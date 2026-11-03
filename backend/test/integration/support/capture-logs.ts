import { inspect } from 'node:util';
import { Logger } from '@nestjs/common';
import { vi } from 'vitest';

/**
 * Todo lo que se escribe en el log durante la prueba, en cualquier nivel y por cualquier vía: las
 * instancias de `Logger`, sus métodos estáticos y `console`. Lo que no es texto se convierte con `inspect`,
 * con todo su contenido, para que también se vea lo que se escribe como objeto o dentro de un error
 * (`String` solo daría `[object Object]`). Quien la usa restaura los métodos después de cada prueba
 * (`vi.restoreAllMocks()`).
 */
export function captureLogs(): string[] {
  const lines: string[] = [];
  const record = (...args: unknown[]) => {
    lines.push(
      args
        .map((arg) =>
          typeof arg === 'string' ? arg : inspect(arg, { depth: null }),
        )
        .join(' '),
    );
  };
  for (const level of [
    'log',
    'error',
    'warn',
    'debug',
    'verbose',
    'fatal',
  ] as const) {
    vi.spyOn(Logger.prototype, level).mockImplementation(record);
    vi.spyOn(Logger, level).mockImplementation(record);
  }
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, method).mockImplementation(record);
  }
  return lines;
}
