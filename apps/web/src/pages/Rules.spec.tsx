import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { Rules } from './Rules';

const initial = [{ type: 'noCopySuffix' }, { type: 'oldestTaken' }, { type: 'oldestModified' }];

function setup() {
  const puts: unknown[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') { puts.push(JSON.parse(init.body as string)); return new Response(init.body as string); }
    return new Response(JSON.stringify(initial));
  }));
  render(<MemoryRouter><Rules /></MemoryRouter>);
  return puts;
}

it('carrega, reordena, adiciona, remove e salva a lista ordenada', async () => {
  const puts = setup();
  expect(await screen.findByText(/1\. nome sem sufixo/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /Descer regra: nome sem sufixo/ }));
  await userEvent.click(screen.getByRole('button', { name: /Remover regra: mais antiga \(modificada em\)/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Adicionar regra' }));
  await userEvent.selectOptions(screen.getByLabelText('Critério'), 'deeperFolder');
  await userEvent.click(screen.getByRole('button', { name: 'Incluir regra' }));
  await userEvent.click(screen.getByRole('button', { name: 'Adicionar regra' }));
  await userEvent.selectOptions(screen.getByLabelText('Critério'), 'inFolder');
  await userEvent.click(screen.getByRole('button', { name: 'Incluir regra' }));
  expect(await screen.findByText(/começando com "\/"/)).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText('Pasta'), '/Imagens/Viagem');
  await userEvent.click(screen.getByRole('button', { name: 'Incluir regra' }));
  await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
  expect(await screen.findByText('Regras salvas.')).toBeInTheDocument();
  expect(puts).toEqual([[{ type: 'oldestTaken' }, { type: 'noCopySuffix' }, { type: 'deeperFolder' }, { type: 'inFolder', path: '/Imagens/Viagem' }]]);
  expect(screen.getByText(/Mudar as regras não altera lotes já confirmados/)).toBeInTheDocument();
});

it('recusa lista vazia sem chamar o servidor e volta ao padrão', async () => {
  const puts = setup();
  await screen.findByText(/1\. nome sem sufixo/);
  for (let i = 0; i < 3; i++) await userEvent.click(screen.getAllByRole('button', { name: /^Remover regra/ })[0]);
  await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
  expect(await screen.findByText('Deixe pelo menos uma regra na lista.')).toBeInTheDocument();
  expect(puts).toHaveLength(0);
  await userEvent.click(screen.getByRole('button', { name: 'Voltar ao padrão' }));
  expect(screen.getByText(/1\. nome sem sufixo/)).toBeInTheDocument();
  expect(screen.getAllByRole('listitem')).toHaveLength(3);
});

it('não oferece critério simples que já está na lista, mas deixa repetir pasta', async () => {
  setup();
  await screen.findByText(/1\. nome sem sufixo/);
  await userEvent.click(screen.getByRole('button', { name: 'Adicionar regra' }));
  const labels = Array.from(screen.getByLabelText('Critério').querySelectorAll('option')).map((o) => o.textContent);
  expect(labels.some((l) => l?.startsWith('nome sem sufixo'))).toBe(false);
  expect(labels).toContain('maior resolução');
  expect(labels).toContain('está na pasta…');
  expect(labels).toContain('não está na pasta…');
});

it('tira a barra final do caminho da pasta, menos na raiz', async () => {
  const puts = setup();
  await screen.findByText(/1\. nome sem sufixo/);
  for (const typed of ['/Imagens/Viagem/', '/']) {
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar regra' }));
    await userEvent.selectOptions(screen.getByLabelText('Critério'), 'inFolder');
    await userEvent.type(screen.getByLabelText('Pasta'), typed);
    await userEvent.click(screen.getByRole('button', { name: 'Incluir regra' }));
  }
  await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
  await screen.findByText('Regras salvas.');
  expect(puts[0]).toEqual([...initial, { type: 'inFolder', path: '/Imagens/Viagem' }, { type: 'inFolder', path: '/' }]);
});
