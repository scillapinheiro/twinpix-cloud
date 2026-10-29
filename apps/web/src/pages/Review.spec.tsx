import type { GroupView } from '@twinpix/shared';
import { render, screen } from '@testing-library/react';
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
  suggestion: { keepId: 'a', reason: 'regra: nome sem sufixo de cópia' },
  preMarkedIds: ['b'],
  bytesFreedSoFar: 2_100_000_000,
};

function Where() {
  const loc = useLocation();
  return <pre data-testid="where">{JSON.stringify({ path: loc.pathname, state: loc.state })}</pre>;
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
    return new Response(JSON.stringify({ ...group, files, suggestion: { keepId: 'f0', reason: 'regra: x' }, preMarkedIds: [] }));
  }));
  const { container } = render(
    <MemoryRouter initialEntries={['/revisao/1']}>
      <Routes><Route path="/revisao/:scanId" element={<Review />} /></Routes>
    </MemoryRouter>,
  );
  await screen.findByText(/Grupo 12 de 445/);
  expect(container.querySelector('.cards')).toHaveAttribute('data-count', count);
});

describe('modal de confirmação', () => {
  const next: GroupView = { ...group, id: 8, position: 13, files: [
    { ...base, id: 'c', name: 'y.jpg', modifiedAt: '2015-02-07T10:00:00Z' },
    { ...base, id: 'd', name: 'y 1.jpg', modifiedAt: '2015-02-07T10:00:00Z' },
  ], suggestion: { keepId: 'c', reason: 'regra: x' }, preMarkedIds: ['d'] };
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
    await userEvent.click(screen.getByRole('button', { name: 'Próximo grupo' }));
    expect(await screen.findByText(/Grupo 13 de 445/)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('where').textContent).toContain('/revisao/1/grupo/8');
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
