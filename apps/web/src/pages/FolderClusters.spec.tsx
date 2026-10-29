import type { BatchSummary, CloudItem, FolderCluster, ReconcilePlan } from '@twinpix/shared';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi } from 'vitest';
import { FolderClusters } from './FolderClusters';
import { ScanProgress } from './ScanProgress';

const item = (id: string, folderPath: string, name = `${id}.jpg`) => ({ id, name, folderPath, size: 100 } as CloudItem);
const stat = (path: string, o: Partial<FolderCluster['folders'][0]> = {}) => ({
  path, fileCount: 10, bytes: 2_000_000, uniqueCount: 0, situation: 'partial' as const, containedIn: null, commonWithComplete: 5, ...o,
});
const two: FolderCluster = {
  key: '["/A","/B"]', suggestedKeep: '/A', repeatedFiles: 20, uniqueFiles: 2, groupCount: 8,
  folders: [stat('/A', { fileCount: 10, uniqueCount: 2, situation: 'complete' }), stat('/B', { fileCount: 8, situation: 'contained', containedIn: '/A' })],
};
const three: FolderCluster = {
  key: '["/X","/Y","/Z"]', suggestedKeep: '/X', repeatedFiles: 30, uniqueFiles: 5, groupCount: 12,
  folders: [stat('/X', { uniqueCount: 3, situation: 'complete' }), stat('/Y', { situation: 'contained', containedIn: '/X' }), stat('/Z', { uniqueCount: 2, commonWithComplete: 9 })],
};
const planFor = (keep: string): ReconcilePlan => keep === '/A'
  ? { clusterKey: two.key, keepFolder: '/A', items: [{ groupId: 1, keepId: 'a1', deleteIds: ['b1'] }], deleteFiles: [item('b1', '/B'), item('b2', '/B')], keepFiles: [item('a1', '/A')], bytes: 2_000_000, remaining: [{ path: '/A', fileCount: 10 }, { path: '/B', fileCount: 0 }] }
  : { clusterKey: two.key, keepFolder: '/B', items: [{ groupId: 2, keepId: 'b1', deleteIds: ['a1'] }], deleteFiles: [item('a1', '/A')], keepFiles: [item('b1', '/B')], bytes: 100, remaining: [{ path: '/A', fileCount: 2 }, { path: '/B', fileCount: 8 }] };
const summary: BatchSummary = { id: 7, kind: 'folders', scanId: 1, status: 'running', createdAt: '', totalGroups: 1, doneGroups: 0, skippedGroups: 0, movedFiles: 0, movedBytes: 0, failedFiles: 0, restoredFiles: 0, notRestoredFiles: 0, error: null };

let clusters: FolderCluster[];
let calls: Array<{ url: string; method: string; body?: string }>;
let batchGet: BatchSummary;
let batchList: BatchSummary[];
beforeEach(() => {
  calls = [];
  batchList = [];
  clusters = [two];
  batchGet = summary;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body as string | undefined });
    if (url === '/api/scans/1/folder-clusters') return new Response(JSON.stringify(clusters));
    if (url.startsWith('/api/scans/1/folder-clusters/unique')) return new Response(JSON.stringify([item('u1', '/A', 'unica.jpg')]));
    if (url.startsWith('/api/scans/1/folder-clusters/plan')) return new Response(JSON.stringify(planFor(new URL(url, 'http://x').searchParams.get('keep')!)));
    if (url === '/api/scans/1/folder-clusters/apply') return new Response(JSON.stringify(summary));
    if (url === '/api/batches') return new Response(JSON.stringify(batchList));
    if (url === '/api/batches/7') return new Response(JSON.stringify(batchGet));
    if (url === '/api/scans/1') return new Response(JSON.stringify({ id: 1, status: 'done', groupsPending: 0, roots: [], foldersDone: 1, foldersTotal: 1, filesFound: 1, groupsTotal: 1, groupsSkipped: 0, bytesFreed: 0, unanalyzedCount: 0, error: null }));
    return new Response('{}', { status: 404 });
  }));
});

function renderPage() {
  render(
    <MemoryRouter initialEntries={['/pastas-repetidas/1']}>
      <Routes>
        <Route path="/pastas-repetidas/:scanId" element={<FolderClusters />} />
        <Route path="/revisao/:scanId" element={<p>Tela de revisão</p>} />
        <Route path="/varredura/:id" element={<p>Tela da análise</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

it('duas pastas: cartões, quadro-resumo, lista dos únicos e prévia', async () => {
  renderPage();
  expect(await screen.findByRole('heading', { name: 'Pastas repetidas · 1 de 1' })).toBeInTheDocument();
  expect(screen.getByText('★ Sugerida para manter')).toBeInTheDocument();
  expect(screen.getByText(/8 arquivos estão nas duas · 2 só na primeira · 0 só na segunda/)).toBeInTheDocument();
  expect(screen.getByText(/a segunda pasta está toda contida na primeira/)).toBeInTheDocument();
  expect(await screen.findByText('Resultado: a segunda pasta fica vazia.')).toBeInTheDocument();
  expect(screen.getByText('O que fazer com os arquivos repetidos?')).toBeInTheDocument();
  expect(screen.getByText(/Os 2 arquivos que só existem em/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Aplicar (2 arquivos para a lixeira)' })).toBeEnabled();
  await userEvent.click(screen.getByRole('button', { name: 'ver lista' }));
  expect(await screen.findByText('/A/unica.jpg')).toBeInTheDocument();
  expect(screen.queryByRole('table')).toBeNull();
});

it('três pastas: tabela com situação', async () => {
  clusters = [three];
  renderPage();
  expect(await screen.findByRole('table')).toBeInTheDocument();
  expect(screen.getByText('Mais completa')).toBeInTheDocument();
  expect(screen.getByText('Toda contida na /X')).toBeInTheDocument();
  expect(screen.getByText('Parcial: 9 em comum com a mais completa')).toBeInTheDocument();
});

it('trocar a pasta recarrega o plano e o texto do resultado', async () => {
  renderPage();
  await screen.findByText('Resultado: a segunda pasta fica vazia.');
  await userEvent.click(screen.getByRole('radio', { name: /Manter em \/B/ }));
  expect(await screen.findByText('Resultado: a primeira fica só com os seus 2 arquivos únicos.')).toBeInTheDocument();
  expect(calls.some((c) => c.url.includes('plan?key=') && c.url.includes('keep=%2FB'))).toBe(true);
  expect(screen.getByRole('button', { name: 'Aplicar (1 arquivo para a lixeira)' })).toBeEnabled();
});

it('Aplicar fica desligado enquanto o plano carrega', async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const base = globalThis.fetch as unknown as (u: string, i?: RequestInit) => Promise<Response>;
  vi.stubGlobal('fetch', vi.fn(async (u: string, i?: RequestInit) => { if (u.includes('plan?')) await gate; return base(u, i); }));
  renderPage();
  const btn = await screen.findByRole('button', { name: /Aplicar/ });
  expect(btn).toBeDisabled();
  release();
  await waitFor(() => expect(screen.getByRole('button', { name: /Aplicar/ })).toBeEnabled());
});

it('"Revisar um por um" leva à revisão', async () => {
  renderPage();
  await screen.findByText('Resultado: a segunda pasta fica vazia.');
  await userEvent.click(screen.getByRole('radio', { name: 'Revisar um por um' }));
  await userEvent.click(screen.getByRole('button', { name: 'Ir para a revisão um por um' }));
  expect(await screen.findByText('Tela de revisão')).toBeInTheDocument();
});

it('modal confirma e envia os items do plano mostrado, uma vez só com clique duplo', async () => {
  renderPage();
  await screen.findByText('Resultado: a segunda pasta fica vazia.');
  await userEvent.click(screen.getByRole('button', { name: /Aplicar/ }));
  const dialog = await screen.findByRole('dialog');
  expect(dialog).toHaveTextContent('Nada é apagado de vez');
  expect(screen.getByRole('list', { name: 'Arquivos que saem' })).toHaveTextContent('/B/b1.jpg');
  expect(screen.getByRole('heading', { name: 'Cópia que fica de cada arquivo repetido (1)' })).toBeInTheDocument();
  expect(screen.getByRole('list', { name: 'Cópias que ficam' })).toHaveTextContent('/A/a1.jpg');
  expect(dialog).toHaveTextContent('Também continuam onde estão: 2 arquivos que só existem numa pasta e 7 cópias extras na pasta escolhida.');
  expect(screen.getByRole('list', { name: 'Pastas depois da limpeza' })).toHaveTextContent('/B: fica vazia');
  await userEvent.dblClick(screen.getByRole('button', { name: 'Mover para a lixeira' }));
  expect(await screen.findByText('Lote de pastas repetidas')).toBeInTheDocument();
  const posts = calls.filter((c) => c.method === 'POST' && c.url.endsWith('/apply'));
  expect(posts).toHaveLength(1);
  expect(JSON.parse(posts[0].body!)).toEqual({ key: two.key, keepFolder: '/A', items: planFor('/A').items });
});

it('erro do servidor aparece no modal e permite tentar de novo', async () => {
  const base = globalThis.fetch as unknown as (u: string, i?: RequestInit) => Promise<Response>;
  let first = true;
  vi.stubGlobal('fetch', vi.fn(async (u: string, i?: RequestInit) => {
    if (u.endsWith('/apply') && first) { first = false; return new Response(JSON.stringify({ message: 'A prévia mudou. Abra as pastas repetidas de novo.' }), { status: 400 }); }
    return base(u, i);
  }));
  renderPage();
  await screen.findByText('Resultado: a segunda pasta fica vazia.');
  await userEvent.click(screen.getByRole('button', { name: /Aplicar/ }));
  await userEvent.click(await screen.findByRole('button', { name: 'Mover para a lixeira' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('A prévia mudou');
  expect(screen.queryByRole('button', { name: 'Tentar de novo' })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Recarregar' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(await screen.findByRole('button', { name: /Aplicar/ })).toBeEnabled();
});

it('erro genérico no modal permite tentar de novo', async () => {
  const base = globalThis.fetch as unknown as (u: string, i?: RequestInit) => Promise<Response>;
  let first = true;
  vi.stubGlobal('fetch', vi.fn(async (u: string, i?: RequestInit) => {
    if (u.endsWith('/apply') && first) { first = false; return new Response(JSON.stringify({ message: 'Sem conexão.' }), { status: 400 }); }
    return base(u, i);
  }));
  renderPage();
  await screen.findByText('Resultado: a segunda pasta fica vazia.');
  await userEvent.click(screen.getByRole('button', { name: /Aplicar/ }));
  await userEvent.click(await screen.findByRole('button', { name: 'Mover para a lixeira' }));
  expect(await screen.findByRole('button', { name: 'Tentar de novo' })).toBeEnabled();
});

it('duas trocas rápidas com respostas fora de ordem: vale o último plano', async () => {
  clusters = [{ ...two, folders: [...two.folders, stat('/C', { fileCount: 3 })] }];
  const base = globalThis.fetch as unknown as (u: string, i?: RequestInit) => Promise<Response>;
  let releaseB!: () => void;
  const gateB = new Promise<void>((r) => { releaseB = r; });
  vi.stubGlobal('fetch', vi.fn(async (u: string, i?: RequestInit) => {
    if (u.includes('plan?') && u.includes('keep=%2FB')) { await gateB; return new Response(JSON.stringify(planFor('/B'))); }
    if (u.includes('plan?') && u.includes('keep=%2FC')) return new Response(JSON.stringify({ ...planFor('/B'), keepFolder: '/C', items: [{ groupId: 3, keepId: 'c1', deleteIds: ['a1'] }] }));
    return base(u, i);
  }));
  renderPage();
  await screen.findByText(/^Resultado:/);
  await userEvent.click(screen.getByRole('radio', { name: /Manter em \/B/ }));
  await userEvent.click(screen.getByRole('radio', { name: /Manter em \/C/ }));
  await waitFor(() => expect(screen.getByRole('button', { name: /Aplicar/ })).toBeEnabled());
  releaseB();
  await new Promise((r) => setTimeout(r, 30));
  await userEvent.click(screen.getByRole('button', { name: /Aplicar/ }));
  await userEvent.click(await screen.findByRole('button', { name: 'Mover para a lixeira' }));
  await screen.findByText('Lote de pastas repetidas');
  const post = calls.find((c) => c.url.endsWith('/apply'))!;
  expect(JSON.parse(post.body!)).toMatchObject({ keepFolder: '/C', items: [{ groupId: 3, keepId: 'c1', deleteIds: ['a1'] }] });
});

it('Pular e Voltar navegam entre conjuntos', async () => {
  clusters = [two, three];
  renderPage();
  expect(await screen.findByRole('heading', { name: 'Pastas repetidas · 1 de 2' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Pular' }));
  expect(await screen.findByRole('heading', { name: 'Pastas repetidas · 2 de 2' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '← Voltar' }));
  expect(await screen.findByRole('heading', { name: 'Pastas repetidas · 1 de 2' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '← Voltar' }));
  expect(await screen.findByText('Tela da análise')).toBeInTheDocument();
});

it('ao recarregar, volta para o lote de pastas aberto desta análise', async () => {
  batchList = [{ ...summary, id: 5, status: 'done' }, { ...summary, status: 'paused' }];
  batchGet = { ...summary, status: 'paused' };
  renderPage();
  expect(await screen.findByRole('heading', { name: 'Lote de pastas repetidas' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Continuar' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Aplicar/ })).toBeNull();
});

it('lote aberto de outro tipo também aparece, com o título dele', async () => {
  batchList = [{ ...summary, id: 7, kind: 'lines', status: 'needs-auth' }];
  batchGet = { ...summary, kind: 'lines', status: 'needs-auth' };
  renderPage();
  expect(await screen.findByRole('heading', { name: 'Lote das idênticas' })).toBeInTheDocument();
  expect(screen.getByText('Termine ou desfaça este lote antes de começar outro.')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Conectar de novo' })).toBeInTheDocument();
});

it('apply recusado por outro lote aberto: Recarregar leva até esse lote', async () => {
  const base = globalThis.fetch as unknown as (u: string, i?: RequestInit) => Promise<Response>;
  vi.stubGlobal('fetch', vi.fn(async (u: string, i?: RequestInit) => {
    if (u.endsWith('/apply')) {
      batchList = [{ ...summary, kind: 'lines', status: 'paused' }];
      return new Response(JSON.stringify({ message: 'Já existe um lote pausado ou em andamento. Termine ou desfaça esse lote primeiro.' }), { status: 400 });
    }
    return base(u, i);
  }));
  batchGet = { ...summary, kind: 'lines', status: 'paused' };
  renderPage();
  await screen.findByText('Resultado: a segunda pasta fica vazia.');
  await userEvent.click(screen.getByRole('button', { name: /Aplicar/ }));
  await userEvent.click(await screen.findByRole('button', { name: 'Mover para a lixeira' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Já existe um lote pausado ou em andamento.');
  await userEvent.click(screen.getByRole('button', { name: 'Recarregar' }));
  expect(await screen.findByRole('heading', { name: 'Lote das idênticas' })).toBeInTheDocument();
});

it('lote terminado não prende a página', async () => {
  batchList = [{ ...summary, status: 'undone' }];
  renderPage();
  expect(await screen.findByRole('heading', { name: 'Pastas repetidas · 1 de 1' })).toBeInTheDocument();
});

describe('entrada em ScanProgress', () => {
  const renderScan = () => render(<MemoryRouter initialEntries={['/varredura/1']}><Routes><Route path="/varredura/:id" element={<ScanProgress />} /></Routes></MemoryRouter>);
  it('aparece só com análise concluída e conjuntos', async () => {
    renderScan();
    expect(await screen.findByRole('link', { name: 'Pastas repetidas (1)' })).toHaveAttribute('href', '/pastas-repetidas/1');
  });
  it('não aparece sem conjuntos nem com análise em andamento', async () => {
    clusters = [];
    renderScan();
    await screen.findByText('Análise concluída.');
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('folder-clusters'))).toBe(true));
    expect(screen.queryByRole('link', { name: /Pastas repetidas/ })).toBeNull();
  });
  it('não aparece com análise em andamento', async () => {
    const base = globalThis.fetch as unknown as (u: string, i?: RequestInit) => Promise<Response>;
    vi.stubGlobal('fetch', vi.fn(async (u: string, i?: RequestInit) => (u === '/api/scans/1'
      ? new Response(JSON.stringify({ id: 1, status: 'paused', groupsPending: 0, roots: [], foldersDone: 0, foldersTotal: 1, filesFound: 0, groupsTotal: 0, groupsSkipped: 0, bytesFreed: 0, unanalyzedCount: 0, error: null }))
      : base(u, i))));
    renderScan();
    await screen.findByText('Análise pausada.');
    expect(screen.queryByRole('link', { name: /Pastas repetidas/ })).toBeNull();
    expect(calls.some((c) => c.url.endsWith('folder-clusters'))).toBe(false);
  });
});
