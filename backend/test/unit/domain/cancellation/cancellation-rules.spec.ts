import { describe, expect, it } from 'vitest';
import {
  canCancelThroughChannel,
  isCancellable,
} from '../../../../src/domain/cancellation/cancellation-rules.js';
import {
  CANCELLATION_CHANNELS,
  RESERVATION_SOURCES,
  RESERVATION_STATUSES,
  type CancellationChannel,
  type ReservationSource,
} from '../../../../src/domain/shared/enums.js';

/** Plan, regla 1, y spec, FR-002a: la Recepcionista cancela las `DIRECT`; Booking, las suyas. */
const PLAN_CHANNELS = ['DIRECT→RECEPTION', 'OTA→OTA_API'];

/** Plan, regla 2, y spec, FR-002: solo `ACTIVE` o `PENDING`. */
const PLAN_CANCELLABLE = ['ACTIVE', 'PENDING'];

describe('Canal de cancelación por source', () => {
  it.each(
    RESERVATION_SOURCES.flatMap((source) =>
      CANCELLATION_CHANNELS.map(
        (channel): [ReservationSource, CancellationChannel] => [
          source,
          channel,
        ],
      ),
    ),
  )('%s por %s', (source, channel) => {
    expect(canCancelThroughChannel(source, channel)).toBe(
      PLAN_CHANNELS.includes(`${source}→${channel}`),
    );
  });
});

describe('Estados que admiten cancelación', () => {
  it.each(RESERVATION_STATUSES)('%s', (status) => {
    expect(isCancellable(status)).toBe(PLAN_CANCELLABLE.includes(status));
  });
});
