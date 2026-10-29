import { useEffect, useRef, useState } from 'react';
import type { ApiError } from '../lib/api';
import { formatBytes } from '../lib/format';

interface Props {
  files: number;
  groups: number;
  bytes: number;
  /** Envia o lote; se rejeitar, o erro aparece no modal e dá para tentar de novo. */
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}

export function BatchConfirmDialog({ files, groups, bytes, onConfirm, onCancel }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

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

  return (
    <div className="modal-overlay" onClick={(e) => { if (!busy && e.target === e.currentTarget) onCancel(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="batch-confirm-title" tabIndex={-1} ref={dialogRef}>
        <h1 id="batch-confirm-title">Confirmar lote</h1>
        <p>
          <strong>{files} {files === 1 ? 'arquivo de' : 'arquivos de'} {groups} {groups === 1 ? 'grupo vai' : 'grupos vão'} para a lixeira do OneDrive</strong>,
          {' '}liberando {formatBytes(bytes)}. Em cada grupo fica a cópia sugerida. Nada é apagado de vez.
        </p>
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
