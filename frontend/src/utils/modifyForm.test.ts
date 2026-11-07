import { describe, expect, it } from 'vitest';
import type { ReservationDetail } from '../types';
import { buildBody, initialValues, validateModification } from './modifyForm';

const r = {
  reservationRef: 'RSV-3F9A1C7B', status: 'ACTIVE', source: 'DIRECT', externalConfirmationCode: null, otaName: null, startDate: '2026-11-10', endDate: '2026-11-12',
  nights: 2, guestCount: 2, notes: '', createdAt: '', updatedAt: 'U1', conflict: null, cancellation: null,
  rooms: [{ roomId: 'room-201', roomNumber: '201', categoryRoom: 'SUPERIOR', guestCount: 2, roomGrossAmount: null, stayStatus: 'EXPECTED' }],
  guest: { firstName: 'Ana', lastName: 'Pérez', documentType: 'CC', documentNumber: '1', nationality: 'Colombia', contactPhone: null, contactEmail: null },
} as ReservationDetail;
const cap = () => 3;

describe('formulario de modificación', () => {
  it('sin cambios no hay cuerpo; solo viaja lo que cambió, sin nationality', () => {
    const v = initialValues(r);
    expect(buildBody(r, v)).toBeNull();
    expect(buildBody(r, { ...v, notes: 'Llegada tarde' })).toEqual({ updatedAt: 'U1', notes: 'Llegada tarde' });
    expect(buildBody(r, { ...v, guest: { ...v.guest, contactPhone: '+57 300' } })).toEqual({ updatedAt: 'U1', guest: { contactPhone: '+57 300' } });
    expect(buildBody(r, { ...v, startDate: '2026-11-11', endDate: '2026-11-13' })).toMatchObject({ startDate: '2026-11-11', endDate: '2026-11-13' });
  });
  it('valida con los mensajes del plan', () => {
    const v = initialValues(r);
    expect(validateModification(v, '2026-11-02', cap)).toBeNull();
    expect(validateModification({ ...v, startDate: '2026-11-01' }, '2026-11-02', cap)).toMatch(/anterior a hoy/);
    expect(validateModification({ ...v, rooms: [] }, '2026-11-02', cap)).toMatch(/al menos una habitación/);
    expect(validateModification({ ...v, rooms: [...v.rooms, ...v.rooms] }, '2026-11-02', cap)).toMatch(/ya forma parte/);
    expect(validateModification({ ...v, rooms: [{ roomId: 'room-201', guestCount: 4 }] }, '2026-11-02', cap)).toMatch(/supera la capacidad/);
    expect(validateModification({ ...v, notes: 'x'.repeat(501) }, '2026-11-02', cap)).toMatch(/500/);
  });
});
