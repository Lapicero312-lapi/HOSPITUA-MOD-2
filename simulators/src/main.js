import { combinedHandler } from './combined.js';
import { createSimulatorServer } from './http.js';
import { module1Handler } from './module1.js';
import { module3Handler } from './module3.js';

/**
 * Arranca los simuladores (plan base, "Simuladores del Módulo 1 y del Módulo 3"). Con `PORT`, como en
 * Render, los dos responden en ese único puerto ("Despliegue de la demo (Render)"). Sin ella, cada uno en
 * su puerto: los de `MODULE1_BASE_URL` y `MODULE3_BASE_URL` en desarrollo, que se pueden cambiar con
 * `MODULE1_SIMULATOR_PORT` y `MODULE3_SIMULATOR_PORT`. Con `RABBITMQ_URL`, el Módulo 1 también publica los avisos
 * de Check-In y Check-Out a pedido y consume la lista del día ("El Módulo 1 por RabbitMQ (demo)").
 */
// `amqplib` se carga solo con RabbitMQ: sin `RABBITMQ_URL`, el simulador no necesita nada instalado.
const publisher = process.env.RABBITMQ_URL
  ? await (
      await import('./module1-messaging.js')
    ).connectModule1Messaging(process.env.RABBITMQ_URL)
  : undefined;
if (publisher) {
  console.log(
    'Simulador del Módulo 1 conectado a RabbitMQ: POST /simulate/check-in y /simulate/check-out',
  );
}

const simulators = process.env.PORT
  ? [
      {
        name: 'Módulo 1 y Módulo 3',
        port: Number(process.env.PORT),
        handler: combinedHandler({ publisher }),
      },
    ]
  : [
      {
        name: 'Módulo 1',
        port: Number(process.env.MODULE1_SIMULATOR_PORT ?? 4001),
        handler: module1Handler({ publisher }),
      },
      {
        name: 'Módulo 3',
        port: Number(process.env.MODULE3_SIMULATOR_PORT ?? 4003),
        handler: module3Handler(),
      },
    ];

for (const { name, port, handler } of simulators) {
  createSimulatorServer(name, handler).listen(port, () => {
    console.log(`Simulador del ${name} en el puerto ${port}`);
  });
}
