import type { HistoryEntry, UndoResponse } from '@twinpix/shared';
import { useEffect, useState } from 'react';
import { ApiError, apiFetch } from '../lib/api';
import { formatBytes, formatDate } from '../lib/format';

const STATUS_TEXT = { done: 'Na lixeira', failed: 'Não foi movido', pending: 'Pendente', undone: 'Restaurado' } as const;

export function History() {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [messages, setMessages] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);

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
              <td>{formatDate(e.createdAt)}</td>
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
