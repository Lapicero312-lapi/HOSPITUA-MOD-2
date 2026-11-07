import { api } from './apiClient';
import type {
  DaySummary,
  DirectCreateRequest,
  DirectPreview,
  DirectPreviewRequest,
  CancelRequest,
  CancelResponse,
  ModificationBody,
  ModificationPreview,
  GuestLookup,
  ListFilters,
  Ota,
  ReservationDetail,
  ReservationPage,
  RoomsResponse,
} from '../types';

export function listReservations(filters: ListFilters) {
  const qs = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => {
    if (v) qs.set(k, v);
  });
  return api<ReservationPage>(`/reservations?${qs}`);
}
export const getDaySummary = () => api<DaySummary>('/reservations/day-summary');
export const getReservation = (ref: string) =>
  api<ReservationDetail>(`/reservations/${encodeURIComponent(ref)}`);
export const listOtas = () => api<Ota[]>('/otas');
export const listRooms = () => api<RoomsResponse>('/rooms');
export const previewDirect = (body: DirectPreviewRequest) =>
  api<DirectPreview>('/reservations/direct/preview', {
    method: 'POST',
    body: JSON.stringify(body),
  });
export const createDirect = (
  body: DirectCreateRequest,
  idempotencyKey: string,
) =>
  api<ReservationDetail>('/reservations/direct', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Idempotency-Key': idempotencyKey },
  });
export const lookupGuest = (documentType: string, documentNumber: string) =>
  api<GuestLookup>(
    `/guests/lookup?${new URLSearchParams({ documentType, documentNumber })}`,
  );
export const previewModification = (ref: string, body: ModificationBody) =>
  api<ModificationPreview>(
    `/reservations/${encodeURIComponent(ref)}/modification-preview`,
    { method: 'POST', body: JSON.stringify(body) },
  );
export const updateReservation = (ref: string, body: ModificationBody) =>
  api<ReservationDetail>(`/reservations/${encodeURIComponent(ref)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
export const cancelReservation = (ref: string, body: CancelRequest) =>
  api<CancelResponse>(`/reservations/${encodeURIComponent(ref)}/cancellation`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
