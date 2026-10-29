import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { App } from './App';

it('sem Client ID mostra como configurar', async () => {
  vi.stubGlobal('fetch', vi.fn(async () =>
    new Response(JSON.stringify({ configured: false, connected: false, accountName: null, demo: false }), { status: 200 }),
  ));
  render(<App />);
  expect(await screen.findByText(/TWINPIX_CLIENT_ID/)).toBeInTheDocument();
});

it('desconectado mostra o botão de conectar', async () => {
  vi.stubGlobal('fetch', vi.fn(async () =>
    new Response(JSON.stringify({ configured: true, connected: false, accountName: null, demo: false }), { status: 200 }),
  ));
  render(<App />);
  expect(await screen.findByRole('link', { name: 'Conectar ao OneDrive' })).toHaveAttribute('href', '/api/auth/login');
});

it('na tela inicial conectada, "Nova análise" é botão principal', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) =>
    new Response(JSON.stringify(String(url).includes('/api/auth') ? { configured: true, connected: true, accountName: 'Ana', demo: false } : null), { status: 200 }),
  ));
  render(<App />);
  const link = await screen.findByRole('link', { name: 'Nova análise' });
  expect(link).toHaveClass('button', 'primary');
});
