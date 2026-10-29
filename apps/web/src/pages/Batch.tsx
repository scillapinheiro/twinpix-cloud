import type { BatchLine, BatchPreview, BatchStatus, BatchSummary, ScanSummary } from '@twinpix/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { BatchConfirmDialog } from '../components/BatchConfirmDialog';
import { ApiError, apiFetch } from '../lib/api';
import { formatBytes } from '../lib/format';

const ACTIVE: BatchStatus[] = ['running', 'paused', 'waiting-network', 'needs-auth', 'undoing'];
const path = (folder: string, name: string) => `${folder === '/' ? '' : folder}/${name}`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function Batch() {
  const { scanId } = useParams();
  const [preview, setPreview] = useState<BatchPreview | null>(null);
  const [batch, setBatch] = useState<BatchSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const all = await apiFetch<BatchSummary[]>('/api/batches').catch(() => [] as BatchSummary[]);
        const active = all.find((b) => b.scanId === Number(scanId) && ACTIVE.includes(b.status));
        if (active) {
          if (!cancelled) setBatch(active);
        } else {
          const p = await apiFetch<BatchPreview>(`/api/scans/${scanId}/batch`);
          if (!cancelled) setPreview(p);
        }
      } catch (e) {
        if (!cancelled) setError((e as ApiError).message);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [scanId]);

  if (error) return <p className="alert">{error}</p>;
  if (!loaded) return <p>Carregando…</p>;
  if (batch) return <BatchProgress initial={batch} scanId={scanId!} />;
  if (preview) return <BatchPreviewView preview={preview} scanId={scanId!} onStarted={setBatch} />;
  return null;
}

function BatchPreviewView({ preview, scanId, onStarted }: { preview: BatchPreview; scanId: string; onStarted: (b: BatchSummary) => void }) {
  const [marked, setMarked] = useState<Set<string>>(new Set(preview.lines.map((l) => l.key)));
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const moveButton = useRef<HTMLButtonElement>(null);

  const chosen = preview.lines.filter((l) => marked.has(l.key));
  const files = chosen.reduce((s, l) => s + l.fileCount, 0);
  const groups = chosen.reduce((s, l) => s + l.groupCount, 0);
  const bytes = chosen.reduce((s, l) => s + l.bytes, 0);
  const flip = (set: Set<string>, key: string) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  };
  const cancel = useCallback(() => { setConfirming(false); moveButton.current?.focus(); }, []);

  if (preview.lines.length === 0) {
    return (
      <section className="card">
        <h1>Revisar em lote</h1>
        <p>Não há grupos para o lote.</p>
        {preview.tiesCount > 0 && <p className="notice">{plural(preview.tiesCount, 'grupo sem regra clara fica', 'grupos sem regra clara ficam')} para a revisão um por um.</p>}
        <div className="row"><Link className="button primary" to={`/revisao/${scanId}`}>Revisão um por um</Link></div>
      </section>
    );
  }

  return (
    <>
      <section className="batch" inert={confirming}>
        <div className="card">
          <h1>Revisar em lote</h1>
          <p>
            Só cópias idênticas. Em cada grupo, fica a cópia sugerida pela regra; as outras vão para a lixeira do OneDrive.
            Dá para desfazer pelo Histórico.
          </p>
          {preview.tiesCount > 0 && (
            <p className="notice">{plural(preview.tiesCount, 'grupo sem regra clara fica', 'grupos sem regra clara ficam')} para a revisão um por um.</p>
          )}
        </div>
        <ul className="batch-lines">
          {preview.lines.map((l: BatchLine) => (
            <li key={l.key} className="card batch-line">
              <label className="batch-line-head">
                <input type="checkbox" checked={marked.has(l.key)} onChange={() => setMarked((m) => flip(m, l.key))} />
                <span>
                  <strong>{plural(l.groupCount, 'grupo', 'grupos')}</strong> · fica em <strong>{l.keepFolder}</strong> · sai de{' '}
                  <strong>{l.removeFolders.join(', ')}</strong> · {formatBytes(l.bytes)}
                </span>
              </label>
              <p className="muted batch-reason">regra: {l.reasons.map((r) => r.replace(/^regra:\s*/, '')).join('; ')}</p>
              <button type="button" className="link" aria-expanded={open.has(l.key)} onClick={() => setOpen((o) => flip(o, l.key))}>
                {open.has(l.key) ? 'esconder lista' : 'ver lista'}
              </button>
              {open.has(l.key) && (
                <ul className="batch-items muted">
                  {l.items.map((it) => (
                    <li key={it.groupId}>
                      fica: {path(it.keep.folderPath, it.keep.name)}
                      {it.remove.map((r) => <span key={r.id}> · sai: {path(r.folderPath, r.name)}</span>)}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
        <div className="action-bar">
          <span className="batch-total">{plural(groups, 'grupo', 'grupos')} marcados · {formatBytes(bytes)}</span>
          <button type="button" ref={moveButton} className="button danger" disabled={files === 0} onClick={() => setConfirming(true)}>
            Mover para a lixeira ({plural(files, 'arquivo', 'arquivos')})
          </button>
        </div>
      </section>
      {confirming && (
        <BatchConfirmDialog
          files={files}
          groups={groups}
          bytes={bytes}
          onCancel={cancel}
          onConfirm={async () => {
            const b = await apiFetch<BatchSummary>(`/api/scans/${scanId}/batch`, { method: 'POST', body: { lineKeys: chosen.map((l) => l.key) } });
            onStarted(b);
          }}
        />
      )}
    </>
  );
}

const STATUS_TEXT: Record<BatchStatus, string> = {
  running: 'Movendo para a lixeira…',
  paused: 'Lote pausado.',
  'waiting-network': 'Sem conexão. Continua sozinho quando a internet voltar.',
  'needs-auth': 'A conexão com o OneDrive expirou.',
  done: 'Lote concluído.',
  undoing: 'Desfazendo o lote…',
  undone: 'Lote desfeito.',
  error: 'O lote parou por um erro.',
};

function BatchProgress({ initial, scanId }: { initial: BatchSummary; scanId: string }) {
  const navigate = useNavigate();
  const [b, setB] = useState(initial);
  const [pending, setPending] = useState(0);
  const [confirmUndo, setConfirmUndo] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
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
        if (!['done', 'undone', 'error'].includes(next.status)) timer = setTimeout(tick, 1000);
      } catch (e) {
        if (dead) return;
        setActionError((e as ApiError).message);
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
      setConfirmUndo(false);
    } catch (e) {
      setActionError((e as ApiError).message);
    }
  }

  const pct = b.totalGroups ? Math.round((b.doneGroups / b.totalGroups) * 100) : 0;
  const bad = b.status === 'error' || b.status === 'needs-auth';

  return (
    <section className="card">
      <h1>Lote das idênticas</h1>
      <p className={bad ? 'alert' : undefined} role="status">
        {STATUS_TEXT[b.status]} {b.status === 'error' && b.error ? `(${b.error})` : ''}
      </p>
      <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Progresso do lote">
        <div style={{ width: `${pct}%` }} />
      </div>
      <p>{b.doneGroups} de {b.totalGroups} grupos</p>
      <p>{plural(b.movedFiles, 'arquivo movido', 'arquivos movidos')} · {formatBytes(b.movedBytes)} liberados</p>
      {finished && (
        <ul>
          {b.status !== 'undone' && <li>Movidos: {b.movedFiles}</li>}
          {b.skippedGroups > 0 && <li>Pulados: {plural(b.skippedGroups, 'grupo', 'grupos')} (voltam para a revisão um por um)</li>}
          {b.failedFiles > 0 && <li className="alert">Falhas: {plural(b.failedFiles, 'arquivo não foi movido', 'arquivos não foram movidos')}</li>}
          {b.status === 'undone' && (
            <>
              <li>Restaurados: {b.restoredFiles}</li>
              {b.notRestoredFiles > 0 && <li className="alert">Não restaurados: {b.notRestoredFiles}</li>}
            </>
          )}
        </ul>
      )}
      {actionError && <p className="alert" role="alert">{actionError}</p>}
      <div className="row">
        {b.status === 'running' && <button type="button" className="button" onClick={() => void act('pause')}>Pausar</button>}
        {(b.status === 'paused' || b.status === 'needs-auth') && (
          <button type="button" className="button" onClick={() => void act('resume')}>Continuar</button>
        )}
        {b.status === 'needs-auth' && <a className="button primary" href="/api/auth/login">Conectar de novo</a>}
        {finished && pending > 0 && <Link className="button primary" to={`/revisao/${scanId}`}>Revisão um por um</Link>}
        {finished && <button type="button" className="button" onClick={() => navigate('/historico')}>Ver histórico</button>}
        {b.status === 'done' && b.movedFiles > 0 && (
          confirmUndo ? (
            <button type="button" className="button danger" onClick={() => void act('undo')}>Confirmar desfazer</button>
          ) : (
            <button type="button" className="button" onClick={() => setConfirmUndo(true)}>Desfazer este lote</button>
          )
        )}
      </div>
    </section>
  );
}
