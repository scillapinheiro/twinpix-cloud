import type { ApplyResult, DeletionPreview } from '@twinpix/shared';
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ApiError, apiFetch } from '../lib/api';
import { formatBytes } from '../lib/format';

interface State { groupId: number; scanId: number; deleteIds: string[] }

const STATUS_TEXT = { done: 'movido para a lixeira', failed: 'não foi movido', pending: 'pendente', undone: 'restaurado' } as const;

export function Confirm() {
  const navigate = useNavigate();
  const state = useLocation().state as State | null;
  const [preview, setPreview] = useState<DeletionPreview | null>(null);
  const [result, setResult] = useState<ApplyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  useEffect(() => {
    if (!state) return;
    apiFetch<DeletionPreview>(`/api/groups/${state.groupId}/preview`, { method: 'POST', body: { deleteIds: state.deleteIds } })
      .then(setPreview)
      .catch((e: ApiError) => setError(e.message));
  }, [state]);

  if (!state) return <p className="alert">Nada para confirmar. Volte para a revisão.</p>;
  if (error) return <p className="alert">{error}</p>;
  if (!preview) return <p>Carregando…</p>;

  const nextGroup = () => navigate(`/revisao/${state.scanId}`);

  if (result) {
    return (
      <section className="card">
        <h1>Resultado</h1>
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
        <button type="button" className="button primary" onClick={nextGroup}>
          {result.stale ? 'Conferir o grupo atualizado' : 'Próximo grupo'}
        </button>
      </section>
    );
  }

  const n = preview.deleteFiles.length;
  return (
    <section className="card">
      <h1>Confirmar</h1>
      <p>
        <strong>{n} {n === 1 ? 'arquivo vai' : 'arquivos vão'} para a lixeira do OneDrive</strong>, liberando {formatBytes(preview.bytes)}.
        Nada é apagado de vez: você pode restaurar pelo Histórico ou pela lixeira do OneDrive.
      </p>
      <h2>Vão para a lixeira</h2>
      <ul>{preview.deleteFiles.map((f) => <li key={f.id}>{f.folderPath === '/' ? '' : f.folderPath}/{f.name}</li>)}</ul>
      <h2>Ficam onde estão</h2>
      <ul>{preview.keepFiles.map((f) => <li key={f.id}>{f.folderPath === '/' ? '' : f.folderPath}/{f.name}</li>)}</ul>
      {applyError && <p className="alert">{applyError}</p>}
      <div className="row">
        <button type="button" className="button" onClick={() => navigate(-1)}>Voltar</button>
        <button
          type="button"
          className="button danger"
          disabled={busy}
          onClick={async () => {
            if (busy) return;
            setBusy(true);
            setApplyError(null);
            try {
              setResult(await apiFetch<ApplyResult>(`/api/groups/${state.groupId}/apply`, { method: 'POST', body: { deleteIds: state.deleteIds } }));
            } catch (e) {
              setApplyError((e as ApiError).message);
              setBusy(false);
            }
          }}
        >
          Mover para a lixeira
        </button>
      </div>
    </section>
  );
}
