# Feature Specification: Registrar Confirmación y Comisión de OTA

**Created**: 2026-09-25

## 1. Caso de Uso

### Descripción del problema

Cada reserva que llega de una agencia de viajes en línea (OTA) trae consigo una obligación
financiera con esa agencia: una comisión pactada sobre el valor bruto de la estadía. Si esa comisión
no se calcula y se asienta en el mismo instante en que se registra la reserva, la conciliación
posterior con la OTA se vuelve imprecisa y el hotel pierde trazabilidad sobre cuánto le corresponde
retener a cada canal. La reserva y su comisión se asocian siempre a una `categoryRoom`: en esta
etapa no existe ningún `roomId` ni `numberRoom` físico asignado, ya que esa asignación ocurre
únicamente en el Check-In, dentro del Módulo 1.

El negocio necesita un caso de uso interno, invocado siempre que "Generar Reservación por OTA"
registra una nueva reserva, que aplique de forma estricta la fórmula contractual sobre el
`grossAmount` recibido y deje el importe neto listo para la conciliación mensual con cada agencia,
incluyendo el ajuste automático a cero cuando la reserva se cancela sin costo.

### Flujo de Usuario de Alto Nivel

1. "Generar Reservación por OTA" invoca internamente "Registrar confirmación y comisión de ota" al
   validar una nueva reserva, enviando el `grossAmount`, el `externalConfirmationCode` y la `Ota`
   originadora.
2. El sistema consulta el `commissionPercentage` contractual configurado para esa `Ota`.
3. El sistema calcula el `commissionAmount` aplicando la fórmula `grossAmount ×
   commissionPercentage / 100`.
4. El sistema persiste el `commissionAmount`, el `commissionPercentage` y el
   `externalConfirmationCode` en la `Reservation`, asociada a su `categoryRoom`, con
   `commissionStatus` `CALCULATED`.
5. Durante el cierre mensual, el área financiera concilia las comisiones de las reservas en
   `Reservation.state` `COMPLETED`, cambiando su `commissionStatus` a `RECONCILED` o `PAID`, y
   ajusta a cero las comisiones de las reservas en `CANCELLED`.

## 2. Escenarios de Usuario y Pruebas

### User Story 1 - Registro Automático de Comisión (Priority: P1)

**Plain Language**: Cálculo y registro automático de la comisión OTA al validar una nueva reserva,
aplicando el porcentaje contractual sobre el `grossAmount` y dejando el `commissionAmount` y el
`externalConfirmationCode` persistidos con `commissionStatus` `CALCULATED`.

Al validarse una nueva reserva proveniente de una `Ota`, el sistema aplica el porcentaje contractual
configurado para esa agencia sobre el `grossAmount` recibido, calcula el `commissionAmount` y lo
persiste junto con el `externalConfirmationCode` en la `Reservation`, con `commissionStatus`
`CALCULATED`. Esta historia es el flujo maestro (Happy Path), invocado siempre como parte de
"Generar Reservación por OTA", y se consolida con el rechazo por porcentaje de comisión inválido
para evitar la sobre-atomización.

**Why this priority**: Es la funcionalidad esencial para operar con canales de distribución de
terceros: sin ella, el hotel recibiría reservas de OTA sin registrar con exactitud la comisión
pactada ni el ingreso neto real de cada una.

**Independent Test**: Se prueba invocando el caso de uso con un `grossAmount` de $400 y un
`commissionPercentage` del 15% configurado para la agencia. Se verifica que el sistema calcule un
`commissionAmount` de $60, lo persista junto al `externalConfirmationCode`, y marque el
`commissionStatus` como `CALCULATED`. Se completa enviando un `commissionPercentage` inválido,
confirmando el rechazo con **HTTP 400**.

**Acceptance Scenarios**:

1. **Escenario 1**: Cálculo y registro exitoso de comisión OTA (Happy Path)

   ```gherkin
   Given una reserva proveniente de una Ota válida con commissionPercentage contractual configurado
   When "Generar Reservación por OTA" invoca "Registrar confirmación y comisión de ota" con el grossAmount y el externalConfirmationCode
   Then el sistema calcula el commissionAmount aplicando grossAmount × commissionPercentage / 100
   And lo persiste en la Reservation asociada a su categoryRoom
   And marca el commissionStatus como CALCULATED
   ```

2. **Escenario 2**: Rechazo controlado por porcentaje de comisión inválido (Error)

   ```gherkin
   Given una solicitud de registro de comisión
   When el commissionPercentage configurado para el canal es menor a 0% o superior al 100%
   Then el sistema intercepta la solicitud sin calcular ni persistir ninguna comisión
   And responde con un error controlado HTTP 400 (Bad Request) indicando que el porcentaje de comisión no es válido
   ```

---

### User Story 2 - Conciliación Financiera Mensual (Priority: P2)

**Plain Language**: Conciliación mensual de las comisiones OTA, marcando como `RECONCILED` o `PAID`
las de reservas con estadía finalizada (`COMPLETED`) y ajustando a cero las de reservas
`CANCELLED`, para evitar obligaciones de pago indebidas hacia la agencia.

El área financiera revisa el reporte de comisiones de un periodo mensual, comparando las reservas
con `commissionStatus` `CALCULATED` contra aquellas que completaron su estadía o que se cancelaron.
El sistema permite marcar las comisiones como `RECONCILED` o `PAID`, y ajusta a cero las de las
reservas canceladas.

**Why this priority**: Es un flujo de auditoría contable importante para la liquidación mensual con
los proveedores de distribución, pero no interviene en la ingesta síncrona diaria de reservas. Se
prioriza como P2 por depender de la ejecución previa de la User Story 1.

**Independent Test**: Se genera el listado de comisiones de un canal sobre un conjunto de reservas
en `COMPLETED` y se ejecuta la conciliación, verificando que sus comisiones pasen a `RECONCILED`. Se
repite sobre reservas en `CANCELLED`, verificando que su `commissionAmount` se ajuste a cero.

**Acceptance Scenarios**:

1. **Escenario 1**: Conciliación exitosa de comisiones para reservas en `COMPLETED`

   ```gherkin
   Given un conjunto de reservas OTA con commissionStatus CALCULATED en Reservation.state COMPLETED
   When el área financiera ejecuta el proceso de conciliación del periodo
   Then el sistema confirma la coincidencia de montos
   And actualiza el commissionStatus de esas reservas a RECONCILED o PAID
   ```

2. **Escenario 2**: Ajuste automático a cero para reservas en `CANCELLED`

   ```gherkin
   Given una reserva de canal OTA en Reservation.state CANCELLED con commissionStatus CALCULATED
   When el sistema procesa la conciliación de comisiones del periodo
   Then el sistema ajusta el commissionAmount a cero
   And conserva el histórico de la comisión originalmente calculada para auditoría
   ```

## 3. Casos Borde

- **Caso Borde 1**: Modificación posterior del porcentaje contractual de una `Ota`. El nuevo
  `commissionPercentage` aplica exclusivamente a las reservas futuras; las reservas previas
  conservan el `commissionAmount` calculado al momento de su creación.
- **Caso Borde 2**: Reutilización de `externalConfirmationCode` para la misma `Ota`. El sistema
  rechaza el intento por duplicidad con un error controlado **HTTP 400 (Bad Request)**, sin generar
  un registro de comisión duplicado.
- **Caso Borde 3**: Cancelación de una reserva OTA. El proceso de conciliación ajusta el
  `commissionAmount` a cero y conserva el histórico de auditoría de la comisión originalmente
  calculada.

## 4. Requisitos

### Requisitos Funcionales

- **FR-001**: El sistema debe calcular automáticamente el `commissionAmount` aplicando la fórmula
  `grossAmount × commissionPercentage / 100` al validar una nueva reserva de canal OTA.
- **FR-002**: El sistema debe consultar el `commissionPercentage` contractual configurado para la
  `Ota` que origina cada reserva.
- **FR-003**: El sistema debe asignar el `commissionStatus` inicial `CALCULATED` a toda reserva OTA
  registrada correctamente.
- **FR-004**: El sistema debe rechazar el registro cuando el `commissionPercentage` sea menor a 0%
  o superior al 100%, respondiendo **HTTP 400 (Bad Request)**.
- **FR-005**: El sistema debe rechazar cualquier intento de registrar una reserva OTA con un
  `externalConfirmationCode` ya existente para la misma `Ota`, respondiendo **HTTP 400 (Bad
  Request)**.
- **FR-006**: El sistema debe permitir la conciliación financiera, cambiando el `commissionStatus`
  de `CALCULATED` a `RECONCILED` o `PAID`.
- **FR-007**: El sistema debe ajustar a cero el `commissionAmount` de las reservas que se
  encuentren en `Reservation.state` `CANCELLED`.
- **FR-008**: El sistema debe interceptar cualquier error de validación de entrada y responder con
  **HTTP 400 (Bad Request)**, quedando estrictamente prohibida la propagación de excepciones de
  infraestructura **HTTP 500**.

### Requisitos No Funcionales

- **NFR-001**: El cálculo y registro de la comisión debe completarse en menos de 1 segundo, con
  precisión decimal exacta.

## 5. Entidades Clave

- **Reservation**: Reserva de canal OTA sobre la que se calcula la comisión. Atributos:
  `reservationRef`, `guestRef`, `categoryRoom`, `grossAmount` (valor bruto recibido de la OTA),
  `commissionAmount`, `commissionPercentage`, `commissionStatus` (`CALCULATED` | `RECONCILED` |
  `PAID` | `DISPUTED`), `externalConfirmationCode`, `source` (`OTA`) y `Reservation.state`
  (`PENDING`, `ACTIVE`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`, `NO_SHOW`).
- **Ota**: Intermediario externo que origina la reserva. Atributos: `id`, `name` y
  `commissionPercentage`.
- **Guest**: Huésped titular de la reserva. Atributos: `id`, `fullName`, `documentNumber` y
  `nationality`.

## 6. Criterios de Éxito

### Resultados Medibles

- **SC-001**: El 100% de las reservas OTA registran su `commissionAmount` y `commissionStatus`
  `CALCULATED` al crearse.
- **SC-002**: El 100% de los códigos duplicados o porcentajes de comisión inválidos se rechazan con
  **HTTP 400**.
- **SC-003**: El 100% de las reservas canceladas ajustan su comisión a cero en la conciliación.
- **SC-004**: Cero errores **HTTP 500** en producción.
