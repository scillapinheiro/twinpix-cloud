import { describe, expect, it, vi } from 'vitest';
import { GraphError, InvalidLinkError } from '../errors';
import type { GraphClient } from './graph-client';
import { encodeShareUrl, OneDriveProvider, parseOneDriveAddress } from './onedrive-provider';

const SELECT_FOR_TEST = 'id,name,size,webUrl,createdDateTime,lastModifiedDateTime,parentReference,file,folder,root,fileSystemInfo,photo,image,video';

const inDrive = (i: ReturnType<typeof folderItem>, driveId: string) => ({ ...i, parentReference: { ...i.parentReference, driveId } });

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

  it('lixeira: 409 não é confirmado como movido', async () => {
    const { graph } = fakeGraph({ 'DELETE /me/drive/items/Z': { status: 409, data: null } });
    await expect(new OneDriveProvider(graph).moveToTrash('Z')).rejects.toBeInstanceOf(GraphError);
  });

  it('link: compara o id da conta sem diferenciar maiúsculas', async () => {
    const enc = encodeShareUrl('https://1drv.ms/f/s!abc');
    const item = { ...folderItem('F', 'Pasta'), parentReference: { driveId: 'MEU', path: '/drive/root:' } };
    const p = new OneDriveProvider(fakeGraph({
      'GET /me/drive': { status: 200, data: { id: 'meu' } },
      [`GET /shares/${enc}/driveItem`]: { status: 200, data: item },
    }).graph);
    await expect(p.resolveFolderLink('https://1drv.ms/f/s!abc')).resolves.toMatchObject({ id: 'F' });
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

  const NEW = 'https://onedrive.live.com/my?id=%2Fpersonal%2F74c059baed225922%2FDocuments%2FeNe%20Solucoes%2FConfraeNe%202023%2FConfra%20eNe%20%28PORTRAIT%29&sortField=LinkFilename&isAscending=true&viewid=35ca777c%2D8a3a%2D4639%2D8d81%2De98facff530b';

  it('parseOneDriveAddress classifica os formatos', () => {
    expect(parseOneDriveAddress(NEW)).toEqual({ kind: 'path', driveId: '74c059baed225922', path: 'eNe Solucoes/ConfraeNe 2023/Confra eNe (PORTRAIT)' });
    expect(parseOneDriveAddress('https://onedrive.live.com/my?id=%2Fpersonal%2Fabc%2FDocuments')).toEqual({ kind: 'path', driveId: 'abc', path: '' });
    expect(parseOneDriveAddress('https://onedrive.live.com/?id=74C059BAED225922%21123&cid=74C059BAED225922')).toEqual({ kind: 'item', driveId: '74C059BAED225922', itemId: '74C059BAED225922!123' });
    expect(parseOneDriveAddress('https://onedrive.live.com/?id=74C059BAED225922!123&cid=74C059BAED225922')).toMatchObject({ kind: 'item', itemId: '74C059BAED225922!123' });
    expect(parseOneDriveAddress('https://onedrive.live.com/?id=root&cid=74C059BAED225922')).toMatchObject({ kind: 'item', itemId: 'root' });
    expect(parseOneDriveAddress('https://1drv.ms/f/s!abc')).toEqual({ kind: 'share' });
    expect(parseOneDriveAddress('https://onedrive.live.com/?redeem=aHR0cHM&id=X%211&cid=Y')).toEqual({ kind: 'share' });
    expect(parseOneDriveAddress('http://onedrive.live.com/my?id=%2Fpersonal%2Fabc%2FDocuments')).toBeNull();
  });

  it('link novo: busca por caminho codificado; outra conta, 404 e arquivo são recusados', async () => {
    const own = { 'GET /me/drive': { status: 200, data: { id: '74C059BAED225922' } } };
    const route = 'GET /me/drive/root:/eNe%20Solucoes/ConfraeNe%202023/Confra%20eNe%20(PORTRAIT)';
    const ok = fakeGraph({ ...own, [route]: { status: 200, data: inDrive(folderItem('F', 'Confra eNe (PORTRAIT)'), '74c059baed225922') } });
    await expect(new OneDriveProvider(ok.graph).resolveFolderLink(NEW)).resolves.toMatchObject({ id: 'F' });
    expect(ok.request.mock.calls.map((c) => c[1])).toContain(`/me/drive/root:/eNe%20Solucoes/ConfraeNe%202023/Confra%20eNe%20(PORTRAIT)?$select=${SELECT_FOR_TEST}`);

    const otherUrl = NEW.replace('74c059baed225922', 'outro');
    await expect(new OneDriveProvider(fakeGraph(own).graph).resolveFolderLink(otherUrl)).rejects.toThrow('outra conta');
    await expect(new OneDriveProvider(fakeGraph({ ...own, [route]: { status: 404, data: null } }).graph).resolveFolderLink(NEW)).rejects.toThrow('Não encontrei');
    const file = { ...folderItem('A', 'a.jpg'), folder: undefined, file: { mimeType: 'image/jpeg' } };
    await expect(new OneDriveProvider(fakeGraph({ ...own, [route]: { status: 200, data: file } }).graph).resolveFolderLink(NEW)).rejects.toThrow('não é de uma pasta');
  });

  it('link novo sem caminho vai para a raiz; link antigo usa items/<id>', async () => {
    const own = { 'GET /me/drive': { status: 200, data: { id: 'abc' } } };
    const root = { ...folderItem('R', 'root'), root: {} };
    const p1 = new OneDriveProvider(fakeGraph({ ...own, 'GET /me/drive/root': { status: 200, data: root } }).graph);
    await expect(p1.resolveFolderLink('https://onedrive.live.com/my?id=%2Fpersonal%2FABC%2FDocuments')).resolves.toMatchObject({ id: 'R', path: '/' });
    const p2 = new OneDriveProvider(fakeGraph({ ...own, 'GET /me/drive/items/ABC!1': { status: 200, data: inDrive(folderItem('I', 'Velha'), 'abc') } }).graph);
    await expect(p2.resolveFolderLink('https://onedrive.live.com/?id=ABC%211&cid=ABC')).resolves.toMatchObject({ id: 'I' });
  });

  it('parse recusa segmentos perigosos, vazios, controle e id estranho', () => {
    const mk = (p: string) => `https://onedrive.live.com/my?id=${encodeURIComponent(`/personal/abc/Documents/${p}`)}`;
    expect(parseOneDriveAddress(mk('..'))).toBeNull();
    expect(parseOneDriveAddress(mk('a/./b'))).toBeNull();
    expect(parseOneDriveAddress(mk('../../shares/u!X/driveItem'))).toBeNull();
    expect(parseOneDriveAddress(mk('a//b'))).toBeNull();
    expect(parseOneDriveAddress(mk('a/ /b'))).toBeNull();
    expect(parseOneDriveAddress(mk('a\nb'))).toBeNull();
    expect(parseOneDriveAddress('https://onedrive.live.com/my?id=%2Fpersonal%2Fabc%2FDocuments%0A')).toBeNull();
    expect(parseOneDriveAddress('https://onedrive.live.com/my?id=%2Fpersonal%2Fabc')).toBeNull();
    expect(parseOneDriveAddress(mk('ok/pasta'))).toMatchObject({ kind: 'path', path: 'ok/pasta' });
  });

  it('pasta de outra conta é recusada nos ramos de caminho e de item', async () => {
    const own = { 'GET /me/drive': { status: 200, data: { id: 'abc' } } };
    const foreign = inDrive(folderItem('F', 'x'), 'outro');
    const p1 = new OneDriveProvider(fakeGraph({ ...own, 'GET /me/drive/root:/x': { status: 200, data: foreign } }).graph);
    await expect(p1.resolveFolderLink('https://onedrive.live.com/my?id=%2Fpersonal%2Fabc%2FDocuments%2Fx')).rejects.toThrow('outra conta');
    const p2 = new OneDriveProvider(fakeGraph({ ...own, 'GET /me/drive/items/ABC!1': { status: 200, data: foreign } }).graph);
    await expect(p2.resolveFolderLink('https://onedrive.live.com/?id=ABC%211&cid=ABC')).rejects.toThrow('outra conta');
    const noDrive = { ...folderItem('F', 'x'), parentReference: { path: '/drive/root:' } };
    const p3 = new OneDriveProvider(fakeGraph({ ...own, 'GET /me/drive/root:/x': { status: 200, data: noDrive } }).graph);
    await expect(p3.resolveFolderLink('https://onedrive.live.com/my?id=%2Fpersonal%2Fabc%2FDocuments%2Fx')).rejects.toThrow('outra conta');
  });
});
