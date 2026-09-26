# Decisiones pendientes de los planes del Módulo 2

**Date**: 2026-09-26  
**Plan base**: [plan.md](./plan.md)  

Lista de lo que los planes dejaron abierto y debe decidir el equipo. Cada fila trae una propuesta; la
columna **Decisión** se llena en la reunión. Las decisiones ya tomadas (C1 a C10 y D1 a D9) están en el
plan base y no se repiten aquí.

**Cómo usarla**: marcar `[x]` cuando se decida, escribir la decisión y, si cambia un documento, avisar en
la columna **Notas**. Las secciones indican con quién se decide: A (bloqueantes), B (equipo del Módulo 1),
C (equipo del Módulo 3), D (equipo del Módulo 2) y E (ajustes a documentos).

## A. Bloqueantes: decidir antes de implementar

| # | Decisión | Propuesta | Decisión | Notas |
|---|---|---|---|---|
| A1 | **Herramienta de build**: el repo ya tiene Gradle (`build.gradle`); el plan base aprobó Maven | Gradle, que ya existe; se cambia el plan | [ ] | Afecta tareas T001 y T002 del plan base |
| A2 | **Versión de Java**: el esqueleto usa la 26; la especificación técnica dice 21 | 21, salvo que el equipo prefiera la 26 | [ ] | La versión de Spring Boot del esqueleto es 4.1.1 |
| A3 | **Base de datos**: el esqueleto usa H2 y un perfil MySQL; la especificación dice PostgreSQL | PostgreSQL | [ ] | D3 (restricción de exclusión `btree_gist`) y C10 (bloqueo asesor) dependen de PostgreSQL; con MySQL hay que rehacerlas |
| A4 | **Acceso a datos**: el esqueleto usa `starter-jdbc`; la especificación dice Spring Data JPA | JPA | [ ] | El plan usa `@Version` de JPA para el control de concurrencia |
| A5 | **Estructura del proyecto**: `src/` en la raíz (esqueleto) o `backend/` + `frontend/` (plan) | `backend/` + `frontend/`, moviendo el esqueleto | [ ] | El paquete `com.hospitua.reservas` es compatible con el actual `com.hospitua` |
| A6 | **Contraseña de MySQL commiteada** en `application-mysql.properties` | Sacarla del repositorio y usar variables de entorno | [ ] | Riesgo de seguridad; no se ha modificado |
| A7 | **Autenticación (Spring Security)**: mecanismo para la Ota (clave de API u OAuth2 de cliente) y cómo se liga a `ota_id`; credenciales de servicio del Módulo 1 y del Módulo 3; sesión y expiración de Migración | Definir un mecanismo por tipo de actor | [ ] | Bloquea la tarea T018 y cinco planes |
| A8 | **Roles `FINANCE` y `ADMIN`**: el spec de comisión nombra un "analista financiero" y un "Administrador" | Crearlos como roles del Módulo 2 | [ ] | No son actores del Módulo 2 en el diccionario ni en el diagrama (ver E) |
| A9 | **Formato oficial del archivo SIRE**: columnas, anchos, delimitadores, orden y juego de caracteres | Obtener la especificación de Migración Colombia | [ ] | Bloquea `T-SIR-06` y el archivo de referencia de pruebas |
| A10 | **Mapeo de `movementType`** (`ENTRY`, `DEPARTURE`) a los códigos que exige Migración Colombia | Igual que A9 | [ ] | |

## B. Con el equipo del Módulo 1

| # | Decisión | Propuesta | Decisión | Notas |
|---|---|---|---|---|
| B1 | **Agregar el estado `Reserved`** a `Room.status` | Que lo aprueben y lo incorporen | [ ] | C8: sin él, las reservas con llegada hoy fallan y se cancelan |
| B2 | **Contrato REST del inventario**: rutas, campos y si acepta rango de fechas | No enviar fechas (el estado físico es del instante actual) | [ ] | Plan `consult-room-inventory` |
| B3 | **Listado por categoría**: completo o filtrado por estado | Que ofrezca ambos modos (D4) | [ ] | Necesario para estadías futuras |
| B4 | **Categoría inexistente** en el inventario | Devolver lista vacía, no error | [ ] | |
| B5 | **Calendario de mantenimientos**: si las fechas son fecha o fecha y hora, y si el fin es inclusivo | Fecha, con fin inclusivo | [ ] | La regla de cruce depende de esto |
| B6 | **Calendario por categoría**: que acepte `categoryRoom` o varios `roomId` | Sí, para evitar una llamada por habitación | [ ] | |
| B7 | **Órdenes de estado de habitación**: ruta, idempotencia por `requestId`, consulta del resultado por `requestId` y campos del "detalle de la reserva" | Proponer `PUT /rooms/{roomId}/state` con `Idempotency-Key` | [ ] | Plan `set-room-state` |
| B8 | **Valores de reintento** de las órdenes | Cada 15 s y 3 intentos de resolución en 2 minutos | [ ] | |
| B9 | **Mensaje `habitacion.checkin`**: confirmar que trae los datos migratorios dentro y de dónde salen `movementType` y `movementDate` | Dentro del mensaje (C2) | [ ] | El diccionario no los lista en `ForeignGuestData` |
| B10 | **Diagrama `mod-1-2-3.drawio`**: quitar la flecha "Datos de huéspedes extranjeros" y agregar la del calendario | Actualizarlo | [ ] | C2 y C4 |
| B11 | **Hora de inicio del día operativo** y zona horaria del hotel | Configurables; falta el valor | [ ] | También lo usa el cierre del día |

## C. Con el equipo del Módulo 3

| # | Decisión | Propuesta | Decisión | Notas |
|---|---|---|---|---|
| C1 | **Contrato de la tarifa dinámica**: ruta, campos y autenticación | Proponer `POST /pricing/quotes` | [ ] | Plan `calculate-dynamic-rate` |
| C2 | **Escala del importe** (decimales) y moneda | Definir con el Módulo 3 | [ ] | D2 guarda la moneda en la reserva |
| C3 | **Porcentaje de comisión**: confirmar que lo expresan de 0 a 100 | 0 a 100, dividido entre 100 (C7) | [ ] | |
| C4 | **Autenticación del Módulo 3** al llamar a `GET /api/otas/{otaId}` | Credencial de servicio (ver A7) | [ ] | |

## D. Decisiones del equipo del Módulo 2

### Reservas y huéspedes

| # | Decisión | Propuesta | Decisión | Notas |
|---|---|---|---|---|
| D1 | **Formato de `reservationRef`** | Letras, dígitos y guion, hasta 40 caracteres (o UUID corto) | [ ] | Lo genera el sistema |
| D2 | **Búsqueda por `fullName`** | Parcial, sin distinguir mayúsculas ni acentos, mínimo 3 caracteres | [ ] | |
| D3 | **Límite de resultados** de la búsqueda | 50 por búsqueda | [ ] | El spec lo menciona para un rango de fechas que no es criterio (ver E) |
| D4 | **`roomNumber` en la respuesta** de consulta de reservas | Devolver solo `roomId`; alternativa: guardar una copia al asignar | [ ] | El Módulo 1 es dueño de `roomNumber` |
| D5 | **Elegir habitación** cuando solo llega la categoría | La de menor `roomNumber` entre las candidatas | [ ] | Direct y OTA |
| D6 | **Habitaciones `Inactive`** | Excluirlas siempre | [ ] | El spec no lo dice |
| D7 | **Tope de habitaciones candidatas** por categoría y `hospitua.availability.max-parallel` | Definir según el tamaño real del hotel | [ ] | |
| D8 | **País del hotel** para decidir si un huésped es `FOREIGN` o `NATIONAL` | Parámetro `hospitua.hotel.country` | [ ] | |
| D9 | **Huésped existente**: si el tipo de documento también lo identifica, y qué campos son obligatorios | Buscar por `documentNumber`; `fullName` y `documentNumber` obligatorios | [ ] | |

### OTA y comisión

| # | Decisión | Propuesta | Decisión | Notas |
|---|---|---|---|---|
| D10 | **`currency` en el payload de la agencia** | La agencia la envía | [ ] | D2 la exige en la reserva |
| D11 | **Reintento tras un timeout**: el spec rechaza el código repetido con 400 | Alternativa: devolver la reserva ya creada | [ ] | Hoy se sigue el spec |
| D12 | **Cómo notifica la agencia el pago o la garantía** | `POST /api/ota/reservations/{reservationRef}/confirmation` | [ ] | No está en el spec |
| D13 | **Campos que puede editar la Ota**, y si puede cambiar datos del huésped | Definir según el negocio | [ ] | |
| D14 | **Estado de la comisión al cancelar** | Importe en cero al cancelar y `RECONCILED` en la conciliación | [ ] | El spec dice ambas cosas |
| D15 | **Estado `DISPUTED`** | Dejarlo fuera | [ ] | Ningún escenario lo usa |

### Cancelación y ciclo de vida

| # | Decisión | Propuesta | Decisión | Notas |
|---|---|---|---|---|
| D16 | **Formato de `processedBy`** en las cancelaciones | Usuario autenticado (Recepcionista) o identificador de la agencia | [ ] | |
| D17 | **Cancelar una reserva OTA en `PENDING`** | Igual que `ACTIVE` | [ ] | El spec lo admite |
| D18 | **400 cuando la cancelación sí se aplicó** (`ROOM_RELEASE_PENDING`) | Mantener lo que pide el spec; el cliente distingue por `errorCode` | [ ] | |
| D19 | **Hora de cierre del día operativo** | Configurable; falta el valor | [ ] | |
| D20 | **Reintentos de los consumidores de colas** | Definir cantidad y espera | [ ] | |
| D21 | **Check-In de un huésped `NATIONAL` con datos migratorios** | Ignorarlos y registrar una incidencia | [ ] | |

### SIRE

| # | Decisión | Propuesta | Decisión | Notas |
|---|---|---|---|---|
| D22 | **Doble reporte** al mismo huésped en periodos que se solapan | Definir una regla (por ejemplo, marcar lo ya exportado) | [ ] | El spec lo menciona como riesgo sin regla |
| D23 | **Límite de exportaciones simultáneas** y su alcance por instancia | Empezar con 2 por instancia | [ ] | Responde 429 al exceder |

### Generales

| # | Decisión | Propuesta | Decisión | Notas |
|---|---|---|---|---|
| D24 | **Performance Goals, Constraints y Scale/Scope** globales | Definir según el uso esperado | [ ] | Hoy solo hay tiempos por operación |
| D25 | **Herramienta de pruebas del frontend** | Vitest con Testing Library | [ ] | Propuesta nueva; no está en la especificación técnica |
| D26 | **Resilience4j** para llamadas REST | No; solo timeouts de `RestClient` | [ ] | |

## E. Ajustes a documentos del equipo

Ninguno de estos cambios está hecho.

| # | Documento | Ajuste | Motivo |
|---|---|---|---|
| E1 | `DIAGRAMA.drawio` (casos de uso) | Unir "Establecer estado de habitación" a generar directa, generar OTA y actualizar reservación | Solo está unido a cancelar; los specs lo usan en cuatro casos |
| E2 | `DIAGRAMA.drawio` | Quitar la línea de "Generar reservación por OTA" a "Calcular tarifa dinámica" | Decisión C5 |
| E3 | `diccionario.md` y `guia_flujo_reservas.html` | Aclarar que el inventario se consulta siempre solo para elegir habitaciones y el estado físico solo si la estadía incluye hoy | El spec de disponibilidad dice esto último |
| E4 | Specs de disponibilidad, inventario y otros | Listar los 8 estados de `Room` del diccionario, no solo 3 | Inconsistencia |
| E5 | `diccionario.md` | Corregir "descarga asíncronamente" de Migración; agregar `gross_amount_currency` y `status_reason`; unificar `totalAmount` con `grossAmount` | Inconsistencias y D2, D6, C6 |
| E6 | `check-view-reservation/spec.md` | Quitar o definir la "búsqueda por rango de fechas" | No está entre los criterios (FR-002) |
| E7 | `process-foreign-guest-data/spec.md` | Unificar "con una advertencia" y "200 sin advertencias mezcladas" | Se contradice |
| E8 | `export-sire-file/spec.md` | Cambiar `GET` a `POST` en la generación y definir el formato del archivo | D9 y A9 |
| E9 | `update-reservation` y `process-foreign-guest-data` | Cambiar "responde 200/400" por las reglas de cola | Decisión C1 |
| E10 | `register-ota-information-commission/spec.md` y `generate-ota-reservation/spec.md` | Usar `grossAmount` en la entidad; exponer `GET /api/otas/{otaId}` | Decisiones C3a y C6 |
| E11 | Actores de `register-ota-information-commission` | Definir si "Administrador" y "analista financiero" son actores del Módulo 2 | No aparecen en el diccionario ni en el diagrama |
| E12 | `template/sdd-guide.MD` | Corregir la ruta `specs/templates/` a `specs/template/` | Carpeta real |
| E13 | Disponibilidad agotada | Confirmar que responder 400 (directa y actualizar) y 409 (OTA) es intencional | Cada spec lo define distinto |
