# Feature Specification: Rediseño visual del frontend de la Recepcionista

**Created**: 2026-11-14

## Use Case (Caso de Uso)

### Descripción del problema

Las pantallas de la Recepcionista se construyeron caso de uso por caso de uso, cada una con su propia
hoja de estilos y sus propios colores, radios y sombras. El resultado funciona, pero:

- No tiene una identidad visual del hotel: no usa la marca hospitua (logo, paleta y tipografía).
- Cada pantalla repite estilos y se ve distinta de las demás: tablas, botones, estados y mensajes
  cambian de una a otra.
- La Recepcionista trabaja turnos largos frente a la pantalla, y la interfaz no le ofrece una opción
  de menor brillo.
- El encabezado con todos los enlaces en una sola fila no cabe en una tablet de recepción ni en un
  celular, y las tablas se salen de la pantalla.

Esta especificación cubre **solo la capa visual** del frontend de la Recepcionista: cómo se ven y se
reacomodan las pantallas que ya existen. **No cambia ninguna regla de negocio, ningún contrato con el
backend ni ningún flujo de los casos de uso**: las pantallas hacen las mismas llamadas, muestran los
mismos datos y los mismos mensajes, y sus pruebas siguen iguales. Lo que dice cada caso de uso sobre
qué muestra su pantalla sigue mandando; el wireframe (`specs/wireframes/`) sigue siendo la referencia
de **qué** hay en cada pantalla, y esta especificación fija **cómo se ve**.

La identidad visual sale de los paquetes de marca entregados al equipo: **HOSPITUA Complete Visual
System v2** (paleta, logo, tipografía, iconos y movimiento) y **HOSPITUA Login 3D Final** (el conserje
animado del login). De esos paquetes se toma solo lo visual: las funciones que proponen y que el
Módulo 2 no tiene (varias sedes, selector de turno, contraseña, facturación DIAN, housekeeping, split
billing, Rack de 14 días) y sus datos de ejemplo **quedan fuera**.

### Flujo de Usuario de Alto Nivel

1. La Recepcionista abre la aplicación y ve la pantalla de **apertura de turno** con la marca
   hospitua. Escribe su nombre como hoy (login simulado, regla 10 del plan base) y entra.
2. Trabaja en un **marco único**: menú lateral con las pantallas, una cabecera con la ubicación
   actual y la pantalla en el centro. Todas las pantallas comparten los mismos componentes visuales.
3. Si lo prefiere, cambia a **tema oscuro**; la elección se recuerda en ese navegador.
4. Desde una tablet o un celular, el menú se recoge y las tablas se desplazan sin romper la pantalla.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Identidad visual única en todas las pantallas (Priority: P1)

Todas las pantallas usan la marca hospitua y los mismos componentes: colores, tipografía, botones,
campos, tablas, estados de reserva, mensajes de error, carga y vacío.

**Why this priority**: Es el objetivo del rediseño; las demás historias se apoyan en estos componentes.

**Independent Test**: Recorrer todas las pantallas y comprobar que usan la paleta, la tipografía y los
componentes compartidos, y que las pruebas existentes del frontend pasan sin cambios.

**Acceptance Scenarios**:

1. **Scenario**: Los estados de la reserva se distinguen igual en todas las pantallas
   - **Given** una reserva `ACTIVE`, otra `IN_PROGRESS`, otra `PENDING`, otra `COMPLETED` y otra `CANCELLED`
   - **When** la Recepcionista las ve en el listado o en el detalle
   - **Then** cada estado tiene el mismo color en las dos pantallas: Confirmada (`ACTIVE`) en dorado,
     En curso en petróleo, Pendiente en ámbar, Completada neutra y Cancelada o No-Show en rojo, y el
     texto del estado no cambia
2. **Scenario**: Los mensajes del backend se muestran igual en todas las pantallas
   - **Given** cualquier pantalla que recibe un error de la API
   - **When** se muestra el mensaje
   - **Then** se ve con el mismo componente de error, con el texto del backend tal cual
3. **Scenario**: No cambia lo que muestra ni lo que envía ninguna pantalla
   - **Given** las pruebas existentes del frontend
   - **When** se ejecutan después del rediseño
   - **Then** pasan sin modificarse

---

### User Story 2 - Marco de trabajo y navegación (Priority: P1)

El menú pasa a un **rail lateral** con el logo, las pantallas y, abajo, la Recepcionista y el botón
"Salir". Una **cabecera** muestra la ubicación (por ejemplo "Reservas / RSV-3F9A1C7B").

**Why this priority**: Reemplaza el encabezado actual, que no cabe en pantallas angostas y no indica en
qué reserva se está.

**Independent Test**: Navegar entre todas las pantallas desde el rail y comprobar la ubicación en la
cabecera; las pruebas de rutas y de "Salir" siguen pasando.

**Acceptance Scenarios**:

1. **Scenario**: La navegación tiene las mismas pantallas y el mismo orden
   - **Given** la Recepcionista con su nombre guardado
   - **When** abre cualquier pantalla
   - **Then** el menú "Principal" lista Inicio, Reservas, Huéspedes alojados, Exportar SIRE,
     Habitaciones, Tarifas y Agencias OTA, marca la pantalla actual y muestra "Recepcionista: {nombre}"
2. **Scenario**: La cabecera indica dónde está
   - **Given** el detalle de la reserva `RSV-3F9A1C7B`
   - **When** se muestra
   - **Then** la cabecera dice "Reservas / RSV-3F9A1C7B"
3. **Scenario**: El rail se puede contraer
   - **Given** una pantalla de escritorio
   - **When** la Recepcionista contrae el rail
   - **Then** quedan solo los iconos, con el nombre de cada pantalla al pasar el cursor, y la
     preferencia se recuerda en ese navegador

---

### User Story 3 - Apertura de turno con la marca (Priority: P2)

La pantalla de login se divide en dos: a la izquierda el formulario sobre Ivory, con el logo animado;
a la derecha (solo en pantallas anchas) un panel decorativo en Dark Petroleum con la tarjeta llave
digital y Túa, el conserje de hospitua, que saluda.

**Why this priority**: Es la primera pantalla que ve la Recepcionista en cada turno, pero no cambia el
trabajo con las reservas.

**Independent Test**: Entrar con un nombre válido, con un nombre vacío y con uno de más de 100
caracteres; las pruebas del login simulado siguen pasando.

**Acceptance Scenarios**:

1. **Scenario**: El login funciona igual
   - **Given** la pantalla de apertura de turno
   - **When** la Recepcionista escribe su nombre y pulsa "Ingresar"
   - **Then** entra a la pantalla pedida, como hoy, sin esperas añadidas
2. **Scenario**: Túa reacciona al formulario
   - **Given** la pantalla de apertura de turno en una pantalla ancha
   - **When** la Recepcionista escribe, o pulsa "Ingresar" sin nombre
   - **Then** Túa mira hacia el formulario mientras escribe, y se sacude con la burbuja "Revise el
     nombre" cuando el nombre no sirve; el mensaje de error del formulario es el mismo de hoy
3. **Scenario**: El panel decorativo no inventa datos
   - **Given** el panel derecho
   - **When** se muestra
   - **Then** solo muestra datos reales (hora y día de Colombia, avance del día) y es invisible para
     los lectores de pantalla

---

### User Story 4 - Tema oscuro (Priority: P3)

La Recepcionista puede cambiar entre tema claro y oscuro desde el login o desde el rail.

**Why this priority**: Reduce el brillo en los turnos de noche; no es necesario para operar.

**Independent Test**: Cambiar el tema, recargar y comprobar que se mantiene; con el sistema en modo
oscuro y sin elección previa, la aplicación abre en oscuro.

**Acceptance Scenarios**:

1. **Scenario**: Por defecto sigue al sistema
   - **Given** un navegador sin elección guardada y el sistema en modo oscuro
   - **When** se abre la aplicación
   - **Then** se ve en tema oscuro, sin un parpadeo claro al cargar
2. **Scenario**: La elección se recuerda
   - **Given** la Recepcionista elige tema claro
   - **When** recarga la página
   - **Then** sigue en tema claro

---

### User Story 5 - Tablet y celular (Priority: P3)

Las pantallas se reacomodan en tablet y celular sin perder información ni acciones.

**Why this priority**: La recepción usa tablets en el lobby, pero el trabajo principal es en escritorio.

**Independent Test**: Recorrer las pantallas a 1440, 900 y 390 px de ancho.

**Acceptance Scenarios**:

1. **Scenario**: Tablet horizontal
   - **Given** una pantalla de 768 a 1023 px
   - **When** se abre cualquier pantalla
   - **Then** el rail queda solo con iconos
2. **Scenario**: Tablet vertical y celular
   - **Given** una pantalla de menos de 768 px
   - **When** se abre cualquier pantalla
   - **Then** el rail se oculta y se abre desde un botón de la cabecera; las tablas se desplazan en
     horizontal con la primera columna fija
3. **Scenario**: Paneles de detalle
   - **Given** la vista previa de un movimiento SIRE o el detalle de un huésped alojado
   - **When** se abre
   - **Then** aparece como panel lateral derecho en escritorio y tablet, y como panel inferior en
     celular, con los mismos datos y botones de hoy

### Edge Cases

- **Sin las fuentes de la marca** (sin red o bloqueadas): se usa la fuente del sistema y nada se rompe.
- **Movimiento reducido** (preferencia del sistema): las animaciones se desactivan.
- **Sin almacenamiento local** (navegación privada): el tema y el rail vuelven a su valor por defecto
  al recargar; la aplicación funciona igual.
- **Lectores de pantalla**: lo decorativo (panel del login, Túa, iconos) no se anuncia; los controles
  conservan sus nombres accesibles ("Ingresar", "Salir", "Buscar", …).

## Requirements *(mandatory)*

### Functional Requirements

**Alcance**

- **FR-001**: El rediseño MUST cambiar solo la presentación: las pantallas MUST hacer las mismas
  llamadas a la API, con los mismos datos y cabeceras, y mostrar los mismos datos, textos de acciones
  y mensajes del backend que hoy.
- **FR-002**: Las pruebas existentes del frontend MUST pasar sin modificarse.
- **FR-003**: Lo que cada caso de uso dice de su pantalla MUST seguir cumpliéndose; esta
  especificación no agrega datos, filtros ni acciones de negocio.

**Sistema visual**

- **FR-004**: Colores, tipografía, radios, sombras y movimiento MUST definirse una sola vez como tokens
  compartidos, y las pantallas MUST usarlos en lugar de valores propios.
- **FR-005**: La paleta MUST ser la de hospitua: Ivory `#F7F5F0` (fondo), Dark Petroleum `#123B46`
  (acción principal), Petroleum Green `#2E6870` (enlaces, foco y elementos activos), Charcoal
  `#20272A` (texto) y Elegant `#B89B5E` (dorado, solo para detalles de marca y guías activas).
- **FR-006**: La tipografía MUST ser Plus Jakarta Sans (y JetBrains Mono para códigos y horas), con
  cifras tabulares en números, fechas, horas, montos y códigos.
- **FR-007**: Los estados de la reserva MUST mostrarse con el color de FR-005 / US1 escenario 1 y su
  texto actual.
- **FR-008**: La interfaz MUST usar solo iconos de línea (incluidos los del paquete de marca), sin emojis.
- **FR-009**: El logo MUST ser el oficial de hospitua (la "H" con la puerta entreabierta).

**Marco y navegación**

- **FR-010**: El frontend MUST mostrar un rail lateral con las pantallas de la navegación actual, en el
  mismo orden, con el nombre de la Recepcionista y "Salir".
- **FR-011**: El frontend MUST mostrar en la cabecera la ubicación de la pantalla actual.
- **FR-012**: El rail MUST poder contraerse a iconos en escritorio, y MUST recordar esa preferencia en
  el navegador.

**Login**

- **FR-013**: El login MUST seguir pidiendo solo el nombre, con las mismas validaciones y mensajes, y
  MUST entrar sin demoras añadidas.
- **FR-014**: El panel decorativo del login y Túa MUST mostrar solo datos reales y MUST ocultarse a los
  lectores de pantalla.

**Tema y dispositivos**

- **FR-015**: El frontend MUST ofrecer tema claro y oscuro; por defecto MUST seguir la preferencia del
  sistema y MUST recordar la elección en el navegador.
- **FR-016**: El frontend MUST adaptarse a escritorio (≥ 1024 px), tablet horizontal (768–1023 px) y
  tablet vertical o celular (< 768 px) según US5.
- **FR-017**: Las fuentes MUST servirse desde el propio frontend, sin depender de un servicio externo.
- **FR-018**: Las animaciones MUST desactivarse cuando el sistema pide movimiento reducido.

### Fuera de alcance

- Las funciones que proponen los paquetes de marca y que el Módulo 2 no tiene: varias sedes, selector
  de turno, contraseña, facturación DIAN, housekeeping, split billing y Rack de 14 días.
- Los datos de ejemplo de los paquetes (sedes, ocupaciones, reservas).
- La variante de Túa con Three.js / React Three Fiber.
- Pantallas nuevas, como "Asignar habitación".

### Puntos para decidir en la revisión

Estos agregados no salen de ningún caso de uso. Se proponen aquí para que el equipo los apruebe o los
quite antes de integrar:

1. **Paleta de comandos (⌘K / Ctrl K)** para ir a cualquier pantalla escribiendo su nombre.
2. **Reloj con la hora de Colombia** en la cabecera.
3. **Botón "Nueva reserva"** en la cabecera, fuera de las pantallas de reservas.
4. **Cerrar la vista previa SIRE y el detalle del huésped con un clic fuera del panel**, además del
   botón "Cerrar" y la tecla Escape.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El 100 % de las pruebas existentes del frontend pasa sin cambios.
- **SC-002**: Ninguna pantalla define colores, radios o sombras propios fuera de los tokens.
- **SC-003**: Ninguna pantalla tiene desplazamiento horizontal de página a 390 px de ancho (las tablas
  se desplazan dentro de su panel).
- **SC-004**: El contraste del texto principal y de los botones cumple WCAG AA (4,5:1) en los dos temas.
