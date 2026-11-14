import { createServer, type Server, type Socket, connect } from 'node:net';

/** Un proxy TCP hacia un servicio de las pruebas, que la prueba puede cortar y volver a abrir. */
export type TcpProxy = {
  /** El puerto local por el que se entra al servicio. */
  port: number;
  /** Corta las conexiones abiertas y deja de aceptar nuevas: para quien conecta, el servicio cayó. */
  down: () => Promise<void>;
  /** Vuelve a aceptar conexiones en el mismo puerto. */
  up: () => Promise<void>;
  close: () => Promise<void>;
};

/**
 * Abre un proxy en un puerto libre de `127.0.0.1` hacia `host:port`. Sirve para simular la caída de un
 * contenedor compartido (RabbitMQ) solo para la aplicación de una prueba, sin detenerlo para las demás.
 */
export async function startTcpProxy(
  host: string,
  port: number,
): Promise<TcpProxy> {
  const sockets = new Set<Socket>();
  const track = (socket: Socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  };
  const newServer = (): Server =>
    createServer((client) => {
      const upstream = connect(port, host);
      track(client);
      track(upstream);
      client.pipe(upstream).pipe(client);
      client.on('error', () => upstream.destroy());
      upstream.on('error', () => client.destroy());
    });
  const listen = (server: Server, on: number) =>
    new Promise<number>((resolve, reject) => {
      server.once('error', reject);
      server.listen(on, '127.0.0.1', () => {
        const address = server.address();
        resolve(
          typeof address === 'object' && address !== null ? address.port : on,
        );
      });
    });
  const stop = (server: Server) =>
    new Promise<void>((resolve) => {
      for (const socket of sockets) {
        socket.destroy();
      }
      server.close(() => resolve());
    });

  let server = newServer();
  const localPort = await listen(server, 0);
  let listening = true;

  return {
    port: localPort,
    down: async () => {
      if (listening) {
        listening = false;
        await stop(server);
      }
    },
    up: async () => {
      if (!listening) {
        server = newServer();
        await listen(server, localPort);
        listening = true;
      }
    },
    close: async () => {
      if (listening) {
        listening = false;
        await stop(server);
      }
    },
  };
}
