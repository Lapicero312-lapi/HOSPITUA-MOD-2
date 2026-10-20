import {
  BusinessError,
  CONCURRENT_UPDATE,
  ConcurrentUpdateError,
  NotFoundError,
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
  });

  it('el conflicto de concurrencia usa el código y el mensaje de los planes', () => {
    const error = new ConcurrentUpdateError();

    expect(error).toBeInstanceOf(BusinessError);
    expect(error.errorCode).toBe(CONCURRENT_UPDATE);
    expect(error.errorCode).toBe('CONCURRENT_UPDATE');
    expect(error.message).toBe(
      'Esta reserva ya fue actualizada o cancelada recientemente',
    );
  });

  it('no conoce códigos HTTP', () => {
    expect(new BusinessError('A', 'b')).not.toHaveProperty('status');
  });
});
