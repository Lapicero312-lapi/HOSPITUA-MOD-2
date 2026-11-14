import { Module } from '@nestjs/common';
import { GetOtaService } from './get-ota.service.js';
import { ListOtaCommissionsService } from './list-ota-commissions.service.js';
import { ListOtasService } from './list-otas.service.js';
import { ManageOtaService } from './manage-ota.service.js';
import { OtaConnectionTrackerService } from './ota-connection-tracker.service.js';
import { GET_OTA } from './ports/in/get-ota.port.js';
import { LIST_OTA_COMMISSIONS } from './ports/in/list-ota-commissions.port.js';
import { LIST_OTAS } from './ports/in/list-otas.port.js';
import { MANAGE_OTA } from './ports/in/manage-ota.port.js';
import { OTA_CONNECTION_TRACKER } from './ports/in/ota-connection-tracker.port.js';
import { REGISTER_OTA_CONFIRMATION_AND_COMMISSION } from './ports/in/register-ota-confirmation-and-commission.port.js';
import { RegisterOtaConfirmationAndCommissionService } from './register-ota-confirmation-and-commission.service.js';

/**
 * Los servicios de `register-ota-information-commission` (plan base, regla 4 de la arquitectura). Usa
 * `OTA_REPOSITORY`, `RESERVATION_REPOSITORY`, `RESERVATION_QUERY_PORT` y `COMMISSION_AUDIT_REPOSITORY` de
 * `PersistenceModule`, que
 * es global.
 */
@Module({
  providers: [
    { provide: MANAGE_OTA, useClass: ManageOtaService },
    { provide: OTA_CONNECTION_TRACKER, useClass: OtaConnectionTrackerService },
    {
      provide: REGISTER_OTA_CONFIRMATION_AND_COMMISSION,
      useClass: RegisterOtaConfirmationAndCommissionService,
    },
    { provide: LIST_OTAS, useClass: ListOtasService },
    { provide: GET_OTA, useClass: GetOtaService },
    { provide: LIST_OTA_COMMISSIONS, useClass: ListOtaCommissionsService },
  ],
  exports: [
    MANAGE_OTA,
    OTA_CONNECTION_TRACKER,
    REGISTER_OTA_CONFIRMATION_AND_COMMISSION,
    LIST_OTAS,
    GET_OTA,
    LIST_OTA_COMMISSIONS,
  ],
})
export class RegisterOtaInformationCommissionModule {}
