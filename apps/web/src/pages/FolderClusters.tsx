import type { BatchSummary, CloudItem, FolderCluster, FolderStat, ReconcilePlan } from '@twinpix/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { BatchProgress } from '../components/BatchProgress';
import { ReconcileConfirmDialog } from '../components/ReconcileConfirmDialog';
import { ApiError, apiFetch } from '../lib/api';
import { formatBytes } from '../lib/format';
import { plural } from '../lib/plural';

const REVIEW = '__review__';
const ORD = ['primeira', 'segunda', 'terceira', 'quarta', 'quinta', 'sexta', 'sétima', 'oitava', 'nona', 'décima'];
const ordinal = (i: number) => ORD[i] ?? `${i + 1}ª`;
const fileName = (f: CloudItem) => `${f.folderPath === '/' ? '' : f.folderPath}/${f.name}`;

function situationText(f: FolderStat): string {
  if (f.situation === 'complete') return 'Mais completa';
  if (f.situation === 'contained') return `Toda contida na ${f.containedIn ?? 'outra pasta'}`;
  return `Parcial: ${f.commonWithComplete} em comum com a mais completa`;
}

export function FolderClusters() {
  const { scanId } = useParams();
  const navigate = useNavigate();
  const [clusters, setClusters] = useState<FolderCluster[] | null>(null);
  const [index, setIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [batch, setBatch] = useState<BatchSummary | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await apiFetch<FolderCluster[]>(`/api/scans/${scanId}/folder-clusters`);
      setClusters(list);
      setIndex(0);
      setError(null);
    } catch (e) {
      setError((e as ApiError).message);
    }
  }, [scanId]);
  useEffect(() => { void load(); }, [load]);

  const back = <p><Link to={`/varredura/${scanId}`}>Voltar à análise</Link></p>;
  if (error) return <><p className="alert">{error}</p>{back}</>;
  if (!clusters) return <p>Carregando…</p>;

  if (batch) {
    return (
      <BatchProgress
        initial={batch}
        scanId={scanId!}
        title="Lote de pastas repetidas"
        afterFinish={<button type="button" className="button primary" onClick={() => { setBatch(null); void load(); }}>Próximo conjunto</button>}
      />
    );
  }
  if (clusters.length === 0) {
    return (
      <section className="card">
        <h1>Pastas repetidas</h1>
        <p>Não há mais conjuntos de pastas repetidas.</p>
        {back}
      </section>
    );
  }
  const cluster = clusters[index] ?? clusters[0];
  const go = (i: number) => (i < 0 || i >= clusters.length ? navigate(`/varredura/${scanId}`) : setIndex(i));
  return (
    <ClusterView
      key={cluster.key}
      cluster={cluster}
      position={index + 1}
      total={clusters.length}
      scanId={scanId!}
      onPrev={() => go(index - 1)}
      onNext={() => go(index + 1)}
      onStarted={setBatch}
      onReload={() => void load()}
    />
  );
}

function resultText(cluster: FolderCluster, plan: ReconcilePlan): string {
  const parts: string[] = [];
  cluster.folders.forEach((f, i) => {
    if (f.path === plan.keepFolder) return;
    const rem = plan.remaining.find((r) => r.path === f.path)?.fileCount ?? 0;
    parts.push(rem === 0 ? `a ${ordinal(i)} pasta fica vazia` : `a ${ordinal(i)} fica só com ${rem === 1 ? 'o seu 1 arquivo único' : `os seus ${rem} arquivos únicos`}`);
  });
  return `Resultado: ${parts.join('; ')}.`;
}

function UniqueList({ scanId, cluster, folder }: { scanId: string; cluster: FolderCluster; folder: string }) {
  const [files, setFiles] = useState<CloudItem[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  async function toggle() {
    if (open) return setOpen(false);
    setOpen(true);
    if (files) return;
    try {
      setFiles(await apiFetch<CloudItem[]>(`/api/scans/${scanId}/folder-clusters/unique?key=${encodeURIComponent(cluster.key)}&folder=${encodeURIComponent(folder)}`));
    } catch (e) {
      setErr((e as ApiError).message);
    }
  }
  return (
    <>
      {' '}<button type="button" className="link" aria-expanded={open} onClick={() => void toggle()}>{open ? 'esconder lista' : 'ver lista'}</button>
      {open && (
        <ul className="reconcile-list" aria-label={`Arquivos só em ${folder}`}>
          {err && <li className="alert">{err}</li>}
          {!files && !err && <li>Carregando…</li>}
          {files?.map((f) => <li key={f.id}>{fileName(f)}</li>)}
        </ul>
      )}
    </>
  );
}

function ClusterView({ cluster, position, total, scanId, onPrev, onNext, onStarted, onReload }: {
  cluster: FolderCluster; position: number; total: number; scanId: string;
  onPrev: () => void; onNext: () => void; onStarted: (b: BatchSummary) => void; onReload: () => void;
}) {
  const navigate = useNavigate();
  const [choice, setChoice] = useState(cluster.suggestedKeep);
  const [plan, setPlan] = useState<ReconcilePlan | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const applyButton = useRef<HTMLButtonElement>(null);
  const seq = useRef(0);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (choice === REVIEW) { seq.current++; setPlan(null); setPlanError(null); return; }
    const mine = ++seq.current;
    setPlan(null);
    setPlanError(null);
    apiFetch<ReconcilePlan>(`/api/scans/${scanId}/folder-clusters/plan?key=${encodeURIComponent(cluster.key)}&keep=${encodeURIComponent(choice)}`)
      .then((p) => { if (mine === seq.current) setPlan(p); })
      .catch((e: ApiError) => { if (mine === seq.current) setPlanError(e.message); });
  }, [choice, cluster.key, scanId, tick]);

  const cancel = useCallback(() => { setConfirming(false); applyButton.current?.focus(); }, []);
  const folders = cluster.folders;
  const two = folders.length === 2;
  const uniqueOf = (i: number) => folders[i].uniqueCount;
  const common = two ? folders[0].fileCount - folders[0].uniqueCount : cluster.groupCount;
  const n = plan?.deleteFiles.length ?? 0;
  const situationLine = two
    ? folders[1].situation === 'contained' ? 'a segunda pasta está toda contida na primeira.' : folders[0].situation === 'contained' ? 'a primeira pasta está toda contida na segunda.' : 'cada pasta tem arquivos que a outra não tem.'
    : null;

  return (
    <>
      <section className="reconcile" inert={confirming}>
        <div className="card">
          <h1>Pastas repetidas · {position} de {total}</h1>
          {two ? (
            <div className="reconcile-cards">
              {folders.map((f) => (
                <div key={f.path} className={`reconcile-card${f.path === cluster.suggestedKeep ? ' suggested' : ''}`}>
                  <p className="reconcile-badge">{f.path === cluster.suggestedKeep ? '★ Sugerida para manter' : ' '}</p>
                  <p><strong>📁 {f.path}</strong></p>
                  <dl>
                    <dt>Arquivos:</dt><dd>{f.fileCount}</dd>
                    <dt>Tamanho:</dt><dd>{formatBytes(f.bytes)}</dd>
                    <dt>Só nesta pasta:</dt>
                    <dd><strong>{plural(f.uniqueCount, 'arquivo', 'arquivos')}</strong>{f.uniqueCount > 0 && <UniqueList scanId={scanId} cluster={cluster} folder={f.path} />}</dd>
                  </dl>
                </div>
              ))}
            </div>
          ) : (
            <table className="reconcile-table">
              <thead><tr><th /><th>Pasta</th><th>Arquivos</th><th>Só nela</th><th>Situação</th></tr></thead>
              <tbody>
                {folders.map((f) => (
                  <tr key={f.path} className={f.path === cluster.suggestedKeep ? 'suggested' : undefined}>
                    <td>{f.path === cluster.suggestedKeep ? '★' : ''}</td>
                    <td><strong>{f.path}</strong></td>
                    <td>{f.fileCount}</td>
                    <td><strong>{f.uniqueCount}</strong>{f.uniqueCount > 0 && <UniqueList scanId={scanId} cluster={cluster} folder={f.path} />}</td>
                    <td>{situationText(f)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="reconcile-summary">
            {two ? (
              <>
                <strong>Situação:</strong> {situationLine}<br />
                {common} arquivos estão nas duas · {uniqueOf(0)} só na primeira · {uniqueOf(1)} só na segunda.
              </>
            ) : (
              <>
                <strong>Resumo:</strong> {cluster.groupCount} arquivos se repetem entre as pastas. Existem <strong>{plural(cluster.uniqueFiles, 'arquivo único', 'arquivos únicos')}</strong>{' '}
                ({folders.map((f, i) => `${f.uniqueCount} na ${ordinal(i)}`).join(', ')}) que <strong>nunca</strong> serão tocados.
              </>
            )}
          </div>
          <fieldset className="reconcile-choice">
            <legend><strong>{two ? (plan ? `O que fazer com os ${plan.items.length} arquivos repetidos?` : 'O que fazer com os arquivos repetidos?') : 'Manter as cópias repetidas em qual pasta?'}</strong></legend>
            {folders.map((f, i) => (
              <label key={f.path}>
                <input type="radio" name="keep" checked={choice === f.path} onChange={() => setChoice(f.path)} />
                {' '}Manter em {f.path}{f.path === cluster.suggestedKeep ? ' (sugerida)' : ''}
                {two && ` e excluir da ${ordinal(1 - i)}`}
              </label>
            ))}
            <label>
              <input type="radio" name="keep" checked={choice === REVIEW} onChange={() => setChoice(REVIEW)} /> Revisar um por um
            </label>
            {plan && <p className="muted" role="status">{resultText(cluster, plan)}</p>}
            {!plan && !planError && choice !== REVIEW && <p className="muted" role="status">Calculando a prévia…</p>}
            {planError && <p className="alert" role="alert">{planError}</p>}
            {folders.filter((x) => x.uniqueCount > 0).map((x) => (
              <p key={x.path} className="muted">
                🔒 {x.uniqueCount === 1 ? 'O arquivo que só existe' : `Os ${x.uniqueCount} arquivos que só existem`} em <strong>{x.path}</strong> <strong>nunca</strong> {x.uniqueCount === 1 ? 'é tocado' : 'são tocados'}.
              </p>
            ))}
          </fieldset>
        </div>
        <div className="action-bar">
          <button type="button" className="button" onClick={onPrev}>← Voltar</button>
          <span className="reconcile-spacer" />
          <button type="button" className="button" onClick={onNext}>Pular</button>
          {choice === REVIEW ? (
            <button type="button" className="button primary" onClick={() => navigate(`/revisao/${scanId}`)}>Ir para a revisão um por um</button>
          ) : (
            <button type="button" ref={applyButton} className="button danger" disabled={!plan || plan.items.length === 0} onClick={() => setConfirming(true)}>
              Aplicar ({plural(n, 'arquivo', 'arquivos')} para a lixeira)
            </button>
          )}
        </div>
      </section>
      {confirming && plan && (
        <ReconcileConfirmDialog
          plan={plan}
          onCancel={cancel}
          onReload={() => { setConfirming(false); setTick((t) => t + 1); onReload(); }}
          onConfirm={async () => {
            const b = await apiFetch<BatchSummary>(`/api/scans/${scanId}/folder-clusters/apply`, {
              method: 'POST',
              body: { key: cluster.key, keepFolder: plan.keepFolder, items: plan.items },
            });
            onStarted(b);
          }}
        />
      )}
    </>
  );
}
