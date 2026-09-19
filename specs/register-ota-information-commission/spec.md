# Feature Specification: Registrar Confirmación y Comisión de OTA

**Created**: 2026-09-08

## Use Case (Caso de Uso)

### Descripción del problema

Cada reserva que llega de una agencia de viajes en línea (OTA) trae consigo una obligación
financiera con esa agencia: una comisión pactada sobre el valor bruto de la estadía. Si esa
comisión no se calcula y se asienta en el mismo instante en que se registra la reserva, la
conciliación posterior con la OTA se vuelve imprecisa y el hotel pierde trazabilidad sobre cuánto
le corresponde retener a cada canal. El negocio necesita un caso de uso interno, invocado siempre
que "Generar Reservación por OTA" registra una nueva reserva, que aplique de forma estricta la
fórmula contractual y deje el importe neto listo para la conciliación mensual con cada agencia.

### Flujo de Usuario de Alto Nivel

1. El caso de uso "Generar Reservación por OTA" invoca internamente "Registrar confirmación y
   comisión de ota" al validar una nueva reserva, enviando el `totalAmount` recibido de la OTA y el
   `externalConfirmationCode`.
2. El sistema consulta el `commissionPercentage` contractual configurado para esa `Ota`.
3. El sistema calcula el `commissionAmount` aplicando estrictamente la fórmula del glosario:
   `totalAmount × commissionPercentage`.
4. El sistema persiste el `commissionAmount` y el `commissionPercentage` en la `Reservation`, junto
   con el `externalConfirmationCode`, y marca el `commissionStatus` como `CALCULATED`.
5. Durante el ciclo de vida de la reserva, el sistema permite conciliar la comisión contra el
   cierre contable mensual, cambiando el `commissionStatus` a `RECONCILED` o `PAID`, o ajustándolo
   a cero cuando la reserva se cancela sin cobro de penalidad.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Cálculo y Registro de Comisión al Confirmar una Reserva OTA (Priority: P1)

Al validarse una nueva reserva proveniente de una `Ota`, el sistema aplica el porcentaje
contractual configurado para esa agencia sobre el `totalAmount` recibido, calcula el
`commissionAmount` y lo persiste junto con el `externalConfirmationCode` en la `Reservation`, con
`commissionStatus` `CALCULATED`. Esta historia es el flujo maestro (Happy Path), invocado siempre
como parte de "Generar Reservación por OTA".

**Why this priority**: Es la funcionalidad esencial para operar con canales de distribución de
terceros: sin ella, el hotel recibiría reservas de OTA sin registrar con exactitud la comisión
pactada ni el ingreso neto real de cada una.

**Independent Test**: Se prueba invocando el caso de uso con un `totalAmount` de \$400 y un
`commissionPercentage` del 15% configurado para la agencia. Se verifica que el sistema calcule un
`commissionAmount` de \$60, lo persista junto al `externalConfirmationCode`, y marque el
`commissionStatus` como `CALCULATED`. Se completa enviando un `commissionPercentage` inválido,
confirmando el rechazo con **HTTP 400**.

**Acceptance Scenarios**:

1. **Scenario**: Registro exitoso de comisión al confirmar una reserva OTA (Happy Path)
   - **Given** una reserva proveniente de una `Ota` válida con `commissionPercentage`
     contractual configurado
   - **When** "Generar Reservación por OTA" invoca "Registrar confirmación y comisión de ota" con
     el `totalAmount` y el `externalConfirmationCode`
   - **Then** el sistema calcula el `commissionAmount` aplicando `totalAmount ×
     commissionPercentage`, lo persiste en la `Reservation`, y marca el `commissionStatus` como
     `CALCULATED`

2. **Scenario**: Rechazo controlado por porcentaje de comisión inválido (Error)
   - **Given** una solicitud de registro de comisión
   - **When** el `commissionPercentage` configurado para el canal es menor a cero o superior al
     100%
   - **Then** el sistema intercepta la solicitud, responde con **HTTP 400 (Bad Request)**
     indicando que el porcentaje de comisión no es válido, y no persiste la reserva

---

### User Story 2 - Conciliación Financiera de Comisiones OTA (Priority: P2)

La Recepcionista o el analista financiero revisa el reporte de comisiones de un periodo mensual,
comparando las reservas con `commissionStatus` `CALCULATED` contra aquellas que completaron su
estadía (`CHECKED_OUT`) o que se cancelaron con cobro de penalidad. El sistema permite marcar las
comisiones como `RECONCILED` o `PAID`, y ajustar a cero las reservas canceladas sin costo.

**Why this priority**: Es un flujo de auditoría contable importante para la liquidación mensual con
los proveedores de distribución, pero no interviene en la ingesta síncrona diaria de reservas.

**Independent Test**: Se genera el listado de comisiones de un canal sobre un conjunto de reservas
en `CHECKED_OUT`. Se ejecuta la conciliación y se comprueba que las comisiones pasen a
`RECONCILED` y que las asociadas a reservas `CANCELLED` sin penalidad ajusten su comisión a cero.

**Acceptance Scenarios**:

1. **Scenario**: Conciliación exitosa de comisiones para reservas con Check-Out completado
   - **Given** un conjunto de reservas OTA con `commissionStatus` `CALCULATED` en `state`
     `CHECKED_OUT`
   - **When** el usuario financiero ejecuta el proceso de conciliación del periodo
   - **Then** el sistema confirma la coincidencia de montos y actualiza el `commissionStatus` de
     esas reservas a `RECONCILED`

2. **Scenario**: Anulación de comisión por cancelación libre de penalidad
   - **Given** una reserva de canal OTA que pasó a `state` `CANCELLED` sin cobro de penalidad
   - **When** el sistema procesa la conciliación de comisiones
   - **Then** el sistema ajusta el `commissionAmount` a cero y marca el `commissionStatus` como
     `RECONCILED`, evitando una obligación de pago indebida hacia la agencia

---

### User Story 3 - Configuración del Porcentaje Contractual por Canal OTA (Priority: P3)

La Recepcionista o un Administrador configura los parámetros de una nueva `Ota`, especificando su
`name` y el `commissionPercentage` contractual por defecto que se aplicará a sus futuras reservas.

**Why this priority**: Es una función administrativa de soporte para incorporar nuevos canales
comerciales, pero no interviene en la ingesta diaria de reservas existentes.

**Independent Test**: Se registra una nueva `Ota` con un 15% de comisión por defecto. Se envía una
reserva de prueba sobre ese canal y se verifica que el sistema aplique automáticamente el 15% al
calcular el `commissionAmount`.

**Acceptance Scenarios**:

1. **Scenario**: Registro exitoso de nuevo canal OTA con comisión contractual
   - **Given** la consola de configuración de canales
   - **When** el Administrador registra una nueva `Ota` con un `commissionPercentage` válido
   - **Then** el sistema guarda la nueva `Ota` y la habilita para calcular comisiones de forma
     automática en sus futuras reservas

2. **Scenario**: Rechazo de configuración por nombre de canal ausente (Error)
   - **Given** el formulario de alta de canal OTA
   - **When** el Administrador intenta guardar el registro con el campo `name` vacío
   - **Then** el sistema responde con **HTTP 400 (Bad Request)** especificando los campos
     requeridos faltantes

### Casos Borde

- ¿Qué sucede si se modifica el `commissionPercentage` contractual de una `Ota` con reservas ya
  registradas? El nuevo porcentaje aplica exclusivamente a las reservas futuras; las reservas
  existentes conservan el `commissionAmount` calculado al momento de su creación.
- ¿Qué sucede si se recibe una nueva reserva reutilizando un `externalConfirmationCode` ya
  registrado para la misma `Ota`? El sistema rechaza el intento por duplicidad, responde con **HTTP
  400 (Bad Request)**, y no genera un registro de comisión duplicado.
- ¿Cómo maneja el sistema una cancelación tardía con penalidad parcial de una reserva OTA? El
  sistema recalcula el `commissionAmount` aplicando el `commissionPercentage` exclusivamente sobre
  la porción cobrada por penalidad, manteniendo la consistencia financiera.
- ¿Cómo maneja el sistema dos actualizaciones simultáneas de la misma reserva OTA? El sistema
  procesa secuencialmente los eventos para garantizar que el `commissionStatus` final refleje la
  versión de datos más reciente.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema debe calcular automáticamente el `commissionAmount` aplicando la fórmula
  `totalAmount × commissionPercentage` al validar una nueva reserva de canal OTA.
- **FR-002**: El sistema debe consultar el `commissionPercentage` contractual configurado para la
  `Ota` que origina cada reserva.
- **FR-003**: El sistema debe asignar el `commissionStatus` inicial `CALCULATED` a toda reserva OTA
  registrada correctamente.
- **FR-004**: El sistema debe rechazar el registro de reservas OTA cuyo `commissionPercentage` sea
  menor a cero o superior al 100%.
- **FR-005**: El sistema debe rechazar cualquier intento de registrar una reserva OTA con un
  `externalConfirmationCode` ya existente para el mismo canal.
- **FR-006**: El sistema debe proveer una función de conciliación que cambie el `commissionStatus`
  de `CALCULATED` a `RECONCILED` o `PAID`.
- **FR-007**: El sistema debe ajustar a cero el `commissionAmount` de las reservas que pasen a
  `state` `CANCELLED` sin cobro de penalización.
- **FR-008**: El sistema debe permitir configurar y actualizar el `name` y el `commissionPercentage`
  por defecto de cada `Ota`.
- **FR-009**: El sistema debe interceptar cualquier error de validación de entrada o integración y
  responder con **HTTP 400 (Bad Request)**, prohibiendo que se propaguen como fallas **HTTP 500**.
- **FR-010**: El sistema debe mantener un registro auditable de cada comisión calculada, ajustada o
  conciliada, incluyendo la fecha, el canal responsable y los importes aplicados.

### Non-Functional Requirements

- **NFR-001**: El cálculo y registro de la comisión al validar una reserva OTA debe completarse en
  un tiempo inferior a 1 segundo.
- **NFR-002**: El cálculo de comisiones debe realizarse con precisión decimal exacta para evitar
  descuadres en los cierres contables mensuales.

### Key Entities *(include if feature involves data)*

- **Reservation**: Representa la reserva de canal OTA sobre la que se calcula la comisión.
  Atributos: `reservationRef`, `guestRef`, categoría o habitación asignada, `totalAmount` (valor
  bruto recibido de la OTA), `commissionAmount` (comisión calculada), `commissionPercentage`
  (porcentaje contractual aplicado), `commissionStatus` (`CALCULATED` | `RECONCILED` | `PAID` |
  `DISPUTED`), `externalConfirmationCode`, `source` (`OTA`), y `state` con estados permitidos en
  este flujo: `ACTIVE`, `CHECKED_IN`, `CHECKED_OUT`, `CANCELLED`. Al provenir de un canal que ya
  respalda y garantiza la reserva del lado de la agencia, se persiste siempre directamente en
  `ACTIVE`; este flujo no utiliza el estado `PENDING`.
- **Ota**: Representa al intermediario externo que origina la reserva. Atributos: `id`, `name`, y
  `commissionPercentage` (porcentaje de comisión pactado por defecto).
- **Guest**: Representa al huésped titular de la reserva. Atributos: `id`, `fullName`,
  `documentNumber`, `nationality`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El 100% de las reservas con `source` `OTA` cuentan con `commissionAmount` y
  `commissionStatus` `CALCULATED` calculados de forma exacta al momento de su registro.
- **SC-002**: El 100% de los intentos de registro con `externalConfirmationCode` duplicado o
  `commissionPercentage` inválido son rechazados con **HTTP 400 (Bad Request)**.
- **SC-003**: Cero errores de servidor **HTTP 500** son provocados por fallos en el cálculo o
  conciliación de comisiones OTA; el 100% se responde con **HTTP 400**.
- **SC-004**: El 100% de las reservas canceladas libres de costo ajustan su `commissionAmount` a
  cero en el proceso de conciliación mensual.
- **SC-005**: El tiempo de respuesta para el registro y cálculo de comisión de una reserva OTA es
  inferior a 1 segundo.
