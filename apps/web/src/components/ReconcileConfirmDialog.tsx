import type { ReconcilePlan } from '@twinpix/shared';
import { useEffect, useRef, useState } from 'react';
import type { ApiError } from '../lib/api';
import { formatBytes } from '../lib/format';
import { plural } from '../lib/plural';

interface Props {
  plan: ReconcilePlan;
  /** Envia o lote; se rejeitar, o erro aparece no modal e dá para tentar de novo. */
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}

const fileName = (f: { folderPath: string; name: string }) => `${f.folderPath === '/' ? '' : f.folderPath}/${f.name}`;

export function ReconcileConfirmDialog({ plan, onConfirm, onCancel }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false);

  useEffect(() => { dialogRef.current?.focus(); }, []);
  useEffect(() => {
    if (busy) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  async function confirm() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (e) {
      setError((e as ApiError).message);
      busyRef.current = false;
      setBusy(false);
    }
  }

  const n = plan.deleteFiles.length;
  return (
    <div className="modal-overlay" onClick={(e) => { if (!busy && e.target === e.currentTarget) onCancel(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="reconcile-confirm-title" tabIndex={-1} ref={dialogRef}>
        <h1 id="reconcile-confirm-title">Confirmar pastas repetidas</h1>
        <p>
          <strong>{plural(n, 'arquivo vai', 'arquivos vão')} para a lixeira do OneDrive</strong>, liberando {formatBytes(plan.bytes)}.
          As cópias ficam em <strong>{plan.keepFolder}</strong>. Os arquivos que só existem em uma pasta não são tocados. Nada é apagado de vez.
        </p>
        <h2>Saem ({n})</h2>
        <ul className="reconcile-list" aria-label="Arquivos que saem">
          {plan.deleteFiles.map((f) => <li key={f.id}>{fileName(f)}</li>)}
        </ul>
        <h2>Ficam</h2>
        <ul aria-label="Arquivos que ficam">
          {plan.remaining.map((r) => (
            <li key={r.path}>{r.path}: {r.fileCount === 0 ? 'fica vazia' : plural(r.fileCount, 'arquivo', 'arquivos')}</li>
          ))}
        </ul>
        {error && <p className="alert" role="alert">{error}</p>}
        <div className="row">
          <button type="button" className="button" onClick={onCancel} disabled={busy}>Voltar</button>
          <button type="button" className="button danger" disabled={busy} onClick={() => void confirm()}>
            {error ? 'Tentar de novo' : 'Mover para a lixeira'}
          </button>
        </div>
      </div>
    </div>
  );
}
