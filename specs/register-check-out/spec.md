# Feature Specification: Registro de Check-Out

**Created**: 2026-09-08

## Use Case (Caso de Uso)

### Descripción del problema

El cierre de la estadía de un huésped es hoy un cuello de botella. El recepcionista debe reunir a
mano los consumos locales de la habitación, buscar tarifas y calcular el monto final antes de
dejar salir al huésped, lo que produce filas en recepción y retrasa la disponibilidad de la
habitación para el personal de aseo y para el siguiente cliente. Cuando la información de consumos
locales no se consolida y liquida a tiempo con el área responsable de precios, aparecen fugas
financieras: cargos que nunca se registran, cobros aplicados sin control y diferencias entre lo
que el huésped paga y lo que realmente corresponde a su estadía. El negocio necesita un check-out
ágil, con una única liquidación confiable y trazable calculada por el Módulo 3, y con la
habitación marcada de inmediato como pendiente de limpieza.

### Flujo de Usuario de Alto Nivel

1. El **Recepcionista** ubica la reserva del huésped mediante el caso de uso interno "Consultar /
   ver reserva" y el sistema valida que se encuentre en estado `CHECKED_IN`.
2. El **Recepcionista** registra en el Módulo 2 los cargos por consumos adicionales de la estadía
   (por ejemplo, servicio a la habitación o minibar), si los hubiera.
3. El sistema recopila la información básica de la salida (`reservationRef`, consumos locales
   registrados y fechas reales de estadía) y la envía al caso de uso "Procesar liquidación y
   validación" del **Módulo 3 (Pricing)**.
4. El **Módulo 3** procesa, valida y calcula la liquidación final y la retorna al Módulo 2. El
   Módulo 2 no realiza ninguna suma, tarifa ni cálculo de cobros: solo expone el resultado
   recibido.
5. El sistema presenta en pantalla el resumen consolidado de la liquidación retornada por el
   Módulo 3 para la confirmación visual del **Recepcionista**.
6. Tras la confirmación manual del **Recepcionista**, el sistema cambia el estado de la reserva a
   `CHECKED_OUT` de forma local y registra la transacción de salida.
7. El sistema solicita de forma asíncrona al **Módulo 1**, mediante el caso de uso `Set Habitation
   State` ("Establecer el estado de la habitación"), transicionar la `Habitation` asignada de
   `Occupied` a `PendingCleaning`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Registro de Check-Out de un Huésped (Priority: P1)

El **Recepcionista** formaliza la salida de un huésped cuya reserva está en estado `CHECKED_IN`:
registra los consumos locales de la estadía, obtiene del **Módulo 3** la liquidación final,
confirma visualmente el resumen y cierra la estadía. Toda la operación transcurre en una sola
pantalla de check-out; por eso, el flujo feliz y los bloqueos lógicos (reserva en estado inválido,
intento de salida duplicada, indisponibilidad del Módulo 3, datos mal formados) se consolidan en
esta misma historia de usuario y no se modelan como pantallas ni historias separadas, para evitar
la sobre-atomización. Al completarse con éxito, la reserva queda en `CHECKED_OUT` y la `Habitation`
se solicita al Módulo 1 para pasar de `Occupied` a `PendingCleaning`.

**Why this priority**: Es el flujo principal y de mayor frecuencia del módulo. Dejar la habitación
en `PendingCleaning` apenas se confirma la salida permite que el personal de aseo actúe de
inmediato y que la habitación vuelva a estar disponible cuanto antes, lo que impacta de forma
directa la ocupación y los ingresos. A la vez, exigir que la liquidación provenga del Módulo 3
antes de la salida física impide fugas de caja: ningún huésped abandona el hotel sin que sus
consumos hayan sido validados y liquidados. Sin este flujo, el negocio no puede operar el cierre
de estadías de forma ordenada ni auditable.

**Independent Test**: Se puede probar de forma aislada tomando una reserva en estado `CHECKED_IN`
con una `Habitation` asignada, registrando uno o más consumos locales y enviando los datos de
estadía y cargos al Módulo 3 ("Procesar liquidación y validación"). Se verifica que el sistema
recibe la liquidación calculada, la muestra como resumen consolidado en pantalla, y que al
confirmar el resumen la reserva se persiste en estado `CHECKED_OUT` con su transacción de
check-out y la referencia de la liquidación. Finalmente se comprueba que se emite la solicitud
asíncrona al Módulo 1 (`Set Habitation State`) para pasar la `Habitation` a `PendingCleaning`. La
prueba se completa repitiendo el intento sobre una reserva en estado `ACTIVE` y sobre una ya en
`CHECKED_OUT`, confirmando que ambos se bloquean con un error de negocio controlado y sin efectos
colaterales.

**Acceptance Scenarios**:

1. **Scenario**: Registro exitoso de Check-Out con liquidación del Módulo 3 (Happy Path)
   - **Given** que existe una reserva en estado `CHECKED_IN` con una `Habitation` asignada en el
     Módulo 1
   - **When** el **Recepcionista** inicia el Check-Out, el sistema envía los datos requeridos al
     Módulo 3 ("Procesar liquidación y validación") y este devuelve la liquidación calculada
     exitosamente
   - **Then** el sistema presenta el resumen consolidado en pantalla; al recibir la confirmación
     explícita del Recepcionista, cambia el estado de la reserva a `CHECKED_OUT`, guarda los datos
     de la transacción de salida y solicita al Módulo 1 cambiar el estado físico de la `Habitation`
     a `PendingCleaning` mediante `Set Habitation State`

2. **Scenario**: Bloqueo de Check-Out si la reserva no está en estado CHECKED_IN
   - **Given** que se carga una reserva que se encuentra en estado `ACTIVE` o `CANCELLED`
   - **When** se intenta proceder con el Check-Out
   - **Then** el sistema bloquea la acción, arrojando un error de negocio controlado HTTP 400 y el
     mensaje explicativo en pantalla

3. **Scenario**: Prevención de un Check-Out duplicado
   - **Given** una reserva que ya se encuentra en estado `CHECKED_OUT` con su transacción de salida
     registrada
   - **When** el Recepcionista intenta registrar el Check-Out nuevamente sobre esa reserva
   - **Then** el sistema rechaza el intento con un error de negocio controlado HTTP 400, muestra
     los datos de la salida ya registrada y no crea una nueva transacción de check-out ni emite
     otra solicitud de limpieza al Módulo 1

### Casos Borde

- ¿Qué sucede si el Módulo 3 (Pricing) no responde o devuelve un error durante la llamada a
  "Procesar liquidación y validación"? El sistema aplica un fallback resiliente: guarda un estado
  local temporal del Check-Out marcado para regularización financiera posterior y permite la
  salida física del huésped sin bloquearla; la cuenta pendiente se regulariza de forma asíncrona
  en cuanto el Módulo 3 vuelve a estar disponible, y el Módulo 2 no asume ni calcula montos
  locales por su cuenta.
- ¿Cómo maneja el sistema si la llamada de actualización de estado de la habitación (`Set
  Habitation State`) al Módulo 1 falla después de haber registrado el Check-Out de manera exitosa?
  La transacción financiera se mantiene firme en `CHECKED_OUT` y la solicitud de cambio de estado
  de la `Habitation` a `PendingCleaning` queda marcada de forma local como `PENDING` para
  reintentarse de forma asíncrona en segundo plano, sin obligar a repetir la salida del huésped.
- ¿Qué sucede cuando el Recepcionista intenta enviar datos con campos obligatorios vacíos, montos
  de consumo no numéricos o negativos, o texto libre con caracteres maliciosos? El sistema
  intercepta la validación de forma local en el controlador del Módulo 2 y responde con un error
  estructurado **HTTP 400 (Bad Request)** amigable que indica qué corregir, impidiendo la
  propagación de fallas técnicas que deriven en un error **HTTP 500 (Internal Server Error)**.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema debe permitir al **Recepcionista** buscar la reserva mediante el caso de
  uso interno "Consultar / ver reserva" antes de iniciar el check-out.
- **FR-002**: El sistema debe validar que la reserva se encuentre estrictamente en estado
  `CHECKED_IN` para autorizar el proceso de salida física.
- **FR-003**: El sistema debe enviar la información requerida de la reserva al Módulo 3 ("Procesar
  liquidación y validación") para que este realice de forma externa el cálculo de los cobros
  finales; el Módulo 2 no debe realizar sumas ni cálculos propios de tarifas.
- **FR-004**: El sistema debe mostrar en pantalla el resumen de liquidación retornado por el
  Módulo 3 y exigir la confirmación manual del **Recepcionista** antes de persistir la transacción
  de salida.
- **FR-005**: Al confirmar la salida, el sistema debe cambiar el estado de la reserva a
  `CHECKED_OUT` de manera local y solicitar de forma asíncrona al Módulo 1 cambiar el estado de la
  `Habitation` asignada a `PendingCleaning` mediante `Set Habitation State`.
- **FR-006**: El sistema debe interceptar cualquier inconsistencia de datos o fallo de red para
  retornar errores estructurados **HTTP 400 (Bad Request)** amigables, impidiendo que escalen a un
  error de infraestructura **HTTP 500 (Internal Server Error)**.

### Non-Functional Requirements

- **NFR-001**: El tiempo de comunicación e integración con el Módulo 3 para retornar la
  liquidación debe ser inferior a 3 segundos bajo condiciones normales de carga.

### Key Entities *(include if feature involves data)*

- **CheckOut**: Representa la transacción física y financiera de salida de un huésped. Atributos:
  `id`, `reservationRef`, `checkOutTime` (momento real de la salida), `processedBy` (identificador
  del Recepcionista), `liquidationRef` (referencia de la liquidación confirmada del Módulo 3) y
  `habitationRequestStatus` (`PENDING` | `COMPLETED`, para el seguimiento del cambio de estado
  enviado al Módulo 1). El Módulo 2 solo registra la confirmación de la liquidación; no almacena
  cálculos propios de tarifa.
- **Reservation**: Representa la estadía sobre la que opera el check-out. Atributos:
  `reservationRef`, `guestList`, `assignedHabitation`, `startDate`, `endDate` y `state` con
  estados permitidos: `PENDING`, `ACTIVE`, `CHECKED_IN`, `CHECKED_OUT`, `CANCELLED`. Solo puede
  pasar a `CHECKED_OUT` desde el estado `CHECKED_IN`.
- **Habitation**: Representa la habitación física ocupada por el huésped, cuya gestión de estado
  es propiedad del Módulo 1. Atributos: `habitationId`, `numberHabitation` y `stateHabitation` con
  los siete estados oficiales del glosario: `Available`, `Occupied`, `PendingCleaning`,
  `InCleaning`, `DisabledForRepairs`, `TechnicalBlock`, `Inactive`. Como resultado de un check-out
  confirmado, el sistema solicita al Módulo 1 su transición de `Occupied` a `PendingCleaning`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El Recepcionista puede finalizar un Check-Out estándar en menos de 1 minuto una vez
  que el Módulo 3 confirma y devuelve el cálculo de liquidación.
- **SC-002**: El 100% de las solicitudes de validación de cobro fallidas o caídas de Pricing se
  resuelven con respuestas HTTP 400 controladas, con cero errores de infraestructura HTTP 500 en
  producción.
