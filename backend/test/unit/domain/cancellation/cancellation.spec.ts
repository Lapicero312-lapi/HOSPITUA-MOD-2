import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  Cancellation,
  type CancellationProps,
} from '../../../../src/domain/cancellation/cancellation.js';

/** La cancelación del ejemplo de A del plan (respuesta 200): la Recepcionista, con su motivo. */
const PROPS: CancellationProps = {
  id: randomUUID(),
  reservationRef: 'RSV-3F9A1C7B',
  cancellationDate: new Date('2026-10-09T10:15:20-05:00'),
  reason: 'El huésped cambió de planes',
  channel: 'RECEPTION',
  processedBy: 'laura.mendez',
  status: 'COMPLETED',
};

describe('Cancellation', () => {
  it('conserva los datos con los que se crea', () => {
    const cancellation = Cancellation.restore(PROPS);

    expect(cancellation.snapshot()).toEqual(PROPS);
    expect(cancellation.reservationRef).toBe('RSV-3F9A1C7B');
    expect(cancellation.channel).toBe('RECEPTION');
    expect(cancellation.status).toBe('COMPLETED');
  });

  it('es inmutable: cambiar los datos de entrada o la copia no la cambia', () => {
    const props = { ...PROPS };
    const cancellation = Cancellation.restore(props);
    props.reason = 'otro motivo';
    cancellation.snapshot().processedBy = 'otra persona';

    expect(cancellation.reason).toBe('El huésped cambió de planes');
    expect(cancellation.processedBy).toBe('laura.mendez');
  });

  it('el motivo es opcional', () => {
    expect(Cancellation.restore({ ...PROPS, reason: null }).reason).toBeNull();
  });
});
