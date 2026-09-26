# Feature Specification: Marcar No-Show de Reserva

**Created**: 2026-09-25

## 1. Caso de Uso

### Descripción del problema

Una reserva cuyo huésped nunca llega queda "estancada": sigue comprometiendo un cupo del aforo
lógico de su `categoryRoom` en el Módulo 2 y distorsiona las métricas de ocupación. Si nadie la
marca, el hotel pierde noches que podría haber revendido y arrastra reservas que ya no se van a
honrar. El negocio necesita un proceso automático de cierre del día que identifique las reservas
esperadas sin ingreso, las marque como no presentadas y restituya de inmediato el cupo de aforo que
tenían comprometido, resolviendo todo de forma autónoma dentro de la base de datos del Módulo 2.

Durante la etapa de reserva no existe ningún `numberRoom` físico asignado al huésped —esa asignación
ocurre únicamente en el Check-In, dentro del Módulo 1—, por lo que este proceso no tiene ninguna
habitación física que liberar y, en consecuencia, no realiza ninguna llamada hacia el Módulo 1.

### Flujo de Usuario de Alto Nivel

1. El sistema ejecuta un proceso automático al cierre del día operativo, según la zona horaria
   configurada del hotel.
2. El sistema identifica las entidades `Reservation` cuya `startDate` corresponde al día procesado
   y que se encuentran en `Reservation.state` `PENDING` o `ACTIVE`.
3. Para cada una, el sistema transiciona el `Reservation.state` a `NO_SHOW` de forma local.
4. El sistema restituye de inmediato, en la base de datos local del Módulo 2, un cupo del aforo
   lógico de la `categoryRoom` asociada a cada reserva marcada.
5. Las reservas en `IN_PROGRESS`, `COMPLETED` o `CANCELLED` se ignoran por completo.

## 2. Escenarios de Usuario y Pruebas

### User Story 1 - Validación Automática de Fin de Día (Priority: P2)

**Plain Language**: Proceso automático y 100% local que, al cierre del día operativo, transiciona a
`NO_SHOW` las reservas esperadas sin ingreso y restituye de inmediato el cupo de aforo lógico de su
`categoryRoom`, sin ninguna llamada hacia el Módulo 1.

El sistema, sin intervención humana, identifica al cierre del día las reservas esperadas que no
registraron ingreso físico, las marca como `NO_SHOW` y restituye el cupo de aforo lógico local que
tenían comprometido. Por tratarse de un único proceso automático en lote, el camino exitoso, la
exclusión de reservas en curso o finalizadas, y el manejo de fallos individuales dentro del lote se
consolidan en esta misma historia de usuario, para evitar la sobre-atomización.

**Why this priority**: Es una automatización necesaria para mantener la salud del aforo lógico y las
métricas de ocupación, aunque no bloquea la operación diaria de reservas. Se prioriza como P2 por no
ser parte del flujo transaccional inmediato de venta.

**Independent Test**: Se simula el cierre del día y se verifica que el proceso identifique las
reservas del día en `PENDING` o `ACTIVE`, las transicione a `NO_SHOW`, restituya exactamente 1 cupo
de aforo por cada una en la `categoryRoom` correspondiente, ignore las `IN_PROGRESS`, `COMPLETED` y
`CANCELLED`, y que ningún registro genere una llamada hacia el Módulo 1. La prueba se completa
simulando un registro con datos corruptos dentro del lote, confirmando que el proceso continúa con
el resto sin interrupción ni error **HTTP 500**.

**Acceptance Scenarios**:

1. **Escenario 1**: Cambio automático a `NO_SHOW` y liberación de aforo local (Happy Path)

   ```gherkin
   Given una Reservation con startDate del día procesado que sigue en Reservation.state PENDING o ACTIVE
   When el sistema ejecuta el proceso automático de cierre de día
   Then el sistema transiciona la Reservation a state NO_SHOW
   And restituye de inmediato 1 cupo del aforo lógico local de la categoryRoom asociada
   And no emite ninguna llamada hacia el Módulo 1
   ```

2. **Escenario 2**: Exclusión de reservas en curso (`IN_PROGRESS`)

   ```gherkin
   Given una Reservation con startDate del día procesado en state IN_PROGRESS
   When el sistema ejecuta el proceso de cierre de día
   Then el sistema la ignora y mantiene su state actual, porque el huésped ya ingresó
   And no restituye ningún cupo de aforo
   ```

3. **Escenario 3**: Manejo de errores aislados dentro del lote sin interrumpir el procesamiento global

   ```gherkin
   Given un lote de reservas del día procesado donde un registro presenta datos inválidos o corruptos
   When el sistema procesa el lote registro por registro
   Then el sistema captura el error de ese registro, deja una incidencia registrada
   And continúa procesando el resto del lote sin interrupción ni propagar una excepción HTTP 500
   ```

## 3. Casos Borde

- **Caso Borde 1**: Reejecución del proceso el mismo día. La operación es idempotente: el sistema
  ignora las reservas que ya se encuentran en `NO_SHOW` y no vuelve a restituir su cupo de aforo.
- **Caso Borde 2**: Inconsistencia en la zona horaria del servidor. El sistema utiliza
  obligatoriamente la zona horaria configurada del hotel para determinar el día procesado, evitando
  marcar como no presentadas reservas cuyo día operativo aún no ha finalizado.
- **Caso Borde 3**: Fallo de conexión a la base de datos durante el procesamiento. El sistema aplica
  transaccionalidad por registro, de modo que los registros no procesados por la falla quedan
  marcados para reintento, sin dejar reservas a medio actualizar entre su `state` y su restitución de
  aforo.

## 4. Requisitos

### Requisitos Funcionales

- **FR-001**: El sistema debe ejecutar el proceso automático de cierre diario utilizando la zona
  horaria oficial del hotel.
- **FR-002**: El sistema debe identificar las reservas en `Reservation.state` `PENDING` o `ACTIVE`
  cuya `startDate` sea igual al día procesado.
- **FR-003**: El sistema debe ignorar las reservas en `IN_PROGRESS`, `COMPLETED` o `CANCELLED`.
- **FR-004**: El sistema debe transicionar cada reserva identificada a `Reservation.state`
  `NO_SHOW`.
- **FR-005**: El sistema debe restituir, en la base de datos local del Módulo 2, el cupo de aforo
  disponible de la `categoryRoom` correspondiente a cada reserva marcada como `NO_SHOW`.
- **FR-006**: El sistema debe capturar los errores individuales de cada registro sin detener el
  procesamiento del resto del lote, y sin exponer en ningún caso excepciones **HTTP 500**.

### Requisitos No Funcionales

- **NFR-001**: El proceso debe completar lotes de hasta 1000 reservas en menos de 1 minuto,
  manteniendo total idempotencia.

## 5. Entidades Clave

- **Reservation**: Reserva que transiciona de `PENDING` o `ACTIVE` a `NO_SHOW`. Atributos: `id`,
  `reservationRef`, `categoryRoom`, `checkInDate`, `checkOutDate` y `state` (`PENDING`, `ACTIVE`,
  `IN_PROGRESS`, `COMPLETED`, `CANCELLED`, `NO_SHOW`).
- **Room**: Concepto de categoría de habitación (`categoryRoom`) y su cupo de aforo lógico local,
  administrado dentro del Módulo 2. No representa aquí ninguna habitación física individual, ya que
  el `numberRoom` no se asigna sino hasta el Check-In, dentro del Módulo 1.

## 6. Criterios de Éxito

### Resultados Medibles

- **SC-001**: El 100% de las reservas no honradas al cierre del día quedan en `Reservation.state`
  `NO_SHOW` con su cupo de aforo de `categoryRoom` restituido de forma exacta.
- **SC-002**: Cero llamadas de modificación realizadas hacia el Módulo 1 durante todo el proceso de
  cierre de día.
- **SC-003**: Cero interrupciones del lote o errores **HTTP 500** ante registros con datos
  corruptos o inválidos.
