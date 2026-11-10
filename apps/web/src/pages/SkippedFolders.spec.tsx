import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi } from 'vitest';
import { ScanProgress } from './ScanProgress';

const base = {
  id: 3, status: 'done', roots: [{ id: 'r', name: 'A', path: '/A', childCount: 1 }], foldersDone: 3, foldersTotal: 3, filesFound: 4,
  unanalyzedCount: 0, groupsTotal: 0, groupsPending: 0, groupsSkipped: 0, probableTotal: 0, probablePending: 0, probableSkipped: 0, bytesFreed: 0, error: null,
};

function view(foldersSkipped: number) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/skipped-folders')) return new Response(JSON.stringify(['/A/Compartilhada', '/A/Outra']));
    return new Response(JSON.stringify({ ...base, foldersSkipped }));
  }));
  render(
    <MemoryRouter initialEntries={['/varredura/3']}>
      <Routes><Route path="/varredura/:id" element={<ScanProgress />} /></Routes>
    </MemoryRouter>,
  );
}

describe('pastas puladas por falta de permissão', () => {
  it('avisa quantas foram puladas e mostra a lista ao pedir', async () => {
    view(2);
    expect(await screen.findByText(/Pastas puladas por falta de permissão: 2/)).toBeInTheDocument();
    expect(screen.queryByText('/A/Compartilhada')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'ver lista' }));
    expect(await screen.findByText('/A/Compartilhada')).toBeInTheDocument();
    expect(screen.getByText('/A/Outra')).toBeInTheDocument();
  });

  it('sem pastas puladas, a linha não aparece', async () => {
    view(0);
    await screen.findByText(/Pastas analisadas: 3 de 3/);
    expect(screen.queryByText(/falta de permissão/)).not.toBeInTheDocument();
  });
});
