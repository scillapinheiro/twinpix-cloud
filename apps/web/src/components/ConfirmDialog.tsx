import type { ApplyResult, DeletionPreview } from '@twinpix/shared';
import { useEffect, useRef, useState } from 'react';
import { ApiError, apiFetch } from '../lib/api';
import { formatBytes } from '../lib/format';
import { ignoreShortcut, isNativeActivator } from '../lib/shortcuts';

interface Props {
  groupId: number;
  deleteIds: string[];
  /** Fecha sem enviar nada (Voltar, Esc, clique no fundo). */
  onCancel: () => void;
  /** Fecha depois do resultado; `stale` pede para reconferir o grupo atual. */
  onDone: (stale: boolean) => void;
}

const STATUS_TEXT = { done: 'movido para a lixeira', failed: 'não foi movido', pending: 'pendente', undone: 'restaurado' } as const;

export function ConfirmDialog({ groupId, deleteIds, onCancel, onDone }: Props) {
  const [preview, setPreview] = useState<DeletionPreview | null>(null);
  const [result, setResult] = useState<ApplyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const canCancel = !busy && !result;

  useEffect(() => {
    dialogRef.current?.focus();
    apiFetch<DeletionPreview>(`/api/groups/${groupId}/preview`, { method: 'POST', body: { deleteIds } })
      .then(setPreview)
      .catch((e: ApiError) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  const busyRef = useRef(false);
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e) => {
    if (e.key === 'Escape') {
      if (canCancel) onCancel();
      return;
    }
    // Enter em botão já o aciona sozinho; aqui só vale com o foco no próprio diálogo ou fora de botões.
    if (e.key !== 'Enter' || ignoreShortcut(e) || isNativeActivator(e)) return;
    if (result) {
      e.preventDefault();
      onDone(result.stale);
    } else if (preview && !busy && !busyRef.current) {
      e.preventDefault();
      void apply();
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyRef.current(e);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  async function apply() {
    if (busy || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setApplyError(null);
    try {
      setResult(await apiFetch<ApplyResult>(`/api/groups/${groupId}/apply`, { method: 'POST', body: { deleteIds } }));
    } catch (e) {
      setApplyError((e as ApiError).message);
      busyRef.current = false;
      setBusy(false);
    }
  }

  const n = preview?.deleteFiles.length ?? 0;
  const path = (f: { folderPath: string; name: string }) => `${f.folderPath === '/' ? '' : f.folderPath}/${f.name}`;

  return (
    <div className="modal-overlay" onClick={(e) => { if (canCancel && e.target === e.currentTarget) onCancel(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title" tabIndex={-1} ref={dialogRef}>
        {result ? (
          <>
            <h1 id="confirm-title">Resultado</h1>
            {result.stale ? (
              <p className="notice">
                Este grupo mudou no OneDrive desde a análise (algum arquivo foi alterado, movido ou apagado). Nada foi movido.
                {' '}O grupo foi atualizado com a situação atual — confira de novo antes de excluir.
              </p>
            ) : (
              <>
                <ul>
                  {result.results.map((r) => (
                    <li key={r.actionId} className={r.status === 'failed' ? 'alert' : undefined}>
                      {r.fileName}: {STATUS_TEXT[r.status]}{r.error ? ` (${r.error})` : ''}
                    </li>
                  ))}
                </ul>
                <p className="muted">Mudou de ideia? Dá para desfazer no Histórico enquanto o arquivo estiver na lixeira.</p>
              </>
            )}
            <div className="row">
              <button type="button" className="button primary" onClick={() => onDone(result.stale)}>
                {result.stale ? 'Conferir o grupo atualizado' : 'Próximo grupo'}
                {' '}<kbd className="key-hint" aria-hidden="true">Enter</kbd>
              </button>
            </div>
          </>
        ) : (
          <>
            <h1 id="confirm-title">Confirmar</h1>
            {error && <p className="alert">{error}</p>}
            {!error && !preview && <p>Carregando…</p>}
            {preview && (
              <>
                <p>
                  <strong>{n} {n === 1 ? 'arquivo vai' : 'arquivos vão'} para a lixeira do OneDrive</strong>, liberando {formatBytes(preview.bytes)}.
                  Nada é apagado de vez: você pode restaurar pelo Histórico ou pela lixeira do OneDrive.
                </p>
                <h2>Vão para a lixeira</h2>
                <ul>{preview.deleteFiles.map((f) => <li key={f.id}>{path(f)}</li>)}</ul>
                <h2>Ficam onde estão</h2>
                <ul>{preview.keepFiles.map((f) => <li key={f.id}>{path(f)}</li>)}</ul>
              </>
            )}
            {applyError && <p className="alert">{applyError}</p>}
            <div className="row">
              <button type="button" className="button" onClick={onCancel} disabled={busy}>Voltar</button>
              {preview && (
                <button type="button" className="button danger" disabled={busy} onClick={apply}>
                  Mover para a lixeira <kbd className="key-hint" aria-hidden="true">Enter</kbd>
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
