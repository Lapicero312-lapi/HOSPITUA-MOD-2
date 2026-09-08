# Especificación de Funcionalidad: Procesar Datos de Huéspedes Extranjeros

**Creado**: 2026-09-07

## Escenarios de Usuario y Pruebas *(obligatorio)*

La funcionalidad de Procesar Datos de Huéspedes Extranjeros (`Process Foreign Guest Data`) permite a la **Recepcionista** (o al **Huésped** en auto-registro) capturar, verificar y almacenar localmente la información migratoria requerida para los huéspedes cuya nacionalidad no sea local (`Guest.type` igual a `FOREIGN`). Toda la interacción ocurre dentro de la misma interfaz de check-in (o portal de pre-check-in), por lo que las distintas actividades de captura, validación de reglas de permanencia y corrección de inconsistencias no se modelan como historias de usuario independientes sino como pasos y escenarios dentro del mismo flujo funcional:

- Cuando el huésped admitido o registrado es clasificado como extranjero (`Guest.type` igual a `FOREIGN`), el sistema exige la captura de sus datos migratorios obligatorios: número de documento o pasaporte (`documentId`), nacionalidad (`nationality`), tipo de visa (`visaType`), y fechas de vigencia de permanencia (`stayDates`).
- El sistema evalúa localmente que todos los campos obligatorios estén presentes, que el tipo de visa sea válido según la tabla oficial, y que la vigencia del permiso de estadía cubra la totalidad de las fechas reservadas (`endDate` de `Reservation`).
- Al resultar exitosa la validación, el sistema registra el resultado como `PASSED` en la entidad `MigratoryValidation` y establece su estado de exportación en `PENDING` (`sireExportStatus`), almacenando los datos localmente en la base de datos. Este procesamiento únicamente valida y guarda la información en el sistema local; el proceso de check-in **no** realiza, programa ni depende del envío de reportes al organismo externo **Migración Colombia**. La funcionalidad de **"Export SIRE File"** (Exportar Archivo SIRE) es un proceso desacoplado e independiente, exclusivo del actor **Migración**, y no forma parte del alcance de esta especificación.
- Si algún dato es inválido, incompleto o incoherente, el sistema registra el resultado como `FAILED`, detalla los campos faltantes en `missingFields` y responde con una alerta controlada **HTTP 400 (Bad Request)**, permitiendo a la Recepcionista corregir la información en la misma pantalla sin perder los datos ya ingresados.
- Para los huéspedes nacionales (`Guest.type` igual a `NATIONAL`), este procesamiento es omitido automáticamente por el sistema.

**Estados de la entidad `Reservation`** (deben mantenerse en concordancia estricta en todo el sistema): `PENDING`, `ACTIVE`, `CHECKED_IN`, `CHECKED_OUT`, `CANCELLED`. Esta funcionalidad procesa datos migratorios para reservas en estado `ACTIVE` durante el check-in.

**Estados de la entidad `Room`** relevantes (propiedad del Módulo 1): `AVAILABLE`, `OCCUPIED`, `CLEANING`, `OUT_OF_SERVICE`.

**Estados y atributos de la entidad `MigratoryValidation`**:
- `result`: `PASSED`, `FAILED`.
- `sireExportStatus`: `PENDING`, `EXPORTED`.

---

### Historia de Usuario 1 - Validación y Registro Local de Datos Migratorios para Huéspedes Extranjeros (Prioridad: P1)

Una Recepcionista está realizando el registro de check-in de un huésped cuyo tipo es extranjero (`Guest.type` igual a `FOREIGN`). Para cumplir con la normativa legal de registro de extranjeros en el hotel, la Recepcionista ingresa los datos migratorios del huésped en la pantalla de check-in. El sistema valida que la información esté completa, que el tipo de visa sea válido y que la vigencia del permiso cubra el rango de la estadía. Si la validación es exitosa, el sistema guarda localmente el registro de `MigratoryValidation` en estado `PASSED` con `sireExportStatus` en `PENDING`, permitiendo avanzar con la admisión del huésped. Esta historia es el flujo maestro de la funcionalidad: abarca en una sola pantalla el camino feliz de validación, la verificación de coincidencia con la reserva, y las alertas controladas por datos incompletos o vencidos.

**Por qué esta prioridad**: Es el flujo crítico y obligatorio (Happy Path) para operar el negocio respetando el marco legal migratorio. Por sí sola entrega un MVP completo de validación local: garantiza que todo huésped extranjero admitido tenga sus datos migratorios en regla y guardados en el sistema antes de confirmar el check-in, habilitando el posterior reporte SIRE sin bloquear la admisión del huésped.

**Prueba Independiente**: Se puede probar de forma aislada ingresando los datos migratorios de un huésped extranjero con un pasaporte válido, nacionalidad y tipo de visa reconocidos, y fechas de vigencia que cubran la estadía. Se verifica que el sistema cree una `MigratoryValidation` con resultado `PASSED` y `sireExportStatus` en `PENDING`, guardando los datos en la base de datos y retornando una confirmación exitosa. La prueba se complementa enviando solicitudes con tipo de visa ausente o vigencia de visa menor a la fecha de salida, verificando que la `MigratoryValidation` quede en `FAILED` y la solicitud sea bloqueada de manera segura con **HTTP 400**.

**Escenarios de Aceptación**:

*Escenarios de Éxito (Happy Path)*

1. **Escenario**: Procesamiento exitoso de datos migratorios completos para un huésped extranjero
   - **Dado** que la Recepcionista tiene en pantalla un check-in en proceso para una reserva `ACTIVE` con un huésped extranjero (`Guest.type` igual a `FOREIGN`)
   - **Cuando** la Recepcionista ingresa un `documentId` válido, `nationality` extranjera, `visaType` autorizado, y `stayDates` cuya fecha de expiración sea igual o posterior al `endDate` de la `Reservation`
   - **Entonces** el sistema registra una `MigratoryValidation` en estado `PASSED` con `sireExportStatus` en `PENDING`, persiste los datos migratorios localmente en la base de datos, y retorna un estado favorable para habilitar la confirmación del check-in

2. **Escenario**: Exención automática del procesamiento para huéspedes nacionales
   - **Dado** que la Recepcionista procesa el check-in de un huésped con `Guest.type` igual a `NATIONAL`
   - **Cuando** el sistema evalúa la necesidad de validación migratoria
   - **Entonces** el sistema omite el procesamiento de `MigratoryValidation`, no exige campos de visa ni vigencia de permanencia extranjera, y permite continuar directamente con el flujo normal de check-in

*Escenarios de Error / Caminos Tristes*

3. **Escenario**: Rechazo controlado por tipo de visa ausente o no reconocido
   - **Dado** que la Recepcionista procesa los datos de un huésped extranjero (`Guest.type` igual a `FOREIGN`)
   - **Cuando** la Recepcionista deja el campo `visaType` vacío o ingresa un código de visa no registrado en la tabla oficial del sistema
   - **Entonces** el sistema marca el resultado de `MigratoryValidation` como `FAILED`, registra `visaType` dentro del atributo `missingFields`, y responde con un error controlado **HTTP 400 (Bad Request)** detallando que el tipo de visa es obligatorio y debe ser válido, impidiendo la finalización del check-in hasta su corrección

4. **Escenario**: Rechazo por vigencia del permiso de permanencia inferior a la estadía reservada
   - **Dado** un huésped extranjero cuya visa o permiso de permanencia en `stayDates` vence en una fecha anterior al `endDate` de la `Reservation`
   - **Cuando** la Recepcionista intenta procesar y guardar la validación migratoria
   - **Entonces** el sistema marca la `MigratoryValidation` con resultado `FAILED`, registra la inconsistencia en `missingFields`, y responde con una alerta **HTTP 400 (Bad Request)** indicando que la vigencia del permiso migratorio no cubre la fecha de salida del hotel

---

### Historia de Usuario 2 - Corrección y Re-validación de Datos Migratorios (Prioridad: P2)

Cuando una evaluación previa de datos migratorios resulta en estado `FAILED` debido a un error tipográfico en el pasaporte, una nacionalidad mal seleccionada o una visa omitida, la Recepcionista puede corregir los campos erróneos en la misma pantalla y solicitar una re-evaluación del registro.

**Por qué esta prioridad**: Es un flujo alternativo importante para la operación diaria de recepción. Permite subsanar errores humanos de digitación sin tener que cancelar ni reiniciar desde cero el proceso de check-in, garantizando fluidez operativa en la recepción.

**Prueba Independiente**: Se puede probar registrando primero una `MigratoryValidation` en estado `FAILED` sobre una reserva `ACTIVE`. Posteriormente, desde la misma pantalla, la Recepcionista actualiza el campo erróneo (por ejemplo, corregir el número de pasaporte o adjuntar el tipo de visa) y envía la re-validación. Se confirma que el sistema actualiza el registro de `MigratoryValidation` a `PASSED`, cambia `sireExportStatus` a `PENDING`, y despeja los bloqueos de admisión.

**Escenarios de Aceptación**:

1. **Escenario**: Re-validación exitosa tras la corrección de datos en pantalla
   - **Dado** que un huésped extranjero cuenta con una `MigratoryValidation` previa en estado `FAILED` por tener el `documentId` incompleto
   - **Cuando** la Recepcionista corrige el valor de `documentId` con el número oficial del pasaporte y presiona la opción de re-validar
   - **Entonces** el sistema procesa nuevamente los datos, actualiza el estado de `MigratoryValidation` a `PASSED` con `sireExportStatus` en `PENDING`, limpia la lista de `missingFields`, y habilita la confirmación del check-in

2. **Escenario**: Mantenimiento del estado fallido ante corrección persistente con datos inválidos
   - **Dado** una `MigratoryValidation` en estado `FAILED`
   - **Cuando** la Recepcionista intenta re-validar modificando un campo pero dejando otro atributo obligatorio vacío
   - **Entonces** el sistema mantiene el resultado de `MigratoryValidation` en `FAILED`, responde con un código **HTTP 400 (Bad Request)** especificando qué campo continúa pendiente, y no permite finalizar el check-in

---

### Historia de Usuario 3 - Pre-carga Autónoma de Datos Migratorios por el Huésped (Prioridad: P3)

Un Huésped con una reserva confirmada en estado `ACTIVE` accede al portal web de autogestión antes de su llegada e ingresa autónomamente sus datos migratorios (`documentId`, `nationality`, `visaType`, `stayDates`). El sistema procesa y almacena la `MigratoryValidation` en estado `PASSED` de forma anticipada.

**Por qué esta prioridad**: Es una característica deseable de optimización y confort. Reduce sustancialmente los tiempos de espera en la recepción durante las horas pico de check-in, pero no es crítica para que el negocio funcione, ya que la Recepcionista siempre puede realizar la captura directamente en mostrador.

**Prueba Independiente**: Se prueba autenticando a un **Guest** en el portal web, seleccionando su reserva `ACTIVE`, completando el formulario de datos migratorios y enviando la solicitud. Se verifica que en la base de datos se cree el registro `MigratoryValidation` en `PASSED` con `sireExportStatus` en `PENDING` y `validatedBy` indicando el canal web del huésped. Posteriormente, al consultar la reserva desde la consola de Recepcionista, se confirma que los datos figuran pre-validados.

**Escenarios de Aceptación**:

1. **Escenario**: Pre-carga migratoria autónoma exitosa desde el portal web
   - **Dado** un **Guest** autenticado en el portal web con una reserva confirmada en estado `ACTIVE`
   - **Cuando** el Huésped diligencia y envía el formulario con todos sus datos migratorios válidos antes de su fecha de llegada
   - **Entonces** el sistema genera una `MigratoryValidation` en estado `PASSED` con `sireExportStatus` en `PENDING`, asociándola a la reserva para que esté disponible de forma inmediata en la recepción del hotel

2. **Escenario**: Rechazo de pre-carga web por datos migratorios incompletos
   - **Dado** un **Guest** diligenciando sus datos migratorios en el portal web
   - **Cuando** el Huésped envía la información sin adjuntar la fecha de vencimiento de su permiso de permanencia
   - **Entonces** el sistema rechaza la pre-carga, responde con un código **HTTP 400 (Bad Request)** indicando los datos faltantes en la interfaz web, y no genera un registro `MigratoryValidation` en estado `PASSED`

---

### Casos Borde

- **Envío de formulario con campos obligatorios vacíos o ausentes**: si la Recepcionista o el Huésped intenta procesar los datos migratorios omitiendo campos esenciales como `documentId`, `nationality` o `visaType`, el sistema debe interceptar la solicitud antes de procesarla, rechazar la operación con un error de negocio controlado **HTTP 400 (Bad Request)**, y retornar un mensaje claro indicando específicamente qué campos están ausentes, prohibiendo estrictamente que se generen excepciones no capturadas que provoquen un error de infraestructura **HTTP 500**.
- **Ingreso de fechas migratorias en formato inválido o con inconsistencia lógica**: si se envían fechas con formatos de texto no reconocidos o si la fecha de inicio del permiso de permanencia es posterior a su fecha de expiración en `stayDates`, el sistema debe validar el formato y la coherencia lógica, rechazando la solicitud con un código **HTTP 400 (Bad Request)** y un mensaje amigable al usuario, evitando fallos en el motor de base de datos o excepciones **HTTP 500**.
- **Presencia de caracteres especiales o patrones maliciosos en campos de texto libre**: si en los campos de `documentId` o en el nombre de la nacionalidad se detectan caracteres extraños, símbolos no permitidos o secuencias asociadas a inyección de código, el sistema debe sanitizar e interceptar la entrada, respondiendo con un error **HTTP 400 (Bad Request)** y bloqueando la persistencia de datos sospechosos sin afectar la estabilidad del servidor.
- **Intento de procesar datos migratorios sobre un huésped de nacionalidad local (`NATIONAL`)**: si se intenta invocar el procesamiento migratorio para un huésped clasificado como `NATIONAL`, el sistema intercepta la acción y responde con un código **HTTP 400 (Bad Request)** explicando que la validación migratoria aplica exclusivamente a huéspedes extranjeros (`FOREIGN`).
- **Concurrencia al procesar los datos migratorios del mismo huésped**: si dos Recepcionistas intentan validar los datos migratorios del mismo `Guest` al mismo tiempo, el sistema controla la transacción para garantizar que solo una `MigratoryValidation` en estado `PASSED` sea registrada y vinculada a la reserva, evitando duplicidad de registros.

---

## Requisitos *(obligatorio)*

### Requisitos Funcionales

- **FR-001**: El sistema DEBE requerir la captura y validación de datos migratorios exclusivamente para los huéspedes clasificados con `Guest.type` igual a `FOREIGN`.
- **FR-002**: El sistema NO DEBE solicitar ni procesar registros de `MigratoryValidation` para huéspedes cuyo `Guest.type` sea `NATIONAL`.
- **FR-003**: El sistema DEBE exigir como obligatorios los siguientes atributos para la entidad `MigratoryValidation`: `documentId` (pasaporte o documento migratorio equivalente), `nationality`, `visaType` y `stayDates`.
- **FR-004**: El sistema DEBE verificar que el `visaType` suministrado coincida con la lista oficial de tipos de visa y permisos autorizados por las autoridades migratorias.
- **FR-005**: El sistema DEBE validar que la fecha de vencimiento incluida en `stayDates` sea igual o posterior a la fecha final de la reserva (`endDate` de la entidad `Reservation`).
- **FR-006**: El sistema DEBE registrar la entidad `MigratoryValidation` con estado `result` igual a `PASSED` cuando todos los datos obligatorios sean válidos y coherentes.
- **FR-007**: El sistema DEBE registrar la entidad `MigratoryValidation` con estado `result` igual a `FAILED` y listar los atributos omitidos o erróneos en el campo `missingFields` cuando se detecten inconsistencias.
- **FR-008**: El sistema DEBE asignar el valor `PENDING` al atributo `sireExportStatus` en toda `MigratoryValidation` que alcance el estado `PASSED`, dejándola disponible para su posterior uso en la exportación de reportes.
- **FR-009**: El sistema DEBE almacenar localmente en la base de datos los datos migratorios validados y NO DEBE realizar ni requerir conexión o transmisión síncrona/asíncrona hacia sistemas externos de Migración durante la validación o el check-in.
- **FR-010**: El sistema DEBE condicionar la finalización exitosa del `CheckIn` de un huésped `FOREIGN` a la existencia de una `MigratoryValidation` en estado `PASSED`.
- **FR-011**: El sistema DEBE permitir a la `Receptionist` corregir y re-evaluar los datos de una `MigratoryValidation` en estado `FAILED` desde la misma pantalla de recepción.
- **FR-012**: El sistema DEBE permitir al actor `Guest` realizar la pre-carga y validación anticipada de sus datos migratorios a través del portal web de autogestión para reservas en estado `ACTIVE`.
- **FR-013**: El sistema DEBE interceptar cualquier fallo de validación de entradas (campos obligatorios vacíos, fechas en formatos inválidos o caracteres no permitidos) y responder estrictamente con códigos **HTTP 400 (Bad Request)** acompañados de un mensaje amigable; el sistema DEBE prohibir que estas inconsistencias se propaguen como errores **HTTP 500**.
- **FR-014**: El sistema DEBE mantener un registro auditable de cada intento de validación migratoria, almacenando la fecha de ejecución, el actor responsable (`Receptionist` o `Guest`), el resultado obtenido (`PASSED` | `FAILED`) y el detalle de inconsistencias detectadas.

### Requisitos No Funcionales

- **NFR-001**: El tiempo total de procesamiento y evaluación local de la `MigratoryValidation` en el servidor DEBE ser inferior a 1 segundo por cada huésped.
- **NFR-002**: Los datos migratorios de los huéspedes extranjeros DEBEN ser almacenados en la base de datos cumpliendo con los estándares de seguridad y protección de datos personales vigentes, garantizando confidencialidad y restricciones de acceso no autorizado.

### Entidades Clave *(incluir si la funcionalidad involucra datos)*

- **MigratoryValidation**: Representa la verificación local de cumplimiento de datos migratorios para un huésped extranjero. Atributos clave: `id` (identificador único), `guestRef` (referencia al `Guest`), `reservationRef` (referencia a la `Reservation`), `submittedData` (datos presentados: `documentId`, `nationality`, `visaType`, `stayDates`), `result` (`PASSED` | `FAILED`), `missingFields` (lista de atributos incompletos o erróneos), `sireExportStatus` (`PENDING` | `EXPORTED`), `validatedAt` (fecha y hora del procesamiento), y `validatedBy` (actor responsable: `Receptionist` o `Guest`).
- **Guest**: Representa al huésped asociado al proceso. Atributos clave: `fullName` (nombre completo), `documentId` (documento de identidad o pasaporte), `nationality` (nacionalidad), y `type` (`NATIONAL` | `FOREIGN`). Para huéspedes con `type` igual a `FOREIGN`, se requiere obligatoriamente una `MigratoryValidation` en estado `PASSED` para su admisión.
- **Reservation**: Representa la estadía reservada sobre la cual se registran los huéspedes. Atributos clave: `reservationRef` (código de reserva), `startDate` (fecha de llegada), `endDate` (fecha de salida), `assignedRoom` (habitación asignada), y `status` con valores posibles: `PENDING`, `ACTIVE`, `CHECKED_IN`, `CHECKED_OUT`, `CANCELLED`.
- **CheckIn**: Representa el evento de admisión formal en el hotel. Atributos clave: `reservationRef`, `guests` (lista de huéspedes admitidos), `assignedRoom`, `arrivalTime` (momento real de ingreso), `receptionist` (Recepcionista responsable), y `status` (`IN_HOUSE`). Su confirmación para huéspedes `FOREIGN` exige que la `MigratoryValidation` asociada esté en `PASSED`.
- **Room**: Representa la unidad física de alojamiento asignada al huésped (propiedad del Módulo 1). Atributos clave: `roomId` (identificador de habitación), `roomType` (tipo de habitación), y `status` (`AVAILABLE`, `OCCUPIED`, `CLEANING`, `OUT_OF_SERVICE`).

---

## Criterios de Éxito *(obligatorio)*

### Resultados Medibles

- **SC-001**: El 100% de los huéspedes extranjeros (`Guest.type` igual a `FOREIGN`) que completan el registro de check-in cuentan con una `MigratoryValidation` registrada en estado `PASSED` y `sireExportStatus` en `PENDING`.
- **SC-002**: El 100% de los huéspedes de nacionalidad local (`Guest.type` igual a `NATIONAL`) completan su admisión sin requerir ni generar registros de validación migratoria extranjera.
- **SC-003**: Cero errores de servidor **HTTP 500** son generados ante envíos de datos migratorios con formatos vacíos, fechas inválidas o caracteres no autorizados; el 100% de estos intentos es respondido con errores de negocio **HTTP 400 (Bad Request)** controlados y mensajes amigables.
- **SC-004**: Una Recepcionista puede capturar y validar los datos migratorios de un huésped extranjero en la pantalla de check-in en menos de 30 segundos.
- **SC-005**: El 95% de las re-validaciones intentadas tras una respuesta `FAILED` se resuelven exitosamente en el primer reintento gracias a la claridad del detalle proporcionado en `missingFields`.
- **SC-006**: El 100% de las validaciones aprobadas (`PASSED`) almacenan los datos migratorios localmente en la base de datos quedando listas con `sireExportStatus` en `PENDING` para la posterior ejecución desacoplada del reporte SIRE.
