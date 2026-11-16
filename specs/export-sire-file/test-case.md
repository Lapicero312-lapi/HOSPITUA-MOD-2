### Test Case Specification: Exportar Archivo SIRE
**Created** : 2026-11-15  **Spec/Plan Link** : [spec.md](spec.md) · [plan.md](plan.md)  **Status** : Draft

#### Test Overview  *(mandatory)*

**Test Case ID** : TC-008-ExportSireFile
**Product Name & Version** : HOSPITUA · Módulo 2: Operación de Reservas y Cumplimiento Legal v0.0.1
**Author** : Victor Diaz
**Current Owner** : Victor Diaz
**Priority** : P2 - High

--------------------------------------------------------------------------------

#### Objectives & Context  *(mandatory)*

##### Test Objectives
Este caso de prueba verifica que la Recepcionista descarga el archivo SIRE correcto para enviarlo a Migración
Colombia:
- la pantalla abre en los movimientos de hoy y el periodo se cambia con las fechas o los atajos (escenario 8 y
  FR-002a);
- el archivo trae una línea por cada entrada y cada salida de cada huésped extranjero del periodo, no solo del
  titular, y deja fuera a los colombianos (escenarios 1 a 3 y FR-003);
- cada línea tiene los 12 campos en orden, con el separador y el formato de fecha configurados (FR-005 y
  SC-001);
- el mismo periodo o el mismo movimiento se descargan las veces que haga falta, y cada descarga queda
  registrada; la vista previa no registra nada (escenarios 4, 6 y 7, FR-006, FR-007 y FR-010);
- la respuesta trae solo el archivo y el `Export-Id` (FR-008);
- un periodo sin extranjeros, inválido o demasiado largo da un `400`, y el exceso de solicitudes un `429`, nunca
  un `500` (escenario 5, FR-009 y SC-002).

##### Document References
| Reference Name | Type of Reference | Document Location / Link |
| ------ | ------ | ------ |
| Exportar Archivo SIRE | Specification Document | [specs/export-sire-file/spec.md](spec.md) |
| Exportar Archivo SIRE | Plan Document | [specs/export-sire-file/plan.md](plan.md) |
| Plan base | Plan Document | [specs/base/plan.md](../base/plan.md) |
| Despliegue de la demo (Render) | README | [README.md](../../README.md) |

--------------------------------------------------------------------------------

#### Prerequisites & Environment

##### Test Case Limitations
* El archivo tiene datos personales (NFR-002). Todos los huéspedes de este caso son ficticios, y los archivos
  descargados se borran al terminar.
* La demo es compartida: el periodo de hoy puede traer movimientos de otras pruebas o de las reservas de
  ejemplo. Por eso los pasos buscan las líneas propias por el documento, y los totales se comparan con lo que
  muestra la pantalla.
* La salida de un huésped que sigue alojado se reporta el día en que ocurre: el paso que la usa se ejecuta al
  día siguiente (sección 3).
* No se pueden provocar a mano en la demo, y los cubre `backend/test/integration/export-sire-file/`:
  * un campo con un carácter que no se puede escribir en el archivo ("Caracteres no válidos en el registro del
    huésped."): el Módulo 2 ya rechaza al recibir el Check-In los caracteres de control, y el archivo se
    escribe en `utf-8` (`export-sire-file-edge-cases.spec.ts`);
  * una generación que falla a mitad, sin dejar `SireExport` (`export-sire-file-edge-cases.spec.ts`);
  * NFR-001, 500 movimientos en menos de 2 s (`export-sire-file-time.spec.ts`).
* Que una descarga quede registrada en `SireExport` se ve en el `Export-Id` y en el nombre del archivo. Revisar
  la tabla es opcional y necesita acceso a la base de la demo.

##### Dependencies & Assumptions
* TC-011-ProcessGuestData debe pasar primero: los movimientos migratorios que se exportan los registra al
  recibir el Check-In y el Check-Out del Módulo 1.
* TC-009-GenerateDirectReservation debe pasar primero: las reservas de los huéspedes se crean desde el
  frontend.

##### Preconditions & Default Setup
* **Initial State** : la demo desplegada, con sus servicios en *Live*. Fechas relativas: `hoy` es la fecha del
  hotel (`America/Bogota`) el día en que se ejecuta, y `hoy+N`, N días después. En pantalla, las fechas se ven
  como `DD/MM/AAAA`.
* **Configuración del archivo en la demo** : código del hotel `DEMO-HOTEL`, código de la ciudad `DEMO-CIUDAD`,
  separador tabulador (la vista previa lo muestra como `→`), fechas `DD/MM/AAAA`, fin de línea `CRLF` y
  codificación `utf-8`.
* **Huéspedes ficticios** (cada uno con `firstName`, `lastName`, `documentType`, `documentNumber`,
  `nationality`, `birthDate` y, los extranjeros, `originPlace` y `destinationPlace`):

  | Huésped | Documento | Nacionalidad | Nacimiento | Procedencia | Destino |
  | ------ | ------ | ------ | ------ | ------ | ------ |
  | John Prueba | `PAS` `X0000011` | `Estados Unidos` | `1985-03-10` | `Miami, Estados Unidos` | `Cartagena, Colombia` |
  | Ana Prueba | `PAS` `X0000012` | `Venezuela` | `1992-07-01` | `Caracas, Venezuela` | `Bogotá, Colombia` |
  | Carlos Prueba | `CC` `1000000013` | `Colombia` | `1980-11-30` | — | — |
  | Marie Prueba | `PAS` `X0000014` | `Francia` | `1979-02-14` | `París, Francia` | `Medellín, Colombia` |

* **Check-In y Check-Out** : se publican con `POST` a
  `https://hospitua-m2-simulators.onrender.com/simulate/check-in` o `/simulate/check-out`, con
  `{"reservationRef", "roomId", "guests"}` como el cuerpo C1 de TC-002-CancelReservation. G1 son John, Ana y
  Carlos; G2 es Marie. El `roomId` sale de `/api/rooms` del simulador, por el número de la habitación asignada.
* **Environment** : Staging, la demo de Render:
  * frontend: `https://hospitua-m2-frontend.onrender.com`;
  * backend: `https://hospitua-m2-backend.onrender.com/api/docs`;
  * simuladores: `https://hospitua-m2-simulators.onrender.com`.
* **Test Accounts** :
  * Recepcionista: el inicio de sesión es simulado y solo pide el nombre, por ejemplo `Laura Méndez`;
  * Render: la cuenta de quien desplegó la demo, para ver los logs y, opcionalmente, consultar la base.

--------------------------------------------------------------------------------

#### Test Execution Flow  *(mandatory)*

##### Section 1: Periodo y movimientos de hoy (escenario 8 y FR-002a)
| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Crear S1, un grupo mixto | Entrar al frontend → Reservas → Nueva reserva directa, con John Prueba como titular | `TRIPLE`; entrada `hoy`, salida `hoy+1`; 1 habitación, 3 personas | La reserva queda creada | [ ] | Anotar el código y la habitación |
| 2 | Registrar la entrada del grupo | Publicar el Check-In de S1 con G1 | G1 | El simulador responde `202` y S1 queda "En curso" | [ ] | |
| 3 | Crear S2 y registrar su entrada | Nueva reserva directa con Marie Prueba como titular, y publicar su Check-In con G2 | `INDIVIDUAL`; entrada `hoy`, salida `hoy+2`; 1 habitación | S2 queda "En curso" | [ ] | Anotar el código y la habitación |
| 4 | Registrar la salida del grupo | Publicar el Check-Out de S1 con G1 | G1 | S1 queda "Completada" | [ ] | |
| 5 | Abrir la exportación | Exportar SIRE | N/A | "Exportar archivo SIRE" con "Fecha inicial" y "Fecha final" en `hoy`. "Movimientos en el periodo" muestra cinco filas propias: entrada y salida de John y de Ana, y entrada de Marie, cada una con su reserva, su huésped, su nacionalidad y el movimiento ("Entrada" o "Salida") con la fecha de `hoy`. Carlos no aparece (escenarios 3 y 8) | [ ] | Anotar el total de movimientos del periodo (N). Si hay varias páginas, las filas propias pueden estar en cualquiera |
| 6 | Cambiar el periodo con los atajos | Elegir "Últimos 7 días" y después "Hoy" | N/A | Con "Últimos 7 días", el periodo va de `hoy-7` a `hoy` y puede traer movimientos de días anteriores. Con "Hoy", vuelve a `hoy` y `hoy`, con los mismos movimientos del paso 5 (escenario 8) | [ ] | |

--------------------------------------------------------------------------------

##### Section 2: Archivo, vista previa y descargas (escenarios 1 a 4, 6 y 7)
| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Previsualizar un movimiento | En la fila de la entrada de John, "Previsualizar" | N/A | La vista previa muestra los 12 campos con su valor y la línea: `DEMO-HOTEL → DEMO-CIUDAD → PAS → X0000011 → Estados Unidos → PRUEBA → JOHN → E → <hoy> → Miami, Estados Unidos → Cartagena, Colombia → 10/03/1985`. No se descarga nada (escenario 6 y FR-005) | [ ] | Los nombres y apellidos salen en mayúsculas |
| 2 | Previsualizar una salida | En la fila de la salida de Ana, "Previsualizar" | N/A | La misma forma, con `PAS → X0000012 → Venezuela → PRUEBA → ANA → S → <hoy> → Caracas, Venezuela → Bogotá, Colombia → 01/07/1992` | [ ] | |
| 3 | Descargar todo el periodo | Cerrar la vista previa → "Descargar todo el periodo (.TXT)" | N/A | Se descarga `SIRE_<id>.txt` y aparece "Archivo SIRE_<id>.txt descargado: N movimientos." El archivo tiene N líneas, separadas con tabulador y terminadas en `CRLF`, entre ellas las cinco propias, con los mismos valores de la vista previa. No hay ninguna línea de Carlos (escenarios 1, 2 y 3, FR-005 y FR-007) | [ ] | Anotar el `<id>` |
| 4 | Descargar otra vez el mismo periodo | "Descargar todo el periodo (.TXT)" de nuevo | N/A | Otro archivo, con otro `<id>` y las mismas N líneas: no hay restricción por haberlo descargado antes (escenario 4 y FR-006) | [ ] | |
| 5 | Descargar un solo movimiento | En la fila de la entrada de Marie, "Descargar", dos veces | N/A | Cada vez se descarga un `SIRE_<id>.txt` con una sola línea, la de Marie, y aparece "Movimiento de Marie Prueba descargado (SIRE_<id>.txt).", con un `<id>` distinto cada vez (escenario 7 y FR-010) | [ ] | |
| 6 | Exportar por la API | Documentación de la API → `POST /api/sire/exports` con `X-User` | `{"exportKind": "PERIOD", "startDate": "<hoy>", "endDate": "<hoy>"}`; `X-User` `Laura Méndez` | `200` con el cuerpo de texto del archivo y nada más, la cabecera `Export-Id` y `Content-Disposition` `attachment; filename="SIRE_<Export-Id>.txt"` (FR-008) | [ ] | |
| 7 | Revisar el histórico | Opcional, con acceso a la base de la demo: `SELECT export_kind, records_count, date_range_start, date_range_end, processed_by FROM sire_export ORDER BY export_date DESC LIMIT 5;` | N/A | Una fila por cada descarga de los pasos 3 a 6 (dos `PERIOD` de N, dos `SINGLE_MOVEMENT` de 1 y una `PERIOD` por la API), con `Laura Méndez` en `processed_by`. Ninguna por las vistas previas (FR-007 y SC-003) | [ ] | Opcional |
| 8 | Revisar que los logs no tienen datos del archivo | Render → `hospitua-m2-backend` → Logs, buscar los documentos y los apellidos | `X0000011`, `X0000014` y `PRUEBA` | Ninguna coincidencia (plan base: los logs no llevan datos personales) | [ ] | Borrar los archivos descargados al terminar |

--------------------------------------------------------------------------------

##### Section 3: La salida de un huésped que sigue alojado (escenario 2)
| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Hoy solo se reporta su entrada | Exportar SIRE con el periodo `hoy` | N/A | Marie tiene solo la fila de entrada: S2 sigue "En curso" (escenario 2) | [ ] | |
| 2 | Registrar su salida al día siguiente | Al día siguiente, publicar el Check-Out de S2 con G2 | G2 | S2 queda "Completada" | [ ] | Se ejecuta al día siguiente |
| 3 | La salida va en el periodo en que ocurre | Exportar SIRE con "Hoy" y después con el periodo del día anterior | N/A | La salida de Marie aparece en el periodo de hoy, con la fecha de hoy, y no en el del día anterior, que conserva solo su entrada | [ ] | |

--------------------------------------------------------------------------------

##### Section 4: Periodos inválidos y límite de solicitudes (escenario 5, casos borde, FR-009 y SC-002)
| Step # | Step Description | Path & Action | Test Data | Expected Results | Pass/Fail | Comments |
| :---: | ------ | ------ | ------ | ------ | :---: | ------ |
| 1 | Un periodo sin movimientos | Exportar SIRE con un periodo futuro. Después, la misma exportación por la API | Fecha inicial `hoy+200`, final `hoy+201` | La pantalla muestra "No hay movimientos migratorios que reportar en ese periodo." y "Descargar todo el periodo (.TXT)" queda deshabilitado. La API responde `400` con el código `NO_MIGRATORY_MOVEMENTS` y el mismo mensaje, sin archivo (escenario 5) | [ ] | |
| 2 | Un periodo al revés | Fecha inicial después de la final, en pantalla y por la API | Inicial `hoy`, final `hoy-1` | "La fecha inicial no puede ser posterior a la fecha final." La API responde `400` `INVALID_DATE_RANGE` | [ ] | |
| 3 | Un periodo de más de un año | Por la API | Inicial `hoy-400`, final `hoy` | `400` con el código `PERIOD_TOO_LARGE` y "El periodo solicitado excede el límite permitido. Por favor exporte periodos más cortos." | [ ] | |
| 4 | Una fecha mal formada | Por la API | `startDate` con la fecha de hoy escrita como `DD/MM/AAAA` | `400` con el código `INVALID_DATE` | [ ] | |
| 5 | Sin la Recepcionista | `POST /api/sire/exports` sin `X-User` | El cuerpo de la sección 2, paso 6 | `400` con el código `USER_REQUIRED`, sin archivo | [ ] | |
| 6 | Un tipo de exportación que no existe | Por la API | `"exportKind": "ALL"` | `400` con el código `INVALID_EXPORT_KIND` y "El tipo de exportación no es válido." | [ ] | |
| 7 | Un movimiento que no existe | Por la API | `{"exportKind": "SINGLE_MOVEMENT", "movementId": "00000000-0000-4000-8000-000000000000"}` | `400` con el código `MOVEMENT_NOT_FOUND` y "El movimiento no existe." | [ ] | |
| 8 | Demasiadas descargas seguidas | Con el mismo `X-User`, repetir la exportación de la sección 2, paso 6, once veces dentro del mismo minuto | `X-User` `Laura Méndez` | Las primeras diez responden `200`. La undécima responde `429` con el código `TOO_MANY_REQUESTS`, "Se superó el límite de solicitudes de exportación. Intente de nuevo en unos segundos." y la cabecera `Retry-After`, nunca un `500` | [ ] | Las descargas de ese mismo minuto en la pantalla también cuentan |

--------------------------------------------------------------------------------

##### Edge Cases & Boundary Conditions
* **EC-001** : ¿Qué pasa con un periodo de más de un año? `400` "El periodo solicitado excede el límite
  permitido. Por favor exporte periodos más cortos." (sección 4, paso 3).
* **EC-002** : ¿Qué pasa con un periodo invertido o mal formado? `400`, sin consultar nada (sección 4, pasos 2 y
  4).
* **EC-003** : ¿Qué pasa con caracteres que no se pueden escribir en el archivo? `400` "Caracteres no válidos en
  el registro del huésped."; está en las limitaciones.
* **EC-004** : ¿Qué pasa con demasiadas exportaciones a la vez o seguidas? `429`, nunca `500` (sección 4,
  paso 8).
* **EC-005** : ¿Qué pasa si la generación falla a mitad? No queda `SireExport`; está en las limitaciones.
* **EC-006** : ¿Aparecen las reservas canceladas o que no se presentaron? No: nunca tuvieron Check-In, así que no
  tienen movimientos.
* **EC-007** : ¿Qué pasa con un huésped que entró y salió en el periodo? Dos líneas, una de entrada y otra de
  salida (sección 2, paso 3, con John y Ana).
* **EC-008** : ¿Qué pasa con un huésped con varias estadías en el periodo? Las líneas de cada una, porque cada
  movimiento es real.
* **EC-009** : ¿Se borran las `SireExport`? No: son un registro auditable (sección 2, paso 7).

--------------------------------------------------------------------------------

#### Defect Severity Reference

| Severity Level | Code | Definition & Impact |
| ------ | :---: | ------ |
| **Critical** | **C** | Caída del sistema, datos dañados o un recorrido crítico bloqueado sin alternativa. Por ejemplo, un archivo sin algún huésped extranjero del periodo, un colombiano en el archivo, campos fuera de orden o datos personales en los logs. |
| **Major** | **M** | Una función principal que no sirve o pierde una parte importante, pero con una alternativa incómoda. Por ejemplo, la descarga individual que no funciona pero la del periodo sí, una descarga que no queda registrada, o un `500` en lugar del `429`. |
| **Small / Minor** | **S** | Un detalle visual, de alineación, de ortografía o que no bloquea nada. Por ejemplo, el aviso de descarga sin el nombre del archivo, o una fecha de la tabla sin el formato `DD/MM/AAAA`. |
