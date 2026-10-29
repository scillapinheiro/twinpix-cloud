import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { FolderPicker } from './FolderPicker';

const routes: Record<string, unknown> = {
  'GET /api/folders/root': { id: 'root', name: 'OneDrive', path: '/', childCount: 2 },
  'GET /api/folders/root/children': [
    { id: 'a', name: 'Minhas imagens', path: '/Minhas imagens', childCount: 1 },
    { id: 'b', name: 'Imagens', path: '/Imagens', childCount: 1 },
  ],
  'GET /api/folders/a/children': [{ id: 'a1', name: 'minhas fotos', path: '/Minhas imagens/minhas fotos', childCount: 0 }],
  'POST /api/folders/check-nesting': [{ inner: '/Minhas imagens/minhas fotos', outer: '/Minhas imagens' }],
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${url}`;
    return new Response(JSON.stringify(routes[key] ?? null), { status: 200 });
  }));
});

it('escolhe pastas, entra em subpasta e avisa sobre pasta dentro de outra', async () => {
  render(<MemoryRouter><FolderPicker /></MemoryRouter>);
  await userEvent.click(await screen.findByRole('checkbox', { name: 'Escolher a pasta Minhas imagens' }));
  await userEvent.click(screen.getByRole('button', { name: 'Abrir Minhas imagens' }));
  await userEvent.click(await screen.findByRole('checkbox', { name: 'Escolher a pasta minhas fotos' }));
  expect(await screen.findByText(/já está incluída em/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Iniciar análise/ })).toBeEnabled();
  expect(screen.getByRole('button', { name: /Iniciar análise/ })).toHaveClass('button', 'primary');
});
