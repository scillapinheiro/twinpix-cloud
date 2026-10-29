import { describe, expect, it, vi } from 'vitest';
import { InvalidLinkError } from '../errors';
import type { GraphClient } from './graph-client';
import { encodeShareUrl, OneDriveProvider } from './onedrive-provider';

function fakeGraph(routes: Record<string, { status: number; data: unknown }>) {
  const request = vi.fn(async (method: string, path: string) => {
    const key = `${method} ${path.split('?')[0]}`;
    const r = routes[key];
    if (!r) throw new Error(`rota não simulada: ${key}`);
    return r;
  });
  return { graph: { request } as unknown as GraphClient, request };
}

const folderItem = (id: string, name: string, parent = '/drive/root:') => ({
  id, name, webUrl: '', createdDateTime: '', lastModifiedDateTime: '',
  parentReference: { driveId: 'meu', path: parent }, folder: { childCount: 1 },
});

describe('OneDriveProvider', () => {
  it('lista filhos e devolve o nextLink como token de página', async () => {
    const { graph } = fakeGraph({
      'GET /me/drive/items/F/children': {
        status: 200,
        data: {
          value: [
            folderItem('S', 'Sub', '/drive/root:/Pai'),
            { id: 'P', name: 'a.jpg', size: 1, webUrl: '', createdDateTime: 'c', lastModifiedDateTime: 'm',
              parentReference: { path: '/drive/root:/Pai' }, file: { mimeType: 'image/jpeg', hashes: { quickXorHash: 'h' } } },
            { id: 'D', name: 'doc.pdf', size: 1, webUrl: '', createdDateTime: 'c', lastModifiedDateTime: 'm',
              parentReference: { path: '/drive/root:/Pai' }, file: { mimeType: 'application/pdf' } },
          ],
          '@odata.nextLink': 'https://graph.microsoft.com/v1.0/next',
        },
      },
    });
    const page = await new OneDriveProvider(graph).listChildren('F', null);
    expect(page.folders.map((f) => f.path)).toEqual(['/Pai/Sub']);
    expect(page.files.map((f) => f.id)).toEqual(['P']);
    expect(page.nextPageToken).toBe('https://graph.microsoft.com/v1.0/next');
  });

  it('getItem devolve null quando o arquivo sumiu', async () => {
    const { graph } = fakeGraph({ 'GET /me/drive/items/X': { status: 404, data: null } });
    expect(await new OneDriveProvider(graph).getItem('X')).toBeNull();
  });

  it('lixeira e restauração mapeiam os status', async () => {
    const { graph } = fakeGraph({
      'DELETE /me/drive/items/A': { status: 204, data: null },
      'DELETE /me/drive/items/B': { status: 404, data: null },
      'POST /me/drive/items/A/restore': { status: 200, data: {} },
      'POST /me/drive/items/B/restore': { status: 404, data: null },
      'POST /me/drive/items/C/restore': { status: 409, data: null },
    });
    const p = new OneDriveProvider(graph);
    expect(await p.moveToTrash('A')).toBe('moved');
    expect(await p.moveToTrash('B')).toBe('already-gone');
    expect(await p.restore('A')).toBe('restored');
    expect(await p.restore('B')).toBe('not-in-trash');
    expect(await p.restore('C')).toBe('conflict');
  });

  it('codifica o link de compartilhamento no formato u!base64url', () => {
    expect(encodeShareUrl('https://1drv.ms/f/s!abc')).toBe('u!aHR0cHM6Ly8xZHJ2Lm1zL2YvcyFhYmM');
  });

  it('link: recusa domínio estranho, arquivo e pasta de outra conta', async () => {
    const enc = encodeShareUrl('https://1drv.ms/f/s!abc');
    const own = { 'GET /me/drive': { status: 200, data: { id: 'meu' } } };
    const p1 = new OneDriveProvider(fakeGraph(own).graph);
    await expect(p1.resolveFolderLink('https://example.com/x')).rejects.toBeInstanceOf(InvalidLinkError);

    const p2 = new OneDriveProvider(fakeGraph({ ...own, [`GET /shares/${enc}/driveItem`]: { status: 200, data: { ...folderItem('A', 'a.jpg'), folder: undefined, file: { mimeType: 'image/jpeg' } } } }).graph);
    await expect(p2.resolveFolderLink('https://1drv.ms/f/s!abc')).rejects.toThrow('não é de uma pasta');

    const other = { ...folderItem('F', 'Pasta'), parentReference: { driveId: 'outro', path: '/drive/root:' } };
    const p3 = new OneDriveProvider(fakeGraph({ ...own, [`GET /shares/${enc}/driveItem`]: { status: 200, data: other } }).graph);
    await expect(p3.resolveFolderLink('https://1drv.ms/f/s!abc')).rejects.toThrow('outra conta');

    const p4 = new OneDriveProvider(fakeGraph({ ...own, [`GET /shares/${enc}/driveItem`]: { status: 200, data: folderItem('F', 'Pasta') } }).graph);
    await expect(p4.resolveFolderLink('https://1drv.ms/f/s!abc')).resolves.toMatchObject({ id: 'F', path: '/Pasta' });
  });
});
