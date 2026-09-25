# Feature Specification: Actualizar Reservación

**Created**: 2026-09-19

## Use Case (Caso de Uso)

### Descripción del problema

Los planes de viaje de un huésped cambian con frecuencia: adelanta o pospone su llegada, extiende la
estadía, cambia de categoría de habitación o corrige datos personales. Si el hotel no puede reflejar
esos cambios de forma ágil sobre una reserva, la fricción crece, se pierden ventas y el personal
termina llevando ajustes por fuera del sistema. El problema tiene tres caras: verificar que las
nuevas fechas estén disponibles, recalcular el valor cuando cambian las fechas o la categoría (lo
hace el Módulo 3, no el Módulo 2), y mantener un único punto donde se cambia el estado de la
reserva, que también usan el Check-In, el Check-Out y el proceso de No-Show. El negocio necesita una
única funcionalidad de actualización que valide la disponibilidad, delegue el recálculo y solo
persista tras la confirmación del solicitante.

### Flujo de Usuario de Alto Nivel

1. La **Recepcionista** o la **Ota** localiza la reserva mediante "Consultar
   reservas" y valida que esté en `ACTIVE` o `PENDING`.
2. El solicitante edita las fechas, la categoría de `Room` o los datos personales del `Guest`.
3. Si cambian las fechas o la habitación, el sistema ejecuta "Verificar disponibilidades" enviando
   la `reservationRef` de la reserva editada, para que esta no se cruce consigo misma.
4. Si cambian las fechas o la categoría, el sistema ejecuta "Calcular tarifa dinámica" en el Módulo
   3 para obtener el nuevo valor y la diferencia.
5. El solicitante revisa el resumen y confirma; el sistema persiste los cambios.

Adicionalmente, los procesos "Cancelar reservación", "Generar reservación por OTA" (confirmación de
pago o garantía), "Generar reservación directa" y "Generar reservación por OTA" (cancelación
compensatoria con el motivo `ROOM_REJECTED` cuando el Módulo 1 rechaza apartar la habitación),
"Registrar Check-In", "Registrar Check-Out" y "Marcar No-Show" usan esta funcionalidad para cambiar
el `status` de la reserva a `CANCELLED`, `ACTIVE`, `IN_PROGRESS`, `COMPLETED` o `NO_SHOW`, de modo
que las reglas de transición y de concurrencia vivan en un solo lugar.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Modificación de Datos de Reservación (Priority: P1)

Un solicitante —la Recepcionista o la Ota— modifica una reserva que aún no ha
iniciado su estadía. Puede cambiar fechas, categoría o datos personales. Cuando el cambio afecta
fechas o categoría, el sistema valida disponibilidad y delega el recálculo en el Módulo 3, mostrando
la diferencia antes de confirmar; cuando solo toca datos personales, guarda directamente. Por
tratarse de una única vista, el camino feliz y los bloqueos lógicos se consolidan en esta misma
historia de usuario.

**Why this priority**: Da al hotel la flexibilidad de acomodar los cambios del cliente sin fricción
y sin gestiones por fuera del sistema, garantizando la consistencia de la disponibilidad y del valor
de la estadía antes de la llegada.

**Independent Test**: Se modifica una reserva `ACTIVE` y se verifica que el sistema valide la
disponibilidad, muestre la diferencia calculada por el Módulo 3 y solo tras la confirmación guarde
los cambios. Se repite con datos personales (sin recálculo) y sobre reservas `IN_PROGRESS`,
`COMPLETED`, `CANCELLED` y `NO_SHOW`, confirmando el bloqueo.

**Acceptance Scenarios**:

1. **Scenario**: Actualización de fechas o categoría con recálculo exitoso (Happy Path)
   - **Given** una `Reservation` en `ACTIVE` con disponibilidad validada para las nuevas fechas
   - **When** el solicitante modifica las fechas o la categoría y el Módulo 3 devuelve la tarifa
     recalculada
   - **Then** el sistema muestra el resumen con la diferencia a pagar o reembolsar y, tras la
     confirmación, actualiza la reserva

2. **Scenario**: Modificación de datos personales sin afectación financiera
   - **Given** una `Reservation` en `ACTIVE` o `PENDING`
   - **When** el solicitante corrige datos del `Guest`
   - **Then** el sistema guarda los cambios sin invocar al Módulo 3 ni alterar fechas o categoría

3. **Scenario**: Cambio de estado solicitado por un proceso interno
   - **Given** una cancelación, una confirmación de pago OTA, una cancelación compensatoria por
     `ROOM_REJECTED`, o una notificación de Check-In, Check-Out o No-Show válida
   - **When** el proceso correspondiente ejecuta "Actualizar reservación"
   - **Then** el sistema cambia el `status` a `CANCELLED`, `ACTIVE`, `IN_PROGRESS`, `COMPLETED` o
     `NO_SHOW` según la transición permitida

4. **Scenario**: Bloqueo por falta de disponibilidad (Error)
   - **Given** que "Verificar disponibilidades" indica que la `Room` no está disponible en las
     nuevas fechas
   - **When** el solicitante intenta modificar las fechas
   - **Then** el sistema bloquea la confirmación y responde **HTTP 400 (Bad Request)** indicando la
     falta de disponibilidad

5. **Scenario**: Bloqueo de edición sobre reservas finalizadas o en curso (Error)
   - **Given** una `Reservation` en `IN_PROGRESS`, `COMPLETED`, `CANCELLED` o `NO_SHOW`
   - **When** un solicitante intenta editarla
   - **Then** el sistema bloquea la edición con **HTTP 400** indicando que el estado actual no
     admite modificaciones

6. **Scenario**: Cambio de habitación coordinado con el Módulo 1
   - **Given** una `Reservation` en `ACTIVE` con la `Room` A en `RESERVED`, y la `Room` B disponible
     en sus fechas
   - **When** el solicitante cambia la reserva a la `Room` B y confirma
   - **Then** el sistema ordena al Módulo 1 `RESERVED` para la `Room` B y, tras su confirmación,
     ordena `AVAILABLE` para la `Room` A, y actualiza la reserva

### Casos Borde

- ¿Qué sucede cuando el Módulo 3 no responde durante el recálculo? El sistema detiene la
  confirmación financiera y responde **HTTP 400** con el mensaje: "No se pudo calcular la nueva
  tarifa en este momento. Intente más tarde."
- ¿Qué sucede si se envían fechas inválidas (salida antes de llegada)? El sistema rechaza la
  solicitud con **HTTP 400**: "Las nuevas fechas de reserva son inválidas", sin consultar al Módulo
  3.
- ¿Qué sucede si se ingresan caracteres extraños en los datos del huésped? El sistema los rechaza
  antes de guardar con **HTTP 400**: "El formato de los datos contiene caracteres no válidos."
- ¿Cómo maneja el sistema dos ediciones simultáneas de la misma reserva? Usa control de concurrencia
  optimista con el atributo `version`: la segunda recibe **HTTP 400** indicando que debe recargar.
- ¿Qué sucede con el Módulo 1 cuando solo cambian las fechas? Nada: un cambio de fechas sin cambio
  de `Room` no genera órdenes al Módulo 1.
- ¿Cómo se coordina el cambio de habitación con el Módulo 1? El sistema ejecuta "Establecer estado
  de habitación" en este orden: primero ordena `RESERVED` para la `Room` nueva y, solo si el Módulo
  1 la confirma, ordena `AVAILABLE` para la anterior. Si el Módulo 1 rechaza la `Room` nueva o no
  responde, el cambio no se aplica, la reserva conserva su `Room` original y se responde **HTTP
  400**. Si falla únicamente la liberación de la `Room` anterior, el cambio ya quedó aplicado y esa
  orden queda en `PENDING` para reintentarse; el sistema responde **HTTP 400** con el mensaje "La
  reserva se actualizó, pero la liberación de la habitación anterior quedó pendiente", y reenviar la
  misma solicitud no repite el cambio.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema debe permitir editar los datos de estadía y los datos personales de una
  `Reservation` en `ACTIVE` o `PENDING`.
- **FR-002**: El sistema debe validar la disponibilidad mediante "Verificar disponibilidades" cuando
  cambien las fechas o la habitación, enviando la `reservationRef` de la reserva editada para
  excluirla del cruce de solapamientos.
- **FR-003**: El sistema debe invocar "Calcular tarifa dinámica" del Módulo 3 cuando el cambio
  afecte fechas o categoría, y exigir la confirmación del solicitante antes de persistir.
- **FR-004**: El sistema debe permitir modificar los datos personales del `Guest` sin invocar al
  Módulo 3 ni exigir disponibilidad.
- **FR-005**: El sistema debe ser el único punto de cambio de `status` de la reserva, aceptando las
  transiciones `PENDING`→`ACTIVE`, `ACTIVE`→`IN_PROGRESS`, `IN_PROGRESS`→`COMPLETED`, `ACTIVE` o
  `PENDING`→`CANCELLED`, y `ACTIVE` o `PENDING`→`NO_SHOW`; cualquier otra transición debe rechazarse
  con **HTTP 400**.
- **FR-006**: El sistema debe aplicar control de concurrencia optimista mediante `version`.
- **FR-007**: Cuando la modificación cambie la `Room`, el sistema debe ordenar primero `RESERVED`
  para la nueva y solo después `AVAILABLE` para la anterior, abortando el cambio si el Módulo 1
  rechaza la nueva o no responde. Si falla únicamente la liberación de la anterior, el cambio debe
  conservarse, la orden debe reintentarse desde `PENDING` y la respuesta debe ser **HTTP 400** con
  el aviso de liberación pendiente.
- **FR-008**: El sistema debe interceptar excepciones de validación, concurrencia e integración,
  respondiendo **HTTP 400 (Bad Request)** y prohibiendo errores **HTTP 500**; en el caso de la
  liberación pendiente de FR-007, la respuesta 400 no implica que el cambio se haya revertido: el
  cambio ya está aplicado y solo la liberación queda por reintentar.

### Non-Functional Requirements

- **NFR-001**: La recotización integrada con el Módulo 3 debe completarse en menos de 3 segundos en
  condiciones normales.

### Key Entities *(include if feature involves data)*

- **Reservation**: Entidad principal actualizada. Atributos: `reservationRef`, `guestRef`, `roomId`,
  `categoryRoom`, `startDate`, `endDate`, `grossAmount`, `version`,  `source` (`DIRECT` | `OTA`) y
  `status` (`PENDING`, `ACTIVE`, `IN_PROGRESS`,
  `COMPLETED`, `CANCELLED`, `NO_SHOW`).
- **Guest**: Titular de la reserva. Atributos: `id`, `fullName`, `documentNumber`, `nationality`,
  `contactPhone`, `contactEmail`.
- **Room**: Habitación física referenciada para la disponibilidad. Atributos: `roomId`,
  `numberRoom`, `categoryRoom` y `status` (`AVAILABLE` | `RESERVED` | `OCCUPIED`).
- **RateQuote**: Cotización del Módulo 3 para la modificación. Atributos: `reservationRef`,
  `previousGrossAmount`, `grossAmount`, `amountDifference`, `currency`, `calculatedAt`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El solicitante completa la actualización de fechas y tarifa en menos de 1 minuto una
  vez recibida la cotización del Módulo 3.
- **SC-002**: El 100% de los cambios de estado cumplen con las transiciones permitidas y con la
  nomenclatura unificada de estados.
- **SC-003**: El 100% de los intentos inválidos (fechas pasadas, falta de disponibilidad, reservas
  finalizadas) responden **HTTP 400**, con cero errores **HTTP 500**.
- **SC-004**: Cero discrepancias financieras entre el Módulo 2 y el Módulo 3 tras actualizaciones
  exitosas.
