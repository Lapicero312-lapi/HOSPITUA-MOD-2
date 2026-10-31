const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;
const RESERVATION_REF_FORMAT = /^RSV-[0-9A-F]{8}$/;

export function isValidStayDates(startDate: string, endDate: string): boolean {
  return isRealDate(startDate) && isRealDate(endDate) && endDate > startDate;
}

export function hasExactlyCategoryOrRoomId(
  categoryRoom: string | undefined,
  roomId: string | undefined,
): boolean {
  return (categoryRoom !== undefined) !== (roomId !== undefined);
}

export function isValidExcludeReservationRef(
  excludeReservationRef: string | undefined,
): boolean {
  return (
    excludeReservationRef === undefined ||
    RESERVATION_REF_FORMAT.test(excludeReservationRef)
  );
}

function isRealDate(value: string): boolean {
  if (!DATE_FORMAT.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}
