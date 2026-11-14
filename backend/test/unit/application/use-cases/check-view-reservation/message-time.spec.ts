import { describe, expect, it } from 'vitest';
import {
  colombiaTime,
  colombiaTimeWithMicroseconds,
} from '../../../../../src/application/use-cases/check-view-reservation/message-time.js';

describe('Horas de los mensajes al Módulo 1 (plan, "Anotar un cambio")', () => {
  describe('colombiaTime: occurredAt y generatedAt, con segundos', () => {
    it('el occurredAt del ejemplo de UPDATED: las 14:15 UTC son las 09:15 en Colombia', () => {
      expect(colombiaTime(new Date('2026-10-09T14:15:00.000Z'))).toBe(
        '2026-10-09T09:15:00-05:00',
      );
    });

    it('el occurredAt del ejemplo de NO_SHOW: el cierre corre a las 00:00:30 del día siguiente', () => {
      expect(colombiaTime(new Date('2026-10-10T05:00:30.000Z'))).toBe(
        '2026-10-10T00:00:30-05:00',
      );
    });

    it('antes de las 05:00 UTC todavía es el día anterior en Colombia', () => {
      expect(colombiaTime(new Date('2026-10-10T04:59:59.000Z'))).toBe(
        '2026-10-09T23:59:59-05:00',
      );
    });

    it('los milisegundos no se escriben: se cortan, no se redondean', () => {
      expect(colombiaTime(new Date('2026-10-09T14:15:00.999Z'))).toBe(
        '2026-10-09T09:15:00-05:00',
      );
    });
  });

  describe('colombiaTimeWithMicroseconds: updatedAt, con sus seis decimales', () => {
    it.each([
      [
        'como la entrega la base en hora de Colombia',
        '2026-10-08 15:42:10.123456-05',
      ],
      ['como la entrega la base en UTC', '2026-10-08 20:42:10.123456+00'],
      ['en ISO 8601 con Z', '2026-10-08T20:42:10.123456Z'],
      ['en ISO 8601 con -05:00', '2026-10-08T15:42:10.123456-05:00'],
      ['con una zona de horas y minutos', '2026-10-09 07:12:10.123456+10:30'],
    ])(
      'el updatedAt del ejemplo de la lista, %s, es 2026-10-08T15:42:10.123456-05:00',
      (_, timestamp) => {
        expect(colombiaTimeWithMicroseconds(timestamp)).toBe(
          '2026-10-08T15:42:10.123456-05:00',
        );
      },
    );

    it('completa los decimales que la base no escribe: .1 es .100000', () => {
      expect(colombiaTimeWithMicroseconds('2026-10-09 14:15:00.1+00')).toBe(
        '2026-10-09T09:15:00.100000-05:00',
      );
    });

    it('sin decimales, el del ejemplo de UPDATED: .000000', () => {
      expect(colombiaTimeWithMicroseconds('2026-10-09 14:15:00+00')).toBe(
        '2026-10-09T09:15:00.000000-05:00',
      );
    });

    it('cambia de día si en Colombia todavía es el anterior', () => {
      expect(
        colombiaTimeWithMicroseconds('2026-10-09 02:00:00.000001+00'),
      ).toBe('2026-10-08T21:00:00.000001-05:00');
    });

    it.each([
      ['sin zona', '2026-10-08 15:42:10.123456'],
      ['solo la fecha', '2026-10-08'],
      ['con más de seis decimales', '2026-10-08 15:42:10.1234567-05'],
      ['vacía', ''],
    ])('una fecha %s es un error del programa', (_, timestamp) => {
      expect(() => colombiaTimeWithMicroseconds(timestamp)).toThrow(
        'no es una fecha con hora y zona',
      );
    });
  });
});
