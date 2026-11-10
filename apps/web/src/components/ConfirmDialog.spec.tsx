import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { ConfirmDialog } from './ConfirmDialog';

const file = (id: string, name: string) => ({ id, name, folderPath: '/A', size: 1000 });
const preview = { deleteFiles: [file('b', 'x 1.jpg'), file('c', 'x 2.jpg')], keepFiles: [file('a', 'x.jpg')], bytes: 2000 };

let applies = 0;
function stubFetch(applyResult: unknown) {
  applies = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/preview')) return new Response(JSON.stringify(preview));
    if (url.endsWith('/apply')) {
      applies++;
      await new Promise((r) => setTimeout(r, 30));
      return new Response(JSON.stringify(applyResult));
    }
    return new Response('null');
  }));
}

function renderDialog(onDone = vi.fn()) {
  render(<ConfirmDialog groupId={7} deleteIds={['b', 'c']} onCancel={vi.fn()} onDone={onDone} />);
  return onDone;
}

it('falha parcial: mostra o que foi para a lixeira e o que não foi, com o motivo', async () => {
  stubFetch({
    groupId: 7, stale: false,
    results: [
      { actionId: 1, fileId: 'b', fileName: 'x 1.jpg', status: 'done', error: null },
      { actionId: 2, fileId: 'c', fileName: 'x 2.jpg', status: 'failed', error: 'O OneDrive respondeu com erro 503.' },
    ],
  });
  renderDialog();
  await userEvent.click(await screen.findByRole('button', { name: /Mover para a lixeira|Excluir|Confirmar/i }));
  expect(await screen.findByText('x 1.jpg: movido para a lixeira')).toBeInTheDocument();
  const falha = screen.getByText('x 2.jpg: não foi movido (O OneDrive respondeu com erro 503.)');
  expect(falha).toHaveClass('alert');
  expect(screen.getByText('x 1.jpg: movido para a lixeira')).not.toHaveClass('alert');
});

it('clique duplo em confirmar envia a exclusão uma vez só', async () => {
  stubFetch({ groupId: 7, stale: false, results: [{ actionId: 1, fileId: 'b', fileName: 'x 1.jpg', status: 'done', error: null }] });
  renderDialog();
  const botao = await screen.findByRole('button', { name: /Mover para a lixeira|Excluir|Confirmar/i });
  await userEvent.dblClick(botao);
  await screen.findByText('x 1.jpg: movido para a lixeira');
  await waitFor(() => expect(applies).toBe(1));
});
