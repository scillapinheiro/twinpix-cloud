import { describe, expect, it, vi } from 'vitest';
import { ForbiddenError, GraphError, InvalidLinkError, TestFolderLockError } from '../errors';
import { isInsideFolder } from '../test-folder';
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

describe('OneDriveProvider com a trava da pasta de teste', () => {
  const T = '/TwinPix Teste';
  const photo = (id: string, parentPath: string) => ({
    id, name: `${id}.jpg`, size: 1, webUrl: '', createdDateTime: 'c', lastModifiedDateTime: 'm',
    parentReference: { driveId: 'meu', path: parentPath }, file: { mimeType: 'image/jpeg' },
  });
  const locked = (routes: Record<string, { status: number; data: unknown }>) => {
    const g = fakeGraph(routes);
    return { ...g, p: new OneDriveProvider(g.graph, { testFolder: T }) };
  };
  const called = (request: ReturnType<typeof fakeGraph>['request'], method: string) =>
    request.mock.calls.some(([m]) => m === method);

  it('move para a lixeira item da pasta de teste e das subpastas (consulta o item antes)', async () => {
    const { p, request } = locked({
      'GET /me/drive/items/A': { status: 200, data: photo('A', '/drive/root:/TwinPix%20Teste') },
      'DELETE /me/drive/items/A': { status: 204, data: null },
      'GET /me/drive/items/B': { status: 200, data: photo('B', '/drive/root:/TwinPix Teste/Sub') },
      'DELETE /me/drive/items/B': { status: 204, data: null },
    });
    expect(await p.moveToTrash('A')).toBe('moved');
    expect(await p.moveToTrash('B')).toBe('moved');
    expect(request.mock.calls.map(([m, path]) => `${m} ${String(path).split('?')[0]}`)).toEqual([
      'GET /me/drive/items/A', 'DELETE /me/drive/items/A', 'GET /me/drive/items/B', 'DELETE /me/drive/items/B',
    ]);
  });

  it('recusa mover item fora da pasta de teste, com nome parecido, a própria pasta e item sem caminho', async () => {
    const { p, request } = locked({
      'GET /me/drive/items/F': { status: 200, data: photo('F', '/drive/root:/Fotos') },
      'GET /me/drive/items/S': { status: 200, data: photo('S', '/drive/root:/TwinPix Teste 2') },
      'GET /me/drive/items/R': { status: 200, data: photo('R', '/drive/root:') },
      'GET /me/drive/items/P': { status: 200, data: folderItem('P', 'TwinPix Teste') },
      'GET /me/drive/items/N': { status: 200, data: { ...photo('N', ''), parentReference: { driveId: 'meu' } } },
    });
    for (const id of ['F', 'S', 'R', 'P', 'N']) {
      await expect(p.moveToTrash(id)).rejects.toBeInstanceOf(TestFolderLockError);
    }
    expect(called(request, 'DELETE')).toBe(false);
  });

  it('a recusa é um ForbiddenError (o app registra como falha, sem tentar conferir)', async () => {
    const { p } = locked({ 'GET /me/drive/items/F': { status: 200, data: photo('F', '/drive/root:/Fotos') } });
    const e = await p.moveToTrash('F').catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ForbiddenError);
    expect((e as Error).message).toContain(T);
  });

  it('item que já sumiu: já não estava, sem DELETE', async () => {
    const { p, request } = locked({ 'GET /me/drive/items/X': { status: 404, data: null } });
    expect(await p.moveToTrash('X')).toBe('already-gone');
    expect(called(request, 'DELETE')).toBe(false);
  });

  it('restaura só o que este provedor conferiu e moveu; o resto é recusado sem POST', async () => {
    const { p, request } = locked({
      'GET /me/drive/items/A': { status: 200, data: photo('A', '/drive/root:/TwinPix Teste') },
      'DELETE /me/drive/items/A': { status: 204, data: null },
      'POST /me/drive/items/A/restore': { status: 200, data: {} },
    });
    await expect(p.restore('A')).rejects.toBeInstanceOf(TestFolderLockError);
    await expect(p.restore('Z')).rejects.toBeInstanceOf(TestFolderLockError);
    expect(called(request, 'POST')).toBe(false);
    await p.moveToTrash('A');
    expect(await p.restore('A')).toBe('restored');
    await expect(p.restore('A')).rejects.toBeInstanceOf(TestFolderLockError);
  });

  it('restauração sem sucesso mantém a permissão para tentar de novo', async () => {
    const { p } = locked({
      'GET /me/drive/items/A': { status: 200, data: photo('A', '/drive/root:/TwinPix Teste') },
      'DELETE /me/drive/items/A': { status: 204, data: null },
      'POST /me/drive/items/A/restore': { status: 409, data: null },
    });
    await p.moveToTrash('A');
    expect(await p.restore('A')).toBe('conflict');
    expect(await p.restore('A')).toBe('conflict');
  });

  it('análise: lista só pastas dentro da pasta de teste; continuação de página não reconsulta', async () => {
    const children = { status: 200, data: { value: [photo('A', '/drive/root:/TwinPix Teste')] } };
    const { p, request } = locked({
      'GET /me/drive/items/T': { status: 200, data: folderItem('T', 'TwinPix Teste') },
      'GET /me/drive/items/T/children': children,
      'GET /me/drive/items/S': { status: 200, data: folderItem('S', 'Sub', '/drive/root:/TwinPix Teste') },
      'GET /me/drive/items/S/children': children,
      'GET /me/drive/items/O': { status: 200, data: folderItem('O', 'Fotos') },
      'GET /me/drive/items/R': { status: 200, data: { ...folderItem('R', 'root'), root: {} } },
    });
    expect((await p.listChildren('T', null)).files).toHaveLength(1);
    expect((await p.listChildren('S', null)).files).toHaveLength(1);
    await expect(p.listChildren('O', null)).rejects.toBeInstanceOf(TestFolderLockError);
    await expect(p.listChildren('R', null)).rejects.toBeInstanceOf(TestFolderLockError);
    expect(request.mock.calls.some(([, path]) => String(path).startsWith('/me/drive/items/O/children'))).toBe(false);
    request.mockClear();
    request.mockImplementationOnce(async () => children);
    await p.listChildren('T', 'https://graph.microsoft.com/v1.0/next');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('o seletor de pastas continua navegando a partir da raiz', async () => {
    const { p } = locked({
      'GET /me/drive/items/root/children': { status: 200, data: { value: [folderItem('T', 'TwinPix Teste'), folderItem('O', 'Fotos')] } },
    });
    expect((await p.listFolders('root')).map((f) => f.path)).toEqual(['/Fotos', '/TwinPix Teste']);
  });
});

describe('isInsideFolder', () => {
  it('aceita a pasta e o que está dentro dela, sem diferenciar maiúsculas; recusa nomes parecidos', () => {
    expect(isInsideFolder('/TwinPix Teste', '/TwinPix Teste')).toBe(true);
    expect(isInsideFolder('/twinpix teste/Sub', '/TwinPix Teste')).toBe(true);
    expect(isInsideFolder('/TwinPix Teste 2', '/TwinPix Teste')).toBe(false);
    expect(isInsideFolder('/', '/TwinPix Teste')).toBe(false);
    expect(isInsideFolder('/Outra/TwinPix Teste', '/TwinPix Teste')).toBe(false);
  });
});
