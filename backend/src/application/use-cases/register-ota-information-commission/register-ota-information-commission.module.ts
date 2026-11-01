import { Module } from '@nestjs/common';
import { ManageOtaService } from './manage-ota.service.js';
import { MANAGE_OTA } from './ports/in/manage-ota.port.js';
import { REGISTER_OTA_CONFIRMATION_AND_COMMISSION } from './ports/in/register-ota-confirmation-and-commission.port.js';
import { RegisterOtaConfirmationAndCommissionService } from './register-ota-confirmation-and-commission.service.js';

/**
 * Los servicios de `register-ota-information-commission` (plan base, regla 4 de la arquitectura). Usa
 * `OTA_REPOSITORY` y `RESERVATION_REPOSITORY` de `PersistenceModule`, que es global.
 */
@Module({
  providers: [
    { provide: MANAGE_OTA, useClass: ManageOtaService },
    {
      provide: REGISTER_OTA_CONFIRMATION_AND_COMMISSION,
      useClass: RegisterOtaConfirmationAndCommissionService,
    },
  ],
  exports: [MANAGE_OTA, REGISTER_OTA_CONFIRMATION_AND_COMMISSION],
})
export class RegisterOtaInformationCommissionModule {}
