### Diccionario General del Proyecto HOSPITUA
**Creado** : 2026-09-07  
**Última Actualización** : 2026-09-28  

Glosario técnico-funcional compartido por los tres módulos del proyecto **HOSPITUA**, diseñado para unificar la terminología, entidades, estados y conceptos clave bajo la metodología **Specification-Driven Development (SDD)** y garantizar la alineación estricta entre los diagramas de casos de uso, la arquitectura de mensajes y los documentos de especificación (`spec.md`).

---

#### Convenciones transversales

* **Nomenclatura** : Los atributos y las entidades se escriben en `camelCase` técnico (por ejemplo `roomNumber`, `categoryRoom`, `startDate`, `endDate`, `grossAmount`, `reservationRef`). Los estados del Módulo 1 se escriben tal como los define este diccionario (PascalCase) y los estados propios del Módulo 2 en `MAYÚSCULAS_CON_GUION_BAJO`.
* **Gobernanza** : Este diccionario es el contrato de integración oficial entre los tres módulos. En lo que pertenece al Módulo 1 y al Módulo 3 (nombres, atributos y estados) manda el diccionario y los specs del Módulo 2 se adaptan a él. Lo propio del Módulo 2 se documenta aquí con la misma nomenclatura que sus specs.
* **Control de errores** : Todo error debe responderse con un código de la familia HTTP 4xx (400 *Bad Request* por defecto), de forma controlada y con un mensaje claro. Están prohibidos los errores HTTP 500 y cualquier respuesta 2xx o 3xx para un error.

---

#### Actores

* **Administrador** : Usuario interno con permisos transversales de gestión. En el Módulo 1: administra el catálogo e inventario de habitaciones. En el Módulo 3: gestiona la facturación, configura tarifas base, supervisa liquidaciones y actualiza el porcentaje de IVA vigente.
* **Personal de limpieza** : Actor operativo del Módulo 1 encargado de la gestión de higiene de las unidades de alojamiento: registra el inicio (`InCleaning`) y la finalización del aseo, cambiando el estado de la habitación a disponible (`Available`).
* **Personal de mantenimiento** : Actor operativo del Módulo 1 responsable de inhabilitar habitaciones por reparaciones físicas (`DisabledForRepairs`) o bloqueos técnicos preventivos (`TechnicalBlock`), registrando y finalizando dichas intervenciones en el calendario de mantenimiento.
* **Gerente** : Actor estratégico con permisos de solo lectura para consultar reportes consolidados de ocupación, estado del inventario, volumen de reservas y métricas financieras.
* **Recepcionista** : Usuario interno del front-desk y actor principal del Módulo 2. Responsable de gestionar reservas directas, procesar modificaciones de estadías, registrar cancelaciones, consultar las reservas, gestionar la atención de huéspedes y generar el archivo SIRE que envía a Migración.
* **OTA (Online Travel Agency)** : Intermediario externo automatizado (ej. Booking, Airbnb, Expedia) que actúa como actor del sistema disparando la creación de reservas remotas (`Generar reservación por ota`) con un código de confirmación externo y consultando la liquidación de comisiones en el Módulo 3.
* **Migración** : Ente gubernamental externo (Migración Colombia) que recibe el reporte SIRE. **No es un actor del sistema**: no accede al Módulo 2. La Recepcionista genera el archivo `.TXT` con la exportación SIRE y lo envía a Migración por los medios que esta disponga, fuera del sistema. El Módulo 2 no realiza envíos automáticos.
* **Módulo 1 (Gestión de Habitaciones e Inventario de Aforo)** : Módulo externo/sistema dueño del inventario físico de habitaciones (`Room.status`), el calendario de mantenimiento, el Check-In y el Check-Out físicos (que notifica al Módulo 2 por habitación) y la captura inicial de datos migratorios de extranjeros. No consulta las reservas al Módulo 2: recibe cada día la lista de reservas del día y sus actualizaciones (`Enviar reservas del día al Módulo 1`).
* **Módulo 2 (Operación de Reservas y Cumplimiento Legal)** : Módulo dueño del ciclo de vida de las reservas (`Reservation.status`), orquestador de la verificación de disponibilidad (triangulación entre Módulo 1 y reservas locales) y generador del archivo legal de migración SIRE.
* **Módulo 3 (Facturación, Consumos y Liquidación)** : Módulo financiero dueño del motor de precios dinámicos (`Calcular tarifa dinámica`), el registro de comisiones OTA, el cálculo de IVA, las liquidaciones y la emisión de facturas fiscales.
* **Responsable de facturación (rol)** : Rol funcional en las historias de usuario del Módulo 3 que representa al Administrador en su ejercicio de conciliación de ingresos netos, comisiones e impuestos.

---

#### Módulo 1: Gestión de Habitaciones e Inventario de Aforo

* **Habitación (Room)** : Unidad física de alojamiento definida por su identificación única (`id`, `roomNumber`), categoría (`categoryRoom`), capacidad máxima de huéspedes (`maxCapacity`) y tarifa base. El Módulo 2 usa `maxCapacity` para validar la cantidad de personas de una reserva.
* **Estado de habitación (Room.status)** : Situación operativa física en tiempo real administrada exclusivamente por el Módulo 1, con 7 estados vigentes más 1 solicitado (`Reserved`):
  * `Available` (Disponible para asignación o reserva)
  * `Reserved` (**Solicitud de adición al Módulo 1, pendiente de aprobación por su equipo.** Reservada para una reserva del Módulo 2 el día de su llegada; no debe asignarse a un cliente sin reserva)
  * `Occupied` (Ocupada por un huésped en estadía activa)
  * `PendingCleaning` (Pendiente de aseo tras un Check-Out)
  * `InCleaning` (En proceso de limpieza por el personal de aseo)
  * `DisabledForRepairs` (Inhabilitada por mantenimiento o reparación física)
  * `TechnicalBlock` (Bloqueada por razones administrativas o de aforo)
  * `Inactive` (Dada de baja del inventario operativo)
* **Solicitud de adición del estado `Reserved`** : Requisito imprescindible para el flujo del día de la reserva (`Marcar habitación como reservada`, definido en el diagrama de integración `mod-1-2-3`), que evita sobreventas a clientes *walk-in*. Mientras el equipo del Módulo 1 no lo incorpore a `Room.status`, esta solicitud queda abierta y los specs del Módulo 2 lo usan como parte de la interfaz solicitada.
* **Calendario de Mantenimientos (MaintenanceCalendar)** : Registro de bloqueos e intervenciones programadas por rango de fechas en Módulo 1, consultado de forma síncrona por el Módulo 2 para evitar vender o asignar habitaciones en reparación.
* **Tarifa base** : Precio regular configurado para una categoría de habitación en el Módulo 1, utilizado por el Módulo 3 como insumo inicial para la cotización dinámica.
* **Datos de Huéspedes Extranjeros (ForeignGuestData)** : Registro de datos migratorios de **cada** huésped extranjero (no solo el titular de la reserva): `firstName`, `lastName`, `documentType`, `documentNumber`, `birthDate`, `nationality`, `movementType` (`ENTRY` | `DEPARTURE`) y `movementDate` (fecha sin hora: `checkInDate` o `checkOutDate`). El Módulo 1 identifica al extranjero por su nacionalidad (distinta de Colombia), asigna el tipo de movimiento y su fecha sin pedírselos a la Recepcionista, y los envía al Módulo 2. Los procesa el Módulo 1 y los envía al Módulo 2 dentro de las notificaciones de Check-In (`ENTRY`) y de Check-Out (`DEPARTURE`) para la consolidación del SIRE.

---

#### Módulo 2: Operación de Reservas y Cumplimiento Legal

* **Reserva (Reservation)** : Entidad principal gobernada por el Módulo 2 que representa la separación de alojamiento para un huésped titular y su grupo, en **una o varias habitaciones** (entre 1 y 10) con las mismas fechas. Atributos: `reservationRef` (identificador único de la reserva y valor con el que el resto de entidades y los demás módulos la referencian), `guestRef` (titular), `guestCount` (cantidad total de personas de la reserva: entero, mayor o igual a la cantidad de habitaciones y menor o igual a la suma de `maxCapacity` de sus habitaciones), `rooms` (lista de `ReservationRoom`), `startDate`, `endDate`, `grossAmount` (suma del valor de sus habitaciones), `source` (`DIRECT` | `OTA`), `externalConfirmationCode`, `commissionPercentage`, `commissionAmount`, `commissionStatus`, `notes` (observaciones de la reserva, opcional, máximo 500 caracteres), `createdAt`, `lateArrivalNotice` (indica que el huésped avisó una llegada tardía; protege la reserva del No-Show solo hasta el cierre del día siguiente a su llegada), `status` y `version` (control de concurrencia optimista).
  * Reserva de canal `DIRECT`: nace en `ACTIVE`, con `externalConfirmationCode` en `null` y comisión en `0`.
  * Reserva de canal `OTA`: nace en `PENDING` y pasa a `ACTIVE` cuando la agencia confirma. Recibe de la OTA el valor bruto (`totalAmount`) y calcula `commissionAmount` como `totalAmount × commissionPercentage`. Su `commissionStatus` es `CALCULATED` | `RECONCILED` | `PAID` | `DISPUTED`.
* **Ciclo de Vida de la Reserva (Reservation.status)** : Estados oficiales y únicos, gobernados de forma estricta por el Módulo 2. No existen alias ni otros valores:
  * `PENDING` : Estado inicial de reservas de canal OTA en proceso de validación o confirmación externa.
  * `ACTIVE` : Estado oficial de reserva confirmada y habilitada para Check-In (estado inicial por defecto para reservas de canal directo).
  * `IN_PROGRESS` : Transición activada cuando el Módulo 1 notifica el Check-In físico de la primera habitación de la reserva.
  * `COMPLETED` : Transición final cuando ya no queda ninguna habitación de la reserva ocupada ni por llegar: todas están en `CHECKED_OUT` o `NOT_ARRIVED`.
  * `CANCELLED` : Anulación de la reserva. Si la habitación ya estaba `Reserved` en el Módulo 1, se le notifica de inmediato para devolverla a `Available`. Aplica a solicitudes explícitas de cancelación y a ausencias sin aviso (*No-Show*) de canal directo.
  * `NO_SHOW` : Estado registrado exclusivamente cuando un huésped de canal OTA no se presenta en la fecha de Check-In sin previo aviso. Libera la habitación física en Módulo 1 pero conserva el registro lógico en Módulo 2 para la conciliación y cobro de comisiones con la OTA.
* **Habitación de la reserva (ReservationRoom)** : Cada habitación asignada a una `Reservation`. Atributos: `reservationRef`, `roomId` (referencia a `Room.id` del Módulo 1), `roomNumber` (copia del número de habitación del Módulo 1, guardada al asignarla), `categoryRoom`, `roomGrossAmount` (valor bruto de esa habitación cotizado por el Módulo 3; solo canal `DIRECT`) y `stayStatus`.
* **Estado de la habitación en la reserva (ReservationRoom.stayStatus)** : Estado de cada habitación dentro de la reserva, gobernado por el Módulo 2 a partir de las notificaciones del Módulo 1 y del cierre del día. No es el estado físico de la `Room`:
  * `EXPECTED` : La habitación está asignada y se espera su llegada (estado inicial).
  * `CHECKED_IN` : El Módulo 1 notificó el Check-In de esa habitación.
  * `CHECKED_OUT` : El Módulo 1 notificó el Check-Out de esa habitación.
  * `NOT_ARRIVED` : La habitación no tuvo Check-In al cierre del día de llegada y se liberó en el Módulo 1.
* **Consultar reservas** : Caso de uso de solo lectura del Módulo 2, usado por la Recepcionista y por los procesos internos. Lista todas las reservas paginadas, las filtra por estado, por fecha (`ARRIVAL`, `DEPARTURE` o `STAY`), por titular y por canal, y busca una reserva por código (`reservationRef` o `externalConfirmationCode`). No lo usan ni el Módulo 1 ni la Ota.
* **Enviar reservas del día al Módulo 1** : Parte del caso de uso "Consultar reservas" (historias 4 y 5 de su especificación). Proceso del Módulo 2 que, al iniciar cada día operativo, envía al Módulo 1 por cola la lista de reservas `ACTIVE` con llegada ese día (`DailyReservationList`) con la cantidad de personas, las habitaciones, el titular, la fecha de salida y los detalles de cada reserva, y después envía cada cambio que afecte a esa lista (`DailyReservationUpdate`: `ADDED`, `UPDATED` o `REMOVED`). Es informativo: no aparta ni libera habitaciones.
* **Lista de reservas del día (DailyReservationList)** : Atributos: `messageId`, `operationalDate`, `generatedAt`, `sequenceNumber` (siempre `1`), `totalReservations`, `totalRooms`, `totalGuests`, `reservations` y `publishStatus` (`PENDING` | `PUBLISHED` | `FAILED`).
* **Actualización de la lista del día (DailyReservationUpdate)** : Atributos: `messageId`, `operationalDate`, `sequenceNumber` (creciente dentro del día operativo), `updateType` (`ADDED` | `UPDATED` | `REMOVED`), `reservationRef`, `reservation` (detalle completo, en `ADDED` y `UPDATED`), `removalReason` (`CANCELLED` | `DATE_CHANGED` | `NO_SHOW`, en `REMOVED`), `occurredAt` y `publishStatus`.
* **Verificar disponibilidades** : Sub-caso de uso centralizado (`«include»`) en Módulo 2 que ejecuta una orquestación síncrona de triple validación antes de crear o modificar cualquier reserva, una vez por cada habitación de la reserva:
  1. Consulta de inventario físico en tiempo real al Módulo 1 (`Consultar inventario de habitaciones`, REST GET).
  2. Consulta de bloqueos en el calendario de mantenimientos al Módulo 1 (`Consultar calendario de mantenimientos`, REST GET).
  3. Cruce local con las habitaciones de las reservas vigentes en la base de datos del Módulo 2 (`Consultar reservas`), excluyendo su propio `reservationRef` en flujos de actualización para evitar falsos bloqueos por solapamiento propio, y las habitaciones en `CHECKED_OUT` o `NOT_ARRIVED`.
* **Tarifa Dinámica Informativa (RateQuote)** : Cotización obtenida síncronamente desde el Módulo 3 mediante `REST - POST` con un cuerpo JSON que contiene `categoryRoom`, `startDate`, `endDate` y, en recotizaciones, `previousGrossAmount`. La respuesta trae `grossAmount`, `amountDifference` (solo en recotizaciones), `currency` y `calculatedAt`. El Módulo 2 la solicita una vez por habitación, congela cada monto en `ReservationRoom.roomGrossAmount` y la suma en `Reservation.grossAmount`, de forma **estrictamente informativa**: no calcula IVA, no aplica comisiones ni modifica el importe bruto retornado.
* **Canal de origen (source)** : Clasificación del origen de la reserva como `DIRECT` (recepción, teléfono, portal propio; 0% comisión) o `OTA` (agencia externa con porcentaje de comisión y código de confirmación).
* **Código de confirmación externo (externalConfirmationCode)** : Identificador único asignado por la agencia de viajes externa; obligatorio para reservas de canal `OTA`, utilizado para trazabilidad y aislamiento de consultas por canal.
* **Huésped (Guest)** : Entidad de datos (no es un actor del sistema) con la persona física que se aloja en el hotel. Atributos: `id`, `fullName`, `documentNumber`, `nationality`, `type` (`NATIONAL` | `FOREIGN`), `contactPhone` y `contactEmail`. Sus datos migratorios los captura el Módulo 1 en el Check-In (`ForeignGuestData`).
* **Agencia (Ota)** : Entidad del intermediario externo que origina reservas. Atributos: `id`, `name` y `commissionPercentage` (porcentaje de comisión pactado por defecto).
* **Cancelación (Cancellation)** : Registro de auditoría de la anulación de una reserva. Atributos: `cancellationId`, `reservationRef`, `cancellationDate`, `reason` (opcional), `channel` (`RECEPTION` | `OTA_API`), `processedBy` y `status` (`COMPLETED`).
* **Marcar habitación como reservada (día de la reserva)** : Cuando la reserva es para el día operativo en curso (al iniciar el día o al crearse una reserva para hoy), el Módulo 2 le ordena al Módulo 1, por `REST POST/PUT` y con una orden por habitación, pasar cada habitación asignada a la reserva a `Reserved`, para que Recepción no la asigne a un cliente sin reserva (*walk-in*). Si la reserva se cancela ese mismo día, el Módulo 2 notifica de inmediato y el Módulo 1 devuelve la habitación a `Available`. Requiere el estado `Reserved` solicitado al Módulo 1.
* **Orden de estado de habitación (RoomStateRequest)** : Orden que el Módulo 2 envía al Módulo 1 para cambiar el estado de una habitación. Atributos: `requestId`, `roomId`, `requestedStatus` (`Reserved` | `Available`), `previousStatus`, `originEvent` (`RESERVATION_CREATED` | `RESERVATION_DUE_TODAY` | `RESERVATION_CANCELLED` | `RESERVATION_NO_SHOW` | `ROOM_CHANGED` | `ROOM_ADDED` | `ROOM_REMOVED` | `ROOM_NOT_ARRIVED` | `DATES_CHANGED`), `reservationRef`, `sequenceNumber` (secuencia creciente y única por habitación, asignada de forma atómica), `requestedAt`, `requestedBy`, `requestStatus` (`PENDING` | `COMPLETED` | `REJECTED`) y `rejectionReason` (`OBSOLETE` | `ROOM_OCCUPIED` | `UNRESOLVED`, solo cuando es `REJECTED`).
* **Incidente de conciliación (ReconciliationIncident)** : Registro de una discrepancia entre el Módulo 1 y el Módulo 2 que una persona debe resolver (por ejemplo, una habitación ocupada sin una reserva vigente). Atributos: `incidentId`, `origin` (`CHECK_IN` | `CHECK_OUT` | `ROOM_STATE`), `reservationRef`, `roomId`, `reason`, `createdAt` y `resolutionStatus` (`OPEN` | `RESOLVED`).
* **No-Show (Ausencia No Notificada)** : Evento operativo desencadenado al cierre del día cuando ninguna habitación de la reserva tuvo Check-In y el huésped no avisó un retraso. En reservas directas cambia a `CANCELLED`; en reservas OTA cambia a `NO_SHOW`. En ambos casos se notifica al Módulo 1 para liberar cada habitación (`Available`). Si llegó solo una parte del grupo, la reserva sigue `IN_PROGRESS` y las habitaciones sin Check-In pasan a `NOT_ARRIVED` y se liberan.
* **SIRE (Validación y Reporte Migratorio)** : Sistema de Información de Registro de Extranjeros de Migración Colombia. El Módulo 2 consolida los datos migratorios recibidos del Módulo 1 (`ForeignGuestData`) en un `MigratoryMovement` por cada huésped y tipo de movimiento, y genera un archivo plano estructurado en formato `.TXT`, con una línea por movimiento y toda la información migratoria del huésped, para que la Recepcionista lo descargue y lo envíe a Migración.
* **Movimiento migratorio (MigratoryMovement)** : Registro del Módulo 2 con un movimiento migratorio de un huésped extranjero en una estadía. Hay uno por cada combinación de reserva, huésped y tipo de movimiento: un huésped que ingresa y sale tiene dos (`ENTRY` y `DEPARTURE`). Atributos: `movementId`, `reservationRef`, `guestRef` (solo si es el titular), `movementType` (`ENTRY` | `DEPARTURE`), `movementDate`, los datos de `ForeignGuestData` copiados, `validationStatus`, `missingFields`, `validationReason` y `reportedInExportId` (exportación en la que se reportó).
* **Estado de validación migratoria (validationStatus)** : Atributo de control del `MigratoryMovement`:
  * `COMPLETE` : Datos migratorios completos y válidos; el registro se incluye en el reporte `.TXT`.
  * `INCOMPLETE` : Datos faltantes o inválidos. Se detallan en `missingFields` y `validationReason`; el registro se omite del reporte y se corrige con un reenvío del Módulo 1.
* **Exportación SIRE (SireExport)** : Histórico de exportaciones del reporte. Atributos: `id` (identificador único de la exportación), `exportDate`, `recordsCount`, `excludedCount`, `dateRangeStart`, `dateRangeEnd`, `includeAlreadyReported` y `processedBy` (la Recepcionista).
* **Registro de Exclusiones SIRE (SireExportExclusion)** : Registro auditable que almacena los huéspedes extranjeros omitidos durante la generación del `.TXT` debido a datos migratorios incompletos o inconsistentes, evitando el rechazo del archivo por la autoridad. Atributos: `exportId` (referencia directa a `SireExport.id`), `reservationRef`, `movementId`, `documentNumber`, `movementType`, `missingFields` y `reason`.

---

#### Módulo 3: Facturación, Consumos y Liquidación

##### Tarifas
* **Temporada (Baja / Regular / Alta)** : Clasificación estacional de las fechas que determina el ajuste porcentual aplicado sobre la tarifa base de la habitación.
* **Tarifa dinámica** : Valor nocturno calculado por el motor oficial de precios del Módulo 3 evaluando temporada, ocupación, anticipación y duración de la estadía.
* **Valor de hospedaje (bruto)** : Suma acumulada de las tarifas dinámicas de todas las noches de la estancia. Sirve de base para el cálculo de la liquidación.

##### Comisión OTA
* **Comisión OTA** : Porcentaje acordado con el intermediario externo, aplicado sobre el valor de hospedaje cuando la reserva proviene de una OTA.
* **Fórmula de comisión** : `-(Valor Hospedaje × % Comisión)`. Solo se aplica a reservas con canal `OTA`; para canal `DIRECT` la comisión es siempre cero (`0`).

##### Impuestos
* **IVA** : Impuesto al Valor Agregado calculado sobre la base gravable de hospedaje al emitir la factura (nunca sobre la comisión OTA descontada).
* **Base gravable** : Importe bruto de hospedaje sobre el que se aplica la tasa de IVA configurada.
* **Porcentaje de IVA vigente** : Tasa tributaria fijada por el Administrador en el Módulo 3, congelada al momento del Check-In.

##### Liquidación
* **Liquidación** : Entidad financiera que consolida la estancia (hospedaje, comisión e ingreso neto). Se genera a partir de eventos de Check-In o Check-Out.
* **Estados de la liquidación** :
  * `Preliminary` (Preliminar: generada al Check-In, modificable si cambia la estadía).
  * `Final` (Definitivo: generada al Check-Out, inmutable, base de la factura final).
  * `Cancelled` (Anulada: registrada si el Check-In es anulado).
* **Ingreso neto** : Valor de hospedaje menos la comisión OTA aplicable, sin incluir impuestos. Es el monto real percibido por el hotel.
* **Detalle / Desglose de liquidación** : Estructura que detalla el valor de hospedaje, el canal de origen, la comisión aplicada y el ingreso neto.

##### Factura
* **Prefactura** : Documento borrador no fiscal emitido al Check-In con carácter informativo para el huésped.
* **Factura fiscal definitiva** : Documento fiscal formal con numeración oficial consecutiva emitido al Check-Out tras el pago.
* **Numeración consecutiva oficial** : Secuencia numérica fiscal única asignada exclusivamente a facturas definitivas.
* **Cliente responsable de facturación** : Datos tributarios (NIT, Cédula, Razón Social) del pagador de la factura.
* **Desglose facturable** : Detalle formal en la factura que expone hospedaje, comisión OTA (referencial), IVA y total neto pagado.

##### Gestión y consulta
* **Consulta de liquidación** : Petición síncrona realizada por un actor autorizado para obtener el estado y desglose financiero de una estancia.
* **Resultado de consulta** : Estructura devuelta que contiene hospedaje, comisión OTA, IVA, ingreso neto y la factura asociada.
* **Ámbito de acceso por actor** : Política de seguridad que restringe a cada OTA a consultar únicamente las liquidaciones y comisiones de sus propias reservas.
* **Resumen consolidado** : Reporte financiero acumulado por rangos de fechas utilizado por el Administrador para conciliar el cobro de comisiones con cada OTA.
