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
