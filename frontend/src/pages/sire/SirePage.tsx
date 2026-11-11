import {
  type UseQueryResult,
  useMutation,
  useQuery,
} from '@tanstack/react-query';
import { useEffect, useId, useState } from 'react';
import { useSearchParams } from 'react-router';
import { ErrorMessage } from '../../components/ErrorMessage.tsx';
import { saveFile } from '../../services/save-file.ts';
import {
  exportSireFile,
  listSireMovements,
  previewSireMovement,
  type SireDownload,
  type SireExportRequest,
  type SireMovementItem,
  type SireMovementPage,
} from '../../services/sire.ts';
import './SirePage.css';

const MOVEMENT_LABELS: Record<SireMovementItem['movementType'], string> = {
  ENTRY: 'Entrada',
  DEPARTURE: 'Salida',
};

/** Una descarga: lo que se pide y, si es de un solo movimiento, cuál (para el aviso). */
type DownloadRequest = {
  request: SireExportRequest;
  movement: SireMovementItem | null;
};

/** El periodo y la página viven en la dirección (`?startDate=…&endDate=…&page=2`): se conservan al recargar. */
type ScreenPeriod = { startDate: string; endDate: string; page: number };

function readPeriod(params: URLSearchParams): ScreenPeriod {
  const page = Number(params.get('page') ?? '1');
  return {
    startDate: params.get('startDate') ?? '',
    endDate: params.get('endDate') ?? '',
    page: Number.isInteger(page) && page >= 1 ? page : 1,
  };
}

function toParams(period: ScreenPeriod): URLSearchParams {
  const params = new URLSearchParams();
  if (period.startDate !== '') params.set('startDate', period.startDate);
  if (period.endDate !== '') params.set('endDate', period.endDate);
  if (period.page > 1) params.set('page', String(period.page));
  return params;
}

/**
 * Pantalla "Exportar SIRE" (spec de `export-sire-file`, historia 1 y FR-010; plan, A, B y C): el periodo con
 * sus atajos, los movimientos de los huéspedes extranjeros, la vista previa de cada uno y las descargas del
 * periodo y de un solo movimiento. Las validaciones las hace el backend: su mensaje se muestra tal cual.
 */
export function SirePage() {
  const [params, setParams] = useSearchParams();
  const period = readPeriod(params);
  const complete = period.startDate !== '' && period.endDate !== '';
  const [notice, setNotice] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState<SireMovementItem | null>(null);

  /** Cambia el periodo y vuelve a la página 1; solo la paginación conserva la página. */
  const change = (changes: Partial<ScreenPeriod>) => {
    setNotice(null);
    setParams(toParams({ ...period, page: 1, ...changes }));
  };

  const movements = useQuery({
    queryKey: ['sire', 'movements', period],
    queryFn: ({ signal }) => listSireMovements(period, signal),
    enabled: complete,
  });

  const download = useMutation({
    mutationFn: ({ request }: DownloadRequest) => exportSireFile(request),
    onMutate: () => setNotice(null),
    onSuccess: (result, { movement }) => {
      saveFile(result.file, result.fileName);
      setNotice(noticeOf(result, movement));
      setPreviewing(null);
    },
  });

  const downloadMovement = (movement: SireMovementItem) =>
    download.mutate({
      request: {
        exportKind: 'SINGLE_MOVEMENT',
        movementId: movement.movementId,
      },
      movement,
    });

  const hasMovements =
    movements.isSuccess && movements.data.totalItems > 0 && complete;

  return (
    <section className="sire">
      <h1 className="sire-title">Exportar archivo SIRE</h1>
      <div className="sire-panel sire-period">
        <div className="sire-fields">
          <div className="sire-field">
            <label htmlFor="sire-start">Fecha inicial</label>
            <input
              id="sire-start"
              type="date"
              value={period.startDate}
              onChange={(event) => change({ startDate: event.target.value })}
            />
          </div>
          <div className="sire-field">
            <label htmlFor="sire-end">Fecha final</label>
            <input
              id="sire-end"
              type="date"
              value={period.endDate}
              onChange={(event) => change({ endDate: event.target.value })}
            />
          </div>
          <button type="button" onClick={() => change(lastDays(7))}>
            Últimos 7 días
          </button>
          <button type="button" onClick={() => change(lastDays(30))}>
            Últimos 30 días
          </button>
          <button
            type="button"
            className="sire-primary sire-download-all"
            disabled={!hasMovements || download.isPending}
            onClick={() =>
              download.mutate({
                request: {
                  exportKind: 'PERIOD',
                  startDate: period.startDate,
                  endDate: period.endDate,
                },
                movement: null,
              })
            }
          >
            Descargar todo el periodo (.TXT)
          </button>
        </div>
        {download.isError && previewing === null && (
          <ErrorMessage error={download.error} />
        )}
        {notice !== null && (
          <p role="status" className="sire-notice">
            {notice}
          </p>
        )}
      </div>
      <div className="sire-panel">
        <h2 className="sire-subtitle">Movimientos del periodo</h2>
        <Movements
          complete={complete}
          query={movements}
          downloading={download.isPending}
          onPreview={setPreviewing}
          onDownload={downloadMovement}
          onPage={(page) => change({ page })}
        />
      </div>
      {previewing !== null && (
        <PreviewDialog
          movement={previewing}
          downloading={download.isPending}
          error={download.isError ? download.error : null}
          onDownload={() => downloadMovement(previewing)}
          onClose={() => {
            download.reset();
            setPreviewing(null);
          }}
        />
      )}
    </section>
  );
}

function Movements({
  complete,
  query,
  downloading,
  onPreview,
  onDownload,
  onPage,
}: {
  complete: boolean;
  query: UseQueryResult<SireMovementPage>;
  downloading: boolean;
  onPreview: (movement: SireMovementItem) => void;
  onDownload: (movement: SireMovementItem) => void;
  onPage: (page: number) => void;
}) {
  if (!complete) {
    return (
      <p className="sire-state">
        Elija la fecha inicial y la final para ver los movimientos del periodo.
      </p>
    );
  }
  if (query.isPending) {
    return (
      <p className="sire-state sire-state--loading">Cargando movimientos…</p>
    );
  }
  if (query.isError) {
    return <ErrorMessage error={query.error} />;
  }
  const list = query.data;
  if (list.items.length === 0) {
    return (
      <p className="sire-state">
        {list.message ??
          'No hay movimientos migratorios que reportar en ese periodo.'}
      </p>
    );
  }
  return (
    <>
      <table className="sire-table">
        <thead>
          <tr>
            <th scope="col">Reserva</th>
            <th scope="col">Huésped</th>
            <th scope="col">Nacionalidad</th>
            <th scope="col">Movimiento</th>
            <th scope="col">Acciones</th>
          </tr>
        </thead>
        <tbody>
          {list.items.map((movement) => (
            <tr key={movement.movementId}>
              <td className="sire-ref">{movement.reservationRef}</td>
              <td>
                <span className="sire-guest">{movement.guest.fullName}</span>
                <span className="sire-secondary">
                  {movement.guest.documentType} {movement.guest.documentNumber}
                </span>
              </td>
              <td>{movement.guest.nationality}</td>
              <td>
                <span className="sire-movement">
                  {MOVEMENT_LABELS[movement.movementType]}
                </span>
                <span className="sire-secondary">
                  {formatDate(movement.movementDate)}
                </span>
              </td>
              <td>
                <span className="sire-actions">
                  <button
                    type="button"
                    aria-label={`Previsualizar ${movementName(movement)}`}
                    onClick={() => onPreview(movement)}
                  >
                    Previsualizar
                  </button>
                  <button
                    type="button"
                    className="sire-primary"
                    aria-label={`Descargar ${movementName(movement)}`}
                    disabled={downloading}
                    onClick={() => onDownload(movement)}
                  >
                    Descargar
                  </button>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <nav className="sire-pagination" aria-label="Paginación">
        <span>
          {list.totalItems === 1
            ? '1 movimiento'
            : `${list.totalItems} movimientos`}
        </span>
        <button
          type="button"
          disabled={list.page <= 1}
          onClick={() => onPage(list.page - 1)}
        >
          Anterior
        </button>
        <span aria-current="page">
          Página {list.page} de {list.totalPages}
        </span>
        <button
          type="button"
          disabled={list.page >= list.totalPages}
          onClick={() => onPage(list.page + 1)}
        >
          Siguiente
        </button>
      </nav>
    </>
  );
}

/** La vista previa de un movimiento (C): sus 12 campos y la línea tal como saldría en el archivo. */
function PreviewDialog({
  movement,
  downloading,
  error,
  onDownload,
  onClose,
}: {
  movement: SireMovementItem;
  downloading: boolean;
  error: Error | null;
  onDownload: () => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const preview = useQuery({
    queryKey: ['sire', 'preview', movement.movementId],
    queryFn: ({ signal }) => previewSireMovement(movement.movementId, signal),
  });

  // Escape cierra la vista previa, como cualquier ventana.
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [onClose]);

  return (
    <div className="sire-backdrop">
      <div
        className="sire-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <h2 id={titleId} className="sire-subtitle">
          Previsualizar movimiento
        </h2>
        <p className="sire-secondary">
          Así saldría la línea en el archivo .TXT.
        </p>
        <dl className="sire-meta">
          <div>
            <dt>Reserva</dt>
            <dd>{movement.reservationRef}</dd>
          </div>
          <div>
            <dt>Huésped</dt>
            <dd>{movement.guest.fullName}</dd>
          </div>
          <div>
            <dt>Movimiento</dt>
            <dd>
              {MOVEMENT_LABELS[movement.movementType]} ·{' '}
              {formatDate(movement.movementDate)}
            </dd>
          </div>
        </dl>
        {preview.isPending && (
          <p className="sire-state sire-state--loading">Cargando la línea…</p>
        )}
        {preview.isError && <ErrorMessage error={preview.error} />}
        {preview.isSuccess && (
          <>
            <table className="sire-table" aria-label="Campos SIRE">
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Campo SIRE</th>
                  <th scope="col">Valor</th>
                </tr>
              </thead>
              <tbody>
                {preview.data.fields.map((field) => (
                  <tr key={field.position}>
                    <td className="sire-secondary">{field.position}</td>
                    <td>{field.name}</td>
                    <td className="sire-value">{field.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="sire-secondary">
              Línea del archivo (el separador se muestra como →):
            </p>
            <pre className="sire-line">{showSeparator(preview.data.line)}</pre>
          </>
        )}
        {error !== null && <ErrorMessage error={error} />}
        <div className="sire-dialog-actions">
          <button type="button" onClick={onClose}>
            Cerrar
          </button>
          <button
            type="button"
            className="sire-primary"
            disabled={!preview.isSuccess || downloading}
            onClick={onDownload}
          >
            Descargar este movimiento (.TXT)
          </button>
        </div>
      </div>
    </div>
  );
}

/** Lo que se le dice a la Recepcionista después de descargar. */
function noticeOf(
  result: SireDownload,
  movement: SireMovementItem | null,
): string {
  if (movement !== null) {
    return `Movimiento de ${movement.guest.fullName} descargado (${result.fileName}).`;
  }
  return `Archivo ${result.fileName} descargado: ${result.lines} ${
    result.lines === 1 ? 'movimiento' : 'movimientos'
  }.`;
}

/** Para leer la línea: el tabulador se muestra como →. */
function showSeparator(line: string): string {
  return line.split('\t').join(' → ');
}

function movementName(movement: SireMovementItem): string {
  return `${MOVEMENT_LABELS[movement.movementType].toLowerCase()} de ${movement.guest.fullName}`;
}

/** Los atajos del wireframe: de hoy menos `days` días a hoy, en hora de Colombia. */
function lastDays(days: number): Pick<ScreenPeriod, 'startDate' | 'endDate'> {
  const today = todayInColombia();
  const start = new Date(`${today}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - days);
  return { startDate: start.toISOString().slice(0, 10), endDate: today };
}

/** El día de hoy en Colombia (`AAAA-MM-DD`), sin depender de la zona horaria del computador. */
function todayInColombia(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** `2026-10-09` como `09/10/2026` (plan base, "Fechas"). */
function formatDate(date: string): string {
  const [year, month, day] = date.split('-');
  return `${day}/${month}/${year}`;
}
