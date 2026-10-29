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

it('mostra o cabeçalho do grupo, pré-marca a cópia e segue para a confirmação', async () => {
  render(
    <MemoryRouter initialEntries={['/revisao/1']}>
      <Routes>
        <Route path="/revisao/:scanId" element={<Review />} />
        <Route path="/confirmar" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
  expect(await screen.findByText(/Grupo 12 de 445/)).toBeInTheDocument();
  expect(screen.getByText(/Cópias idênticas/)).toBeInTheDocument();
  expect(screen.getByText(/2,1 GB liberados até agora/)).toBeInTheDocument();
  const boxes = screen.getAllByRole('checkbox', { name: 'Excluir esta cópia' });
  expect(boxes[0]).not.toBeChecked();
  expect(boxes[1]).toBeChecked();
  await userEvent.click(screen.getByRole('button', { name: 'Excluir marcadas (1)' }));
  expect(screen.getByTestId('where').textContent).toContain('"deleteIds":["b"]');
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
