import { apiRequest } from './api-client.ts';

export type OtaConnectionStatus = 'CONNECTED' | 'DISCONNECTED';

export type Ota = {
  id: string;
  name: string;
  commissionPercentage: number | null;
  connectionStatus: OtaConnectionStatus;
  linkedAt: string;
  lastSyncAt: string;
  activeReservations: number;
};

export type OtaList = {
  items: Ota[];
  total: number;
};

export function listOtas(): Promise<OtaList> {
  return apiRequest<OtaList>('/otas');
}
