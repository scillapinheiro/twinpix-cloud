import type { BatchPreview, BatchSummary } from '@twinpix/shared';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi } from 'vitest';
import { Batch } from './Batch';
import { ScanProgress } from './ScanProgress';

const preview: BatchPreview = {
  scanId: 1, tiesCount: 3, pendingCount: 12,
  lines: [
    {
      key: 'A|B', keepFolder: '/Viagem Praia', removeFolders: ['/Backup celular 2015'], reasons: ['regra: nome sem sufixo de cópia'],
      groupCount: 140, fileCount: 140, bytes: 1_200_000_000,
      items: [{ groupId: 1, keep: { name: 'foto.jpg', folderPath: '/Viagem Praia' }, remove: [{ id: 'r1', name: 'foto.jpg', folderPath: '/Backup celular 2015', size: 10 }] }],
    },
    {
      key: 'C|D', keepFolder: '/Casa', removeFolders: ['/Antigas'], reasons: ['regra: mais antiga'],
      groupCount: 5, fileCount: 7, bytes: 5_000_000, items: [],
    },
  ],
};
const summary = (over: Partial<BatchSummary> = {}): BatchSummary => ({
  id: 9, scanId: 1, status: 'running', createdAt: '', totalGroups: 145, doneGroups: 20, skippedGroups: 0,
  movedFiles: 25, movedBytes: 300_000_000, failedFiles: 0, restoredFiles: 0, notRestoredFiles: 0, error: null, ...over,
});

let calls: Array<{ url: string; method: string; body?: string }>;
let batchGet: BatchSummary;
function mockApi() {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body as string | undefined });
    if (url === '/api/batches') return new Response('[]');
    if (url === '/api/scans/1/batch' && init?.method === 'GET') return new Response(JSON.stringify(preview));
    if (url === '/api/scans/1/batch') return new Response(JSON.stringify(summary()));
    if (url === '/api/batches/9') return new Response(JSON.stringify(batchGet));
    if (url === '/api/batches/9/undo') return new Response(JSON.stringify(summary({ status: 'undoing' })));
    if (url === '/api/scans/1') return new Response(JSON.stringify({ id: 1, status: 'done', groupsPending: 12, roots: [], foldersDone: 1, foldersTotal: 1, filesFound: 1, groupsTotal: 1, groupsSkipped: 0, bytesFreed: 0, unanalyzedCount: 0, error: null }));
    return new Response('{}', { status: 404 });
  }));
}
beforeEach(mockApi);

function renderBatch() {
  render(
    <MemoryRouter initialEntries={['/lote/1']}>
      <Routes><Route path="/lote/:scanId" element={<Batch />} /></Routes>
    </MemoryRouter>,
  );
}

it('mostra as linhas marcadas e o aviso de empate', async () => {
  renderBatch();
  expect(await screen.findByText('140 grupos')).toBeInTheDocument();
  expect(screen.getByText(/3 grupos sem regra clara ficam para a revisão um por um/)).toBeInTheDocument();
  expect(screen.getAllByRole('checkbox').every((c) => (c as HTMLInputElement).checked)).toBe(true);
  expect(screen.getByRole('button', { name: 'Mover para a lixeira (147 arquivos)' })).toBeEnabled();
});

it('desmarcar uma linha atualiza o total e desabilita com zero', async () => {
  renderBatch();
  await screen.findByText('140 grupos');
  const [first, second] = screen.getAllByRole('checkbox');
  await userEvent.click(first);
  expect(screen.getByRole('button', { name: 'Mover para a lixeira (7 arquivos)' })).toBeEnabled();
  await userEvent.click(second);
  expect(screen.getByRole('button', { name: 'Mover para a lixeira (0 arquivos)' })).toBeDisabled();
});

it('ver lista mostra os caminhos', async () => {
  renderBatch();
  await screen.findByText('140 grupos');
  await userEvent.click(screen.getAllByRole('button', { name: 'ver lista' })[0]);
  expect(screen.getByText(/fica: \/Viagem Praia\/foto\.jpg/)).toBeInTheDocument();
  expect(screen.getByText(/sai: \/Backup celular 2015\/foto\.jpg/)).toBeInTheDocument();
});

it('o modal confirma e envia as lineKeys marcadas uma vez só, mesmo com clique duplo', async () => {
  batchGet = summary({ status: 'running' });
  renderBatch();
  await screen.findByText('140 grupos');
  await userEvent.click(screen.getAllByRole('checkbox')[1]);
  await userEvent.click(screen.getByRole('button', { name: /Mover para a lixeira \(140/ }));
  const dialog = screen.getByRole('dialog');
  expect(dialog).toHaveAttribute('aria-modal', 'true');
  expect(dialog).toHaveTextContent('140 arquivos de 140 grupos vão para a lixeira do OneDrive');
  const go = screen.getByRole('button', { name: 'Mover para a lixeira' });
  await userEvent.dblClick(go);
  await waitFor(() => expect(screen.getByRole('progressbar')).toBeInTheDocument());
  const posts = calls.filter((c) => c.method === 'POST');
  expect(posts).toHaveLength(1);
  expect(JSON.parse(posts[0].body!)).toEqual({ lineKeys: ['A|B'] });
});

it('mostra erro no modal e deixa tentar de novo', async () => {
  renderBatch();
  await screen.findByText('140 grupos');
  const f = fetch as ReturnType<typeof vi.fn>;
  const orig = f.getMockImplementation()!;
  f.mockImplementation(async (url: string, init?: RequestInit) =>
    url === '/api/scans/1/batch' && init?.method === 'POST' ? new Response(JSON.stringify({ message: 'A prévia mudou.' }), { status: 400 }) : orig(url, init));
  await userEvent.click(screen.getByRole('button', { name: /Mover para a lixeira \(147/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Mover para a lixeira' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('A prévia mudou.');
  expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeEnabled();
});

it('progresso mostra o status, e o resumo final com desfazer em dois cliques', async () => {
  batchGet = summary({ status: 'done', doneGroups: 145, skippedGroups: 2, movedFiles: 147, failedFiles: 1 });
  renderBatch();
  await screen.findByText('140 grupos');
  await userEvent.click(screen.getByRole('button', { name: /Mover para a lixeira \(147/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Mover para a lixeira' }));
  expect(await screen.findByText(/Lote concluído/, undefined, { timeout: 3000 })).toBeInTheDocument();
  expect(screen.getByText(/Pulados: 2 grupos \(voltam para a revisão um por um\)/)).toBeInTheDocument();
  expect(screen.getByText(/Falhas: 1 arquivo não foi movido/)).toBeInTheDocument();
  expect(await screen.findByRole('link', { name: 'Revisão um por um' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Ver histórico' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Desfazer este lote' }));
  expect(calls.some((c) => c.url.endsWith('/undo'))).toBe(false);
  await userEvent.click(screen.getByRole('button', { name: 'Confirmar desfazer' }));
  await waitFor(() => expect(calls.some((c) => c.url === '/api/batches/9/undo' && c.method === 'POST')).toBe(true));
});

it('retoma o progresso de um lote em andamento ao recarregar', async () => {
  const f = fetch as ReturnType<typeof vi.fn>;
  const orig = f.getMockImplementation()!;
  f.mockImplementation(async (url: string, init?: RequestInit) =>
    url === '/api/batches' ? new Response(JSON.stringify([summary({ status: 'waiting-network' })])) : orig(url, init));
  renderBatch();
  expect(await screen.findByText(/Sem conexão\. Continua sozinho quando a internet voltar\./)).toBeInTheDocument();
});

describe('ScanProgress', () => {
  const scan = (status: string, groupsPending: number) => vi.stubGlobal('fetch', vi.fn(async () =>
    new Response(JSON.stringify({ id: 1, status, groupsPending, roots: [], foldersDone: 1, foldersTotal: 1, filesFound: 1, groupsTotal: 2, groupsSkipped: 0, bytesFreed: 0, unanalyzedCount: 0, error: null }))));
  const renderScan = () => render(<MemoryRouter initialEntries={['/varredura/1']}><Routes><Route path="/varredura/:id" element={<ScanProgress />} /></Routes></MemoryRouter>);

  it('mostra "Revisar em lote" só com análise concluída e pendentes', async () => {
    scan('done', 2);
    renderScan();
    expect(await screen.findByRole('link', { name: 'Revisar em lote' })).toHaveAttribute('href', '/lote/1');
  });
  it('não mostra com a análise em andamento ou sem pendentes', async () => {
    scan('paused', 2);
    const { unmount } = renderScan();
    await screen.findByText(/Análise pausada/);
    expect(screen.queryByRole('link', { name: 'Revisar em lote' })).toBeNull();
    unmount();
    scan('done', 0);
    renderScan();
    await screen.findByText(/Análise concluída/);
    expect(screen.queryByRole('link', { name: 'Revisar em lote' })).toBeNull();
  });
});
