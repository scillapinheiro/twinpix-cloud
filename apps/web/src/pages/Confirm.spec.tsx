import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi } from 'vitest';
import { Confirm } from './Confirm';

const file = (id: string, name: string) => ({
  id, name, folderPath: '/A', size: 1_000_000, quickXorHash: 'h', mimeType: 'image/jpeg', kind: 'photo',
  takenAt: null, createdAt: '2015-01-01T00:00:00Z', modifiedAt: '2015-01-01T00:00:00Z', width: 1, height: 1,
  cameraMake: null, cameraModel: null, durationMs: null, webUrl: '',
});

function renderAt(apply: unknown) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/preview')) {
      return new Response(JSON.stringify({ groupId: 7, deleteFiles: [file('b', 'x 1.jpg')], keepFiles: [file('a', 'x.jpg')], bytes: 1_000_000 }));
    }
    return new Response(JSON.stringify(apply));
  }));
  render(
    <MemoryRouter initialEntries={[{ pathname: '/confirmar', state: { groupId: 7, scanId: 1, deleteIds: ['b'] } }]}>
      <Routes>
        <Route path="/confirmar" element={<Confirm />} />
        <Route path="/revisao/:scanId" element={<p>tela de revisão</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

it('mostra contagem, espaço e listas antes de mover', async () => {
  renderAt({ groupId: 7, stale: false, results: [] });
  expect(await screen.findByText(/1 arquivo vai para a lixeira do OneDrive/)).toBeInTheDocument();
  expect(screen.getByText(/1,0 MB/)).toBeInTheDocument();
  expect(screen.getByText('/A/x 1.jpg')).toBeInTheDocument();
  expect(screen.getByText('/A/x.jpg')).toBeInTheDocument();
});

it('depois de mover mostra o resultado de cada arquivo', async () => {
  renderAt({ groupId: 7, stale: false, results: [{ actionId: 1, fileId: 'b', fileName: 'x 1.jpg', status: 'done', error: null }] });
  await userEvent.click(await screen.findByRole('button', { name: 'Mover para a lixeira' }));
  expect(await screen.findByText('x 1.jpg: movido para a lixeira')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Próximo grupo' }));
  expect(screen.getByText('tela de revisão')).toBeInTheDocument();
});

it('grupo desatualizado: avisa que nada foi movido e que o grupo foi atualizado', async () => {
  renderAt({ groupId: 7, stale: true, results: [] });
  await userEvent.click(await screen.findByRole('button', { name: 'Mover para a lixeira' }));
  expect(
    await screen.findByText(
      'Este grupo mudou no OneDrive desde a análise (algum arquivo foi alterado, movido ou apagado). Nada foi movido. ' +
        'O grupo foi atualizado com a situação atual — confira de novo antes de excluir.',
    ),
  ).toBeInTheDocument();
  expect(screen.queryByText(/desfazer no Histórico/)).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Conferir o grupo atualizado' }));
  expect(screen.getByText('tela de revisão')).toBeInTheDocument();
});

it('erro ao mover mantém a tela e deixa tentar de novo', async () => {
  let applies = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/preview')) {
      return new Response(JSON.stringify({ groupId: 7, deleteFiles: [file('b', 'x 1.jpg')], keepFiles: [file('a', 'x.jpg')], bytes: 1_000_000 }));
    }
    applies += 1;
    if (applies === 1) return new Response(JSON.stringify({ message: 'Falhou.' }), { status: 500 });
    return new Response(JSON.stringify({ groupId: 7, stale: false, results: [] }));
  }));
  render(
    <MemoryRouter initialEntries={[{ pathname: '/confirmar', state: { groupId: 7, scanId: 1, deleteIds: ['b'] } }]}>
      <Routes><Route path="/confirmar" element={<Confirm />} /></Routes>
    </MemoryRouter>,
  );
  const button = await screen.findByRole('button', { name: 'Mover para a lixeira' });
  await userEvent.click(button);
  expect(await screen.findByText('Falhou.')).toBeInTheDocument();
  expect(button).toBeEnabled();
  await userEvent.click(button);
  expect(await screen.findByText('Resultado')).toBeInTheDocument();
  expect(applies).toBe(2);
});
