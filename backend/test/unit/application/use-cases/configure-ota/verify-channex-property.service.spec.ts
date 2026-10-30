import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ChannexRateLimitedError,
  ChannexRejectedError,
  ChannexUnauthorizedError,
  ChannexUnavailableError,
  type ChannexPort,
} from '../../../../../src/application/ports/out/channex.port.js';
import { VerifyChannexPropertyService } from '../../../../../src/application/use-cases/configure-ota/verify-channex-property.service.js';
import { InMemoryChannexSetupState } from '../../../../../src/infrastructure/out/channex/channex-setup.state.js';

const PROPERTY_ID = '716305c4-561a-4561-a187-7f5b8aeb5920';
const API_KEY = 'clave-de-prueba-que-no-debe-salir';

const SETTINGS = {
  CHANNEX_API_KEY: API_KEY,
  CHANNEX_PROPERTY_ID: PROPERTY_ID,
  BOOKING_HOTEL_ID: '10485037',
  BOOKING_COMMISSION_PERCENTAGE: '15',
};

const stateWith = (values: Record<string, string | undefined> = SETTINGS) =>
  new InMemoryChannexSetupState({
    get: (name: string) => values[name],
  } as unknown as ConfigService);

/** Un Channex simulado que solo responde A0. */
const channexWith = (listProperties: ChannexPort['listProperties']) =>
  ({ listProperties: vi.fn(listProperties) }) as unknown as ChannexPort & {
    listProperties: ReturnType<typeof vi.fn>;
  };

const property = (id: string) => ({ id, title: 'Hotel de prueba' });

describe('VerifyChannexPropertyService', () => {
  let logged: string[];

  beforeEach(() => {
    logged = [];
    for (const level of ['log', 'warn', 'error'] as const) {
      vi.spyOn(Logger.prototype, level).mockImplementation(
        (message: unknown) => {
          logged.push(String(message));
        },
      );
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('si la propiedad está en la cuenta, las tareas de Channex quedan listas', async () => {
    const state = stateWith();
    const channex = channexWith(() =>
      Promise.resolve([
        property('2941337f-50d6-4189-ae13-f76efaf9c515'),
        property(PROPERTY_ID.toUpperCase()),
      ]),
    );

    await expect(
      new VerifyChannexPropertyService(channex, state).verify(),
    ).resolves.toBe('READY');
    expect(state.isReady()).toBe(true);
  });

  it('si la propiedad no está en la cuenta, apaga las tareas hasta reiniciar', async () => {
    const state = stateWith();
    const service = new VerifyChannexPropertyService(
      channexWith(() =>
        Promise.resolve([property('2941337f-50d6-4189-ae13-f76efaf9c515')]),
      ),
      state,
    );

    await expect(service.verify()).resolves.toBe('DISABLED');
    expect(state.isReady()).toBe(false);
    expect(state.isDisabled()).toBe(true);
    expect(logged.join('\n')).toContain(
      'La propiedad configurada (CHANNEX_PROPERTY_ID) no existe en Channex',
    );
  });

  it.each([
    ['401', new ChannexUnauthorizedError(401)],
    ['403', new ChannexUnauthorizedError(403)],
    ['otro 4xx (404)', new ChannexRejectedError(404, 'resource_not_found')],
    ['otro 4xx (422)', new ChannexRejectedError(422, null)],
  ])(
    'si Channex responde %s, apaga las tareas hasta reiniciar',
    async (_, error) => {
      const state = stateWith();
      const channex = channexWith(() => Promise.reject(error));
      const service = new VerifyChannexPropertyService(channex, state);

      await expect(service.verify()).resolves.toBe('DISABLED');
      expect(state.isDisabled()).toBe(true);
      // Apagadas: otra verificación ya no llama a Channex.
      await expect(service.verify()).resolves.toBe('DISABLED');
      expect(channex.listProperties).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    ['responde 5xx', new ChannexUnavailableError('respondió 503')],
    [
      'agota el tiempo de espera',
      new ChannexUnavailableError('tiempo de espera agotado'),
    ],
    [
      'no se puede conectar',
      new ChannexUnavailableError('sin respuesta (ECONNREFUSED)'),
    ],
    ['responde 429', new ChannexRateLimitedError()],
  ])(
    'si Channex %s, pide reintentar y las tareas siguen sin trabajar',
    async (_, error) => {
      const state = stateWith();
      const service = new VerifyChannexPropertyService(
        channexWith(() => Promise.reject(error)),
        state,
      );

      await expect(service.verify()).resolves.toBe('RETRY');
      expect(state.isReady()).toBe(false);
      expect(state.isDisabled()).toBe(false);
      expect(logged.join('\n')).toContain('se reintenta en 30 s');
    },
  );

  it('después de un reintento, una respuesta con la propiedad deja las tareas listas', async () => {
    const state = stateWith();
    const channex = channexWith(() => Promise.resolve([property(PROPERTY_ID)]));
    channex.listProperties.mockRejectedValueOnce(
      new ChannexUnavailableError('tiempo de espera agotado'),
    );
    const service = new VerifyChannexPropertyService(channex, state);

    await expect(service.verify()).resolves.toBe('RETRY');
    await expect(service.verify()).resolves.toBe('READY');
    expect(state.isReady()).toBe(true);
  });

  it('con la configuración inválida no llama a Channex y las tareas quedan apagadas', async () => {
    const state = stateWith({ ...SETTINGS, CHANNEX_API_KEY: undefined });
    const channex = channexWith(() => Promise.resolve([property(PROPERTY_ID)]));

    await expect(
      new VerifyChannexPropertyService(channex, state).verify(),
    ).resolves.toBe('DISABLED');
    expect(channex.listProperties).not.toHaveBeenCalled();
    expect(state.isDisabled()).toBe(true);
    expect(logged.join('\n')).toContain(
      'Configuración de Channex incompleta o inválida (CHANNEX_API_KEY)',
    );
  });

  it('ya verificada, no vuelve a llamar a Channex', async () => {
    const state = stateWith();
    const channex = channexWith(() => Promise.resolve([property(PROPERTY_ID)]));
    const service = new VerifyChannexPropertyService(channex, state);

    await service.verify();
    await expect(service.verify()).resolves.toBe('READY');
    expect(channex.listProperties).toHaveBeenCalledTimes(1);
  });

  it('ningún log lleva la clave ni el valor de las variables', async () => {
    await new VerifyChannexPropertyService(
      channexWith(() => Promise.resolve([])),
      stateWith({ ...SETTINGS, BOOKING_COMMISSION_PERCENTAGE: '150' }),
    ).verify();
    await new VerifyChannexPropertyService(
      channexWith(() => Promise.reject(new ChannexUnauthorizedError(401))),
      stateWith(),
    ).verify();

    const all = logged.join('\n');
    expect(all).not.toContain(API_KEY);
    expect(all).not.toContain('150');
    expect(all).not.toContain(PROPERTY_ID);
  });
});

describe('InMemoryChannexSetupState', () => {
  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('empieza sin trabajar hasta que la propiedad se verifique', () => {
    const state = stateWith();

    expect(state.settings()).not.toBeNull();
    expect(state.isReady()).toBe(false);
    expect(state.isDisabled()).toBe(false);
    state.markReady();
    expect(state.isReady()).toBe(true);
  });

  it('apagada, ya no se puede marcar lista', () => {
    const state = stateWith();

    state.disable();
    state.markReady();

    expect(state.isReady()).toBe(false);
    expect(state.isDisabled()).toBe(true);
  });

  it('con la configuración inválida no tiene configuración y está apagada', () => {
    const state = stateWith({});

    expect(state.settings()).toBeNull();
    expect(state.isDisabled()).toBe(true);
    state.markReady();
    expect(state.isReady()).toBe(false);
  });
});
