import { describe, expect, it } from 'vitest';
import { InvalidLinkError, OfflineError } from './errors';
import { FakeCloudProvider } from './fake-cloud-provider';
import { seedDemo } from './demo-seed';

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
