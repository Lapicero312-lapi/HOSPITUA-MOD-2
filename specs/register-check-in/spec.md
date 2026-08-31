# Feature Specification: Register Check-In

**Created**: 2026-08-27  

## User Scenarios & Testing *(mandatory)*

<!--
  IMPORTANT: User stories should be PRIORITIZED as user journeys ordered by importance.
  Each user story/journey must be INDEPENDENTLY TESTABLE - meaning if you implement just ONE of them,
  you should still have a viable MVP (Minimum Viable Product) that delivers value.
  
  Assign priorities (P1, P2, P3, etc.) to each story, where P1 is the most critical.
  Think of each story as a standalone slice of functionality that can be:
  - Developed independently
  - Tested independently
  - Deployed independently
  - Demonstrated to users independently
-->

The Register Check-In feature lets front-desk staff formally admit a guest into the hotel on
their arrival day. Before any admission can happen, the system must locate and validate an
active reservation through the internal use case **"check / view reservation"**. When the
arriving guest is a foreign national, the system must additionally complete the migratory
control validation through the use case **"process & export foreign guest data"** before the
check-in can be confirmed. Once the check-in is successfully registered, the system asks
Module 1 to change the physical state of the assigned room to "occupied" through the use case
**"set room state"**.

### User Story 1 - Successful Check-In for National Guest (Priority: P1)

A front-desk agent receives a guest who is a national of the country where the hotel operates.
The agent looks up the guest's active reservation, confirms the guest's identity and the stay
details, assigns or confirms the room, and registers the check-in. The system records the
arrival, marks the reservation as "checked in", and requests the room to be set to "occupied".

**Why this priority**: This is the core, highest-frequency path of the feature. Without it there
is no way to admit guests, and every other scenario is a variation on top of it. It alone
delivers a usable MVP: a hotel can operate its arrivals desk end to end.

**Independent Test**: Can be fully tested by taking a reservation that is active for today,
running the check-in for a national guest with complete personal data, and confirming that the
reservation becomes "checked in", a check-in record is created with the real arrival moment, and
a request to occupy the room is issued. Delivers the value of a complete, auditable admission.

**Acceptance Scenarios**:

1. **Scenario**: National guest with a valid active reservation is admitted
   - **Given** an active reservation exists for a national guest whose stay includes today's date and a room is assigned
   - **When** the agent confirms the guest's identity and personal data and submits the check-in
   - **Then** the system registers the check-in, marks the reservation as "checked in", records the actual arrival moment and the responsible agent, and requests Module 1 to set the room state to "occupied"

2. **Scenario**: Reservation is located before admission
   - **Given** the agent only has the guest's name and reservation reference
   - **When** the agent searches for the reservation through "check / view reservation"
   - **Then** the system returns the matching active reservation with its stay dates, room, guest list and current status, so the agent can proceed with the check-in

3. **Scenario**: Confirmation summary is shown before finalizing
   - **Given** the agent has entered all required check-in information for a national guest
   - **When** the agent requests to finalize
   - **Then** the system presents a summary of guest, room, stay dates and reservation reference and only completes the check-in after explicit confirmation

---

### User Story 2 - Mandatory SIRE Validation for Foreign Guest Check-In (Priority: P1)

A front-desk agent checks in a guest who is a foreign national. Before the check-in can be
confirmed, the system requires the migratory control data to be validated and processed through
**"process & export foreign guest data"**. The mandatory fields are: identity document,
nationality, visa type, and stay dates. The check-in cannot be completed until this validation
succeeds.

**Why this priority**: Migratory reporting is a legal obligation for the hotel. A foreign guest
admitted without validated migratory data exposes the business to fines and sanctions, so this
control is as critical as the admission itself.

**Independent Test**: Can be fully tested by running a check-in for a foreign guest, verifying
that the system blocks completion until the four mandatory migratory fields are present and
validated, and that once validation succeeds the check-in completes and the migratory data is
handed off for processing and export. Delivers the value of guaranteed legal compliance on
arrivals.

**Acceptance Scenarios**:

1. **Scenario**: Foreign guest with complete migratory data is admitted
   - **Given** an active reservation for a foreign guest whose stay includes today and whose identity document, nationality, visa type and stay dates are all provided
   - **When** the agent submits the check-in
   - **Then** the system runs the migratory control validation, and on success completes the check-in and forwards the migratory data to "process & export foreign guest data"

2. **Scenario**: Missing mandatory migratory field blocks the check-in
   - **Given** a foreign guest whose visa type has not been captured
   - **When** the agent tries to finalize the check-in
   - **Then** the system refuses to complete the check-in, clearly indicates that visa type is required, and keeps the reservation in its pre-arrival status

3. **Scenario**: Migratory validation is skipped for a national guest
   - **Given** a guest whose nationality is that of the hotel's country
   - **When** the agent finalizes the check-in
   - **Then** the system completes the admission without invoking the migratory control validation

---

### User Story 3 - Room Is Marked Occupied After Check-In (Priority: P1)

When a check-in is successfully registered, the system must request Module 1 to update the
physical state of the assigned room to "occupied" through **"set room state"**, so housekeeping
and availability views reflect reality immediately.

**Why this priority**: An admitted guest whose room still shows as "available" or "free" can be
double-assigned to another arriving guest, causing a direct guest-facing conflict. Keeping the
physical room state synchronized with admissions is essential to safe hotel operation.

**Independent Test**: Can be fully tested by completing a check-in and confirming that a request
to set the assigned room to "occupied" is issued to Module 1, and that the check-in is still
recorded even if that request needs to be retried. Delivers the value of trustworthy room
availability.

**Acceptance Scenarios**:

1. **Scenario**: Room state change is requested on success
   - **Given** a check-in that has just been successfully registered with room 101 assigned
   - **When** the admission is finalized
   - **Then** the system sends a request to Module 1 to set room 101 to "occupied"

2. **Scenario**: Room state request fails temporarily
   - **Given** a successfully registered check-in whose room-state request to Module 1 did not go through
   - **When** the failure is detected
   - **Then** the system preserves the completed check-in, flags the room-state update as pending, and allows it to be retried without repeating the whole admission

---

### User Story 4 - Prevent Check-In Without a Valid Active Reservation (Priority: P1)

The system must not allow a check-in for a guest who does not have an active reservation that is
valid for the arrival date. The agent must first find and validate the reservation through
"check / view reservation"; if none applies, the admission is refused.

**Why this priority**: The check-in process is defined as an operation on an existing
reservation. Admitting a guest with no reservation, or against a cancelled or wrong-date
reservation, corrupts occupancy, billing and reporting data at the source.

**Independent Test**: Can be fully tested by attempting a check-in with no matching reservation,
with a cancelled reservation, and with a reservation whose dates do not cover today, and
confirming that each attempt is blocked with a clear reason and no check-in record is created.
Delivers the value of data integrity for all downstream processes.

**Acceptance Scenarios**:

1. **Scenario**: No reservation found for the guest
   - **Given** a guest arriving at the front desk with no reservation on file
   - **When** the agent searches for a reservation to start the check-in
   - **Then** the system reports that no active reservation was found and does not allow the check-in to start

2. **Scenario**: Reservation exists but was already cancelled
   - **Given** a reservation whose status is "cancelled"
   - **When** the agent selects it to check the guest in
   - **Then** the system blocks the admission, states that the reservation is cancelled, and does not change the reservation or room state

3. **Scenario**: Arrival date does not fall within the reservation stay
   - **Given** a reservation whose stay starts three days from today
   - **When** the agent attempts to check the guest in today
   - **Then** the system refuses the check-in and explains that today is outside the reserved stay window

---

### User Story 5 - Prevent Duplicate Check-In for the Same Reservation (Priority: P1)

Once a reservation has been checked in, the system must not allow it to be checked in again. The
agent should instead be shown that the guest is already in-house.

**Why this priority**: A second check-in on the same reservation would create duplicate arrival
records, could trigger a second room-occupancy request, and would distort occupancy counts and
migratory reporting. Guarding against it protects the accuracy of every arrival-based metric.

**Independent Test**: Can be fully tested by checking in a reservation successfully and then
attempting the same check-in again, confirming that the second attempt is rejected, no new
record is created, and no additional room-state request is sent. Delivers the value of accurate,
non-duplicated arrival data.

**Acceptance Scenarios**:

1. **Scenario**: Second check-in attempt on an already admitted reservation
   - **Given** a reservation already marked as "checked in" with the guest in-house
   - **When** the agent attempts to register the check-in again
   - **Then** the system rejects the attempt, shows the existing check-in details, and does not create a new record or send another room-state request

2. **Scenario**: Agent re-opens an in-house reservation to view it
   - **Given** a reservation that is already checked in
   - **When** the agent opens it through "check / view reservation"
   - **Then** the system shows it as "checked in" with the arrival moment and assigned room, and offers view-only actions rather than a new admission

---

### Edge Cases

<!--
  ACTION REQUIRED: The content in this section represents placeholders.
  Fill them out with the right edge cases.
-->

- **Check-in attempted on a date outside the reservation window**: The system compares today's
  date against the reserved stay dates. If today is before the stay starts or after it ends, the
  admission is refused with an explanation, and no check-in record, reservation change or
  room-state request is produced. Early arrivals require the reservation to be adjusted first
  through the reservation use cases, not forced through check-in.
- **Reservation was already cancelled**: When the agent selects a reservation whose status is
  "cancelled", the system treats it as not admissible, blocks the check-in, and leaves the
  reservation and room untouched. The agent is directed to create or reinstate a valid
  reservation.
- **Missing mandatory migratory field for a foreign guest**: If any of identity document,
  nationality, visa type or stay dates is missing or invalid for a foreign guest, the migratory
  control validation fails. The system keeps the reservation in its pre-arrival status, does not
  complete the check-in, and lists exactly which fields must be corrected.
- **Guest arrives before the assigned room is physically ready**: If the assigned room is not in
  a state that allows occupancy (for example still being cleaned), the system does not mark the
  check-in as complete against that room. It surfaces the blocking room condition so the agent
  can wait for the room or assign an equivalent available room before finalizing.
- **Duplicate / repeated check-in for the same reservation**: If the reservation is already
  "checked in", any further check-in attempt is rejected. The system shows the existing arrival
  record and does not create a second record or send a second occupancy request.
- **Room-occupancy request to Module 1 fails after a successful check-in**: The check-in remains
  valid and recorded. The room-state update is marked as pending and can be retried
  independently, so a transient integration failure never forces the agent to redo the
  admission.
- **Group reservation where only some guests arrive**: The system allows the arriving guests to
  be admitted while leaving the not-yet-arrived guests in a pending state on the same
  reservation, and only requests room occupancy for rooms that now hold an in-house guest.
- **Foreign guest whose visa or stay dates expire before the reservation check-out date**: The
  migratory control validation flags the inconsistency so the agent can confirm or correct the
  data with the guest before the check-in is completed.

## Requirements *(mandatory)*

<!--
  ACTION REQUIRED: The content in this section represents placeholders.
  Fill them out with the right functional requirements.
-->

### Functional Requirements

- **FR-001**: System MUST require the agent to locate and validate an active reservation through
  the internal use case "check / view reservation" before any check-in can begin.
- **FR-002**: System MUST only allow a check-in when the located reservation is active (not
  cancelled and not already checked in) and its stay dates include the current arrival date.
- **FR-003**: System MUST capture and confirm the arriving guest's identity and personal details
  and associate them with the reservation being admitted.
- **FR-004**: System MUST determine whether each arriving guest is a national or a foreign guest
  based on nationality.
- **FR-005**: System MUST, for every foreign guest, run the migratory control validation through
  the use case "process & export foreign guest data" before the check-in is completed.
- **FR-006**: System MUST treat identity document, nationality, visa type and stay dates as
  mandatory fields for foreign guests, and MUST block completion of the check-in until all four
  are present and valid.
- **FR-007**: System MUST NOT run the migratory control validation for national guests.
- **FR-008**: System MUST record a check-in only after the agent explicitly confirms a summary of
  guest, room, stay dates and reservation reference.
- **FR-009**: System MUST, upon a successful check-in, register the actual arrival moment, the
  responsible agent, and the assigned room, and mark the reservation as "checked in".
- **FR-010**: System MUST, upon a successful check-in, request Module 1 to update the physical
  state of the assigned room to "occupied" through the use case "set room state".
- **FR-011**: System MUST keep a completed check-in valid even if the room-state request to
  Module 1 fails, marking that update as pending and allowing it to be retried without repeating
  the admission.
- **FR-012**: System MUST reject any attempt to check in a reservation that is already checked
  in, and MUST show the existing arrival record instead of creating a new one.
- **FR-013**: System MUST refuse a check-in when no active reservation applies to the guest and
  arrival date, and MUST state the reason without creating any record or side effect.
- **FR-014**: System MUST not finalize a check-in against a room that is not in a state allowing
  occupancy, and MUST let the agent assign an equivalent available room before finalizing.
- **FR-015**: System MUST keep a full, auditable trail of each check-in attempt, including
  failed and blocked attempts and the reason they were blocked.
- **FR-016**: System MUST clearly communicate, in each failure case, exactly what is missing or
  invalid so the agent can correct it.

### Key Entities *(include if feature involves data)*

- **CheckIn**: Represents the formal admission of a guest into the hotel for a specific
  reservation. Key attributes: reference to the reservation, reference to the admitted guest(s),
  assigned room, actual arrival moment, responsible front-desk agent, admission status
  (completed / blocked), room-state update status (done / pending), and, for foreign guests, the
  outcome of the migratory control validation. A CheckIn belongs to exactly one Reservation and
  covers one or more Guests of that reservation.
- **Reservation**: Represents a booked stay that the check-in operates on. Key attributes:
  reservation reference, guest list, assigned room or room type, stay start date, stay end date,
  origin (direct or OTA), and lifecycle status (active, cancelled, checked in, checked out). A
  Reservation is validated through "check / view reservation" and can have at most one completed
  CheckIn.
- **Guest**: Represents a person arriving at the hotel. Key attributes: full name, identity
  document, nationality, and guest classification (national or foreign). For foreign guests the
  additional mandatory attributes are visa type and stay dates, which feed the migratory control
  validation. A Guest is linked to one or more Reservations and, through them, to a CheckIn.
- **Room**: Represents the physical unit assigned to the guest. Key attributes: room identifier,
  room type, and physical state (for example available, occupied, being cleaned). The Room's
  physical state is owned by Module 1 and is requested to become "occupied" as a result of a
  successful CheckIn.
- **MigratoryValidation**: Represents the migratory control check performed for a foreign guest.
  Key attributes: reference to the guest, the mandatory data submitted (identity document,
  nationality, visa type, stay dates), validation result (passed / failed), list of missing or
  invalid fields, and the moment the data was processed and exported. A MigratoryValidation is
  required for each foreign Guest before their CheckIn can complete.

## Success Criteria *(mandatory)*

<!--
  ACTION REQUIRED: Define measurable success criteria.
  These must be technology-agnostic and measurable.
-->

### Measurable Outcomes

- **SC-001**: 100% of completed check-ins are linked to an active reservation whose stay dates
  include the arrival date; no check-in is ever recorded without a validated reservation.
- **SC-002**: 100% of check-ins for foreign guests have a passed migratory control validation,
  with all four mandatory fields (identity document, nationality, visa type, stay dates) present
  before completion.
- **SC-003**: 100% of successful check-ins produce a room-occupancy request to Module 1, and at
  least 99% of assigned rooms show "occupied" within 1 minute of the check-in being finalized.
- **SC-004**: 0 duplicate check-in records exist for any single reservation over any reporting
  period.
- **SC-005**: A front-desk agent can complete a standard national-guest check-in, from locating
  the reservation to room-occupancy request, in under 2 minutes.
- **SC-006**: 95% of blocked or failed check-in attempts are resolved by the agent on the first
  correction, because the system stated exactly which data was missing or invalid.
- **SC-007**: Support tickets and manual corrections related to rooms shown as available while
  occupied are reduced by at least 80% after this feature is in use.
