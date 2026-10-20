import {
  BusinessError,
  NotFoundError,
  TooManyRequestsError,
} from '../../../../src/domain/shared/business-error.js';

describe('BusinessError', () => {
  it('guarda el código y el mensaje literal', () => {
    const error = new BusinessError('NO_AVAILABILITY', 'No hay disponibilidad');

    expect(error.errorCode).toBe('NO_AVAILABILITY');
    expect(error.message).toBe('No hay disponibilidad');
  });

  it('es un Error y conserva el nombre de su clase', () => {
    const error = new NotFoundError('RESERVATION_NOT_FOUND', 'No existe');

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(BusinessError);
    expect(error.name).toBe('NotFoundError');
    expect(new TooManyRequestsError('A', 'b').name).toBe(
      'TooManyRequestsError',
    );
  });

  it('no conoce códigos HTTP', () => {
    expect(new BusinessError('A', 'b')).not.toHaveProperty('status');
  });
});
