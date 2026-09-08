# Especificación de Funcionalidad: Procesar Datos de Huéspedes Extranjeros

**Creado**: 2026-09-08

## Escenarios de Usuario y Pruebas *(obligatorio)*

### Historia de Usuario 1 - Capturar información migratoria en el Check-In (Prioridad: P1)

Como Recepcionista, necesito ingresar y validar los datos migratorios de un Huésped extranjero (como pasaporte y fecha de ingreso al país) en la pantalla de registro de Check-In, para cumplir con los requisitos legales y permitir que la Reserva cambie su estado correctamente al ingresar a la habitación.

**Por qué esta prioridad**: Es el Happy Path crítico y fundamental para asegurar que los registros cumplan con las normativas antes de alojar al Huésped.

**Prueba Independiente**: Puede ser probado de forma independiente mediante la creación de un perfil de Huésped extranjero e ingresando los datos migratorios esperados en el formulario de la interfaz de Check-In.

**Escenarios de Aceptación**:

1. **Escenario**: Registro exitoso de datos para huésped extranjero
   - **Dado** una Reserva en estado "Activa" asignada a una Habitación
   - **Cuando** el Recepcionista ingresa los datos migratorios completos y válidos del Huésped extranjero
   - **Entonces** el sistema guarda la información y permite continuar con el flujo, cambiando la Reserva a estado "En Estancia (Check-In)".

2. **Escenario**: Intento de registro con datos obligatorios faltantes
   - **Dado** una Reserva en estado "Activa"
   - **Cuando** el Recepcionista intenta procesar el registro dejando el número de pasaporte vacío
   - **Entonces** el sistema muestra un mensaje de error y no permite completar el proceso de Check-In, manteniendo la Reserva en estado "Activa".

---

### Historia de Usuario 2 - Actualizar o corregir información de huésped extranjero (Prioridad: P2)

Como Recepcionista, necesito actualizar o corregir la información migratoria de un Huésped extranjero que ya tiene una estancia en curso, desde la vista de resumen de reserva, por si hubo algún error tipográfico durante su ingreso.

**Por qué esta prioridad**: Es un flujo alternativo importante que permite solucionar errores humanos de captura de datos durante la operación diaria.

**Prueba Independiente**: Se puede probar editando un registro migratorio existente de un Huésped y comprobando que los cambios se guarden correctamente en la base de datos.

**Escenarios de Aceptación**:

1. **Escenario**: Modificación exitosa de datos
   - **Dado** una Reserva en estado "En Estancia (Check-In)"
   - **Cuando** el Recepcionista actualiza la fecha de ingreso al país del Huésped
   - **Entonces** el sistema guarda la modificación exitosamente y refleja el nuevo dato en la interfaz.

2. **Escenario**: Modificación con formato de fecha inválido
   - **Dado** una Reserva en estado "En Estancia (Check-In)"
   - **Cuando** el Recepcionista intenta actualizar la fecha de ingreso colocando una fecha en un formato no reconocido
   - **Entonces** el sistema rechaza la actualización y notifica al usuario que el formato de fecha no es válido.

---

### Casos Borde

- ¿Qué sucede si el número de pasaporte o el país de origen se envía vacío por la red de forma maliciosa? 
  El sistema debe interceptar la falla, no permitir que alcance la capa de base de datos y retornar un código HTTP 400 (Bad Request) controlado con el mensaje "El pasaporte y país de origen son obligatorios".
- ¿Qué sucede si la fecha de entrada al país proporcionada es en el futuro?
  El sistema validará que es lógicamente imposible, rechazando la petición con un HTTP 400 y el mensaje "La fecha de ingreso al país no puede ser futura", evitando un HTTP 500.
- ¿Qué sucede si los datos migratorios contienen caracteres no soportados o maliciosos?
  La validación de entrada interceptará la anomalía y retornará un HTTP 400 indicando "Caracteres no válidos en el formulario migratorio".

## Requisitos *(obligatorio)*

### Requisitos Funcionales

- **FR-001**: El sistema DEBE exigir la información migratoria (pasaporte, país, fecha de entrada) si se detecta que el Huésped es de origen extranjero durante el Check-In.
- **FR-002**: El sistema DEBE validar temporalmente que la fecha de ingreso al país sea anterior o igual a la fecha actual del sistema.
- **FR-003**: El sistema DEBE permitir corregir los datos migratorios desde el resumen de la Reserva.
- **FR-004**: El sistema DEBE retornar errores 400 controlados ante fallos de formato, previniendo comportamientos inesperados (HTTP 500).

### Entidades Clave *(incluir si la funcionalidad involucra datos)*

- **Huésped**: Representa al cliente físico. Contiene atributos que determinan su país de origen y los datos migratorios requeridos.
- **Reserva**: Representa la estancia del huésped. Sus estados son: Pendiente, Activa, En Estancia (Check-In), Finalizada (Check-Out), Cancelada.
- **Habitación**: Entidad que representa la unidad física asignada a la reserva.

## Criterios de Éxito *(obligatorio)*

### Resultados Medibles

- **SC-001**: El 100% de los Check-In de huéspedes extranjeros cuentan con su documento de pasaporte válidamente guardado.
- **SC-002**: Se registran 0 caídas del servidor (HTTP 500) causadas por ingresos de fechas ilógicas o campos vacíos en el proceso migratorio.
- **SC-003**: El proceso de validación migratoria añade como máximo 1 minuto adicional al tiempo total de Check-In del huésped en recepción.
