import { describe, expect, inject, it } from 'vitest';
import { integrationEnv } from '../support/database.js';

describe('RabbitMQ de las pruebas de integración', () => {
  it('responde con las credenciales de RABBITMQ_URL y es la versión 4', async () => {
    const url = new URL(integrationEnv().RABBITMQ_URL);
    const credentials = Buffer.from(
      `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`,
    ).toString('base64');

    const response = await fetch(
      `${inject('rabbitmqManagementUrl')}/api/overview`,
      { headers: { Authorization: `Basic ${credentials}` } },
    );

    expect(response.status).toBe(200);
    const overview = (await response.json()) as { rabbitmq_version: string };
    expect(overview.rabbitmq_version).toMatch(/^4\./);
  });
});
