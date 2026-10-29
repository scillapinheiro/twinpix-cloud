import type { CloudItem, ScanSummary } from '@twinpix/shared';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, apiFetch } from '../lib/api';
import { formatBytes } from '../lib/format';

const STATUS_TEXT: Record<ScanSummary['status'], string> = {
  running: 'Analisando… (só lendo informações; nada é baixado)',
  paused: 'Análise pausada.',
  'waiting-network': 'Sem conexão. A análise continua sozinha quando a internet voltar.',
  'needs-auth': 'A conexão com o OneDrive expirou.',
  done: 'Análise concluída.',
  error: 'A análise parou por um erro.',
};

export function ScanProgress() {
  const { id } = useParams();
  const [scan, setScan] = useState<ScanSummary | null>(null);
  const [unanalyzed, setUnanalyzed] = useState<CloudItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const s = await apiFetch<ScanSummary>(`/api/scans/${id}`);
        setScan(s);
        if (s.status === 'running' || s.status === 'waiting-network') timer = setTimeout(load, 2000);
      } catch (e) {
        setError((e as ApiError).message);
      }
    };
    void load();
    return () => clearTimeout(timer);
  }, [id]);

  async function act(action: 'pause' | 'resume') {
    setScan(await apiFetch<ScanSummary>(`/api/scans/${id}/${action}`, { method: 'POST' }));
    if (action === 'resume') setTimeout(() => window.location.reload(), 300);
  }

  if (error) return <p className="alert">{error}</p>;
  if (!scan) return <p>Carregando…</p>;
  const pct = scan.foldersTotal ? Math.round((scan.foldersDone / scan.foldersTotal) * 100) : 0;

  return (
    <section className="card">
      <h1>Análise</h1>
      <p>Pastas: {scan.roots.map((r) => r.path).join(', ')}</p>
      <p className={scan.status === 'error' || scan.status === 'needs-auth' ? 'alert' : undefined}>
        {STATUS_TEXT[scan.status]} {scan.error && scan.status === 'error' ? `(${scan.error})` : ''}
      </p>
      <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Progresso da análise">
        <div style={{ width: `${pct}%` }} />
      </div>
      <ul>
        <li>Pastas analisadas: {scan.foldersDone} de {scan.foldersTotal}</li>
        <li>Fotos e vídeos encontrados: {scan.filesFound}</li>
        <li>Grupos de cópias idênticas: {scan.groupsTotal} ({scan.groupsPending} para revisar, {scan.groupsSkipped} pulados)</li>
        <li>Espaço liberado: {formatBytes(scan.bytesFreed)}</li>
        <li>
          Não analisados (o OneDrive não informou a impressão digital do arquivo): {scan.unanalyzedCount}
          {scan.unanalyzedCount > 0 && unanalyzed === null && (
            <button type="button" className="link" onClick={async () => setUnanalyzed(await apiFetch<CloudItem[]>(`/api/scans/${id}/unanalyzed`))}>
              ver lista
            </button>
          )}
        </li>
      </ul>
      {unanalyzed && (
        <ul className="muted">
          {unanalyzed.map((f) => <li key={f.id}>{f.folderPath}/{f.name}</li>)}
        </ul>
      )}
      <div className="row">
        {scan.status === 'running' && <button type="button" className="button" onClick={() => act('pause')}>Pausar</button>}
        {(scan.status === 'paused' || scan.status === 'error' || scan.status === 'needs-auth') && (
          <button type="button" className="button" onClick={() => act('resume')}>Continuar análise</button>
        )}
        {scan.status === 'needs-auth' && <a className="button primary" href="/api/auth/login">Conectar de novo</a>}
        {scan.groupsPending > 0 && (
          <Link className="button primary" to={`/revisao/${scan.id}`}>
            {scan.status === 'done' ? 'Começar a revisão' : 'Começar a revisão enquanto a análise continua'}
          </Link>
        )}
        {scan.status === 'done' && scan.groupsPending > 0 && (
          <Link className="button" to={`/lote/${scan.id}`}>Revisar em lote</Link>
        )}
      </div>
    </section>
  );
}
