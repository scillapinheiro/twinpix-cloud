import type { BatchSummary, ScanSummary } from '@twinpix/shared';
import { type ReactNode, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, apiFetch } from '../lib/api';
import { formatBytes } from '../lib/format';
import { plural } from '../lib/plural';
import { BATCH_STATUS_TEXT, BATCH_TITLE, UndoBatchButton } from './BatchBits';

export function BatchProgress({ initial, scanId, title = BATCH_TITLE[initial.kind], notice, afterFinish }: {
  initial: BatchSummary;
  scanId: string;
  title?: string;
  /** Aviso fixo abaixo do título (ex.: lote de outra tela que precisa terminar antes). */
  notice?: string;
  /** Ações extras (ex.: "Próximo conjunto") mostradas quando o lote termina. */
  afterFinish?: ReactNode;
}) {
  const [b, setB] = useState(initial);
  const [pending, setPending] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const finished = b.status === 'done' || b.status === 'undone' || b.status === 'error';

  useEffect(() => {
    if (finished) return;
    let timer: ReturnType<typeof setTimeout>;
    let dead = false;
    const tick = async () => {
      try {
        const next = await apiFetch<BatchSummary>(`/api/batches/${initial.id}`);
        if (dead) return;
        setB(next);
        setPollError(null);
        if (!['done', 'undone', 'error'].includes(next.status)) timer = setTimeout(tick, 1000);
      } catch (e) {
        if (dead) return;
        setPollError((e as ApiError).message);
        timer = setTimeout(tick, 3000);
      }
    };
    timer = setTimeout(tick, 1000);
    return () => { dead = true; clearTimeout(timer); };
  }, [initial.id, finished]);

  useEffect(() => {
    if (!finished) return;
    apiFetch<ScanSummary>(`/api/scans/${scanId}`).then((s) => setPending(s.groupsPending)).catch(() => undefined);
  }, [finished, scanId]);

  async function act(action: 'pause' | 'resume' | 'undo') {
    setActionError(null);
    try {
      setB(await apiFetch<BatchSummary>(`/api/batches/${b.id}/${action}`, { method: 'POST' }));
    } catch (e) {
      setActionError((e as ApiError).message);
    }
  }

  // No lote de pastas cada "grupo" é um arquivo repetido (a mesma palavra da tela das pastas).
  const unit = b.kind === 'folders' ? (n: number) => plural(n, 'arquivo repetido', 'arquivos repetidos') : (n: number) => plural(n, 'grupo', 'grupos');
  const total = unit(b.totalGroups);
  const pct = b.totalGroups ? Math.round(((b.doneGroups + b.skippedGroups) / b.totalGroups) * 100) : 0;
  const bad = b.status === 'error' || b.status === 'needs-auth';

  return (
    <section className="card">
      <h1>{title}</h1>
      {notice && <p className="notice">{notice}</p>}
      <p className={bad ? 'alert' : undefined} role="status">
        {BATCH_STATUS_TEXT[b.status]}
      </p>
      {b.error && <p className={bad ? 'alert' : 'notice'}>{b.error}</p>}
      <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Progresso do lote">
        <div style={{ width: `${pct}%` }} />
      </div>
      <p>{b.doneGroups} de {total}</p>
      <p>{plural(b.movedFiles, 'arquivo movido', 'arquivos movidos')} · {formatBytes(b.movedBytes)} liberados</p>
      {finished && (
        <ul>
          {b.status !== 'undone' && <li>Movidos: {b.movedFiles}</li>}
          {b.skippedGroups > 0 && <li>Pulados: {unit(b.skippedGroups)} (não foram mexidos)</li>}
          {b.failedFiles > 0 && <li className="alert">Falhas: {plural(b.failedFiles, 'arquivo não foi movido', 'arquivos não foram movidos')}</li>}
          {b.status === 'undone' && (
            <>
              <li>Restaurados: {b.restoredFiles}</li>
              {b.notRestoredFiles > 0 && <li className="alert">Não restaurados: {b.notRestoredFiles}</li>}
            </>
          )}
        </ul>
      )}
      {pollError && <p className="alert">{pollError}</p>}
      {actionError && <p className="alert" role="alert">{actionError}</p>}
      <div className="row">
        {(b.status === 'running' || b.status === 'waiting-network') && <button type="button" className="button" onClick={() => void act('pause')}>Pausar</button>}
        {b.status === 'paused' && <button type="button" className="button" onClick={() => void act('resume')}>Continuar</button>}
        {b.status === 'needs-auth' && (
          <>
            <a className="button primary" href="/api/auth/login">Conectar de novo</a>
            <button type="button" className="link" onClick={() => void act('resume')}>Já conectei, continuar</button>
          </>
        )}
        {b.status === 'error' && <a className="button primary" href="/api/auth/login">Conectar de novo</a>}
        {finished && pending > 0 && <Link className="button primary" to={`/revisao/${scanId}`}>Revisão um por um</Link>}
        {finished && afterFinish}
        {finished && <Link className="button" to="/historico">Ver histórico</Link>}
        {(b.status === 'done' || b.status === 'paused' || b.status === 'error') && b.movedFiles > 0 && <UndoBatchButton onUndo={() => act('undo')} />}
      </div>
    </section>
  );
}
