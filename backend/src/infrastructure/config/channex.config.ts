import type { ChannexSettings } from '../../application/ports/out/channex-setup-state.js';
import { isPercentage } from '../../domain/ota/ota.js';

/** Valores que se usan si la variable no está definida (`configure-ota`, B0). */
export const CHANNEX_DEFAULTS = {
  CHANNEX_BASE_URL: 'https://staging.channex.io',
  CHANNEX_SYNC_INTERVAL_SECONDS: '30',
  CHANNEX_ARI_DAYS: '90',
} as const;

/** Channex recomienda agrupar los envíos cada 30 a 60 s. */
const MIN_SYNC_INTERVAL_SECONDS = 30;

const UUID_FORMAT =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ChannexConfigResult =
  | { valid: true; settings: ChannexSettings }
  /** Los nombres de las variables que fallaron; nunca sus valores. */
  | { valid: false; invalid: string[] };

/**
 * Lee y valida las variables de Channex (`configure-ota`, B0). No están en `EnvironmentVariables` a
 * propósito: si fallan, solo se apagan las tareas de Channex y el resto del Módulo 2 arranca igual.
 */
export function readChannexConfig(
  read: (name: string) => string | undefined,
): ChannexConfigResult {
  const value = (name: string): string | null => {
    const raw = read(name)?.trim();
    if (raw) {
      return raw;
    }
    return CHANNEX_DEFAULTS[name as keyof typeof CHANNEX_DEFAULTS] ?? null;
  };
  const invalid: string[] = [];
  const check = (name: string, isValid: (raw: string) => boolean) => {
    const raw = value(name);
    if (raw === null || !isValid(raw)) {
      invalid.push(name);
    }
    return raw ?? '';
  };

  const baseUrl = check('CHANNEX_BASE_URL', isHttpUrl);
  check('CHANNEX_API_KEY', () => true);
  const propertyId = check('CHANNEX_PROPERTY_ID', (raw) =>
    UUID_FORMAT.test(raw),
  );
  const bookingHotelId = check('BOOKING_HOTEL_ID', (raw) => /^\d+$/.test(raw));
  const commissionPercentage = check(
    'BOOKING_COMMISSION_PERCENTAGE',
    isPercentage,
  );
  const syncIntervalSeconds = check('CHANNEX_SYNC_INTERVAL_SECONDS', (raw) =>
    isIntegerFrom(raw, MIN_SYNC_INTERVAL_SECONDS),
  );
  const ariDays = check('CHANNEX_ARI_DAYS', (raw) => isIntegerFrom(raw, 1));

  if (invalid.length > 0) {
    return { valid: false, invalid };
  }
  return {
    valid: true,
    settings: {
      baseUrl: baseUrl.replace(/\/+$/, ''),
      propertyId: propertyId.toLowerCase(),
      bookingHotelId,
      commissionPercentage,
      syncIntervalSeconds: Number(syncIntervalSeconds),
      ariDays: Number(ariDays),
    },
  };
}

function isHttpUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isIntegerFrom(raw: string, min: number): boolean {
  return /^\d+$/.test(raw) && Number(raw) >= min;
}
