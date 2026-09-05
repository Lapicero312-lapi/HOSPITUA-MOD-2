# Especificación de Funcionalidad: Exportar Archivo SIRE

**Creado**: 2026-09-05

## Escenarios de Usuario y Pruebas *(obligatorio)*

La funcionalidad de Exportar Archivo SIRE permite a la **Recepcionista** generar el reporte
periódico de huéspedes extranjeros que exige el Sistema de Información para el Reporte de
Extranjeros (SIRE) de Migración Colombia. Toda la interacción ocurre en una única pantalla de
exportación que agrupa los siguientes pasos y validaciones internas, por lo que estas no se
modelan como historias de usuario independientes sino como pasos o escenarios de la misma
historia:

- La Recepcionista selecciona un rango de fechas (`startDate` y `endDate`) sobre el cual el
  sistema debe buscar huéspedes extranjeros (`Guest.type` igual a `FOREIGN`) cuya reserva haya
  alcanzado el estado `CHECKED_IN` o `CHECKED_OUT`, y cuyos datos migratorios ya hayan sido
  validados localmente mediante "Process Foreign Guest Data" durante el check-in.
- El sistema genera un archivo de texto plano (`.TXT`) con el formato estructurado de columnas y
  delimitadores que exige Migración Colombia, usando exclusivamente los datos migratorios
  validados localmente (documento de identidad, nacionalidad, tipo de visa y fechas de estadía).
  Esta funcionalidad no envía ni transmite el archivo directamente a Migración: la descarga queda
  a cargo de la Recepcionista, quien la remite por el canal oficial correspondiente.
- Una vez generado el archivo con éxito, el sistema marca localmente cada huésped incluido como
  `EXPORTED` para evitar que vuelva a incluirse en descargas futuras, salvo que la Recepcionista
  solicite explícitamente una re-exportación histórica; esto es un paso dentro del mismo flujo, no
  una historia aparte.

**Estados relevantes de la entidad `Reservation`** (deben usarse exactamente estos valores en todo
el sistema): `PENDING`, `ACTIVE`, `CHECKED_IN`, `CHECKED_OUT`, `CANCELLED`. Esta funcionalidad solo
considera reservas en estado `CHECKED_IN` o `CHECKED_OUT`.

**Estados de exportación de la entidad `MigratoryValidation`** que introduce esta funcionalidad:
`PENDING` (validado localmente en el check-in, aún no exportado) y `EXPORTED` (ya incluido en un
reporte SIRE generado).

### Historia de Usuario 1 - Exportación de Huéspedes Extranjeros a SIRE (Prioridad: P1)

Una Recepcionista necesita cumplir con la obligación legal de reportar periódicamente a Migración
Colombia los huéspedes extranjeros hospedados en el hotel. Para ello, selecciona un rango de
fechas, el sistema busca los huéspedes extranjeros con check-in finalizado y datos migratorios
validados dentro de ese rango, genera el archivo `.TXT` estructurado, y marca localmente esos
registros como `EXPORTED` para no duplicarlos en reportes posteriores. Esta historia es el flujo
maestro de la funcionalidad: en una sola pantalla cubre el camino exitoso de generación del
reporte, el flujo operativo de re-exportación histórica cuando se necesita, y los caminos de error
que evitan generar un reporte vacío o con datos incompletos sin advertir a la Recepcionista.

**Por qué esta prioridad**: Esta funcionalidad es de cumplimiento legal obligatorio: el hotel debe
reportar a Migración Colombia la información de sus huéspedes extranjeros dentro de los plazos que
exige la normativa, y omitir o retrasar este reporte expone al hotel a sanciones y multas. Por sí
sola entrega un MVP utilizable: el hotel puede generar y descargar el reporte SIRE de forma
confiable, con la certeza de que cada huésped extranjero se reporta una sola vez.

**Prueba Independiente**: Se puede probar de forma completa seleccionando un rango de fechas de
prueba con huéspedes extranjeros con check-in finalizado y datos migratorios completos,
descargando el archivo `.TXT`, verificando que su contenido corresponde exactamente a esos
huéspedes, y confirmando que su estado de exportación cambia a `EXPORTED`. La misma prueba se
completa marcando la opción de re-exportación sobre huéspedes ya `EXPORTED`, seleccionando un
rango sin huéspedes extranjeros, y seleccionando un rango con un huésped de datos migratorios
incompletos, confirmando en cada caso el comportamiento esperado sin generar un reporte incorrecto
ni un error de servidor. Entrega el valor de un reporte SIRE confiable, auditable y libre de
duplicados.

**Escenarios de Aceptación**:

*Escenarios de Éxito (Happy Path)*

1. **Escenario**: Generación exitosa de reporte SIRE (.TXT) con registros pendientes
   - **Dado** que existen registros de check-in de huéspedes extranjeros con exportación
     pendiente (`MigratoryValidation` en estado `PENDING`) dentro del rango de fechas seleccionado
   - **Cuando** la Recepcionista genera el archivo SIRE y confirma la descarga del archivo `.TXT`
   - **Entonces** el sistema genera el archivo plano estructurado, cambia localmente el estado de
     exportación de esos huéspedes a `EXPORTED`, y muestra un mensaje confirmando la cantidad de
     huéspedes incluidos

*Escenarios de Flujo Operativo*

2. **Escenario**: Re-exportación de huéspedes extranjeros previamente procesados
   - **Dado** que existen registros de huéspedes extranjeros en estado `EXPORTED` dentro de una
     fecha determinada
   - **Cuando** la Recepcionista marca explícitamente la opción "Incluir ya exportados" y genera
     el archivo
   - **Entonces** el sistema permite descargar nuevamente el archivo `.TXT` con esa información,
     sin duplicar el registro de auditoría de `SireExport` ni generar un cambio de estado
     adicional sobre huéspedes que ya estaban `EXPORTED`

*Escenarios de Error / Casos Espejo (Caminos Tristes)*

3. **Escenario**: Intento de exportación en un rango de fechas sin registros extranjeros
   - **Dado** que el sistema no tiene ningún check-in de huéspedes con `Guest.type` igual a
     `FOREIGN` dentro del período seleccionado
   - **Cuando** la Recepcionista genera el reporte
   - **Entonces** el sistema bloquea la descarga, detiene el flujo de forma segura, y responde con
     un error controlado **HTTP 400** indicando que no se encontraron ingresos de huéspedes
     extranjeros en el rango de fechas seleccionado

4. **Escenario**: Omisión controlada de huéspedes con datos migratorios incompletos
   - **Dado** que existen huéspedes extranjeros dentro del rango de fechas, pero uno de ellos
     tiene un campo migratorio obligatorio vacío o inválido (por ejemplo, sin `visaType`)
   - **Cuando** la Recepcionista genera la exportación
   - **Entonces** el sistema omite de forma segura ese registro del archivo, genera el `.TXT` con
     el resto de huéspedes extranjeros correctos, y responde con una alerta controlada **HTTP
     400** que detalla qué huéspedes específicos requieren corrección manual de sus datos antes de
     poder ser exportados

### Casos Borde

- **¿Qué sucede cuando ocurre un error de base de datos al actualizar el estado a `EXPORTED`
  después de iniciar la descarga?**: el sistema trata la generación del archivo y la
  actualización del estado como una operación transaccional; si la persistencia del estado falla
  tras generar el archivo, el sistema no confirma la exportación como completada, informa a la
  Recepcionista con un error controlado **HTTP 400** que debe reintentar la operación, y en
  ningún caso deja huéspedes marcados como `EXPORTED` sin que el archivo se haya generado
  correctamente, evitando a toda costa un fallo **HTTP 500**.
- **¿Cómo maneja el sistema un rango de fechas de búsqueda ingresado de forma invertida?**: si la
  fecha de inicio (`startDate`) es posterior a la fecha de fin (`endDate`), el sistema rechaza la
  búsqueda con un error controlado **HTTP 400** y un mensaje claro, sin ejecutar ninguna consulta
  ni generar archivo alguno.
- **¿Cómo maneja el sistema una fecha de inicio o fin vacía o con formato inválido?**: el sistema
  rechaza la solicitud con **HTTP 400** y un mensaje amigable indicando qué fecha falta o es
  inválida, sin dejar que la excepción se propague como un error de servidor.
- **¿Qué sucede cuando el rango de fechas seleccionado es demasiado amplio y produce un volumen de
  huéspedes inusualmente grande?**: el sistema genera el archivo de todas formas dentro de los
  límites de procesamiento definidos, pero si el volumen excede su capacidad de procesamiento
  configurada, rechaza la solicitud con **HTTP 400** sugiriendo a la Recepcionista dividir la
  consulta en rangos de fechas más pequeños.
- **¿Qué sucede cuando dos Recepcionistas generan el reporte SIRE para el mismo rango de fechas de
  forma simultánea?**: el sistema controla la concurrencia de manera que cada huésped se marque
  como `EXPORTED` una sola vez; la segunda generación concurrente ve a esos huéspedes ya
  `EXPORTED` y no duplica el registro de auditoría ni el conteo de huéspedes reportados.

## Requisitos *(obligatorio)*

### Requisitos Funcionales

- **FR-001**: El sistema debe permitir a la Recepcionista filtrar los registros de check-in por un
  rango de fechas (`startDate` y `endDate`).
- **FR-002**: El sistema debe extraer de forma exclusiva los datos de huéspedes extranjeros
  (`Guest.type` igual a `FOREIGN`) asociados a reservas en estado `CHECKED_IN` o `CHECKED_OUT`.
- **FR-003**: El sistema debe generar un archivo de texto plano (`.TXT`) estructurado según el
  estándar de columnas y delimitadores especificado por Migración Colombia.
- **FR-004**: El sistema debe validar que los campos migratorios obligatorios (documento de
  identidad, nacionalidad, tipo de visa y fechas de estadía) estén completos antes de escribir
  cada línea de registro; si un huésped tiene datos incompletos, el sistema debe omitir su
  registro del archivo e informar detalladamente cuál huésped requiere corrección.
- **FR-005**: El sistema debe actualizar el estado de exportación local de cada huésped incluido
  a `EXPORTED` una vez que el archivo se genera con éxito.
- **FR-006**: El sistema debe permitir a la Recepcionista solicitar explícitamente la
  re-exportación de huéspedes ya marcados como `EXPORTED`, sin duplicar los registros de auditoría
  existentes ni generar un cambio de estado adicional sobre huéspedes ya exportados.
- **FR-007**: El sistema debe registrar cada exportación generada como un `SireExport` con la
  fecha de exportación, la cantidad de registros incluidos, y la Recepcionista responsable.
- **FR-008**: El sistema no debe bloquear la generación completa del archivo cuando solo una parte
  de los huéspedes del rango tenga datos migratorios incompletos; debe excluir únicamente esos
  registros e informar cuáles requieren corrección.
- **FR-009**: El sistema debe bloquear la descarga y responder con un mensaje controlado cuando no
  exista ningún huésped extranjero con check-in finalizado en el rango de fechas seleccionado.
- **FR-010**: El sistema debe interceptar cualquier inconsistencia de fechas o problema de
  validación de entrada y responder con errores de negocio **HTTP 400 (Bad Request)** amigables;
  el sistema no debe permitir que estos errores se propaguen como fallas de infraestructura
  **HTTP 500**.
- **FR-011**: El sistema debe mantener un registro auditable de cada intento de exportación,
  incluyendo los intentos bloqueados o realizados con advertencias y la razón correspondiente.
- **FR-012**: El sistema debe comunicar con claridad, en cada caso de rechazo o advertencia,
  exactamente qué huésped o qué dato requiere corrección.

### Requisitos No Funcionales

- **NFR-001**: El tiempo de procesamiento y generación de la descarga del archivo `.TXT` en el
  servidor debe ser menor a 2 segundos para reportes de hasta 500 huéspedes.
- **NFR-002**: El archivo temporal generado debe manejarse en un buffer de memoria aislado y
  seguro en el backend antes de transmitirse al cliente, sin quedar accesible a otras solicitudes
  concurrentes.

### Entidades Clave *(incluir si la funcionalidad involucra datos)*

- **SireExport**: Representa el histórico de exportaciones generadas hacia Migración. Atributos
  clave: `id` (identificador de la exportación), `exportDate` (fecha y hora en que se generó el
  archivo), `recordsCount` (cantidad de huéspedes incluidos), `processedBy` (Recepcionista
  responsable), `dateRangeStart` y `dateRangeEnd` (rango de fechas consultado), y
  `includesReExported` (booleano que indica si la exportación incluyó huéspedes ya `EXPORTED`).
  Un `SireExport` puede referenciar uno o más `Guest`.
- **Reservation**: Representa la estadía asociada al huésped extranjero exportado. Atributos
  clave: `reservationRef`, `guestList`, `assignedRoom`, `startDate`, `endDate`, `source`, y
  `status` con valores posibles: `PENDING`, `ACTIVE`, `CHECKED_IN`, `CHECKED_OUT`, `CANCELLED`.
  Esta funcionalidad solo considera huéspedes cuya `Reservation` esté en `CHECKED_IN` o
  `CHECKED_OUT`.
- **Guest**: Representa al huésped origen de los datos exportados. Atributos clave: `fullName`,
  `documentId`, `nationality`, `type` (`NATIONAL` | `FOREIGN`), y, para huéspedes `FOREIGN`,
  `visaType` y `stayDates`. Esta funcionalidad solo exporta huéspedes cuyo `type` sea `FOREIGN`.
- **CheckIn**: Representa el evento de admisión que valida la fecha física de ingreso del huésped
  al hotel. Atributos clave: `reservationRef`, `guests`, `assignedRoom`, `arrivalTime`,
  `receptionist`, y `status` (`IN_HOUSE`). El `arrivalTime` de un `CheckIn` es la referencia usada
  para ubicar al huésped dentro del rango de fechas seleccionado.
- **MigratoryValidation**: Representa el procesamiento local de datos migratorios de un `Guest`
  `FOREIGN`, generado durante el check-in mediante "Process Foreign Guest Data". Atributos clave:
  `guestRef`, `submittedData`, `result` (`PASSED` | `FAILED`), `missingFields`, y el nuevo
  atributo `sireExportStatus` (`PENDING` | `EXPORTED`) que esta funcionalidad introduce y
  actualiza. Solo los registros con `result` en `PASSED` son candidatos a exportación, y solo se
  incluyen en un nuevo archivo `.TXT` aquellos con `sireExportStatus` en `PENDING`, salvo que se
  solicite explícitamente una re-exportación.

## Criterios de Éxito *(obligatorio)*

### Resultados Medibles

- **SC-001**: El 100% de los registros exportados en el archivo `.TXT` corresponden exactamente a
  huéspedes extranjeros con ingreso físico (`CheckIn`) dentro del rango de fechas seleccionado.
- **SC-002**: El formato final del archivo `.TXT` pasa de manera exitosa el validador oficial del
  sistema SIRE de Migración Colombia.
- **SC-003**: Cero errores **HTTP 500** se generan al realizar búsquedas o descargas inválidas de
  la exportación; todas las fallas se resuelven con respuestas controladas **HTTP 400**.
- **SC-004**: El 100% de las exportaciones generadas producen un registro `SireExport` auditable
  con la cantidad de huéspedes incluidos y la Recepcionista responsable.
- **SC-005**: Cero huéspedes se reportan por duplicado a Migración a través de dos archivos `.TXT`
  distintos, salvo que se haya solicitado explícitamente una re-exportación histórica.
- **SC-006**: Una Recepcionista puede completar una exportación estándar, desde la selección del
  rango de fechas hasta la descarga del archivo, en menos de 1 minuto.
