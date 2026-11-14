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
const publisher = await connectRabbitMq(process.env.RABBITMQ_URL);

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

/**
 * RabbitMQ se suma a los contratos REST, que son de los que depende el backend: si no responde al arrancar,
 * queda en el log y los simuladores arrancan sin `/simulate`, como el backend arranca sin RabbitMQ.
 * `amqplib` se carga solo con RabbitMQ: sin `RABBITMQ_URL`, el simulador no necesita nada instalado.
 * @param {string | undefined} url
 * @returns {Promise<import('./module1-messaging.js').Module1Publisher | undefined>}
 */
async function connectRabbitMq(url) {
  if (!url) {
    return undefined;
  }
  try {
    const { connectModule1Messaging } = await import('./module1-messaging.js');
    const connected = await connectModule1Messaging(url);
    console.log(
      'Simulador del Módulo 1 conectado a RabbitMQ: POST /simulate/check-in y /simulate/check-out',
    );
    return connected;
  } catch (error) {
    // Sin la URL: puede traer el usuario y la contraseña.
    console.error(
      `No se pudo conectar el simulador del Módulo 1 a RabbitMQ (${error instanceof Error ? error.message : String(error)}): los simuladores arrancan sin /simulate.`,
    );
    return undefined;
  }
}
