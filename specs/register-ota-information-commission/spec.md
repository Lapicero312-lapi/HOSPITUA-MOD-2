# Especificación de Funcionalidad: Registrar Información y Comisión de OTA

**Creado**: 2026-09-08

## Escenarios de Usuario y Pruebas *(obligatorio)*

La funcionalidad de Registrar Información y Comisión de OTA (`Register OTA Information and Commission`) permite capturar, calcular, gestionar y auditar la información contractual, las referencias de canal y las comisiones pagaderas (`OtaCommission`) asociadas a reservas provenientes de Agencias de Viajes en Línea (**OTA**, tales como Booking.com, Expedia o agencias conectadas). Toda la interacción ocurre mediante la ingesta automatizada por API o a través de la consola operativa de la **Recepcionista**:

- Al recibir una reserva o modificación desde una OTA, el sistema asocia el identificador de canal (`source`), el número de confirmación externo (`otaReservationRef`), el porcentaje de comisión acordado y el monto resultante de la comisión.
- El sistema calcula el valor neto que ingresará al hotel descontando la comisión calculada (`OtaCommission`) sobre la tarifa base de la estadía.
- Durante el ciclo de vida de la reserva, el sistema mantiene el seguimiento del estado de la comisión: desde `PENDING` o `CALCULATED` al crearse, hasta `RECONCILED` o `PAID` al cerrar el periodo contable, o `DISPUTED` en caso de cancelaciones o discrepancias.
- Si los datos del canal enviados son inválidos, los porcentajes son negativos o la referencia externa está duplicada, el sistema rechaza el registro y responde con una alerta amigable **HTTP 400 (Bad Request)**.

**Estados de la entidad `Reservation`**: `PENDING`, `ACTIVE`, `CHECKED_IN`, `CHECKED_OUT`, `CANCELLED`.

**Estados de la entidad `OtaCommission`**:
- `status`: `PENDING`, `CALCULATED`, `RECONCILED`, `PAID`, `DISPUTED`.

**Clasificación de la entidad `Guest`**: `NATIONAL`, `FOREIGN`.

**Estados de la entidad `Room`** (propiedad del Módulo 1): `AVAILABLE`, `OCCUPIED`, `CLEANING`, `OUT_OF_SERVICE`.

---

### Historia de Usuario 1 - Ingesta y Cálculo de Comisión para Reservas provenientes de OTA (Prioridad: P1)

El Sistema (vía integración API) o la Recepcionista procesa la creación de una reserva cuya fuente es una agencia en línea (`source` tipo OTA). El sistema registra la referencia de la reserva externa (`otaReservationRef`), aplica el porcentaje contractual de comisión configurado para ese canal, calcula el valor en `OtaCommission` con estado `CALCULATED`, y vincula la información a la `Reservation` en estado `ACTIVE` o `PENDING`. Esta historia es el flujo maestro (Happy Path).

**Por qué esta prioridad**: Es la funcionalidad esencial para operar con canales de distribución de terceros. Permite recibir reservas automatizadas de agencias en línea registrando con exactitud las comisiones y los ingresos netos reales del hotel.

**Prueba Independiente**: Se prueba enviando una solicitud de reserva con `source` igual a `OTA_BOOKING` y una referencia externa válida. Se verifica que el sistema cree la `Reservation`, calcule la `OtaCommission` con estado `CALCULATED` basada en el porcentaje contractual del canal, y guarde los atributos en la base de datos. Se complementa enviando un porcentaje de comisión negativo, confirmando el rechazo con **HTTP 400 (Bad Request)**.

**Escenarios de Aceptación**:

*Escenarios de Éxito (Happy Path)*

1. **Escenario**: Registro exitoso de reserva OTA con cálculo de comisión contractual
   - **Dado** una solicitud de creación de reserva proveniente de un canal `Ota` válido con un porcentaje de comisión contractual registrado
   - **Cuando** el sistema procesa "Register OTA Information and Commission"
   - **Entonces** el sistema guarda el `source` de la agencia, registra la `otaReservationRef`, calcula el valor de la `OtaCommission` en estado `CALCULATED`, y asocia el registro a la `Reservation`

2. **Escenario**: Recálculo de comisión por modificación de tarifa enviada por la OTA
   - **Dado** una reserva previa originada en OTA que cuenta con una `OtaCommission` en estado `CALCULATED`
   - **Cuando** la OTA envía una actualización de fechas que incrementa el costo total de la estadía
   - **Entonces** el sistema recalcula la tarifa dinámica, actualiza proporcionalmente el valor de la `OtaCommission` en estado `CALCULATED`, y actualiza el saldo neto proyectado

*Escenarios de Error / Caminos Tristes*

3. **Escenario**: Rechazo controlado por porcentaje de comisión inválido o negativo
   - **Dado** una solicitud de ingesta de reserva OTA
   - **Cuando** los datos del canal especifican un porcentaje de comisión menor a cero o superior al 100%
   - **Entonces** el sistema intercepta la solicitud, responde con un código **HTTP 400 (Bad Request)** indicando que el porcentaje de comisión no es válido, y no registra la reserva

4. **Escenario**: Rechazo por referencia externa de reserva OTA duplicada
   - **Dado** una reserva de canal OTA previamente registrada con una `otaReservationRef` específica
   - **Cuando** se recibe una nueva solicitud de creación que reutiliza la misma `otaReservationRef` para la misma agencia
   - **Entonces** el sistema rechaza el intento por duplicidad, responde con un error controlado **HTTP 400 (Bad Request)**, y no genera registros duplicados de comisiones

---

### Historia de Usuario 2 - Conciliación Financiera y Auditoría de Comisiones OTA (Prioridad: P2)

La Recepcionista o el analista financiero revisa el reporte de comisiones de un periodo mensual, comparando las comisiones en estado `CALCULATED` contra las reservas que efectivamente completaron su estadía (`CHECKED_OUT`) o aquellas canceladas con cobro de penalidad. El sistema permite marcar las comisiones como `RECONCILED` o `PAID`, y ajustar a cero las reservas canceladas sin costo (`DISPUTED` o anuladas).

**Por qué esta prioridad**: Es un flujo de auditoría contable crítico para la liquidación mensual de cuentas con los proveedores de distribución, evitando pagar comisiones por reservas canceladas o no presentadas (no-show) sin penalidad.

**Prueba Independiente**: Se genera el listado de comisiones para un canal determinado sobre un conjunto de reservas finalizadas en `CHECKED_OUT`. Se ejecuta la acción de conciliación, comprobando que las comisiones pasen a estado `RECONCILED` y que aquellas asociadas a reservas `CANCELLED` sin penalidad ajusten su comisión a cero.

**Escenarios de Aceptación**:

1. **Escenario**: Conciliación exitosa de comisiones para reservas con check-out completado
   - **Dado** un conjunto de registros de `OtaCommission` en estado `CALCULATED` vinculados a reservas en estado `CHECKED_OUT`
   - **Cuando** el usuario financiero ejecuta el proceso de conciliación del periodo
   - **Entonces** el sistema confirma la coincidencia de montos y actualiza el estado de las comisiones a `RECONCILED`, dejándolas listas para la orden de pago

2. **Escenario**: Anulación de comisión por cancelación de reserva libre de penalidad
   - **Dado** una reserva de canal OTA que fue modificada al estado `CANCELLED` dentro de la ventana de anulación gratuita
   - **Cuando** el sistema procesa la conciliación de comisiones
   - **Entonces** el sistema ajusta el monto de la `OtaCommission` a cero y marca su estado como `RECONCILED` o `DISPUTED`, evitando generar una obligación de pago indebida hacia la agencia

---

### Historia de Usuario 3 - Configuración de Parámetros Contractuales por Canal OTA (Prioridad: P3)

La Recepcionista o Administrador configura los parámetros de integración de una nueva agencia de viajes (`source`), especificando el nombre del canal, el código de identificación y el porcentaje contractual por defecto.

**Por qué esta prioridad**: Es una función administrativa de soporte para la incorporación de nuevos canales comerciales, pero no interviene en la ingesta síncrona diaria de reservas existentes.

**Prueba Independiente**: Se registra un nuevo canal OTA con un 15% de comisión por defecto. Se envía posteriormente una reserva de prueba sobre dicho canal y se verifica que el sistema aplique automáticamente el 15% en la `OtaCommission`.

**Escenarios de Aceptación**:

1. **Escenario**: Registro exitoso de nuevo canal OTA con comisión contractual
   - **Dado** la consola de configuración de canales
   - **Cuando** el Administrador registra una nueva agencia asignándole un porcentaje de comisión válido
   - **Entonces** el sistema guarda el nuevo `source` y lo habilita para asociar reservas y calcular `OtaCommission` de forma automática

2. **Escenario**: Rechazo de configuración de canal por nombre o identificador ausente
   - **Dado** el formulario de alta de canal OTA
   - **Cuando** el usuario intenta guardar el registro con el campo de nombre del canal vacío
   - **Entonces** el sistema responde con una alerta **HTTP 400 (Bad Request)** especificando los campos requeridos faltantes

---

### Casos Borde

- **Modificación del porcentaje contractual con reservas ya creadas**: si el administrador actualiza el porcentaje de comisión de una OTA, el nuevo porcentaje aplica exclusivamente a las futuras reservas; las reservas existentes preservan el porcentaje y el monto de `OtaCommission` calculado al momento de su creación.
- **Inconsistencia o formato de respuesta corrupto en la API de la OTA**: si los datos de la reserva recibidos por la API del canal contienen caracteres no autorizados o formatos de fecha incoherentes, el sistema los sanitiza, rechaza la ingesta con un código **HTTP 400 (Bad Request)** y registra el intento fallido en la auditoría sin afectar la estabilidad del servidor.
- **Cancelación tardía con penalidad parcial de la reserva OTA**: si una reserva OTA se cancela con cobro de penalidad, el sistema recalcula la `OtaCommission` aplicando el porcentaje de comisión exclusivamente sobre la porción cobrada por penalidad, manteniendo la consistencia financiera.
- **Concurrencia en la recepción de la misma actualización de reserva OTA**: si la OTA envía dos notificaciones de actualización simultáneas para la misma `otaReservationRef`, el sistema procesa secuencialmente los eventos para garantizar que el estado final de `OtaCommission` refleje la versión de datos más reciente.

---

## Requisitos *(obligatorio)*

### Requisitos Funcionales

- **FR-001**: El sistema DEBE permitir registrar y gestionar la información de canales de distribución de terceros (`source` tipo `Ota`).
- **FR-002**: El sistema DEBE exigir la referencia de confirmación externa (`otaReservationRef`), el canal de origen (`source`) y el monto base como datos obligatorios para toda reserva OTA.
- **FR-003**: El sistema DEBE calcular automáticamente el valor de la entidad `OtaCommission` aplicando el porcentaje contractual de la agencia sobre la tarifa base de la `Reservation`.
- **FR-004**: El sistema DEBE asignar el estado inicial `CALCULATED` a toda nueva `OtaCommission` registrada correctamente.
- **FR-005**: El sistema DEBE recalcular el monto de la `OtaCommission` cuando la reserva asociada sufra modificaciones en sus fechas o tipo de habitación.
- **FR-006**: El sistema DEBE proveer la funcionalidad de conciliación para cambiar el estado de las comisiones de `CALCULATED` a `RECONCILED` o `PAID`.
- **FR-007**: El sistema DEBE ajustar a cero el monto de la `OtaCommission` para reservas que pasen a estado `CANCELLED` sin cobro de penalización.
- **FR-008**: El sistema DEBE rechazar la ingesta o registro de reservas OTA cuyo porcentaje de comisión sea menor a cero o superior al 100%.
- **FR-009**: El sistema DEBE rechazar cualquier intento de registrar una reserva OTA con un `otaReservationRef` ya existente para el mismo canal.
- **FR-010**: El sistema DEBE interceptar cualquier error de validación de entradas o integración y responder estrictamente con códigos **HTTP 400 (Bad Request)** acompañados de mensajes amigables; el sistema DEBE prohibir que estos errores se propaguen como fallas **HTTP 500**.
- **FR-011**: El sistema DEBE calcular el ingreso neto projected del hotel (tarifa total menos `OtaCommission`) para fines de auditoría y facturación.
- **FR-012**: El sistema DEBE mantener un registro auditable de cada comisión calculada, ajustada o conciliada, registrando la fecha, el canal responsable y los importes aplicados.

### Requisitos No Funcionales

- **NFR-001**: El tiempo de procesamiento de la ingesta y cálculo de comisión OTA por API DEBE ser inferior a 1 segundo.
- **NFR-002**: El cálculo de comisiones DEBE realizarse utilizando precisión decimal exacta para evitar descuadres en los cierres contables mensuales.

### Entidades Clave *(incluir si la funcionalidad involucra datos)*

- **OtaCommission**: Representa el registro de comisión contractual de la agencia. Atributos clave: `commissionId` (identificador único), `reservationRef` (referencia a la `Reservation`), `otaReservationRef` (código externo del canal), `source` (nombre/código de la OTA), `commissionPercentage` (porcentaje contractual), `commissionAmount` (monto calculado), `netAmount` (monto neto para el hotel), `calculatedAt` (fecha de cálculo), y `status` (`PENDING`, `CALCULATED`, `RECONCILED`, `PAID`, `DISPUTED`).
- **Reservation**: Reserva asociada. Atributos clave: `reservationRef`, `startDate`, `endDate`, `source`, y `status` (`PENDING`, `ACTIVE`, `CHECKED_IN`, `CHECKED_OUT`, `CANCELLED`).
- **RateQuote**: Cotización tarifaria asociada. Atributos clave: `quoteId`, `newAmount`, `totalAmount`.
- **Guest**: Huésped titular de la reserva. Atributos clave: `fullName`, `documentId`, `type` (`NATIONAL` | `FOREIGN`).

---

## Criterios de Éxito *(obligatorio)*

### Resultados Medibles

- **SC-001**: El 100% de las reservas registradas con `source` de canal OTA cuentan con una `OtaCommission` vinculada en estado `CALCULATED` y un cálculo exacto de su ingreso neto.
- **SC-002**: El 100% de los intentos de registro con referencias duplicadas o porcentajes de comisión inválidos son rechazados con errores **HTTP 400 (Bad Request)**.
- **SC-003**: Cero errores de servidor **HTTP 500** son provocados por fallos en la ingesta o conciliación de reservas OTA; el 100% es respondido con **HTTP 400 (Bad Request)**.
- **SC-004**: El 100% de las reservas canceladas libre de costo ajustan su `OtaCommission` a cero en el proceso de conciliación mensual.
- **SC-005**: El tiempo de respuesta para la ingesta y cálculo de comisión de una reserva OTA es inferior a 1 segundo.
