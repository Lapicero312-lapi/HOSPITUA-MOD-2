import { Module } from '@nestjs/common';
import { RegisterOtaInformationCommissionModule } from '../register-ota-information-commission/register-ota-information-commission.module.js';
import { AriChangeRecorderService } from './ari-change-recorder.service.js';
import { EnsureChannexSetupService } from './ensure-channex-setup.service.js';
import { ARI_CHANGE_RECORDER } from './ports/in/ari-change-recorder.port.js';
import { ENSURE_CHANNEX_SETUP } from './ports/in/ensure-channex-setup.port.js';
import { VERIFY_CHANNEX_PROPERTY } from './ports/in/verify-channex-property.port.js';
import { VerifyChannexPropertyService } from './verify-channex-property.service.js';

/**
 * Los servicios de `configure-ota` (plan base, regla 4 de la arquitectura). Usa `CHANNEX_PORT` y
 * `CHANNEX_SETUP_STATE` de `ChannexClientModule`, `CLOCK` de `ClockModule` y
 * `ARI_PENDING_CHANGE_REPOSITORY` de `PersistenceModule`, que son globales, y `ManageOta` de
 * `register-ota-information-commission`.
 */
@Module({
  imports: [RegisterOtaInformationCommissionModule],
  providers: [
    {
      provide: VERIFY_CHANNEX_PROPERTY,
      useClass: VerifyChannexPropertyService,
    },
    { provide: ENSURE_CHANNEX_SETUP, useClass: EnsureChannexSetupService },
    { provide: ARI_CHANGE_RECORDER, useClass: AriChangeRecorderService },
  ],
  exports: [VERIFY_CHANNEX_PROPERTY, ENSURE_CHANNEX_SETUP, ARI_CHANGE_RECORDER],
})
export class ConfigureOtaModule {}
