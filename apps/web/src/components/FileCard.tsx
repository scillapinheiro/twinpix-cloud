import type { CloudItem } from '@twinpix/shared';
import { FIELD_LABELS, fieldValue, type FieldKey } from '../lib/differing-fields';
import { Thumbnail } from './Thumbnail';

interface Props {
  file: CloudItem;
  isSuggested: boolean;
  marked: boolean;
  /** true quando marcar esta cópia deixaria o grupo sem nenhuma. */
  lockDelete: boolean;
  onToggle: () => void;
  diffs: Set<FieldKey>;
  fields: FieldKey[];
}

export function FileCard({ file, isSuggested, marked, lockDelete, onToggle, diffs, fields }: Props) {
  const disabled = lockDelete && !marked;
  return (
    <article className={`file-card${marked ? ' marked' : ''}`}>
      <Thumbnail fileId={file.id} alt={file.name} />
      {isSuggested && <p className="badge-keep">★ Sugerida para manter</p>}
      <dl>
        {fields.map((key) => (
          <div key={key} style={{ display: 'contents' }}>
            <dt>{FIELD_LABELS[key]}</dt>
            <dd><span className={diffs.has(key) ? 'diff' : undefined}>{fieldValue(file, key)}</span></dd>
          </div>
        ))}
      </dl>
      <label className="row">
        <input type="checkbox" checked={marked} disabled={disabled} onChange={onToggle} aria-label="Excluir esta cópia" />
        Excluir esta cópia
      </label>
      {disabled && <p className="muted">É a única cópia que sobraria.</p>}
      <a href={file.webUrl} target="_blank" rel="noreferrer">Abrir no OneDrive ↗</a>
    </article>
  );
}
