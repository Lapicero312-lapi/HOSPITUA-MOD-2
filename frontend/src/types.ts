// Tipos tomados de specs/check-view-reservation/plan.md (C1, C2, C3).
// Si el backend cambia un contrato, se ajusta SOLO este archivo y los mocks.
export type ReservationStatus =
  'PENDING' | 'ACTIVE' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';
export type Source = 'DIRECT' | 'OTA';
export type MigrationStatus =
  'AWAITING_CHECK_IN' | 'COMPLETE' | 'NOT_REQUIRED' | 'NO_CHECK_IN';
export type StayStatus =
  'EXPECTED' | 'CHECKED_IN' | 'CHECKED_OUT' | 'NOT_ARRIVED';

export interface Conflict {
  reason: 'NO_ROOM_AVAILABLE' | 'CAPACITY_EXCEEDED' | 'CHANGE_NOT_APPLICABLE';
  detectedAt: string;
}
export interface Money {
  amount: string;
  currency: string;
} // el dinero viaja como texto decimal

export interface ReservationListItem {
  reservationRef: string;
  externalConfirmationCode: string | null;
  guest: { fullName: string; documentNumber: string | null };
  rooms: { roomNumber: string | null; categoryRoom: string }[]; // roomNumber null = "Sin asignar"
  source: Source;
  otaName: string | null;
  startDate: string; // AAAA-MM-DD
  endDate: string;
  status: ReservationStatus;
  migrationStatus: MigrationStatus;
  conflict: Conflict | null;
  actions: { canModify: boolean; canCancel: boolean; canAssignRoom: boolean };
}
export interface ReservationPage {
  items: ReservationListItem[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  message: string | null;
}
export interface DaySummary {
  operationalDate: string;
  expectedArrivals: number;
  expectedDepartures: number;
}

export interface ReservationDetail {
  reservationRef: string;
  status: ReservationStatus;
  source: Source;
  externalConfirmationCode: string | null;
  otaName: string | null;
  startDate: string;
  endDate: string;
  nights: number;
  guestCount: number;
  notes: string;
  createdAt: string;
  /** Control de concurrencia de modificar/cancelar. PROVISIONAL: el C3 de check-view-reservation aún no lo lista. */
  updatedAt?: string;
  conflict: Conflict | null;
  rooms: {
    roomId?: string;
    roomNumber: string | null;
    categoryRoom: string;
    guestCount: number;
    roomGrossAmount: Money | null;
    stayStatus: StayStatus;
  }[];
  guest: {
    firstName: string;
    lastName: string;
    documentType: string | null;
    documentNumber: string | null;
    nationality: string | null;
    contactPhone: string | null;
    contactEmail: string | null;
  };
  cancellation: {
    cancellationDate: string;
    channel: 'RECEPTION' | 'OTA_API';
    reason: string | null;
    processedBy: string;
  } | null;
}
export interface Ota {
  id: string;
  name: string;
  commissionPercentage: number;
  connectionStatus: 'CONNECTED' | 'DISCONNECTED';
}
export interface ListFilters {
  search?: string;
  status?: string;
  source?: string;
  otaId?: string;
  inConflict?: string;
  dateFrom?: string;
  dateTo?: string;
  order?: string;
  page?: string;
}

export interface Room {
  id: string;
  roomNumber: string;
  categoryRoom: string;
  maxCapacity: number;
  maintenance: {
    status: 'SCHEDULED' | 'NONE' | 'UNAVAILABLE';
    maintenanceStart: string | null;
    maintenanceEnd: string | null;
  };
}
export interface RoomsResponse {
  items: Room[];
  total: number;
}

// generate-direct-reservation (plan, contratos A, B y E)
export interface GuestInput {
  firstName: string;
  lastName: string;
  documentType: string;
  documentNumber: string;
  nationality: string;
  contactPhone?: string;
  contactEmail?: string;
}
export interface DirectPreviewRequest {
  startDate: string;
  endDate: string;
  categoryRoom: string;
  rooms: { guestCount: number }[];
}
export interface DirectPreview {
  availability: {
    startDate: string;
    endDate: string;
    categoryRoom: string;
    availableCount: number;
    rooms: {
      roomId: string;
      roomNumber: string;
      available: boolean;
      reason: string | null;
    }[];
  };
  assignedRooms: {
    position: number;
    roomId: string;
    roomNumber: string;
    maxCapacity: number;
    guestCount: number;
  }[];
  quotes: {
    rooms: {
      key: string;
      categoryRoom: string;
      nights: number;
      nightlyRates: { date: string; rate: Money }[];
      lodgingAmount: Money;
    }[];
    total: Money;
  };
  reservation: { guestCount: number };
}
export interface DirectCreateRequest extends DirectPreviewRequest {
  guest: GuestInput;
  notes?: string;
  expectedRates: { position: number; lodgingAmount: string }[];
}
export interface GuestLookup {
  found: boolean;
  guest:
    | (Omit<GuestInput, 'nationality' | 'contactPhone' | 'contactEmail'> & {
        nationality: string | null;
        contactPhone: string | null;
        contactEmail: string | null;
      })
    | null;
}

// ---- update-reservation (B1, B2) y cancel-reservation (A) ----
export interface ModificationBody {
  updatedAt: string;
  startDate?: string;
  endDate?: string;
  rooms?: { roomId: string; guestCount: number }[];
  guest?: Partial<Omit<GuestInput, 'nationality'>>;
  notes?: string;
  expectedRates?: { roomId: string; lodgingAmount: string }[];
}
export interface ModificationPreview {
  reservationRef: string;
  changes: {
    dates: boolean;
    roomsAdded: string[];
    roomsRemoved: string[];
    roomsSwapped: string[];
    guestCountChanged: boolean;
    guestChanged: boolean;
    notesChanged: boolean;
  };
  requiresConfirmation: boolean;
  availability: {
    rooms: {
      roomId: string;
      roomNumber: string;
      available: boolean;
      reason: string | null;
    }[];
  };
  quotes: {
    rooms: {
      key: string;
      categoryRoom: string;
      nights: number;
      lodgingAmount: Money;
    }[];
    total: Money;
  } | null;
  reservation: { startDate: string; endDate: string; guestCount: number };
}
export interface CancelRequest {
  updatedAt: string;
  acknowledged: boolean;
  reason?: string;
}
export interface CancelResponse {
  reservationRef: string;
  status: 'CANCELLED';
  cancellation: {
    cancellationId: string;
    cancellationDate: string;
    channel: 'RECEPTION';
    reason: string | null;
    processedBy: string;
    status: 'COMPLETED';
  };
}
