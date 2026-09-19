# Feature Specification: Procesar Datos de Huésped Extranjero

**Created**: 2026-09-08

## Use Case (Caso de Uso)

### Descripción del problema

Cuando un huésped extranjero llega al hotel, la ley exige verificar y conservar ciertos datos
migratorios (pasaporte, nacionalidad, tipo de visa y fechas de estadía) antes de admitirlo, para
poder reportarlos después a Migración mediante "Exportar archivo SIRE". Si el Check-In avanza sin
validar estos datos, el hotel queda expuesto a sanciones legales y a un reporte SIRE incompleto o
inexacto. Al mismo tiempo, la verificación no puede convertirse en un trámite lento que retrase el
ingreso del huésped en el mostrador, ni en un dato que quede congelado sin poder corregirse cuando
el recepcionista comete un error de tipeo. El negocio necesita un procesamiento local, obligatorio
solo para huéspedes `FOREIGN`, que valide los campos mínimos exigidos y deje los datos disponibles
para corrección posterior mientras la estadía siga vigente.

Este procesamiento es puramente local y lógico dentro del Módulo 2: no interactúa bajo ninguna
circunstancia con el Módulo 1. Es el propio caso de uso de Check-In quien, una vez que verifica que
el `MigratoryValidation.result` resultante es `PASSED`, invoca de forma síncrona "Establecer el
estado de la habitación" para solicitar el cambio de la `Habitation` física a `Occupied`; esa
interacción física con el Módulo 1 no forma parte del alcance de esta funcionalidad.

### Flujo de Usuario de Alto Nivel

1. Durante el registro de Check-In, cuando el `Guest` a admitir tiene `type` igual a `FOREIGN`, el
   sistema exige y presenta el formulario de datos migratorios (`MigratoryValidation`).
2. El **Recepcionista** ingresa el pasaporte, la nacionalidad, el tipo de visa y las fechas de
   estadía del huésped.
3. El sistema valida localmente que los cuatro campos estén presentes, tengan un formato correcto y
   sean lógicamente coherentes (por ejemplo, que la fecha de ingreso al país no sea futura).
4. Si la validación es exitosa, el sistema registra el `MigratoryValidation` con resultado `PASSED`
   y permite que el Check-In continúe hacia su confirmación.
5. Si faltan datos o son inválidos, el sistema bloquea la confirmación del Check-In, marca el
   `MigratoryValidation` como `FAILED` y detalla los `missingFields` que deben corregirse.
6. Una vez que la reserva del huésped está `CHECKED_IN`, el Recepcionista puede corregir los datos
   migratorios ya registrados desde el resumen de la reserva, sin necesidad de repetir el Check-In.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Captura y Validación de Datos Migratorios en el Check-In (Priority: P1)

El Recepcionista ingresa los datos migratorios de un `Guest` `FOREIGN` (pasaporte, nacionalidad,
tipo de visa y fechas de estadía) en la misma pantalla de Check-In. El sistema valida que los
cuatro campos estén completos y sean coherentes antes de permitir que el Check-In se confirme. Por
tratarse de un único paso dentro del flujo de admisión, el camino exitoso y el bloqueo por datos
incompletos o inválidos se consolidan en esta misma historia de usuario y no se modelan como
pantallas separadas.

**Why this priority**: Es el camino crítico que asegura el cumplimiento legal del reporte SIRE
antes de alojar al huésped. Sin esta validación, el Check-In podría completarse con datos
migratorios incompletos, exponiendo al hotel a sanciones y a un reporte SIRE defectuoso.

**Independent Test**: Se puede probar de forma independiente ingresando los datos migratorios
completos de un `Guest` `FOREIGN` durante un Check-In y verificando que el `MigratoryValidation`
quede en `PASSED` y que el Check-In continúe. Se completa dejando el pasaporte vacío y confirmando
que el sistema bloquea la confirmación con `MigratoryValidation` en `FAILED`.

**Acceptance Scenarios**:

1. **Scenario**: Registro exitoso de datos migratorios para huésped extranjero (Happy Path)
   - **Given** una reserva en estado `ACTIVE` asignada a un `Guest` con `type` `FOREIGN`
   - **When** el Recepcionista ingresa el pasaporte, la nacionalidad, el tipo de visa y las fechas
     de estadía completos y válidos
   - **Then** el sistema registra el `MigratoryValidation` con resultado `PASSED` y permite que el
     Check-In continúe hacia su confirmación

2. **Scenario**: Bloqueo por dato migratorio obligatorio faltante (Error)
   - **Given** una reserva en estado `ACTIVE` asignada a un `Guest` `FOREIGN`
   - **When** el Recepcionista intenta confirmar el Check-In dejando el número de pasaporte vacío
   - **Then** el sistema registra el `MigratoryValidation` con resultado `FAILED`, detalla en
     `missingFields` el dato faltante, y no permite completar el Check-In

---

### User Story 2 - Corrección de Datos Migratorios sobre una Estadía en Curso (Priority: P2)

El Recepcionista corrige la información migratoria de un `Guest` `FOREIGN` que ya tiene el
Check-In realizado, desde la vista de resumen de la reserva, cuando detecta un error de tipeo en el
registro original.

**Why this priority**: Es un flujo alternativo importante para resolver errores humanos de captura
sin obligar a deshacer el Check-In ya confirmado, pero no bloquea la admisión inicial del huésped.

**Independent Test**: Se puede probar editando un `MigratoryValidation` existente de un `Guest` con
Check-In ya realizado y comprobando que los cambios se guardan correctamente en la base de datos
local.

**Acceptance Scenarios**:

1. **Scenario**: Corrección exitosa de un dato migratorio
   - **Given** una reserva en estado `CHECKED_IN` con `MigratoryValidation` en `PASSED`
   - **When** el Recepcionista corrige la fecha de ingreso al país del huésped desde el resumen de
     la reserva
   - **Then** el sistema guarda la modificación exitosamente y refleja el nuevo dato en la interfaz
     sin alterar el estado del Check-In

2. **Scenario**: Rechazo de corrección con formato de fecha inválido (Error)
   - **Given** una reserva en estado `CHECKED_IN`
   - **When** el Recepcionista intenta actualizar la fecha de ingreso colocando un formato no
     reconocido
   - **Then** el sistema rechaza la actualización y notifica que el formato de fecha no es válido,
     conservando el dato previamente validado

### Casos Borde

- ¿Qué sucede si el pasaporte o la nacionalidad se envían vacíos de forma maliciosa a través de la
  red? El sistema intercepta la falla antes de que alcance la base de datos y retorna un código
  **HTTP 400 (Bad Request)** controlado con el mensaje "El pasaporte y la nacionalidad son
  obligatorios".
- ¿Qué sucede si la fecha de ingreso al país proporcionada es futura? El sistema valida que es
  lógicamente imposible y rechaza la petición con **HTTP 400** y el mensaje "La fecha de ingreso al
  país no puede ser futura", sin dejar que el error se propague como **HTTP 500**.
- ¿Qué sucede si los datos migratorios contienen caracteres no soportados o patrones maliciosos? El
  sistema sanitiza e intercepta la anomalía y retorna **HTTP 400** indicando "Caracteres no válidos
  en el formulario migratorio".
- ¿Qué sucede si se intenta procesar datos migratorios para un `Guest` cuyo `type` es `NATIONAL`?
  El sistema omite el procesamiento por completo: `MigratoryValidation` no se genera y el Check-In
  continúa sin exigir estos campos.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema debe exigir la captura de los datos migratorios (pasaporte, nacionalidad,
  tipo de visa y fechas de estadía) únicamente cuando el `Guest` a admitir tenga `type` igual a
  `FOREIGN`.
- **FR-002**: El sistema no debe ejecutar ni exigir el procesamiento de datos migratorios para
  huéspedes con `type` igual a `NATIONAL`.
- **FR-003**: El sistema debe validar que la fecha de ingreso al país sea anterior o igual a la
  fecha actual del sistema.
- **FR-004**: El sistema debe bloquear la confirmación del Check-In hasta que los cuatro campos
  migratorios obligatorios estén presentes y sean válidos, registrando el `MigratoryValidation`
  con resultado `PASSED` únicamente en ese caso.
- **FR-005**: El sistema debe registrar el `MigratoryValidation` con resultado `FAILED` y detallar
  en `missingFields` cada campo faltante o inválido cuando la validación no se supere.
- **FR-006**: El sistema debe permitir corregir los datos migratorios ya registrados desde el
  resumen de la reserva mientras esta se encuentre en estado `CHECKED_IN`, sin alterar dicho estado.
- **FR-007**: El sistema debe retornar errores estructurados **HTTP 400 (Bad Request)** ante fallos
  de formato o datos incompletos, prohibiendo que se propaguen como fallas de infraestructura
  **HTTP 500**.

### Non-Functional Requirements

- **NFR-001**: El procesamiento de datos migratorios no debe añadir más de 1 minuto adicional al
  tiempo total de Check-In del huésped en recepción.

### Key Entities *(include if feature involves data)*

- **MigratoryValidation**: Representa el procesamiento local de datos migratorios de un `Guest`
  `FOREIGN`. Atributos: `guestRef`, `submittedData` (pasaporte, nacionalidad, tipo de visa, fechas
  de estadía), `result` (`PASSED` | `FAILED`), `missingFields` (lista de campos faltantes o
  inválidos), y `sireExportStatus` (`PENDING` | `EXPORTED`), que esta funcionalidad inicializa en
  `PENDING` al validar con éxito y que "Exportar archivo SIRE" consume y actualiza después. Los
  datos validados quedan almacenados localmente; su exportación hacia Migración mediante "Exportar
  archivo SIRE" es un caso de uso independiente y desacoplado de esta funcionalidad. Es obligatoria
  para cada `Guest` `FOREIGN` antes de que su `CheckIn` pueda completarse.
- **Guest**: Representa al huésped cuyos datos se procesan. Atributos: `id`, `fullName`,
  `documentNumber`, `nationality`, `contactPhone`, `contactEmail`, y `type` (`NATIONAL` |
  `FOREIGN`), clasificación que determina si esta funcionalidad se activa.
- **Reservation**: Representa la estadía asociada al huésped. Atributos: `reservationRef` y
  `state` con estados permitidos: `ACTIVE`, `CHECKED_IN`, `CHECKED_OUT`, `CANCELLED`. El estado
  `PENDING` queda inhabilitado en los flujos estándar: toda reserva nace directamente en `ACTIVE`.
- **CheckIn**: Representa la admisión del huésped, referenciada únicamente como contexto: el
  `MigratoryValidation` de un `Guest` `FOREIGN` es obligatorio antes de que su `CheckIn` pueda
  completarse.
- **Habitation**: Se referencia únicamente de forma informativa, como contexto del Check-In al que
  pertenece esta validación. Atributos: `habitationId` y `stateHabitation` con los siete estados
  oficiales del glosario: `Available`, `Occupied`, `PendingCleaning`, `InCleaning`,
  `DisabledForRepairs`, `TechnicalBlock`, `Inactive`. Esta funcionalidad no interactúa con el
  Módulo 1 ni modifica el `stateHabitation`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El 100% de los Check-In de huéspedes `FOREIGN` cuentan con un `MigratoryValidation`
  en `PASSED` con sus cuatro campos obligatorios completos.
- **SC-002**: Cero caídas del servidor (**HTTP 500**) son causadas por fechas ilógicas o campos
  vacíos en el proceso migratorio; el 100% se resuelve con **HTTP 400**.
- **SC-003**: El procesamiento de datos migratorios añade como máximo 1 minuto adicional al tiempo
  total de Check-In del huésped en recepción.
