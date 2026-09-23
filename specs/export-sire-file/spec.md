# Feature Specification: Exportar Archivo SIRE

**Created**: 2026-09-19

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Generación y Exportación de SIRE con Datos de Extranjeros (Priority: P2)

Como actor o sistema regulatorio (Migración), necesito extraer periódicamente un archivo consolidado con el formato SIRE, para reportar el alojamiento de huéspedes extranjeros basándome en los datos procesados en la fase de Check-in notificada por el Módulo 1.

**Why this priority**: Es una funcionalidad de cumplimiento normativo legal. Aunque no bloquea la operación diaria del hotel en tiempo real, es obligatorio enviar este reporte periódicamente; de lo contrario, el hotel enfrenta multas migratorias.

**Independent Test**: Puede ser probado generando el archivo SIRE para un periodo de fechas determinado, y validando internamente que su estructura exportada cumple con el formato gubernamental y que incluye sin falta el tipo de movimiento y fecha ingresados durante la notificación del Módulo 1.

**Acceptance Scenarios**:

1. **Scenario**: Exportación exitosa con datos de extranjeros integrados
   - **Given** reservas con huéspedes extranjeros en estado `status: IN_PROGRESS` o `status: COMPLETED` que cuentan con información migratoria notificada previamente por el Módulo 1
   - **When** se solicita la generación y exportación del archivo SIRE para el periodo
   - **Then** el sistema extrae los datos combinados de la `Reservation` y el `Guest`, e incluye obligatoriamente el tipo de movimiento migratorio y la fecha procesados en el Check-in, generando el archivo válido.

2. **Scenario**: Bloqueo por falta de datos requeridos de extranjeros
   - **Given** una `Reservation` que requiere exportación SIRE, pero cuyo `Guest` extranjero carece de tipo de movimiento o fecha migratoria válida
   - **When** el sistema intenta consolidar la exportación del archivo SIRE
   - **Then** el sistema interrumpe el proceso de forma controlada o alerta al usuario mediante un error de validación (HTTP 400), indicando: "Datos incompletos para extranjeros en la reserva X".

3. **Scenario**: Periodo de fechas sin huéspedes extranjeros
   - **Given** un periodo solicitado donde solo hubo reservas nacionales o no hubo ocupación
   - **When** se ejecuta la exportación del archivo SIRE
   - **Then** el sistema genera un reporte o alerta controlada indicando que no hay registros migratorios que reportar, sin generar errores de infraestructura.

### Edge Cases

- ¿Qué sucede si el rango de fechas solicitado para exportar es superior a 1 año y sobrecarga el sistema?
  - El sistema detecta el límite abusivo de consultas, detiene la operación y retorna un código HTTP 400 (Bad Request) con el mensaje: "El periodo solicitado excede el límite permitido. Por favor exporte periodos más cortos."
- ¿Qué ocurre si los datos del `Guest` extranjero tienen caracteres corruptos no válidos para el archivo SIRE?
  - El sistema realiza una validación de saneamiento en la fase de exportación y, si no puede codificarlos, frena el proceso retornando un HTTP 400 (Bad Request) estructurado: "Caracteres no válidos en el registro del huésped."
- ¿Qué sucede si se llama a la API de exportación simultáneamente más veces de las permitidas?
  - El sistema aplica rate-limiting y retorna un HTTP 429 o 400 amigable evitando que el servidor devuelva HTTP 500 por falta de memoria.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema DEBE proveer la capacidad de generar y exportar el archivo SIRE basándose en los registros de huéspedes.
- **FR-002**: El sistema DEBE verificar e integrar correctamente los datos migratorios (tipo de movimiento y fecha) que fueron notificados previamente por el Módulo 1 y almacenados en la entidad `Guest`.
- **FR-003**: El sistema DEBE excluir del archivo final a las reservas que se encuentren en estado `status: CANCELLED` o `status: NO_SHOW`.
- **FR-004**: El sistema DEBE interceptar excepciones de datos incompletos o errores de consulta en base de datos retornando un HTTP 400 controlado para evitar errores técnicos internos (HTTP 500).

### Key Entities

- **`Reservation`**: Entidad base. Se exportan solo reservas efectivas (`IN_PROGRESS` o `COMPLETED`).
- **`Guest`**: Entidad principal de la cual se extrae la nacionalidad, número de documento y los datos migratorios.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El 100% de los archivos exportados contienen la información obligatoria de extranjeros notificada por el Módulo 1 en el formato exacto requerido.
- **SC-002**: 100% de los intentos fallidos por datos incompletos arrojan alertas controladas de negocio (HTTP 400) en vez de crashear el servidor.
