import { createServer } from 'node:http';

/** El cuerpo más grande que se lee de una solicitud: las de los contratos son de unos pocos bytes. */
const MAX_BODY_BYTES = 10_000;

/**
 * @typedef {{ status: number; body: unknown }} Reply
 * @typedef {(request: { method: string; url: URL; body: string }) => Reply | Promise<Reply>} Handler
 */

/**
 * @param {number} status
 * @param {unknown} body
 * @returns {Reply}
 */
export function reply(status, body) {
  return { status, body };
}

/**
 * Un error con la forma `{ code, message }`. El Módulo 2 solo mira el estado HTTP.
 * @param {number} status
 * @param {string} code
 * @param {string} message
 */
export function errorReply(status, code, message) {
  return reply(status, { code, message });
}

/**
 * Un servidor HTTP que responde JSON con lo que diga `handler`. Nunca responde 500: un error inesperado
 * sale como 400, como piden los contratos. Escribe en la consola el método, la ruta y el estado de cada
 * solicitud (los simuladores no tienen datos personales).
 * @param {string} name el nombre que sale en la consola
 * @param {Handler} handler
 */
export function createSimulatorServer(name, handler) {
  return createServer((request, response) => {
    readBody(request)
      .then((body) => {
        const url = new URL(request.url ?? '/', 'http://simulator');
        return handler({ method: request.method ?? 'GET', url, body });
      })
      .catch(() =>
        errorReply(400, 'BAD_REQUEST', 'La solicitud no se pudo leer.'),
      )
      .then(({ status, body }) => {
        response.writeHead(status, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(body));
        console.log(`[${name}] ${request.method} ${request.url} → ${status}`);
      });
  });
}

/** @param {import('node:http').IncomingMessage} request */
function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY_BYTES) {
        reject(new Error('cuerpo demasiado grande'));
        request.destroy();
      }
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}
