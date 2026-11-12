import { apiFile, apiRequest } from './api-client.ts';

/** Un movimiento del listado (plan de `export-sire-file`, B): un huésped extranjero y un tipo de movimiento. */
export type SireMovementItem = {
  movementId: string;
  reservationRef: string;
  guest: {
    fullName: string;
    documentType: string;
    documentNumber: string;
    nationality: string;
  };
  movementType: 'ENTRY' | 'DEPARTURE';
  /** `AAAA-MM-DD`. */
  movementDate: string;
};

/** La respuesta de `GET /api/sire/movements` (B). */
export type SireMovementPage = {
  items: SireMovementItem[];
  /** La página que se devolvió: si se pidió una que no existe, es la última válida. */
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  /** Sin extranjeros: "No hay movimientos migratorios que reportar en ese periodo." */
  message: string | null;
};

/** Un campo de la línea, en el orden del archivo (C). */
export type SireField = { position: number; name: string; value: string };

/** La respuesta de `GET /api/sire/movements/{movementId}/preview` (C). */
export type SireMovementPreview = {
  movementId: string;
  reservationRef: string;
  fields: SireField[];
  /** La línea tal como saldría en el archivo, sin el fin de línea. */
  line: string;
};

/** Lo que se pide exportar (A): el periodo completo o un solo movimiento. */
export type SireExportRequest =
  | { exportKind: 'PERIOD'; startDate: string; endDate: string }
  | { exportKind: 'SINGLE_MOVEMENT'; movementId: string };

/** El archivo que respondió A, listo para guardarlo. */
export type SireDownload = {
  /** El `id` de la `SireExport` registrada (`Export-Id`). */
  exportId: string;
  /** El de `Content-Disposition`: `SIRE_<exportId>.txt`. */
  fileName: string;
  /** El archivo tal cual, con su codificación: no se convierte a texto. */
  file: Blob;
  /** Las líneas del archivo: una por movimiento. */
  lines: number;
};

/**
 * `GET /api/sire/movements` (B): los movimientos de extranjeros del periodo, de 50 en 50.
 * @throws ApiError con el error que respondió el backend (los de la tabla D para B).
 */
export function listSireMovements(
  query: { startDate: string; endDate: string; page: number },
  signal?: AbortSignal,
): Promise<SireMovementPage> {
  const params = new URLSearchParams({
    startDate: query.startDate,
    endDate: query.endDate,
    page: String(query.page),
  });
  return apiRequest<SireMovementPage>(`/sire/movements?${params.toString()}`, {
    signal,
  });
}

/**
 * `GET /api/sire/movements/{movementId}/preview` (C): la línea de un movimiento, sin registrar nada.
 * @throws ApiError `MOVEMENT_NOT_FOUND` o `INVALID_GUEST_CHARACTERS`.
 */
export function previewSireMovement(
  movementId: string,
  signal?: AbortSignal,
): Promise<SireMovementPreview> {
  return apiRequest<SireMovementPreview>(
    `/sire/movements/${encodeURIComponent(movementId)}/preview`,
    { signal },
  );
}

/**
 * `POST /api/sire/exports` (A): genera el archivo y registra la descarga a nombre de la Recepcionista
 * (`X-User`).
 * @throws ApiError con el error de la tabla D, también `TOO_MANY_REQUESTS` (429).
 */
export async function exportSireFile(
  request: SireExportRequest,
): Promise<SireDownload> {
  const response = await apiFile('/sire/exports', {
    method: 'POST',
    body: request,
  });
  const exportId = response.headers.get('Export-Id') ?? '';
  const file = await response.blob();
  return {
    exportId,
    fileName:
      fileNameOf(response.headers.get('Content-Disposition')) ??
      `SIRE_${exportId}.txt`,
    file,
    lines: await linesOf(file),
  };
}

/** El nombre de `attachment; filename="SIRE_….txt"`, o `null` si no viene. */
function fileNameOf(disposition: string | null): string | null {
  const match = disposition?.match(/filename="([^"]+)"/);
  return match?.[1] ?? null;
}

/** Cuántas líneas tiene el archivo: cada una termina en un salto de línea, con CRLF o LF. */
async function linesOf(file: Blob): Promise<number> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return bytes.reduce((count, byte) => (byte === 0x0a ? count + 1 : count), 0);
}
