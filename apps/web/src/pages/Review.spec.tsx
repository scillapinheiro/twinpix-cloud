import type { GroupView, ScanSummary } from '@twinpix/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { vi } from 'vitest';
import { Review } from './Review';

const base = {
  quickXorHash: 'h', mimeType: 'image/jpeg', kind: 'photo' as const, takenAt: '2015-02-06T22:26:31Z',
  createdAt: '2015-02-06T22:26:31Z', width: 10, height: 10, cameraMake: 'Canon', cameraModel: 'A530',
  durationMs: null, webUrl: '', size: 1000, folderPath: '/A',
};
const group: GroupView = {
  id: 7, scanId: 1, kind: 'identical', status: 'pending', position: 12, total: 445,
  files: [
    { ...base, id: 'a', name: 'x.jpg', modifiedAt: '2015-02-07T10:00:00Z' },
    { ...base, id: 'b', name: 'x 1.jpg', modifiedAt: '2015-04-21T19:30:00Z' },
  ],
  suggestion: { keepId: 'a', reason: 'regra: nome sem sufixo de cópia', fallback: false },
  preMarkedIds: ['b'],
  bytesFreedSoFar: 2_100_000_000,
};

function Where() {
  const loc = useLocation();
  return <pre data-testid="where">{JSON.stringify({ path: loc.pathname, search: loc.search, state: loc.state })}</pre>;
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/thumbnail')) return new Response(JSON.stringify({ url: null }));
    return new Response(JSON.stringify(group));
  }));
});

function renderReview() {
  render(
    <MemoryRouter initialEntries={['/revisao/1']}>
      <Routes>
        <Route path="/revisao/:scanId" element={<Review />} />
        <Route path="/revisao/:scanId/grupo/:groupId" element={<Review />} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
}

it('mostra o cabeçalho do grupo, a legenda com o motivo e pré-marca a cópia', async () => {
  renderReview();
  expect(await screen.findByText(/Grupo 12 de 445/)).toBeInTheDocument();
  expect(screen.getByText(/Cópias idênticas/)).toBeInTheDocument();
  expect(screen.getByText(/2,1 GB liberados até agora/)).toBeInTheDocument();
  expect(screen.getByText(/escolhida pela regra: nome sem sufixo de cópia/)).toBeInTheDocument();
  expect(screen.getByText(/são diferentes entre as cópias/)).toBeInTheDocument();
  expect(screen.getAllByText('★ Sugerida para manter').length).toBeGreaterThan(0);
  const boxes = screen.getAllByRole('checkbox', { name: 'Excluir esta cópia' });
  expect(boxes[0]).not.toBeChecked();
  expect(boxes[1]).toBeChecked();
});

it.each([[2, '2'], [3, '3'], [4, 'many'], [5, 'many']])('com %i mídias as colunas usam data-count=%s', async (n, count) => {
  const files = Array.from({ length: n }, (_, i) => ({ ...base, id: `f${i}`, name: `x ${i}.jpg`, modifiedAt: '2015-02-07T10:00:00Z' }));
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/thumbnail')) return new Response(JSON.stringify({ url: null }));
    return new Response(JSON.stringify({ ...group, files, suggestion: { keepId: 'f0', reason: 'regra: x', fallback: false }, preMarkedIds: [] }));
  }));
  const { container } = render(
    <MemoryRouter initialEntries={['/revisao/1']}>
      <Routes><Route path="/revisao/:scanId" element={<Review />} /></Routes>
    </MemoryRouter>,
  );
  await screen.findByText(/Grupo 12 de 445/);
  expect(container.querySelector('.cards')).toHaveAttribute('data-count', count);
});

it('com 3 cópias o resumo "Igual em todas as cópias" vem depois dos cartões', async () => {
  const files = ['a', 'b', 'c'].map((id) => ({ ...base, id, name: `x ${id}.jpg`, modifiedAt: '2015-02-07T10:00:00Z' }));
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/thumbnail')) return new Response(JSON.stringify({ url: null }));
    return new Response(JSON.stringify({ ...group, files, suggestion: { keepId: 'a', reason: 'regra: x', fallback: false }, preMarkedIds: [] }));
  }));
  const { container } = render(
    <MemoryRouter initialEntries={['/revisao/1']}>
      <Routes><Route path="/revisao/:scanId" element={<Review />} /></Routes>
    </MemoryRouter>,
  );
  await screen.findByText(/Grupo 12 de 445/);
  const cards = container.querySelector('.cards')!;
  const summary = container.querySelector('.summary-common')!;
  expect(summary).toBeInTheDocument();
  expect(cards.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

describe('modal de confirmação', () => {
  const next: GroupView = { ...group, id: 8, position: 13, files: [
    { ...base, id: 'c', name: 'y.jpg', modifiedAt: '2015-02-07T10:00:00Z' },
    { ...base, id: 'd', name: 'y 1.jpg', modifiedAt: '2015-02-07T10:00:00Z' },
  ], suggestion: { keepId: 'c', reason: 'regra: x', fallback: false }, preMarkedIds: ['d'] };
  let applies: number;
  let current: GroupView;

  beforeEach(() => {
    applies = 0;
    current = group;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/thumbnail')) return new Response(JSON.stringify({ url: null }));
      if (url.endsWith('/preview')) {
        return new Response(JSON.stringify({ groupId: 7, deleteFiles: [group.files[1]], keepFiles: [group.files[0]], bytes: 1_000_000 }));
      }
      if (url.endsWith('/apply')) {
        applies += 1;
        await new Promise((r) => setTimeout(r, 20));
        current = next;
        return new Response(JSON.stringify({ groupId: 7, stale: false, results: [{ actionId: 1, fileId: 'b', fileName: 'x 1.jpg', status: 'done', error: null }] }));
      }
      return new Response(JSON.stringify(current));
    }));
  });

  async function openModal() {
    renderReview();
    await userEvent.click(await screen.findByRole('button', { name: 'Excluir marcadas (1)' }));
    return screen.findByRole('dialog');
  }

  it('abre com a prévia, confirma, mostra o resultado e "Próximo grupo" carrega o próximo sem sair da tela', async () => {
    const dialog = await openModal();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName('Confirmar');
    expect(await screen.findByText(/1 arquivo vai para a lixeira do OneDrive/)).toBeInTheDocument();
    expect(screen.getByText('/A/x.jpg')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Mover para a lixeira' }));
    expect(await screen.findByText('x 1.jpg: movido para a lixeira')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Próximo grupo' })).toHaveClass('button', 'primary');
    await userEvent.click(screen.getByRole('button', { name: 'Próximo grupo' }));
    expect(await screen.findByText(/Grupo 13 de 445/)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('where').textContent).toContain('/revisao/1/grupo/8');
    expect(screen.getByText(/Grupo 13 de 445/).closest('.group-header')).toHaveFocus();
  });

  it('o conteúdo atrás do modal fica inerte enquanto ele está aberto', async () => {
    await openModal();
    expect(document.querySelector('.review')).toHaveAttribute('inert');
    await userEvent.keyboard('{Escape}');
    expect(document.querySelector('.review')).not.toHaveAttribute('inert');
  });

  it('falha ao carregar o próximo grupo mostra erro inline com "Tentar de novo"', async () => {
    const ok = globalThis.fetch;
    let fail = true;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/groups/current') && current === next && fail) {
        fail = false;
        return new Response(JSON.stringify({ message: 'Sem conexão.' }), { status: 500 });
      }
      return (ok as typeof fetch)(url, init);
    }));
    await openModal();
    await userEvent.click(await screen.findByRole('button', { name: 'Mover para a lixeira' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Próximo grupo' }));
    expect(await screen.findByText('Sem conexão.')).toBeInTheDocument();
    expect(screen.getByText(/Grupo 12 de 445/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByText(/Grupo 13 de 445/)).toBeInTheDocument();
    expect(screen.queryByText('Sem conexão.')).not.toBeInTheDocument();
  });

  it('Esc fecha antes do envio e devolve o foco ao botão', async () => {
    await openModal();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Excluir marcadas (1)' })).toHaveFocus();
    expect(applies).toBe(0);
  });

  it('Voltar e clique no fundo fecham sem enviar', async () => {
    await openModal();
    await userEvent.click(await screen.findByRole('button', { name: 'Voltar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Excluir marcadas (1)' }));
    await screen.findByRole('dialog');
    await userEvent.click(screen.getByRole('dialog').parentElement!);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('durante o envio não fecha e o clique duplo envia uma vez só', async () => {
    await openModal();
    const button = await screen.findByRole('button', { name: 'Mover para a lixeira' });
    await userEvent.dblClick(button);
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(await screen.findByText('Resultado')).toBeInTheDocument();
    expect(applies).toBe(1);
  });

  it('erro ao mover mostra a mensagem e deixa tentar de novo', async () => {
    const ok = globalThis.fetch;
    let tries = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/apply') && ++tries === 1) return new Response(JSON.stringify({ message: 'Falhou.' }), { status: 500 });
      return (ok as typeof fetch)(url, init);
    }));
    await openModal();
    const button = await screen.findByRole('button', { name: 'Mover para a lixeira' });
    await userEvent.click(button);
    expect(await screen.findByText('Falhou.')).toBeInTheDocument();
    expect(button).toBeEnabled();
    await userEvent.click(button);
    expect(await screen.findByText('Resultado')).toBeInTheDocument();
  });

  it('grupo desatualizado: avisa e "Conferir o grupo atualizado" recarrega o grupo atual', async () => {
    const ok = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/apply')) return new Response(JSON.stringify({ groupId: 7, stale: true, results: [] }));
      return (ok as typeof fetch)(url, init);
    }));
    await openModal();
    await userEvent.click(await screen.findByRole('button', { name: 'Mover para a lixeira' }));
    expect(await screen.findByText(/Nada foi movido/)).toBeInTheDocument();
    expect(screen.queryByText(/desfazer no Histórico/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Conferir o grupo atualizado' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await screen.findByText(/Grupo 12 de 445/)).toBeInTheDocument();
  });
});

it('grupo desatualizado mostra o aviso de que foi atualizado', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/thumbnail')) return new Response(JSON.stringify({ url: null }));
    return new Response(JSON.stringify({ ...group, status: 'stale' }));
  }));
  render(
    <MemoryRouter initialEntries={['/revisao/1']}>
      <Routes><Route path="/revisao/:scanId" element={<Review />} /></Routes>
    </MemoryRouter>,
  );
  expect(await screen.findByText(/Ele foi atualizado com a situação atual/)).toBeInTheDocument();
});

describe('atalhos de teclado', () => {
  const prev: GroupView = { ...group, id: 6, position: 11 };
  let calls: string[];
  let marks: string[];

  beforeEach(() => {
    calls = [];
    marks = ['b'];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/thumbnail')) return new Response(JSON.stringify({ url: null }));
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url.endsWith('/preview')) {
        return new Response(JSON.stringify({ groupId: 7, deleteFiles: [group.files[1]], keepFiles: [group.files[0]], bytes: 1_000_000 }));
      }
      if (url.endsWith('/apply')) {
        await new Promise((r) => setTimeout(r, 20));
        return new Response(JSON.stringify({ groupId: 7, stale: false, results: [{ actionId: 1, fileId: 'b', fileName: 'x 1.jpg', status: 'done', error: null }] }));
      }
      if (url.endsWith('/previous')) return new Response(JSON.stringify(prev));
      return new Response(JSON.stringify({ ...group, preMarkedIds: marks }));
    }));
  });

  const count = (re: RegExp) => calls.filter((c) => re.test(c)).length;

  it('mostra as dicas e a legenda', async () => {
    renderReview();
    await screen.findByText(/Grupo 12 de 445/);
    expect(screen.getByText('Atalhos: Enter confirma · P pula · ← volta')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pular' })).toHaveTextContent('Pular P');
  });

  it('Enter abre o modal, não confirma sozinho; Enter de novo confirma uma vez e Enter leva ao próximo grupo', async () => {
    renderReview();
    await screen.findByText(/Grupo 12 de 445/);
    await userEvent.keyboard('{Enter}');
    await screen.findByRole('dialog');
    await screen.findByText(/1 arquivo vai para a lixeira/);
    expect(count(/\/apply$/)).toBe(0);
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard('{Enter}');
    expect(await screen.findByText('Resultado')).toBeInTheDocument();
    expect(count(/\/apply$/)).toBe(1);
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(count(/\/apply$/)).toBe(1);
  });

  it('Enter com o botão focado aciona só uma vez (abre o modal sem confirmar)', async () => {
    renderReview();
    (await screen.findByRole('button', { name: 'Excluir marcadas (1)' })).focus();
    await userEvent.keyboard('{Enter}');
    await screen.findByRole('dialog');
    await screen.findByText(/1 arquivo vai para a lixeira/);
    expect(count(/\/apply$/)).toBe(0);
  });

  it('Enter mantido pressionado (repeat) não confirma', async () => {
    renderReview();
    await screen.findByText(/Grupo 12 de 445/);
    await userEvent.keyboard('{Enter}');
    await screen.findByText(/1 arquivo vai para a lixeira/);
    fireEvent.keyDown(document.body, { key: 'Enter', repeat: true });
    fireEvent.keyDown(document.body, { key: 'Enter', repeat: true });
    expect(count(/\/apply$/)).toBe(0);
  });

  it('Enter não faz nada com 0 marcadas', async () => {
    marks = [];
    renderReview();
    await screen.findByText(/Grupo 12 de 445/);
    await userEvent.keyboard('{Enter}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('P pula e ← volta', async () => {
    renderReview();
    await screen.findByText(/Grupo 12 de 445/);
    await userEvent.keyboard('p');
    await waitFor(() => expect(count(/\/groups\/7\/skip$/)).toBe(1));
    await userEvent.keyboard('{ArrowLeft}');
    await waitFor(() => expect(count(/\/groups\/7\/previous$/)).toBe(1));
    expect(await screen.findByText(/Grupo 11 de 445/)).toBeInTheDocument();
  });

  it('teclas são ignoradas com foco em campo de texto, com Ctrl e com o modal aberto (P)', async () => {
    render(
      <MemoryRouter initialEntries={['/revisao/1']}>
        <input aria-label="busca" />
        <Routes><Route path="/revisao/:scanId" element={<Review />} /></Routes>
      </MemoryRouter>,
    );
    await screen.findByText(/Grupo 12 de 445/);
    await userEvent.click(screen.getByLabelText('busca'));
    await userEvent.keyboard('p{Enter}{ArrowLeft}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(calls.filter((c) => /skip|previous|preview/.test(c))).toEqual([]);
    (document.activeElement as HTMLElement).blur();
    await userEvent.keyboard('{Control>}p{/Control}');
    expect(calls.filter((c) => /skip/.test(c))).toEqual([]);
    await userEvent.keyboard('{Enter}');
    await screen.findByRole('dialog');
    await userEvent.keyboard('p');
    expect(calls.filter((c) => /skip/.test(c))).toEqual([]);
  });

  const enabledBox = () => screen.getAllByRole('checkbox', { name: 'Excluir esta cópia' }).find((b) => !(b as HTMLInputElement).disabled)!;

  it('com foco numa caixa "Excluir esta cópia", P pula, ← volta e Enter abre a confirmação', async () => {
    renderReview();
    await screen.findByText(/Grupo 12 de 445/);
    const box = enabledBox();
    box.focus();
    expect(document.activeElement).toBe(box);
    await userEvent.keyboard('p');
    await waitFor(() => expect(count(/\/groups\/7\/skip$/)).toBe(1));
    enabledBox().focus();
    await userEvent.keyboard('{ArrowLeft}');
    await waitFor(() => expect(count(/\/groups\/7\/previous$/)).toBe(1));
    await screen.findByText(/Grupo 11 de 445/);
    const again = enabledBox();
    again.focus();
    const before = (again as HTMLInputElement).checked;
    await userEvent.keyboard('{Enter}');
    await screen.findByRole('dialog');
    expect((again as HTMLInputElement).checked).toBe(before);
    expect(count(/\/apply$/)).toBe(0);
  });

  it('campos de texto (busca, número), área de texto e select continuam ignorando os atalhos', async () => {
    render(
      <MemoryRouter initialEntries={['/revisao/1']}>
        <input aria-label="numero" type="number" />
        <textarea aria-label="nota" />
        <select aria-label="lista"><option>a</option></select>
        <Routes><Route path="/revisao/:scanId" element={<Review />} /></Routes>
      </MemoryRouter>,
    );
    await screen.findByText(/Grupo 12 de 445/);
    for (const label of ['numero', 'nota', 'lista']) {
      screen.getByLabelText(label).focus();
      await userEvent.keyboard('p{ArrowLeft}');
    }
    expect(calls.filter((c) => /skip|previous|preview/.test(c))).toEqual([]);
  });

  it('depois do resultado, Enter/P/Enter repetido enquanto o próximo grupo carrega não reabrem o modal nem enviam nada', async () => {
    const next: GroupView = { ...group, id: 8, position: 13, files: [
      { ...base, id: 'c', name: 'y.jpg', modifiedAt: '2015-02-07T10:00:00Z' },
      { ...base, id: 'd', name: 'y 1.jpg', modifiedAt: '2015-02-07T10:00:00Z' },
    ], suggestion: { keepId: 'c', reason: 'regra: x', fallback: false }, preMarkedIds: ['d'] };
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    let applied = false;
    const posts: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/thumbnail')) return new Response(JSON.stringify({ url: null }));
      if (init?.method === 'POST') posts.push(url);
      if (url.endsWith('/groups/7/preview')) {
        return new Response(JSON.stringify({ groupId: 7, deleteFiles: [group.files[1]], keepFiles: [group.files[0]], bytes: 1 }));
      }
      if (url.endsWith('/groups/8/preview')) {
        return new Response(JSON.stringify({ groupId: 8, deleteFiles: [next.files[1]], keepFiles: [next.files[0]], bytes: 1 }));
      }
      if (url.endsWith('/apply')) {
        applied = true;
        return new Response(JSON.stringify({ groupId: 7, stale: false, results: [{ actionId: 1, fileId: 'b', fileName: 'x 1.jpg', status: 'done', error: null }] }));
      }
      if (applied) { await gate; return new Response(JSON.stringify(next)); }
      return new Response(JSON.stringify(group));
    }));
    renderReview();
    await screen.findByText(/Grupo 12 de 445/);
    await userEvent.keyboard('{Enter}');
    await screen.findByText(/1 arquivo vai para a lixeira/);
    await userEvent.keyboard('{Enter}');
    await screen.findByText('Resultado');
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard('p');
    fireEvent.keyDown(document.body, { key: 'Enter', repeat: true });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Excluir marcadas/ })).toBeDisabled();
    release();
    await screen.findByText(/Grupo 13 de 445/);
    expect(posts.filter((u) => /\/apply$/.test(u))).toEqual(['/api/groups/7/apply']);
    expect(posts.filter((u) => /skip/.test(u))).toEqual([]);
    await userEvent.keyboard('{Enter}');
    await screen.findByText(/1 arquivo vai para a lixeira/);
    expect(posts.filter((u) => /\/apply$/.test(u))).toHaveLength(1);
  });
});

describe('modo prováveis cópias', () => {
  const probableGroup: GroupView = { ...group, kind: 'probable', preMarkedIds: [] };
  const probableNext: GroupView = { ...probableGroup, id: 9, position: 13 };
  let calls: Array<{ url: string; body?: string }>;
  let current: GroupView | null;
  let summary: Partial<ScanSummary>;

  beforeEach(() => {
    calls = [];
    current = probableGroup;
    summary = { id: 1, groupsPending: 0, probablePending: 0 };
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body as string | undefined });
      if (url.endsWith('/thumbnail')) return new Response(JSON.stringify({ url: null }));
      if (url.endsWith('/preview')) return new Response(JSON.stringify({ groupId: 7, deleteFiles: [group.files[1]], keepFiles: [group.files[0]], bytes: 1 }));
      if (url.endsWith('/apply')) {
        current = probableNext;
        return new Response(JSON.stringify({ groupId: 7, stale: false, results: [{ actionId: 1, fileId: 'b', fileName: 'x 1.jpg', status: 'done', error: null }] }));
      }
      if (url.endsWith('/previous')) return new Response(JSON.stringify({ ...probableGroup, id: 5, position: 11 }));
      if (url.endsWith('/skip')) return new Response(JSON.stringify(probableNext));
      if (url.includes('/unskip')) return new Response('{}');
      if (url === '/api/scans/1') return new Response(JSON.stringify(summary));
      return new Response(JSON.stringify(current));
    }));
  });

  function renderProbable(entry = '/revisao/1?tipo=provaveis') {
    render(
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/revisao/:scanId" element={<Review />} />
          <Route path="/revisao/:scanId/grupo/:groupId" element={<Review />} />
        </Routes>
        <Where />
      </MemoryRouter>,
    );
  }

  it('pede kind=probable, mostra o aviso, nenhum marcado e sem "Revisar em lote"', async () => {
    renderProbable();
    expect(await screen.findByText(/Prováveis cópias/)).toBeInTheDocument();
    expect(screen.getByText(/Podem ser a original e uma versão editada. Confira antes de excluir./)).toBeInTheDocument();
    expect(calls[0].url).toBe('/api/scans/1/groups/current?kind=probable');
    for (const box of screen.getAllByRole('checkbox', { name: 'Excluir esta cópia' })) expect(box).not.toBeChecked();
    expect(screen.queryByText('Revisar em lote')).not.toBeInTheDocument();
    expect(screen.getAllByText('★ Sugerida para manter').length).toBeGreaterThan(0);
  });

  it('Enter sem marcadas não faz nada; marcar uma e confirmar envia só ela, e a URL preserva o tipo', async () => {
    renderProbable();
    await screen.findByText(/Prováveis cópias/);
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('checkbox', { name: 'Excluir esta cópia' })[1]);
    await userEvent.click(screen.getByRole('button', { name: 'Excluir marcadas (1)' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Mover para a lixeira' }));
    expect(JSON.parse(calls.find((c) => c.url.endsWith('/apply'))!.body!)).toEqual({ deleteIds: ['b'] });
    await userEvent.click(await screen.findByRole('button', { name: 'Próximo grupo' }));
    expect(await screen.findByText(/Grupo 13 de 445/)).toBeInTheDocument();
    expect(calls.some((c) => c.url === '/api/scans/1/groups/current?kind=probable' && calls.indexOf(c) > 0)).toBe(true);
    expect(screen.getByTestId('where').textContent).toContain('/revisao/1/grupo/9');
    expect(screen.getByTestId('where').textContent).toContain('tipo=provaveis');
  });

  it('pular avança para o próximo grupo provável e preserva o tipo na URL', async () => {
    renderProbable();
    await userEvent.click(await screen.findByRole('button', { name: /Pular/ }));
    await screen.findByText(/Grupo 13 de 445/);
    expect(screen.getByTestId('where').textContent).toContain('/revisao/1/grupo/9');
    expect(screen.getByTestId('where').textContent).toContain('tipo=provaveis');
  });

  it('Voltar mantém nenhuma cópia marcada', async () => {
    renderProbable();
    await screen.findByText(/Prováveis cópias/);
    await userEvent.click(screen.getByRole('button', { name: '← Voltar' }));
    await screen.findByText(/Grupo 11 de 445/);
    for (const box of await screen.findAllByRole('checkbox', { name: 'Excluir esta cópia' })) expect(box).not.toBeChecked();
  });

  it('abrir /revisao/1/grupo/9?tipo=provaveis não marca nenhuma cópia', async () => {
    current = probableNext;
    render(
      <MemoryRouter initialEntries={['/revisao/1/grupo/9?tipo=provaveis']}>
        <Routes>
          <Route path="/revisao/:scanId" element={<Review />} />
          <Route path="/revisao/:scanId/grupo/:groupId" element={<Review />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByText(/Grupo 13 de 445/);
    for (const box of screen.getAllByRole('checkbox', { name: 'Excluir esta cópia' })) expect(box).not.toBeChecked();
  });

  it('sem grupos: "Rever grupos pulados" usa unskip?kind=probable', async () => {
    current = null;
    renderProbable();
    await userEvent.click(await screen.findByRole('button', { name: 'Rever grupos pulados' }));
    expect(calls.some((c) => c.url === '/api/scans/1/unskip?kind=probable')).toBe(true);
  });
  it('grupo provável aberto sem ?tipo na URL: cabeçalho, aviso e navegação seguem o tipo do grupo', async () => {
    current = probableNext;
    renderProbable('/revisao/1/grupo/9');
    expect(await screen.findByText(/Prováveis cópias/)).toBeInTheDocument();
    expect(screen.getByText(/Podem ser a original e uma versão editada/)).toBeInTheDocument();
    expect(screen.queryByText('Revisar em lote')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Pular/ }));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toContain('tipo=provaveis'));
  });

  it('fim das prováveis: diz o tipo e leva às idênticas quando há pendentes', async () => {
    current = null;
    summary = { id: 1, groupsPending: 3, probablePending: 0 };
    renderProbable();
    expect(await screen.findByText(/Não há mais prováveis cópias pendentes/)).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Revisar cópias idênticas' })).toHaveAttribute('href', '/revisao/1');
  });

  it('fim das idênticas: diz o tipo e leva às prováveis quando há pendentes', async () => {
    current = null;
    summary = { id: 1, groupsPending: 0, probablePending: 2 };
    renderProbable('/revisao/1');
    expect(await screen.findByText(/Não há mais cópias idênticas pendentes/)).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Revisar prováveis cópias' })).toHaveAttribute('href', '/revisao/1?tipo=provaveis');
  });

  it('fim sem pendentes do outro tipo: sem link para a outra revisão', async () => {
    current = null;
    renderProbable('/revisao/1');
    await screen.findByText(/Não há mais cópias idênticas pendentes/);
    await waitFor(() => expect(calls.some((c) => c.url === '/api/scans/1')).toBe(true));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('link', { name: 'Revisar prováveis cópias' })).not.toBeInTheDocument();
  });
});
