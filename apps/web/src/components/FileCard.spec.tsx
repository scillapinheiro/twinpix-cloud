import type { CloudItem } from '@twinpix/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { FileCard } from './FileCard';

const file: CloudItem = {
  id: 'f1', name: '20150206_222631_LLS 1.jpg', folderPath: '/Imagens', size: 2_481_234, quickXorHash: 'h',
  mimeType: 'image/jpeg', kind: 'photo', takenAt: '2015-02-06T22:26:31Z', createdAt: '2015-02-06T22:26:31Z',
  modifiedAt: '2015-04-21T19:30:00Z', width: 4128, height: 2322, cameraMake: 'samsung', cameraModel: 'SM-G900M',
  durationMs: null, webUrl: 'https://onedrive.live.com/x',
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ url: null }), { status: 200 })));
});

const fields = ['name', 'folderPath', 'dimensions', 'size', 'takenAt', 'modifiedAt', 'camera'] as const;

it('mostra todos os campos com rótulo, câmera com fabricante e link do OneDrive', () => {
  render(<FileCard file={file} isSuggested={false} reason="" marked={false} lockDelete={false} onToggle={() => {}} diffs={new Set()} fields={[...fields]} />);
  for (const label of ['Arquivo', 'Pasta', 'Dimensões', 'Tamanho', 'Tirada em', 'Modificada em', 'Câmera']) {
    expect(screen.getByText(label)).toBeInTheDocument();
  }
  expect(screen.getByText('samsung SM-G900M')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Abrir no OneDrive/ })).toHaveAttribute('href', 'https://onedrive.live.com/x');
});

it('destaca diferenças e mostra o selo de sugerida com o motivo', () => {
  render(<FileCard file={file} isSuggested reason="regra: mais antiga (tirada em)" marked={false} lockDelete={false} onToggle={() => {}} diffs={new Set(['name'])} fields={[...fields]} />);
  expect(screen.getByText(file.name)).toHaveClass('diff');
  expect(screen.getByText('★ Sugerida para manter (regra: mais antiga (tirada em))')).toBeInTheDocument();
});

it('trava: não deixa marcar a última cópia que sobraria', async () => {
  const onToggle = vi.fn();
  render(<FileCard file={file} isSuggested={false} reason="" marked={false} lockDelete onToggle={onToggle} diffs={new Set()} fields={[...fields]} />);
  const box = screen.getByRole('checkbox', { name: 'Excluir esta cópia' });
  expect(box).toBeDisabled();
  expect(screen.getByText('É a única cópia que sobraria.')).toBeInTheDocument();
  await userEvent.click(box);
  expect(onToggle).not.toHaveBeenCalled();
});
