import { BusinessError } from '../../../../src/domain/shared/business-error.js';

describe('BusinessError', () => {
  it('guarda el código y el mensaje literal', () => {
    const error = new BusinessError('NO_AVAILABILITY', 'No hay disponibilidad');

    expect(error.errorCode).toBe('NO_AVAILABILITY');
    expect(error.message).toBe('No hay disponibilidad');
  });

  it('es un Error con el nombre de su clase', () => {
    const error = new BusinessError('NO_AVAILABILITY', 'No hay disponibilidad');

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('BusinessError');
  });

  it('no conoce códigos HTTP', () => {
    expect(new BusinessError('A', 'b')).not.toHaveProperty('status');
  });
});
