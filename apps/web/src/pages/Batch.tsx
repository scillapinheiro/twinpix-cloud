import type { BatchItem, BatchLine, BatchPreview, BatchStatus, BatchSummary, ScanSummary } from '@twinpix/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { BATCH_STATUS_TEXT, UndoBatchButton } from '../components/BatchBits';
import { BatchConfirmDialog } from '../components/BatchConfirmDialog';
import { Thumbnail } from '../components/Thumbnail';
import { differingFields, FIELD_LABELS, fieldValue, type FieldKey } from '../lib/differing-fields';
import { ApiError, apiFetch } from '../lib/api';
import { formatBytes } from '../lib/format';

const ACTIVE: BatchStatus[] = ['running', 'paused', 'waiting-network', 'needs-auth', 'undoing'];
const path = (folder: string, name: string) => `${folder === '/' ? '' : folder}/${name}`;
const PAGE = 20;
const LIST_FIELDS: FieldKey[] = ['takenAt', 'modifiedAt', 'size'];
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Cópia que fica: a sugerida na pasta original; em outra pasta, a de keepByFolder. */
function keepIdFor(line: BatchLine, it: BatchItem, folder: string): string {
  return folder === line.keepFolder ? it.keep.id : it.keepByFolder[folder] ?? it.keep.id;
}
/** Só oferece a pasta se todos os itens da linha sabem qual cópia ficaria nela. */
function offeredFolders(l: BatchLine): string[] {
  return l.keepOptions.filter((f) => f === l.keepFolder || l.items.every((it) => it.keepByFolder[f]));
}
function lineStats(l: BatchLine, folder: string): { files: number; bytes: number } {
  if (folder === l.keepFolder) return { files: l.fileCount, bytes: l.bytes };
  let files = 0;
  let bytes = 0;
  for (const it of l.items) {
    const keepId = keepIdFor(l, it, folder);
    for (const f of [it.keep, ...it.remove]) {
      if (f.id !== keepId) { files++; bytes += f.size; }
    }
  }
  return { files, bytes };
}

function BatchItems({ line, folder }: { line: BatchLine; folder: string }) {
  const [shown, setShown] = useState(PAGE);
  return (
    <div className="batch-items-wrap">
      <p className="muted">São cópias idênticas: o conteúdo é o mesmo byte a byte, mesmo quando o nome do arquivo é diferente.</p>
      <ul className="batch-items">
        {line.items.slice(0, shown).map((it) => {
          const keepId = keepIdFor(line, it, folder);
          const all = [it.keep, ...it.remove];
          const diffs = differingFields(all);
          return (
            <li key={it.groupId} className="batch-item">
              {all.map((f) => (
                <div key={f.id} className={`batch-file${f.id === keepId ? ' keeps' : ''}`}>
                  <div className="batch-thumb"><Thumbnail fileId={f.id} alt={f.name} /></div>
                  <div className="batch-file-info">
                    <div>
                      <strong>{f.id === keepId ? '★ fica' : 'sai'}</strong>: {path(f.folderPath, f.name)}{' '}
                      <a className="batch-link" href={f.webUrl} target="_blank" rel="noreferrer">Abrir no OneDrive ↗</a>
                    </div>
                    <div className="batch-file-meta">
                      {LIST_FIELDS.map((k) => (
                        <span key={k}>{FIELD_LABELS[k]}: <span className={diffs.has(k) ? 'diff' : undefined}>{fieldValue(f, k)}</span> </span>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </li>
          );
        })}
      </ul>
      {shown < line.items.length && (
        <button type="button" className="link" onClick={() => setShown((n) => n + PAGE)}>
          mostrar mais ({line.items.length - shown} restantes)
        </button>
      )}
    </div>
  );
}

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

  if (error) return <><p className="alert">{error}</p><p><Link to={`/varredura/${scanId}`}>Voltar à análise</Link></p></>;
  if (!loaded) return <p>Carregando…</p>;
  if (batch) return <BatchProgress initial={batch} scanId={scanId!} />;
  if (preview) return <BatchPreviewView preview={preview} scanId={scanId!} onStarted={setBatch} />;
  return null;
}

function BatchPreviewView({ preview, scanId, onStarted }: { preview: BatchPreview; scanId: string; onStarted: (b: BatchSummary) => void }) {
  const [marked, setMarked] = useState<Set<string>>(new Set(preview.lines.map((l) => l.key)));
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState(false);
  const moveButton = useRef<HTMLButtonElement>(null);

  const chosen = preview.lines.filter((l) => marked.has(l.key));
  const folderOf = (l: BatchLine) => choice[l.key] ?? l.keepFolder;
  const stats = chosen.map((l) => lineStats(l, folderOf(l)));
  const files = stats.reduce((s, x) => s + x.files, 0);
  const groups = chosen.reduce((s, l) => s + l.groupCount, 0);
  const bytes = stats.reduce((s, x) => s + x.bytes, 0);
  const inverted = chosen.filter((l) => folderOf(l) !== l.keepFolder);
  const pick = (l: BatchLine, folder: string) =>
    setChoice((c) => {
      const next = { ...c };
      if (folder === l.keepFolder) delete next[l.key];
      else next[l.key] = folder;
      return next;
    });
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
        <div className="row batch-marks">
          <span>{marked.size} de {preview.lines.length} linhas marcadas</span>
          <button type="button" className="link" onClick={() => setMarked(new Set(preview.lines.map((l) => l.key)))}>Marcar todas</button>
          <button type="button" className="link" onClick={() => setMarked(new Set())}>Desmarcar todas</button>
        </div>
        <ul className="batch-lines">
          {preview.lines.map((l: BatchLine) => {
            const keepFolder = folderOf(l);
            const offered = offeredFolders(l);
            const outFolders = l.keepOptions.filter((f) => f !== keepFolder);
            const changed = keepFolder !== l.keepFolder;
            const st = lineStats(l, keepFolder);
            return (
              <li key={l.key} className="card batch-line">
                <label className="batch-line-head">
                  <input type="checkbox" checked={marked.has(l.key)} onChange={() => setMarked((m) => flip(m, l.key))} />
                  <span>
                    <strong>{plural(l.groupCount, 'grupo', 'grupos')}</strong> · fica em <strong>{keepFolder}</strong> · sai de{' '}
                    <strong>{outFolders.join(', ')}</strong> · {formatBytes(st.bytes)}
                    {changed && <span className="badge-chosen"> escolhido por você</span>}
                  </span>
                </label>
                <p className="muted batch-reason">regra: {l.reasons.map((r) => r.replace(/^regra:\s*/, '')).join('; ')}</p>
                {offered.length < 2 ? null : l.removeFolders.length === 1 ? (
                  <button type="button" className="link" onClick={() => pick(l, changed ? l.keepFolder : l.removeFolders[0])}>
                    {changed ? `⇄ Voltar à sugestão: manter em ${l.keepFolder}` : `⇄ Inverter: manter em ${l.removeFolders[0]}`}
                  </button>
                ) : (
                  <label className="batch-keep-select">
                    Manter em:{' '}
                    <select value={keepFolder} onChange={(e) => pick(l, e.target.value)}>
                      {offered.map((f) => <option key={f} value={f}>{f}</option>)}
                    </select>
                  </label>
                )}
                <button type="button" className="link" aria-expanded={open.has(l.key)} onClick={() => setOpen((o) => flip(o, l.key))}>
                  {open.has(l.key) ? 'esconder lista' : 'ver lista'}
                </button>
                {open.has(l.key) && <BatchItems line={l} folder={keepFolder} />}
              </li>
            );
          })}
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
          inverted={inverted.map((l) => ({ key: l.key, folder: folderOf(l), groups: l.groupCount }))}
          onCancel={cancel}
          onConfirm={async () => {
            const b = await apiFetch<BatchSummary>(`/api/scans/${scanId}/batch`, { method: 'POST', body: { lineKeys: chosen.map((l) => l.key), ...(inverted.length ? { keepFolders: Object.fromEntries(inverted.map((l) => [l.key, folderOf(l)])) } : {}) } });
            onStarted(b);
          }}
        />
      )}
    </>
  );
}

function BatchProgress({ initial, scanId }: { initial: BatchSummary; scanId: string }) {
  const [b, setB] = useState(initial);
  const [pending, setPending] = useState(0);
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
        setActionError(null);
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
        {BATCH_STATUS_TEXT[b.status]}
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
        {(b.status === 'running' || b.status === 'waiting-network') && <button type="button" className="button" onClick={() => void act('pause')}>Pausar</button>}
        {b.status === 'paused' && <button type="button" className="button" onClick={() => void act('resume')}>Continuar</button>}
        {b.status === 'needs-auth' && (
          <>
            <a className="button primary" href="/api/auth/login">Conectar de novo</a>
            <button type="button" className="link" onClick={() => void act('resume')}>Já conectei, continuar</button>
          </>
        )}
        {finished && pending > 0 && <Link className="button primary" to={`/revisao/${scanId}`}>Revisão um por um</Link>}
        {finished && <Link className="button" to="/historico">Ver histórico</Link>}
        {b.status === 'done' && b.movedFiles > 0 && <UndoBatchButton onUndo={() => act('undo')} />}
      </div>
    </section>
  );
}
