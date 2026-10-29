import type { ScanSummary } from '@twinpix/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi } from 'vitest';
import { ScanProgress } from './ScanProgress';

const scan = (status: ScanSummary['status']): ScanSummary => ({
  id: 3, status, roots: [{ id: 'r', name: 'A', path: '/A', childCount: 1 }], foldersDone: 1, foldersTotal: 2, filesFound: 4,
  unanalyzedCount: 0, groupsTotal: 0, groupsPending: 0, groupsSkipped: 0, probableTotal: 0, probablePending: 0, probableSkipped: 0, bytesFreed: 0, error: null,
});

function view(status: ScanSummary['status']) {
  const fetchMock = vi.fn(async (url: string) => new Response(JSON.stringify(scan(url.endsWith('/cancel') ? 'cancelled' : status))));
  vi.stubGlobal('fetch', fetchMock);
  render(
    <MemoryRouter initialEntries={['/varredura/3']}>
      <Routes>
        <Route path="/varredura/:id" element={<ScanProgress />} />
        <Route path="/" element={<p>Tela inicial</p>} />
      </Routes>
    </MemoryRouter>,
  );
  return fetchMock;
}

describe('cancelar análise', () => {
  it('cancelamento recusado mostra a mensagem na própria tela e mantém a página', async () => {
    const fetchMock = vi.fn(async (url: string) => url.endsWith('/cancel')
      ? new Response(JSON.stringify({ message: 'Há um lote aberto desta análise.' }), { status: 400 })
      : new Response(JSON.stringify(scan('paused'))));
    vi.stubGlobal('fetch', fetchMock);
    render(
      <MemoryRouter initialEntries={['/varredura/3']}>
        <Routes><Route path="/varredura/:id" element={<ScanProgress />} /></Routes>
      </MemoryRouter>,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Cancelar análise' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar cancelar análise' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Há um lote aberto desta análise.');
    expect(screen.getByRole('heading', { name: 'Análise' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancelar análise' })).toBeInTheDocument();
  });

  it('confirma em dois cliques, cancela e volta à tela inicial', async () => {
    const fetchMock = view('paused');
    await userEvent.click(await screen.findByRole('button', { name: 'Cancelar análise' }));
    expect(fetchMock).not.toHaveBeenCalledWith('/api/scans/3/cancel', expect.anything());
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar cancelar análise' }));
    expect(await screen.findByText('Tela inicial')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/scans/3/cancel', expect.objectContaining({ method: 'POST' }));
  });

  it('não aparece em análise concluída', async () => {
    view('done');
    await screen.findByText('Análise concluída.');
    expect(screen.queryByRole('button', { name: 'Cancelar análise' })).not.toBeInTheDocument();
  });
});

describe('análise cancelada', () => {
  it('mostra o aviso e esconde os atalhos de revisão', async () => {
    const full = { ...scan('cancelled'), groupsPending: 2, probablePending: 1 };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(full))));
    render(
      <MemoryRouter initialEntries={['/varredura/3']}>
        <Routes><Route path="/varredura/:id" element={<ScanProgress />} /></Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText(/Análise cancelada\./)).toBeInTheDocument();
    for (const name of [/Começar a revisão/, /Revisar prováveis cópias/, /Revisar em lote/, /Pastas repetidas/]) {
      expect(screen.queryByRole('link', { name })).toBeNull();
    }
  });
});
