import { Ota } from '../../../../domain/ota/ota.js';
import type { ConnectionStatus } from '../../../../domain/shared/enums.js';
import { OtaTable } from '../tables/ota.table.js';
import { decimalText } from './decimal-text.js';

export function otaToDomain(row: OtaTable): Ota {
  return Ota.restore({
    id: row.id,
    name: row.name,
    hotelAccountId: row.hotelAccountId,
    commissionPercentage: decimalText(row.commissionPercentage),
    connectionStatus: row.connectionStatus as ConnectionStatus,
    linkedAt: row.linkedAt,
    lastSyncAt: row.lastSyncAt,
  });
}

export function otaToTable(ota: Ota): OtaTable {
  return Object.assign(new OtaTable(), {
    id: ota.id,
    name: ota.name,
    hotelAccountId: ota.hotelAccountId,
    commissionPercentage: ota.commissionPercentage,
    connectionStatus: ota.connectionStatus,
    linkedAt: ota.linkedAt,
    lastSyncAt: ota.lastSyncAt,
  });
}
