import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { History } from './History';

it('lista o histórico e desfaz', async () => {
  const entry = {
    actionId: 3, groupId: 7, status: 'done', error: null, createdAt: '2026-10-29T10:00:00Z',
    file: { id: 'b', name: 'x 1.jpg', folderPath: '/A', size: 1000 },
  };
  const fetchMock = vi.fn(async (url: string) => {
    if (url.endsWith('/undo')) return new Response(JSON.stringify({ result: 'restored', message: 'Arquivo restaurado para a pasta original.' }));
    return new Response(JSON.stringify([entry]));
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<MemoryRouter><History /></MemoryRouter>);
  expect(await screen.findByText('/A/x 1.jpg')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Desfazer' }));
  expect(await screen.findByText('Arquivo restaurado para a pasta original.')).toBeInTheDocument();
});
