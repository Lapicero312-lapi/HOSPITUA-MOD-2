import type { Conflict } from '../types';
import { MIGRATION, STATUS_CLASS, STATUS_LABEL } from '../utils/format';

export const StatusBadge = ({ status }: { status: string }) => <span className={`badge ${STATUS_CLASS[status] ?? 'neutral'}`}>{STATUS_LABEL[status] ?? status}</span>;
export const ChannelBadge = ({ source, otaName }: { source: string; otaName: string | null }) =>
  source === 'DIRECT' ? <span className="badge neutral">Directo</span> : <span className="badge ota">OTA · {otaName}</span>;
export const MigrationBadge = ({ value }: { value: string }) => {
  const m = MIGRATION[value];
  return <span className={`badge ${m?.cls ?? 'neutral'}`} title={m?.tip}>{m?.txt ?? value}</span>;
};
export const ConflictBadge = ({ conflict }: { conflict: Conflict | null }) =>
  conflict ? <span className="badge warn" title={conflict.reason}>En conflicto</span> : null;
export const ErrorBox = ({ error }: { error: Error }) => <div role="alert" className="alert-box">{error.message}</div>;
