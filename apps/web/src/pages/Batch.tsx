import type { BatchItem, BatchLine, BatchPreview, BatchSummary } from '@twinpix/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { BATCH_TITLE, findOpenBatch, OTHER_BATCH_NOTICE } from '../components/BatchBits';
import { BatchProgress } from '../components/BatchProgress';
import { BatchConfirmDialog } from '../components/BatchConfirmDialog';
import { Thumbnail } from '../components/Thumbnail';
import { differingFields, FIELD_LABELS, fieldValue, type FieldKey } from '../lib/differing-fields';
import { ApiError, apiFetch } from '../lib/api';
import { filePath, formatBytes } from '../lib/format';
import { plural } from '../lib/plural';

const PAGE = 20;
const LIST_FIELDS: FieldKey[] = ['takenAt', 'modifiedAt', 'size'];

/** Cópia que fica: a sugerida na pasta original; em outra pasta, a de keepByFolder. */
function keepIdFor(line: BatchLine, it: BatchItem, folder: string): string {
  return folder === line.keepFolder ? it.keep.id : it.keepByFolder[folder] ?? it.keep.id;
}
/** Só oferece a pasta se todos os itens da linha sabem qual cópia ficaria nela. */
function offeredFolders(l: BatchLine): string[] {
  return l.keepOptions.filter((f) => f === l.keepFolder || l.items.every((it) => it.keepByFolder[f]));
}
/** Pastas de onde sai alguma cópia, com a pasta escolhida para manter. */
function outFoldersFor(l: BatchLine, folder: string): string[] {
  if (folder === l.keepFolder) return l.removeFolders;
  const out = new Set<string>();
  for (const it of l.items) {
    const keepId = keepIdFor(l, it, folder);
    for (const f of [it.keep, ...it.remove]) if (f.id !== keepId) out.add(f.folderPath);
  }
  return [...out].sort();
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

function BatchItems({ line, folder, probable }: { line: BatchLine; folder: string; probable: boolean }) {
  const [shown, setShown] = useState(PAGE);
  return (
    <div className="batch-items-wrap">
      {probable
        ? <p className="muted">São prováveis regravações: parecem a mesma foto ou vídeo, mas o conteúdo não é igual byte a byte. Confira as miniaturas.</p>
        : <p className="muted">São cópias idênticas: o conteúdo é o mesmo byte a byte, mesmo quando o nome do arquivo é diferente.</p>}
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
                      <strong>{f.id === keepId ? '★ fica' : 'sai'}</strong>: {filePath(f.folderPath, f.name)}{' '}
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
  const [search] = useSearchParams();
  const probable = search.get('tipo') === 'provaveis';
  const kind = probable ? 'probable' : 'lines';
  const [preview, setPreview] = useState<BatchPreview | null>(null);
  const [batch, setBatch] = useState<BatchSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const all = await apiFetch<BatchSummary[]>('/api/batches').catch(() => [] as BatchSummary[]);
        // Lote aberto (deste ou de outro tipo/análise) impede começar outro: mostra ele.
        const open = findOpenBatch(all, Number(scanId), kind);
        if (open) {
          if (!cancelled) setBatch(open);
        } else {
          const p = await apiFetch<BatchPreview>(`/api/scans/${scanId}/batch${probable ? '?kind=probable' : ''}`);
          if (!cancelled) { setBatch(null); setPreview(p); }
        }
      } catch (e) {
        if (!cancelled) setError((e as ApiError).message);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [scanId, reloads, probable, kind]);

  if (error) return <><p className="alert">{error}</p><p><Link to={`/varredura/${scanId}`}>Voltar à análise</Link></p></>;
  if (!loaded) return <p>Carregando…</p>;
  if (batch) {
    const other = batch.kind !== kind || batch.scanId !== Number(scanId);
    return (
      <BatchProgress
        key={batch.id}
        initial={batch}
        scanId={String(batch.scanId)}
        notice={other ? OTHER_BATCH_NOTICE : undefined}
        afterFinish={other ? <button type="button" className="button primary" onClick={() => { setLoaded(false); setReloads((n) => n + 1); }}>{probable ? 'Ir para o lote das prováveis' : 'Ir para o lote das idênticas'}</button> : undefined}
      />
    );
  }
  if (preview) return <BatchPreviewView key={kind} preview={preview} scanId={scanId!} probable={probable} onStarted={setBatch} />;
  return null;
}

function BatchPreviewView({ preview, scanId, probable, onStarted }: { preview: BatchPreview; scanId: string; probable: boolean; onStarted: (b: BatchSummary) => void }) {
  // Prováveis: tudo desmarcado; a autora escolhe o que mover depois de ver as miniaturas.
  const [marked, setMarked] = useState<Set<string>>(new Set(probable ? [] : preview.lines.map((l) => l.key)));
  const title = probable ? BATCH_TITLE.probable : 'Revisar em lote';
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
        <h1>{title}</h1>
        <p>Não há grupos para o lote.</p>
        {preview.tiesCount > 0 && <p className="notice">{plural(preview.tiesCount, 'grupo sem regra clara fica', 'grupos sem regra clara ficam')} para a revisão um por um.</p>}
        <div className="row"><Link className="button primary" to={`/revisao/${scanId}${probable ? '?tipo=provaveis' : ''}`}>Revisão um por um</Link></div>
      </section>
    );
  }

  return (
    <>
      <section className="batch" inert={confirming}>
        <div className="card">
          <h1>{title}</h1>
          {probable ? (
            <>
              <p className="notice probable-warning" role="note">
                <span aria-hidden="true">⚠ </span>São fotos que parecem regravadas (mesma imagem, arquivo um pouco diferente). Confira as miniaturas antes de marcar.
              </p>
              <p>
                Só grupos que parecem a mesma gravação, com a cópia sem sufixo de cópia no nome. Em cada grupo, fica essa cópia; as outras
                vão para a lixeira do OneDrive. Nada vem marcado: marque as linhas que quiser mover. Dá para desfazer pelo Histórico.
              </p>
            </>
          ) : (
            <p>
              Só cópias idênticas. Em cada grupo, fica a cópia sugerida pela regra; as outras vão para a lixeira do OneDrive.
              Dá para desfazer pelo Histórico.
            </p>
          )}
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
            const outFolders = outFoldersFor(l, keepFolder);
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
                {open.has(l.key) && <BatchItems line={l} folder={keepFolder} probable={probable} />}
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
            // A ★ de cada grupo das linhas marcadas, a mesma do "ver lista": o servidor recusa se a prévia mudou.
            const keeps = Object.fromEntries(chosen.flatMap((l) => l.items.map((it) => [it.groupId, keepIdFor(l, it, folderOf(l))])));
            const b = await apiFetch<BatchSummary>(`/api/scans/${scanId}/batch${probable ? '?kind=probable' : ''}`, {
              method: 'POST',
              body: { lineKeys: chosen.map((l) => l.key), ...(inverted.length ? { keepFolders: Object.fromEntries(inverted.map((l) => [l.key, folderOf(l)])) } : {}), keeps },
            });
            onStarted(b);
          }}
        />
      )}
    </>
  );
}
