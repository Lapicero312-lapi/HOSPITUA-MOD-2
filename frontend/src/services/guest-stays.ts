import { apiRequest } from './api-client.ts';

export type GuestStay = {
  reservationRef: string;
  guest: {
    firstName: string;
    lastName: string;
    documentType: string;
    documentNumber: string;
    nationality: string;
    isForeign: boolean;
  };
  entryDate: string | null;
  exitDate: string | null;
  inHotel: boolean;
};

export type GuestStayPage = {
  items: GuestStay[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  message: string | null;
};

export type GuestStayFilters = {
  nationality: 'ALL' | 'FOREIGN' | 'COLOMBIAN';
  presence: 'ALL' | 'IN_HOTEL' | 'CHECKED_OUT';
  dateFrom: string;
  dateTo: string;
  search: string;
  page: number;
};

export type GuestStayDetail = {
  reservationRef: string;
  reservationLink: string;
  guest: {
    documentType: string | null;
    documentNumber: string | null;
    firstName: string | null;
    lastName: string | null;
    birthDate: string | null;
    nationality: string | null;
    isForeign: boolean;
    originPlace: string | null;
    destinationPlace: string | null;
  };
  movements: Array<{
    movementType: 'ENTRY' | 'DEPARTURE';
    movementDate: string | null;
  }>;
};

export function listGuestStays(
  filters: GuestStayFilters,
): Promise<GuestStayPage> {
  const params = new URLSearchParams();
  if (filters.nationality !== 'ALL') {
    params.set('nationality', filters.nationality);
  }
  if (filters.presence !== 'ALL') {
    params.set('presence', filters.presence);
  }
  if (filters.dateFrom) {
    params.set('dateFrom', filters.dateFrom);
  }
  if (filters.dateTo) {
    params.set('dateTo', filters.dateTo);
  }
  if (filters.search.trim()) {
    params.set('search', filters.search.trim());
  }
  if (filters.page > 1) {
    params.set('page', String(filters.page));
  }
  const query = params.size > 0 ? `?${params.toString()}` : '';
  return apiRequest<GuestStayPage>(`/guest-stays${query}`);
}

export function getGuestStayDetail(
  reservationRef: string,
  documentNumber: string,
): Promise<GuestStayDetail> {
  return apiRequest<GuestStayDetail>(
    `/reservations/${encodeURIComponent(reservationRef)}/guests/${encodeURIComponent(documentNumber)}`,
  );
}
