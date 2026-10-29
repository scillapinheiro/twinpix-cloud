import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { History } from './History';

it('lista o histórico e desfaz', async () => {
  const entry = {
    actionId: 3, groupId: 7, status: 'done', error: null, batchId: null, batchKind: null, createdAt: '2026-10-29T10:00:00Z',
    file: { id: 'b', name: 'x 1.jpg', folderPath: '/A', size: 1000 },
  };
  const fetchMock = vi.fn(async (url: string) => {
    if (url.endsWith('/undo')) return new Response(JSON.stringify({ result: 'restored', message: 'Arquivo restaurado para a pasta original.' }));
    if (url === '/api/batches') return new Response('[]');
    return new Response(JSON.stringify([entry]));
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<MemoryRouter><History /></MemoryRouter>);
  expect(await screen.findByText('/A/x 1.jpg')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Desfazer' }));
  expect(await screen.findByText('Arquivo restaurado para a pasta original.')).toBeInTheDocument();
});

it('mostra lotes, rótulo "lote #N" e desfaz o lote após confirmar', async () => {
  const entry = {
    actionId: 3, groupId: 7, status: 'done', error: null, batchId: 4, batchKind: 'lines', createdAt: '2026-10-29T10:00:00Z',
    file: { id: 'b', name: 'x 1.jpg', folderPath: '/A', size: 1000 },
  };
  const batch = { id: 4, kind: 'lines', scanId: 1, status: 'done', createdAt: '2026-10-29T10:00:00Z', totalGroups: 2, doneGroups: 2, skippedGroups: 0, movedFiles: 5, movedBytes: 2_000_000, failedFiles: 0, restoredFiles: 0, notRestoredFiles: 0, error: null };
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    if (url === '/api/batches/4/undo') return new Response(JSON.stringify({ ...batch, status: 'undone' }));
    if (url === '/api/batches') return new Response(JSON.stringify([batch]));
    return new Response(JSON.stringify([entry]));
  }));
  render(<MemoryRouter><History /></MemoryRouter>);
  expect(await screen.findByText('Lotes')).toBeInTheDocument();
  expect(screen.getByText('lote #4')).toBeInTheDocument();
  expect(screen.getByText(/5 arquivos movidos/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Desfazer este lote' }));
  expect(calls).not.toContain('POST /api/batches/4/undo');
  await userEvent.click(screen.getByRole('button', { name: 'Confirmar desfazer' }));
  expect(await screen.findByText(/Lote desfeito\./)).toBeInTheDocument();
  expect(calls).toContain('POST /api/batches/4/undo');
});

it('lote com erro mostra a frase do servidor e oferece desfazer', async () => {
  const batch = { id: 4, kind: 'lines', scanId: 1, status: 'error', createdAt: '2026-10-29T10:00:00Z', totalGroups: 2, doneGroups: 1, skippedGroups: 0, movedFiles: 1, movedBytes: 1000, failedFiles: 0, restoredFiles: 0, notRestoredFiles: 0, error: 'Reconecte o OneDrive para terminar de desfazer o lote.' };
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/batches') return new Response(JSON.stringify([batch]));
    return new Response('[]');
  }));
  render(<MemoryRouter><History /></MemoryRouter>);
  expect(await screen.findByText('Reconecte o OneDrive para terminar de desfazer o lote.')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Conectar de novo' })).toHaveAttribute('href', '/api/auth/login');
  expect(screen.getByRole('button', { name: 'Desfazer este lote' })).toBeInTheDocument();
});
