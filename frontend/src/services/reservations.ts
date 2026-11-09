import { apiRequest } from './api-client.ts';
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
  return apiRequest<ReservationPage>(`/reservations?${qs}`);
}
export const getDaySummary = () =>
  apiRequest<DaySummary>('/reservations/day-summary');
export const getReservation = (ref: string) =>
  apiRequest<ReservationDetail>(`/reservations/${encodeURIComponent(ref)}`);
export const listOtas = () => apiRequest<Ota[]>('/otas');
export const listRooms = () => apiRequest<RoomsResponse>('/rooms');
export const previewDirect = (body: DirectPreviewRequest) =>
  apiRequest<DirectPreview>('/reservations/direct/preview', {
    method: 'POST',
    body,
  });
export const createDirect = (
  body: DirectCreateRequest,
  idempotencyKey: string,
) =>
  apiRequest<ReservationDetail>('/reservations/direct', {
    method: 'POST',
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
export const lookupGuest = (documentType: string, documentNumber: string) =>
  apiRequest<GuestLookup>(
    `/guests/lookup?${new URLSearchParams({ documentType, documentNumber })}`,
  );
export const previewModification = (ref: string, body: ModificationBody) =>
  apiRequest<ModificationPreview>(
    `/reservations/${encodeURIComponent(ref)}/modification-preview`,
    { method: 'POST', body },
  );
export const updateReservation = (ref: string, body: ModificationBody) =>
  apiRequest<ReservationDetail>(`/reservations/${encodeURIComponent(ref)}`, {
    method: 'PATCH',
    body,
  });
export const cancelReservation = (ref: string, body: CancelRequest) =>
  apiRequest<CancelResponse>(
    `/reservations/${encodeURIComponent(ref)}/cancellation`,
    { method: 'POST', body },
  );
