import { describe, expect, it } from 'vitest';
import {
  clientForLog,
  correlationIdFor,
  logLevelFor,
  routePattern,
} from '../../../../src/infrastructure/shared/logging.options.js';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('correlationIdFor', () => {
  it('reutiliza el X-Correlation-Id recibido si cumple ^[\\w-]{1,100}$', () => {
    expect(correlationIdFor('modulo1_abc-123')).toBe('modulo1_abc-123');
    expect(correlationIdFor('a'.repeat(100))).toBe('a'.repeat(100));
  });

  it.each([
    ['sin cabecera', undefined],
    ['vacío', ''],
    ['de más de 100 caracteres', 'a'.repeat(101)],
    ['con caracteres no permitidos', '<script>alert(1)</script>'],
    ['con espacios', 'abc 123'],
    ['repetido (llega como lista)', ['abc', 'def']],
  ])('%s genera un UUID nuevo', (_, received) => {
    const correlationId = correlationIdFor(received);

    expect(correlationId).toMatch(UUID);
  });

  it('cada UUID generado es distinto', () => {
    expect(correlationIdFor(undefined)).not.toBe(correlationIdFor(undefined));
  });
});

describe('clientForLog', () => {
  it.each(['RECEPTIONIST', 'MODULE1', 'MODULE3'])(
    'registra %s tal cual',
    (client) => {
      expect(clientForLog(client)).toBe(client);
    },
  );

  it('un valor desconocido se registra como INVALID, no tal cual', () => {
    expect(clientForLog('CC 1144093552')).toBe('INVALID');
    expect(clientForLog('receptionist')).toBe('INVALID');
  });

  it('sin cabecera es null', () => {
    expect(clientForLog(undefined)).toBeNull();
  });
});

describe('routePattern', () => {
  it('es el patrón de la ruta, no la ruta real', () => {
    const res = {
      locals: { routePattern: '/api/reservations/:reservationRef' },
    };

    expect(routePattern(res as never)).toBe(
      '/api/reservations/:reservationRef',
    );
  });

  it('es null si ninguna ruta atendió la solicitud', () => {
    expect(routePattern({} as never)).toBeNull();
  });
});

describe('logLevelFor', () => {
  it('una respuesta correcta va con nivel info', () => {
    expect(logLevelFor(200)).toBe('info');
    expect(logLevelFor(201)).toBe('info');
  });

  it('un error respondido (4xx) va con nivel warn', () => {
    expect(logLevelFor(400)).toBe('warn');
    expect(logLevelFor(429)).toBe('warn');
  });

  it('un fallo sin respuesta controlada va con nivel error', () => {
    expect(logLevelFor(500)).toBe('error');
    expect(logLevelFor(200, new Error('fallo'))).toBe('error');
  });
});
