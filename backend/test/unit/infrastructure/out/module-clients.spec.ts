import type { HttpService } from '@nestjs/axios';
import { Test, type TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CHANNEX_PORT } from '../../../../src/application/ports/out/channex.port.js';
import { MODULE1_PORT } from '../../../../src/application/ports/out/module1.port.js';
import { MODULE3_PORT } from '../../../../src/application/ports/out/module3.port.js';
import { AppConfigModule } from '../../../../src/infrastructure/config/app-config.module.js';
import { ChannexClientModule } from '../../../../src/infrastructure/out/channex/channex-client.module.js';
import { ChannexHttpAdapter } from '../../../../src/infrastructure/out/channex/channex-http.adapter.js';
import { Module1ClientModule } from '../../../../src/infrastructure/out/module1/module1-client.module.js';
import { Module1HttpAdapter } from '../../../../src/infrastructure/out/module1/module1-http.adapter.js';
import { Module3ClientModule } from '../../../../src/infrastructure/out/module3/module3-client.module.js';
import { Module3HttpAdapter } from '../../../../src/infrastructure/out/module3/module3-http.adapter.js';

/** La configuración del cliente HTTP de un adaptador. */
const clientDefaults = (adapter: object) =>
  (adapter as { http: HttpService }).http.axiosRef.defaults;

describe('Clientes de los Módulos 1 y 3 y de Channex', () => {
  let moduleRef: TestingModule;

  // Arrancar Nest por primera vez puede tardar más que el tiempo de una prueba: se hace una sola vez.
  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        AppConfigModule,
        Module1ClientModule,
        Module3ClientModule,
        ChannexClientModule,
      ],
    }).compile();
  }, 30_000);

  afterAll(async () => {
    await moduleRef.close();
  });

  it('el Módulo 1 usa MODULE1_BASE_URL y el tiempo máximo de 1 s', () => {
    const adapter = moduleRef.get(MODULE1_PORT);

    expect(adapter).toBeInstanceOf(Module1HttpAdapter);
    expect(clientDefaults(adapter)).toMatchObject({
      baseURL: 'http://localhost:4001',
      timeout: 1000,
    });
  });

  it('Channex usa el tiempo máximo de 10 s y lee su dirección en cada llamada', () => {
    const adapter = moduleRef.get(CHANNEX_PORT);

    expect(adapter).toBeInstanceOf(ChannexHttpAdapter);
    expect(clientDefaults(adapter)).toMatchObject({ timeout: 10_000 });
    expect(clientDefaults(adapter).baseURL).toBeUndefined();
  });

  it('el Módulo 3 usa MODULE3_BASE_URL y el tiempo máximo de 3 s', () => {
    const adapter = moduleRef.get(MODULE3_PORT);

    expect(adapter).toBeInstanceOf(Module3HttpAdapter);
    expect(clientDefaults(adapter)).toMatchObject({
      baseURL: 'http://localhost:4003',
      timeout: 3000,
    });
  });
});
