import { describe, expect, it } from 'vitest';
import { formatDate } from './format';
import { validateDateRange, validateSearch } from './validators';

describe('formatDate', () => {
  it('muestra dd/mm/aaaa', () =>
    expect(formatDate('2026-10-23')).toBe('23/10/2026'));
  it('tolera vacíos', () => expect(formatDate(null)).toBe('—'));
});
describe('validateSearch', () => {
  it('acepta código, documento y nombre con tilde', () => {
    ['RSV-3F9A1C7B', '1144093552', 'María José'].forEach((s) =>
      expect(validateSearch(s)).toBeNull(),
    );
  });
  it('rechaza vacío, caracteres raros y nombres cortos', () => {
    expect(validateSearch('   ')).not.toBeNull();
    expect(validateSearch('a;b')).not.toBeNull();
    expect(validateSearch('Jo')).toMatch(/3 caracteres/);
  });
});
describe('validateDateRange', () => {
  it('exige ambas fechas, orden y máximo 366 días', () => {
    expect(validateDateRange('2026-10-01', '')).toMatch(/ambas/);
    expect(validateDateRange('2026-10-05', '2026-10-01')).toMatch(/posterior/);
    expect(validateDateRange('2026-01-01', '2027-12-31')).toMatch(/366/);
    expect(validateDateRange('2026-10-01', '2026-10-31')).toBeNull();
  });
});

import { validateDirectForm } from './directForm';
describe('validateDirectForm', () => {
  const ok = {
    startDate: '2026-11-02',
    endDate: '2026-11-05',
    categoryRoom: 'DOBLE',
    guestCounts: [2],
  };
  it('acepta una solicitud válida', () =>
    expect(validateDirectForm(ok, '2026-11-02')).toBeNull());
  it('rechaza entrada pasada, salida no posterior y habitaciones fuera de rango', () => {
    expect(
      validateDirectForm({ ...ok, startDate: '2026-11-01' }, '2026-11-02'),
    ).toMatch(/anterior a hoy/);
    expect(
      validateDirectForm({ ...ok, endDate: '2026-11-02' }, '2026-11-02'),
    ).toMatch(/posterior/);
    expect(
      validateDirectForm(
        { ...ok, guestCounts: Array(11).fill(1) },
        '2026-11-02',
      ),
    ).toMatch(/entre 1 y 10/);
    expect(
      validateDirectForm({ ...ok, guestCounts: [0] }, '2026-11-02'),
    ).toMatch(/al menos una persona/);
  });
});
