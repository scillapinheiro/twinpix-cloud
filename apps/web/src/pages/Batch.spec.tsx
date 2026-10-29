import type { BatchPreview, BatchSummary, CloudItem } from '@twinpix/shared';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi } from 'vitest';
import { Batch } from './Batch';
import { ScanProgress } from './ScanProgress';

const cloudItem = (o: Partial<CloudItem>): CloudItem => ({
  id: 'x', name: 'x.jpg', folderPath: '/', size: 10, quickXorHash: 'h', mimeType: 'image/jpeg', kind: 'photo',
  takenAt: '2015-01-01T10:00:00Z', createdAt: '2015-01-01T10:00:00Z', modifiedAt: '2015-01-01T10:00:00Z',
  width: 1, height: 1, cameraMake: null, cameraModel: null, durationMs: null, webUrl: 'https://od/x', ...o,
} as CloudItem);

const preview: BatchPreview = {
  scanId: 1, tiesCount: 3, pendingCount: 12,
  lines: [
    {
      key: 'A|B', keepFolder: '/Viagem Praia', removeFolders: ['/Backup celular 2015'], keepOptions: ['/Viagem Praia', '/Backup celular 2015'], reasons: ['regra: nome sem sufixo de cópia'],
      groupCount: 140, fileCount: 140, bytes: 1_200_000_000,
      items: [{
        groupId: 1,
        keep: cloudItem({ id: 'k1', name: 'foto.jpg', folderPath: '/Viagem Praia', modifiedAt: '2015-01-01T10:00:00Z', webUrl: 'https://od/k1' }),
        remove: [cloudItem({ id: 'r1', name: 'IMG_1.jpg', folderPath: '/Backup celular 2015', modifiedAt: '2016-02-02T10:00:00Z', webUrl: 'https://od/r1' })],
        keepByFolder: { '/Viagem Praia': 'k1', '/Backup celular 2015': 'r1' },
      }],
    },
    {
      key: 'C|D', keepFolder: '/Casa', removeFolders: ['/Antigas'], keepOptions: ['/Casa', '/Antigas'], reasons: ['regra: mais antiga'],
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
  expect(screen.getByText(/★ fica/)).toBeInTheDocument();
  expect(screen.getByText(/\/Viagem Praia\/foto\.jpg/)).toBeInTheDocument();
  expect(screen.getByText(/\/Backup celular 2015\/IMG_1\.jpg/)).toBeInTheDocument();
  expect(screen.getAllByRole('link', { name: 'Abrir no OneDrive ↗' }).map((a) => a.getAttribute('href'))).toEqual(['https://od/k1', 'https://od/r1']);
  expect(screen.getAllByLabelText(/Carregando miniatura|Miniatura indisponível/)).toHaveLength(2);
  expect(screen.getByText(/mesmo byte a byte/)).toBeInTheDocument();
  expect(document.querySelectorAll('.batch-file-meta .diff').length).toBe(2);
});

it('lista longa mostra 20 e "mostrar mais" revela o resto', async () => {
  const base = preview.lines[0].items[0];
  const many = Array.from({ length: 25 }, (_, i) => ({ ...base, groupId: i + 1 }));
  const f = fetch as ReturnType<typeof vi.fn>;
  const orig = f.getMockImplementation()!;
  f.mockImplementation(async (url: string, init?: RequestInit) =>
    url === '/api/scans/1/batch' && init?.method === 'GET'
      ? new Response(JSON.stringify({ ...preview, lines: [{ ...preview.lines[0], items: many }] }))
      : orig(url, init));
  renderBatch();
  await screen.findByText('140 grupos');
  await userEvent.click(screen.getByRole('button', { name: 'ver lista' }));
  expect(document.querySelectorAll('.batch-item')).toHaveLength(20);
  await userEvent.click(screen.getByRole('button', { name: /mostrar mais/ }));
  expect(document.querySelectorAll('.batch-item')).toHaveLength(25);
  expect(screen.queryByRole('button', { name: /mostrar mais/ })).toBeNull();
});

it('inverter troca o texto e o ver lista, e o POST leva keepFolders', async () => {
  batchGet = summary();
  renderBatch();
  await screen.findByText('140 grupos');
  await userEvent.click(screen.getAllByRole('button', { name: 'ver lista' })[0]);
  await userEvent.click(screen.getByRole('button', { name: '⇄ Inverter: manter em /Backup celular 2015' }));
  expect(screen.getByText(/escolhido por você/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '⇄ Voltar à sugestão: manter em /Viagem Praia' })).toBeInTheDocument();
  expect(screen.getByText(/★ fica/).closest('.batch-file')).toHaveTextContent('IMG_1.jpg');
  await userEvent.click(screen.getByRole('button', { name: /Mover para a lixeira \(/ }));
  expect(screen.getByRole('dialog')).toHaveTextContent('fica em /Backup celular 2015');
  await userEvent.click(screen.getByRole('button', { name: 'Mover para a lixeira' }));
  await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
  expect(JSON.parse(calls.find((c) => c.method === 'POST')!.body!)).toEqual({ lineKeys: ['A|B', 'C|D'], keepFolders: { 'A|B': '/Backup celular 2015' } });
});

it('Marcar todas / Desmarcar todas', async () => {
  batchGet = summary();
  renderBatch();
  await screen.findByText('140 grupos');
  expect(screen.getByText('2 de 2 linhas marcadas')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Desmarcar todas' }));
  expect(screen.getByText('0 de 2 linhas marcadas')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Mover para a lixeira (0 arquivos)' })).toBeDisabled();
  await userEvent.click(screen.getAllByRole('checkbox')[1]);
  await userEvent.click(screen.getByRole('button', { name: /Mover para a lixeira \(/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Mover para a lixeira' }));
  await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
  expect(JSON.parse(calls.find((c) => c.method === 'POST')!.body!)).toEqual({ lineKeys: ['C|D'] });
});

it('Marcar todas remarca tudo e mantém a inversão', async () => {
  renderBatch();
  await screen.findByText('140 grupos');
  await userEvent.click(screen.getAllByRole('button', { name: /Inverter/ })[0]);
  await userEvent.click(screen.getByRole('button', { name: 'Desmarcar todas' }));
  await userEvent.click(screen.getByRole('button', { name: 'Marcar todas' }));
  expect(screen.getAllByRole('checkbox').every((c) => (c as HTMLInputElement).checked)).toBe(true);
  expect(screen.getByText(/escolhido por você/)).toBeInTheDocument();
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
  expect(screen.getByRole('link', { name: 'Ver histórico' })).toBeInTheDocument();
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

it('needs-auth mostra Conectar de novo e não Continuar; error não mostra texto cru; espera de rede tem Pausar', async () => {
  const f = fetch as ReturnType<typeof vi.fn>;
  const orig = f.getMockImplementation()!;
  let st: BatchSummary = summary({ status: 'needs-auth' });
  f.mockImplementation(async (url: string, init?: RequestInit) =>
    url === '/api/batches' ? new Response(JSON.stringify([st])) : orig(url, init));
  const { unmount } = render(<MemoryRouter initialEntries={['/lote/1']}><Routes><Route path="/lote/:scanId" element={<Batch />} /></Routes></MemoryRouter>);
  expect(await screen.findByRole('link', { name: 'Conectar de novo' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Continuar' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Já conectei, continuar' })).toBeInTheDocument();
  unmount();
  st = summary({ status: 'running' });
  batchGet = summary({ status: 'error', error: 'SQLITE_BOOM' });
  const r2 = render(<MemoryRouter initialEntries={['/lote/1']}><Routes><Route path="/lote/:scanId" element={<Batch />} /></Routes></MemoryRouter>);
  expect(await screen.findByText(/O lote parou por um erro\. Os arquivos já movidos/, undefined, { timeout: 3000 })).toBeInTheDocument();
  expect(screen.queryByText(/SQLITE_BOOM/)).toBeNull();
  r2.unmount();
  st = summary({ status: 'waiting-network' });
  renderBatch();
  expect(await screen.findByRole('button', { name: 'Pausar' })).toBeInTheDocument();
});

it('erro ao carregar mostra link para voltar à análise', async () => {
  const f = fetch as ReturnType<typeof vi.fn>;
  const orig = f.getMockImplementation()!;
  f.mockImplementation(async (url: string, init?: RequestInit) =>
    url === '/api/scans/1/batch' ? new Response(JSON.stringify({ message: 'Análise não encontrada.' }), { status: 404 }) : orig(url, init));
  renderBatch();
  expect(await screen.findByText('Análise não encontrada.')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Voltar à análise' })).toBeInTheDocument();
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

it('mais de uma pasta de saída mostra o seletor "Manter em:" e o POST leva a escolha', async () => {
  const base = preview.lines[0];
  const line = {
    ...base, removeFolders: ['/B', '/C'], keepOptions: ['/Viagem Praia', '/B', '/C'],
    items: [{ ...base.items[0], keepByFolder: { '/Viagem Praia': 'k1', '/B': 'r1', '/C': 'r2' } }],
  };
  const f = fetch as ReturnType<typeof vi.fn>;
  const orig = f.getMockImplementation()!;
  f.mockImplementation(async (url: string, init?: RequestInit) =>
    url === '/api/scans/1/batch' && init?.method === 'GET' ? new Response(JSON.stringify({ ...preview, lines: [line] })) : orig(url, init));
  renderBatch();
  await screen.findByText('140 grupos');
  expect(screen.queryByRole('button', { name: /Inverter/ })).toBeNull();
  await userEvent.selectOptions(screen.getByLabelText('Manter em:'), '/C');
  expect(screen.getByText(/escolhido por você/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /Mover para a lixeira \(/ }));
  expect(screen.getByRole('dialog')).toHaveTextContent('fica em /C');
  await userEvent.click(screen.getByRole('button', { name: 'Mover para a lixeira' }));
  await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
  expect(JSON.parse(calls.find((c) => c.method === 'POST')!.body!)).toEqual({ lineKeys: ['A|B'], keepFolders: { 'A|B': '/C' } });
});

it('não oferece inverter se a prévia não diz qual cópia ficaria na outra pasta', async () => {
  const base = preview.lines[0];
  const line = { ...base, items: [{ ...base.items[0], keepByFolder: { '/Viagem Praia': 'k1' } }] };
  const f = fetch as ReturnType<typeof vi.fn>;
  const orig = f.getMockImplementation()!;
  f.mockImplementation(async (url: string, init?: RequestInit) =>
    url === '/api/scans/1/batch' && init?.method === 'GET' ? new Response(JSON.stringify({ ...preview, lines: [line] })) : orig(url, init));
  renderBatch();
  await screen.findByText('140 grupos');
  expect(screen.queryByRole('button', { name: /Inverter/ })).toBeNull();
});

it('inverter e depois desmarcar a linha: o POST não leva keepFolders', async () => {
  renderBatch();
  await screen.findByText('140 grupos');
  await userEvent.click(screen.getAllByRole('button', { name: /Inverter/ })[0]);
  await userEvent.click(screen.getAllByRole('checkbox')[0]);
  await userEvent.click(screen.getByRole('button', { name: /Mover para a lixeira \(/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Mover para a lixeira' }));
  await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
  expect(JSON.parse(calls.find((c) => c.method === 'POST')!.body!)).toEqual({ lineKeys: ['C|D'] });
});
