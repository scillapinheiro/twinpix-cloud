import { describe, expect, it } from 'vitest';
import { ForbiddenError, InvalidLinkError, OfflineError } from './errors';
import { FakeCloudProvider } from './fake-cloud-provider';
import { seedDemo, seedDemoScenarios } from './demo-seed';

describe('FakeCloudProvider', () => {
  it('lista filhos paginados, pastas primeiro', async () => {
    const p = new FakeCloudProvider();
    p.pageSize = 2;
    const sub = p.addFolder(p.rootId, 'Sub');
    p.addFile(p.rootId, { name: 'a.jpg' });
    p.addFile(p.rootId, { name: 'b.jpg' });
    const page1 = await p.listChildren(p.rootId, null);
    expect(page1.folders.map((f) => f.name)).toEqual(['Sub']);
    expect(page1.files.map((f) => f.name)).toEqual(['a.jpg']);
    const page2 = await p.listChildren(p.rootId, page1.nextPageToken);
    expect(page2.files.map((f) => f.name)).toEqual(['b.jpg']);
    expect(page2.nextPageToken).toBeNull();
    expect(sub.path).toBe('/Sub');
  });

  it('move para a lixeira e restaura', async () => {
    const p = new FakeCloudProvider();
    const f = p.addFile(p.rootId, { name: 'a.jpg' });
    expect(await p.moveToTrash(f.id)).toBe('moved');
    expect(await p.getItem(f.id)).toBeNull();
    expect(await p.moveToTrash(f.id)).toBe('already-gone');
    expect(await p.restore(f.id)).toBe('restored');
    expect(await p.getItem(f.id)).not.toBeNull();
    expect(await p.restore(f.id)).toBe('not-in-trash');
  });

  it('restaurar com nome ocupado dá conflito', async () => {
    const p = new FakeCloudProvider();
    const f = p.addFile(p.rootId, { name: 'a.jpg' });
    await p.moveToTrash(f.id);
    p.addFile(p.rootId, { name: 'a.jpg' });
    expect(await p.restore(f.id)).toBe('conflict');
  });

  it('injeta falhas', async () => {
    const p = new FakeCloudProvider();
    p.failNext('listChildren', new OfflineError('sem rede'));
    await expect(p.listChildren(p.rootId, null)).rejects.toBeInstanceOf(OfflineError);
    await expect(p.listChildren(p.rootId, null)).resolves.toBeDefined();
  });

  it('resolve link de pasta e recusa link inválido', async () => {
    const p = new FakeCloudProvider();
    const sub = p.addFolder(p.rootId, 'Sub');
    expect(await p.resolveFolderLink(`https://fake.onedrive/${sub.id}`)).toEqual(sub);
    await expect(p.resolveFolderLink('https://example.com/x')).rejects.toBeInstanceOf(InvalidLinkError);
    await expect(p.resolveFolderLink('https://example.com/x')).rejects.toThrow('No modo demonstração');
  });

  it('dados de demonstração têm pastas e cópias idênticas', async () => {
    const p = new FakeCloudProvider();
    seedDemo(p);
    const folders = await p.listFolders(p.rootId);
    expect(folders.map((f) => f.name)).toEqual(['Imagens', 'Minhas imagens']);
  });
});

describe('cenários do modo demonstração', () => {
  it('pasta sem permissão falha ao listar, arquivo bloqueado falha ao mover e o resto continua normal', async () => {
    const p = new FakeCloudProvider();
    seedDemo(p);
    seedDemoScenarios(p, { delayMs: 0 });
    const protegido = p.folderByPath('/Imagens/Backup protegido')!;
    await expect(p.listChildren(protegido.id, null)).rejects.toBeInstanceOf(ForbiddenError);

    const album = p.folderByPath('/Imagens/Álbum compartilhado')!;
    const files = (await p.listChildren(album.id, null)).files;
    expect(files).toHaveLength(2);
    const copia = files.find((f) => f.name.endsWith(' 1.jpg'))!;
    const original = files.find((f) => !f.name.endsWith(' 1.jpg'))!;
    await expect(p.moveToTrash(copia.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(p.moveToTrash(original.id)).resolves.toBe('moved');
  });

  it('latência só vale para quem a liga', async () => {
    const p = new FakeCloudProvider();
    seedDemo(p);
    const t0 = Date.now();
    await p.listChildren(p.rootId, null);
    expect(Date.now() - t0).toBeLessThan(50);
    p.latencyMs = 60;
    const t1 = Date.now();
    await p.listChildren(p.rootId, null);
    expect(Date.now() - t1).toBeGreaterThanOrEqual(55);
  });
});
