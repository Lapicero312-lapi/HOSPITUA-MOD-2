import { Module } from '@nestjs/common';
import { ConsultMaintenanceCalendarModule } from '../consult-maintenance-calendar/consult-maintenance-calendar.module.js';
import { ConsultRoomInventoryService } from './consult-room-inventory.service.js';
import { ListRoomsWithMaintenanceService } from './list-rooms-with-maintenance.service.js';
import { CONSULT_ROOM_INVENTORY } from './ports/in/consult-room-inventory.port.js';
import { LIST_ROOMS_WITH_MAINTENANCE } from './ports/in/list-rooms-with-maintenance.port.js';

/**
 * Los servicios de `consult-room-inventory` (plan base, regla 4 de la arquitectura). Usa `MODULE1_PORT`
 * y `MAINTENANCE_CONCURRENCY` de `Module1ClientModule` y `CLOCK` de `ClockModule`, que son globales, y
 * `ConsultMaintenanceCalendar` de `consult-maintenance-calendar`.
 */
@Module({
  imports: [ConsultMaintenanceCalendarModule],
  providers: [
    { provide: CONSULT_ROOM_INVENTORY, useClass: ConsultRoomInventoryService },
    {
      provide: LIST_ROOMS_WITH_MAINTENANCE,
      useClass: ListRoomsWithMaintenanceService,
    },
  ],
  exports: [CONSULT_ROOM_INVENTORY, LIST_ROOMS_WITH_MAINTENANCE],
})
export class ConsultRoomInventoryModule {}
