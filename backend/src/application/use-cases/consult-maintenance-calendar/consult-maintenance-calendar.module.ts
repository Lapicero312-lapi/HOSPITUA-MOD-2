import { Module } from '@nestjs/common';
import { ConsultMaintenanceCalendarService } from './consult-maintenance-calendar.service.js';
import { CONSULT_MAINTENANCE_CALENDAR } from './ports/in/consult-maintenance-calendar.port.js';

/**
 * Los servicios de `consult-maintenance-calendar` (plan base, regla 4 de la arquitectura). Usa
 * `MODULE1_PORT` de `Module1ClientModule`, que es global.
 */
@Module({
  providers: [
    {
      provide: CONSULT_MAINTENANCE_CALENDAR,
      useClass: ConsultMaintenanceCalendarService,
    },
  ],
  exports: [CONSULT_MAINTENANCE_CALENDAR],
})
export class ConsultMaintenanceCalendarModule {}
