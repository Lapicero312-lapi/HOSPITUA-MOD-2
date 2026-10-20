import { BusinessError } from '../../../../src/domain/shared/business-error.js';

describe('BusinessError', () => {
  it('guarda el código y el mensaje literal', () => {
    const error = new BusinessError(
      'NO_AVAILABILITY',
      'Ya no hay disponibilidad para las fechas solicitadas.',
    );

    expect(error.errorCode).toBe('NO_AVAILABILITY');
    expect(error.message).toBe(
      'Ya no hay disponibilidad para las fechas solicitadas.',
    );
  });

  it('es un Error', () => {
    const error = new BusinessError(
      'NO_AVAILABILITY',
      'Ya no hay disponibilidad para las fechas solicitadas.',
    );

    expect(error).toBeInstanceOf(Error);
  });

  it('no conoce códigos HTTP', () => {
    expect(
      new BusinessError(
        'NO_AVAILABILITY',
        'Ya no hay disponibilidad para las fechas solicitadas.',
      ),
    ).not.toHaveProperty('status');
  });
});
