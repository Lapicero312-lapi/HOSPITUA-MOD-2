# Especificación de Funcionalidad: Consultar Inventario y Estado de Habitaciones

**Creado**: 2026-09-08

## Escenarios de Usuario y Pruebas *(obligatorio)*

### Historia de Usuario 1 - Consultar estado de una habitación específica por ID (Prioridad: P1)

Como Recepcionista, necesito consultar el estado actual de una habitación en específico utilizando su identificador (ID) a través del inventario del Módulo 1, para validar de forma estricta si puedo realizar un Check-In (si está "Disponible"), un Check-Out (si está "Ocupada") o cualquier otra operación dependiente del estado.

**Por qué esta prioridad**: Es la base del funcionamiento de nuestro módulo de Reservas y Check-In/Out. Toda transacción sobre una habitación específica requiere una validación puntual por ID contra la fuente de verdad (Módulo 1) para garantizar que la habitación está en el estado correcto antes de proceder, previniendo errores operativos críticos.

**Prueba Independiente**: Puede probarse enviando una solicitud de consulta con un ID de habitación conocido y validando que el sistema responda permitiendo o bloqueando las opciones de Check-In o Check-Out según el estado reportado.

**Escenarios de Aceptación**:

1. **Escenario**: Validación exitosa de habitación "Disponible" para Check-In
   - **Dado** el identificador de una habitación asignada a una reserva
   - **Cuando** el sistema consulta puntualmente su estado en el Módulo 1 y este retorna "Disponible"
   - **Entonces** el sistema autoriza y permite proceder con el flujo de Check-In del huésped.

2. **Escenario**: Validación exitosa de habitación "Ocupada" para Check-Out
   - **Dado** el identificador de la habitación actual de un huésped
   - **Cuando** el sistema consulta puntualmente su estado en el Módulo 1 y este retorna "Ocupada"
   - **Entonces** el sistema autoriza iniciar el proceso de facturación y Check-Out.

3. **Escenario**: Bloqueo de Check-In en habitación no apta
   - **Dado** el identificador de una habitación que se intenta asignar
   - **Cuando** el sistema consulta el estado y este retorna "Pendiente de Limpieza" o "En Limpieza"
   - **Entonces** el sistema bloquea el registro del Check-In y despliega una advertencia indicando que la habitación no está lista para ser ocupada.

---

### Historia de Usuario 2 - Consultar opciones de habitaciones disponibles (Prioridad: P2)

Como Recepcionista, necesito poder consultar el inventario general del Módulo 1 para obtener un listado filtrado únicamente con las habitaciones que están en estado "Disponible", con el fin de poder ofrecer alternativas u opciones de asignación a un huésped que llega sin una habitación predefinida.

**Por qué esta prioridad**: Es un flujo complementario muy importante. Si bien la operación por ID (P1) domina el flujo de una reserva ya estructurada, el listado general es necesario para la asignación dinámica en el mostrador.

**Prueba Independiente**: Se puede probar listando las opciones en la interfaz y comprobando que no aparezca ninguna habitación con estado diferente a "Disponible".

**Escenarios de Aceptación**:

1. **Escenario**: Listado de habitaciones aptas para asignación
   - **Dado** que el Módulo 1 expone el inventario general
   - **Cuando** el Recepcionista solicita ver las opciones para asignar a un huésped sin habitación
   - **Entonces** el sistema filtra y muestra únicamente las habitaciones cuyo estado es "Disponible", con sus atributos completos (número, tipo, tarifa).

2. **Escenario**: Ausencia total de disponibilidad
   - **Dado** que el inventario del Módulo 1 reporta un 100% de ocupación o mantenimiento (ninguna "Disponible")
   - **Cuando** el Recepcionista intenta buscar alternativas para asignación
   - **Entonces** el sistema presenta un listado vacío con el mensaje "No hay habitaciones disponibles en este momento".

---

### Casos Borde

- ¿Qué sucede si el Módulo 1 no responde, da un timeout o devuelve un error al consultar por el ID de la habitación? 
  Nuestro sistema debe interceptar la falla, evitar que se propague como un error de servidor, y retornar un código HTTP 400 (Bad Request) con el mensaje "No se pudo validar el estado de la habitación en el inventario".
- ¿Qué sucede si se consulta un ID de habitación que no existe en el Módulo 1?
  El sistema detectará el resultado vacío y retornará un HTTP 400 indicando "El identificador de la habitación es inválido o no existe".
- ¿Qué sucede si el Recepcionista intenta forzar la asignación de una habitación que el Módulo 1 reporta como "Bloqueo Técnico"?
  La validación estricta de negocio lo bloqueará inmediatamente antes de guardar, retornando un HTTP 400 indicando "La habitación seleccionada se encuentra bloqueada técnicamente y no admite Check-In".

## Requisitos *(obligatorio)*

### Requisitos Funcionales

- **FR-001**: El sistema DEBE consultar puntualmente el estado de una habitación por su identificador (ID) en el Módulo 1.
- **FR-002**: El sistema DEBE autorizar el proceso de Check-In únicamente si el estado de la habitación consultada es "Disponible".
- **FR-003**: El sistema DEBE autorizar el proceso de Check-Out únicamente si el estado de la habitación consultada es "Ocupada".
- **FR-004**: El sistema DEBE permitir consultar y filtrar el inventario general para obtener listados de habitaciones exclusivamente en estado "Disponible".
- **FR-005**: El sistema NO DEBE modificar los datos de la habitación (solo lectura).
- **FR-006**: El sistema DEBE manejar los errores de integración o ID inexistentes con códigos HTTP 400 controlados.

### Entidades Clave *(incluir si la funcionalidad involucra datos)*

- **Habitación**: Unidad provista por el Módulo 1. 
  - **Atributos**: ID único (UUID), número de habitación, piso/ala, tipo, capacidad máxima, tarifa base.
  - **Estados (Módulo 1)**: Disponible, Ocupada, Pendiente de Limpieza, En Limpieza, Deshabilitada por Reparación, Bloqueo Técnico, Inactiva.
- **Reserva**: Entidad propia de nuestro módulo. 
  - **Estados**: Pendiente, Activa, En Estancia (Check-In), Finalizada (Check-Out), Cancelada.
- **Recepcionista**: Actor operativo del sistema.

## Criterios de Éxito *(obligatorio)*

### Resultados Medibles

- **SC-001**: La validación puntual por ID de una habitación antes de un Check-In o Check-Out se ejecuta en menos de 1 segundo.
- **SC-002**: El 100% de los Check-In en el sistema se realizan sobre habitaciones validadas como "Disponible", y el 100% de los Check-Out sobre habitaciones validadas como "Ocupada".
- **SC-003**: Se registran 0 errores de tipo HTTP 500 relacionados con la consulta de inventario por ID, controlando todos los fallos como HTTP 400.
