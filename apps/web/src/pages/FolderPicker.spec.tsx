import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, vi } from 'vitest';
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

it('explica que dá para colar o endereço da barra do navegador', async () => {
  render(<MemoryRouter><FolderPicker /></MemoryRouter>);
  expect(await screen.findByLabelText(/da barra do navegador ou do botão Compartilhar/)).toHaveAttribute('placeholder', 'https://onedrive.live.com/…');
});

describe('link colado e início da análise', () => {
  const pasta = { id: 'z', name: 'Compartilhada', path: '/Compartilhada', childCount: 0 };
  const calls: string[] = [];

  beforeEach(() => {
    calls.length = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const key = `${init?.method ?? 'GET'} ${url}`;
      calls.push(key);
      if (key === 'POST /api/folders/resolve-link') {
        const { url: link } = JSON.parse(String(init?.body));
        if (link.includes('invalido')) return new Response(JSON.stringify({ message: 'Não reconheci este endereço do OneDrive.' }), { status: 400 });
        return new Response(JSON.stringify(pasta), { status: 200 });
      }
      if (key === 'POST /api/scans') return new Response(JSON.stringify({ id: 9 }), { status: 200 });
      return new Response(JSON.stringify(routes[key] ?? null), { status: 200 });
    }));
  });

  it('link válido adiciona a pasta, limpa o campo e não duplica ao colar de novo', async () => {
    render(<MemoryRouter><FolderPicker /></MemoryRouter>);
    const campo = await screen.findByLabelText(/da barra do navegador ou do botão Compartilhar/);
    await userEvent.type(campo, 'https://onedrive.live.com/ok');
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar' }));
    expect(await screen.findByText('Pastas escolhidas (1)')).toBeInTheDocument();
    expect(campo).toHaveValue('');
    await userEvent.type(campo, 'https://onedrive.live.com/ok');
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar' }));
    await waitFor(() => expect(calls.filter((c) => c === 'POST /api/folders/resolve-link')).toHaveLength(2));
    expect(screen.getByText('Pastas escolhidas (1)')).toBeInTheDocument();
  });

  it('link inválido mostra o erro e não escolhe nada', async () => {
    render(<MemoryRouter><FolderPicker /></MemoryRouter>);
    await userEvent.type(await screen.findByLabelText(/da barra do navegador ou do botão Compartilhar/), 'invalido');
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar' }));
    expect(await screen.findByText('Não reconheci este endereço do OneDrive.')).toBeInTheDocument();
    expect(screen.getByText('Pastas escolhidas (0)')).toBeInTheDocument();
  });

  it('clique duplo em Iniciar análise cria uma análise só', async () => {
    render(<MemoryRouter><FolderPicker /></MemoryRouter>);
    await userEvent.type(await screen.findByLabelText(/da barra do navegador ou do botão Compartilhar/), 'https://onedrive.live.com/ok');
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar' }));
    await screen.findByText('Pastas escolhidas (1)');
    await userEvent.dblClick(screen.getByRole('button', { name: /Iniciar análise/ }));
    await waitFor(() => expect(calls).toContain('POST /api/scans'));
    expect(calls.filter((c) => c === 'POST /api/scans')).toHaveLength(1);
  });
});
