import type { AuthStatus, ScanSummary } from '@twinpix/shared';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi } from 'vitest';
import { Home } from './Home';
import { ScanProgress } from './ScanProgress';

const scan = (probablePending: number, extra: Partial<ScanSummary> = {}): ScanSummary => ({
  id: 3, status: 'done', roots: [{ id: 'r', name: 'A', path: '/A', childCount: 1 }], foldersDone: 1, foldersTotal: 1, filesFound: 4,
  unanalyzedCount: 0, groupsTotal: 0, groupsPending: 0, groupsSkipped: 0, probableTotal: 2, probablePending, probableSkipped: 0, bytesFreed: 0, error: null, ...extra,
});

function stub(s: ScanSummary, groupCounts: number[] | 'erro' = [3, 4]) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.includes('/batch?kind=probable')) {
      return groupCounts === 'erro'
        ? new Response(JSON.stringify({ message: 'x' }), { status: 400 })
        : new Response(JSON.stringify({ scanId: 3, tiesCount: 0, pendingCount: 99, lines: groupCounts.map((groupCount, i) => ({ key: `k${i}`, groupCount })) }));
    }
    if (url.endsWith('/auth/status')) return new Response(JSON.stringify({ configured: true, connected: true, accountName: 'Ana', demo: false } satisfies AuthStatus));
    if (url.endsWith('/folder-clusters')) return new Response('[]');
    return new Response(JSON.stringify(s));
  }));
}

describe.each([
  ['ScanProgress', <ScanProgress />, '/varredura/3', '/varredura/:id', 'Começar a revisão'],
  ['Home', <Home />, '/', '/', 'Continuar revisão'],
])('botão de prováveis em %s', (_n, el, path, route, identicalLabel) => {
  const view = () => render(<MemoryRouter initialEntries={[path]}><Routes><Route path={route} element={el} /></Routes></MemoryRouter>);

  it('aparece com pendentes e leva ao modo prováveis', async () => {
    stub(scan(2));
    view();
    expect(await screen.findByRole('link', { name: 'Revisar prováveis cópias' })).toHaveAttribute('href', '/revisao/3?tipo=provaveis');
  });

  it('não aparece sem pendentes', async () => {
    stub(scan(0));
    view();
    await screen.findByRole('heading');
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByRole('link', { name: 'Revisar prováveis cópias' })).not.toBeInTheDocument();
  });
  it('aparece só com pulados, para dar para revê-los', async () => {
    stub(scan(0, { probableSkipped: 2 }));
    view();
    expect(await screen.findByRole('link', { name: 'Revisar prováveis cópias' })).toHaveAttribute('href', '/revisao/3?tipo=provaveis');
  });

  it('"Lote das prováveis (N)" usa a soma dos grupos da prévia, não os pendentes', async () => {
    stub(scan(5));
    view();
    expect(await screen.findByRole('link', { name: 'Lote das prováveis (7)' })).toHaveAttribute('href', '/lote/3?tipo=provaveis');
  });
  it('lote das prováveis não aparece com N = 0, com erro da prévia ou sem prováveis pendentes', async () => {
    for (const [s, g] of ([[scan(5), []], [scan(5), 'erro'], [scan(0, { probableSkipped: 2 }), [3]]]) as Array<[ScanSummary, number[] | 'erro']>) {
      stub(s, g);
      const { unmount } = view();
      await screen.findByRole('heading');
      await new Promise((r) => setTimeout(r, 30));
      expect(screen.queryByRole('link', { name: /Lote das prováveis/ })).not.toBeInTheDocument();
      unmount();
    }
  });
  it('idênticas só com pulados: o botão de revisão continua visível', async () => {
    stub(scan(0, { groupsTotal: 1, groupsSkipped: 1 }));
    view();
    expect(await screen.findByRole('link', { name: identicalLabel })).toHaveAttribute('href', '/revisao/3');
  });
});

describe('contadores da análise', () => {
  const view = () => render(<MemoryRouter initialEntries={['/varredura/3']}><Routes><Route path="/varredura/:id" element={<ScanProgress />} /></Routes></MemoryRouter>);

  it('mostra quantas prováveis estão para revisar e quantas foram puladas', async () => {
    stub(scan(1, { probableTotal: 3, probableSkipped: 2 }));
    view();
    expect(await screen.findByText('Prováveis cópias: 3 (1 para revisar, 2 pulados)')).toBeInTheDocument();
  });

  it('enquanto a análise não termina, avisa que as prováveis são calculadas ao fim', async () => {
    stub(scan(0, { status: 'running', probableTotal: 0 }));
    view();
    expect(await screen.findByText('Prováveis cópias: calculadas ao fim da análise')).toBeInTheDocument();
  });
});
