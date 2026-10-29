import type { BatchSummary, HistoryEntry, UndoResponse } from '@twinpix/shared';
import { useEffect, useState } from 'react';
import { BATCH_STATUS_TEXT, UndoBatchButton } from '../components/BatchBits';
import { ApiError, apiFetch } from '../lib/api';
import { formatBytes, formatDate } from '../lib/format';

const UNDOABLE = ['done', 'paused', 'error'];

const STATUS_TEXT = { done: 'Na lixeira', failed: 'Não foi movido', pending: 'Pendente', undone: 'Restaurado' } as const;

export function History() {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [messages, setMessages] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [batches, setBatches] = useState<BatchSummary[]>([]);
  const [batchError, setBatchError] = useState<string | null>(null);
  const undoing = batches.some((b) => b.status === 'undoing');

  const loadBatches = () => apiFetch<BatchSummary[]>('/api/batches').then(setBatches).catch(() => undefined);
  useEffect(() => { void loadBatches(); }, []);
  useEffect(() => {
    if (!undoing) return;
    const t = setInterval(() => {
      void loadBatches();
      void load();
    }, 1000);
    return () => clearInterval(t);
  }, [undoing]);

  async function undoBatch(id: number) {
    setBatchError(null);
    try {
      const b = await apiFetch<BatchSummary>(`/api/batches/${id}/undo`, { method: 'POST' });
      setBatches((l) => l.map((x) => (x.id === id ? b : x)));
    } catch (e) {
      setBatchError((e as ApiError).message);
    }
  }

  const load = () => apiFetch<HistoryEntry[]>('/api/history').then(setEntries).catch((e: ApiError) => setError(e.message));
  useEffect(() => { void load(); }, []);

  async function undo(actionId: number) {
    try {
      const r = await apiFetch<UndoResponse>(`/api/actions/${actionId}/undo`, { method: 'POST' });
      setMessages((m) => ({ ...m, [actionId]: r.message }));
      if (r.result === 'restored') {
        setEntries((list) => list?.map((e) => (e.actionId === actionId ? { ...e, status: 'undone' } : e)) ?? null);
      }
    } catch (e) {
      setMessages((m) => ({ ...m, [actionId]: (e as ApiError).message }));
    }
  }

  if (error) return <p className="alert">{error}</p>;
  if (!entries) return <p>Carregando…</p>;

  return (
    <section className="card">
      <h1>Histórico</h1>
      {batches.length > 0 && (
        <div className="batches">
          <h2>Lotes</h2>
          {batchError && <p className="alert" role="alert">{batchError}</p>}
          <ul>
            {batches.map((b) => (
              <li key={b.id} className="batch-history-item">
                <strong>Lote #{b.id}</strong> · {formatDate(b.createdAt)} · {BATCH_STATUS_TEXT[b.status]}
                <br />
                <span className="muted">
                  {b.movedFiles} {b.movedFiles === 1 ? 'arquivo movido' : 'arquivos movidos'} · {formatBytes(b.movedBytes)}
                  {b.restoredFiles > 0 && ` · ${b.restoredFiles} restaurados`}
                </span>
                {b.error && <p className={b.status === 'error' ? 'alert' : 'notice'}>{b.error}</p>}
                {b.status === 'error' && <a className="button primary" href="/api/auth/login">Conectar de novo</a>}
                {UNDOABLE.includes(b.status) && b.movedFiles > 0 && <UndoBatchButton onUndo={() => undoBatch(b.id)} />}
              </li>
            ))}
          </ul>
        </div>
      )}
      {entries.length === 0 && <p className="muted">Nenhum arquivo foi movido ainda.</p>}
      <table>
        <thead>
          <tr><th>Arquivo</th><th>Tamanho</th><th>Quando</th><th>Situação</th><th /></tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.actionId}>
              <td>{e.file.folderPath === '/' ? '' : e.file.folderPath}/{e.file.name}</td>
              <td>{formatBytes(e.file.size)}</td>
              <td>{formatDate(e.createdAt)}{e.batchId != null && <> <span className="muted">lote #{e.batchId}</span></>}</td>
              <td>{STATUS_TEXT[e.status]}{e.error ? ` (${e.error})` : ''}</td>
              <td>
                {e.status === 'done' && <button type="button" className="button" onClick={() => undo(e.actionId)}>Desfazer</button>}
                {messages[e.actionId] && <p className="muted">{messages[e.actionId]}</p>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
