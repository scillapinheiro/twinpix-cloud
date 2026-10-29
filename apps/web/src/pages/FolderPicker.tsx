import type { CloudFolder, NestedRoot, ScanSummary } from '@twinpix/shared';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError, apiFetch } from '../lib/api';

export function FolderPicker() {
  const navigate = useNavigate();
  const [trail, setTrail] = useState<CloudFolder[]>([]);
  const [children, setChildren] = useState<CloudFolder[]>([]);
  const [chosen, setChosen] = useState<CloudFolder[]>([]);
  const [nested, setNested] = useState<NestedRoot[]>([]);
  const [link, setLink] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const current = trail[trail.length - 1];

  useEffect(() => {
    apiFetch<CloudFolder>('/api/folders/root').then((root) => setTrail([root])).catch((e: ApiError) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!current) return;
    apiFetch<CloudFolder[]>(`/api/folders/${encodeURIComponent(current.id)}/children`)
      .then(setChildren)
      .catch((e: ApiError) => setError(e.message));
  }, [current]);

  useEffect(() => {
    if (chosen.length < 2) {
      setNested([]);
      return;
    }
    apiFetch<NestedRoot[]>('/api/folders/check-nesting', { method: 'POST', body: { paths: chosen.map((c) => c.path) } })
      .then(setNested)
      .catch(() => setNested([]));
  }, [chosen]);

  const isChosen = (f: CloudFolder) => chosen.some((c) => c.id === f.id);
  const toggle = (f: CloudFolder) => setChosen((list) => (isChosen(f) ? list.filter((c) => c.id !== f.id) : [...list, f]));

  async function addFromLink() {
    setError(null);
    try {
      const folder = await apiFetch<CloudFolder>('/api/folders/resolve-link', { method: 'POST', body: { url: link } });
      if (!isChosen(folder)) setChosen((list) => [...list, folder]);
      setLink('');
    } catch (e) {
      setError((e as ApiError).message);
    }
  }

  async function start() {
    setBusy(true);
    try {
      const scan = await apiFetch<ScanSummary>('/api/scans', { method: 'POST', body: { roots: chosen } });
      navigate(`/varredura/${scan.id}`);
    } catch (e) {
      setError((e as ApiError).message);
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h1>Escolha as pastas para analisar</h1>
      <p>A análise inclui todas as subpastas e compara os arquivos entre todas as pastas escolhidas.</p>
      {error && <p className="alert">{error}</p>}

      <nav className="breadcrumb" aria-label="Caminho">
        {trail.map((f, i) => (
          <button key={f.id} type="button" className="link" onClick={() => setTrail(trail.slice(0, i + 1))}>
            {i === 0 ? 'OneDrive' : f.name}
          </button>
        ))}
      </nav>

      <ul className="folder-list">
        {children.length === 0 && <li className="muted">Nenhuma subpasta aqui.</li>}
        {children.map((f) => (
          <li key={f.id}>
            <label>
              <input type="checkbox" checked={isChosen(f)} onChange={() => toggle(f)} aria-label={`Escolher a pasta ${f.name}`} />
              {f.name}
            </label>
            <button type="button" className="link" onClick={() => setTrail([...trail, f])} aria-label={`Abrir ${f.name}`}>
              abrir ›
            </button>
          </li>
        ))}
      </ul>

      <div className="link-input">
        <label htmlFor="folder-link">Ou cole o endereço de uma pasta do OneDrive (da barra do navegador ou do botão Compartilhar)</label>
        <div className="row">
          <input id="folder-link" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://onedrive.live.com/…" />
          <button type="button" className="button" onClick={addFromLink} disabled={!link.trim()}>Adicionar</button>
        </div>
      </div>

      <h2>Pastas escolhidas ({chosen.length})</h2>
      <ul className="chosen-list">
        {chosen.map((c) => (
          <li key={c.id}>
            {c.path}
            <button type="button" className="link" onClick={() => toggle(c)} aria-label={`Remover ${c.path}`}>remover</button>
          </li>
        ))}
      </ul>
      {nested.map((n) => (
        <p key={n.inner} className="notice">
          A pasta {n.inner} já está incluída em {n.outer}. Os arquivos dela não serão contados duas vezes.
        </p>
      ))}

      <button type="button" className="button primary" disabled={chosen.length === 0 || busy} onClick={start}>
        Iniciar análise ({chosen.length} {chosen.length === 1 ? 'pasta' : 'pastas'})
      </button>
    </section>
  );
}
