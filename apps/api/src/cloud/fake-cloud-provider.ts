import type { CloudFolder, CloudItem, RestoreResult } from '@twinpix/shared';
import type { ChildrenPage, CloudProvider } from './cloud-provider';
import { InvalidLinkError } from './errors';

type Method = keyof CloudProvider;

interface FolderNode { folder: CloudFolder; parentId: string | null }
interface FileNode { item: CloudItem; parentId: string }

const LINK_PREFIX = 'https://fake.onedrive/';

export class FakeCloudProvider implements CloudProvider {
  pageSize = 50;
  readonly rootId = 'root';
  readonly calls: string[] = [];
  private folders = new Map<string, FolderNode>();
  private files = new Map<string, FileNode>();
  private trash = new Map<string, FileNode>();
  private faults: Array<{ method: Method; error: Error; times: number }> = [];
  private nextId = 1;

  constructor() {
    this.folders.set(this.rootId, {
      folder: { id: this.rootId, name: 'OneDrive', path: '/', childCount: 0 },
      parentId: null,
    });
  }

  addFolder(parentId: string, name: string): CloudFolder {
    const parent = this.mustFolder(parentId);
    const path = parent.folder.path === '/' ? `/${name}` : `${parent.folder.path}/${name}`;
    const folder: CloudFolder = { id: `folder-${this.nextId++}`, name, path, childCount: 0 };
    this.folders.set(folder.id, { folder, parentId });
    return folder;
  }

  addFile(parentId: string, partial: Partial<CloudItem> & { name: string }): CloudItem {
    const parent = this.mustFolder(parentId);
    const id = partial.id ?? `file-${this.nextId++}`;
    const isVideo = partial.kind === 'video' || /\.(mp4|mov)$/i.test(partial.name);
    const item: CloudItem = {
      folderPath: parent.folder.path,
      size: 1000,
      quickXorHash: `hash-${id}`,
      mimeType: isVideo ? 'video/mp4' : 'image/jpeg',
      kind: isVideo ? 'video' : 'photo',
      takenAt: '2015-02-06T22:26:31Z',
      createdAt: '2015-02-07T10:00:00Z',
      modifiedAt: '2015-02-07T10:00:00Z',
      width: 4000,
      height: 3000,
      cameraMake: null,
      cameraModel: null,
      durationMs: isVideo ? 10_000 : null,
      webUrl: `https://fake.onedrive/view/${id}`,
      ...partial,
      id,
    };
    this.files.set(id, { item, parentId });
    return item;
  }

  updateFile(id: string, patch: Partial<CloudItem>): void {
    const node = this.files.get(id);
    if (!node) throw new Error(`arquivo ${id} não existe`);
    node.item = { ...node.item, ...patch };
  }

  /** Simula exclusão feita fora do app (ex.: pelo celular). */
  removeFile(id: string): void {
    this.files.delete(id);
  }

  isInTrash(id: string): boolean {
    return this.trash.has(id);
  }

  failNext(method: Method, error: Error, times = 1): void {
    this.faults.push({ method, error, times });
  }

  async getRoot(): Promise<CloudFolder> {
    this.enter('getRoot');
    return this.withCount(this.mustFolder(this.rootId).folder);
  }

  async listFolders(parentId: string): Promise<CloudFolder[]> {
    this.enter('listFolders');
    return this.childFolders(parentId).map((f) => this.withCount(f));
  }

  async listChildren(folderId: string, pageToken: string | null): Promise<ChildrenPage> {
    this.enter('listChildren');
    const entries: Array<{ folder?: CloudFolder; file?: CloudItem }> = [
      ...this.childFolders(folderId).map((folder) => ({ folder: this.withCount(folder) })),
      ...this.childFiles(folderId).map((file) => ({ file })),
    ];
    const start = pageToken ? Number(pageToken) : 0;
    const slice = entries.slice(start, start + this.pageSize);
    const next = start + this.pageSize < entries.length ? String(start + this.pageSize) : null;
    return {
      folders: slice.flatMap((e) => (e.folder ? [e.folder] : [])),
      files: slice.flatMap((e) => (e.file ? [e.file] : [])),
      nextPageToken: next,
    };
  }

  async getItem(id: string): Promise<CloudItem | null> {
    this.enter('getItem');
    return this.files.get(id)?.item ?? null;
  }

  async getThumbnailUrl(id: string): Promise<string | null> {
    this.enter('getThumbnailUrl');
    const item = this.files.get(id)?.item ?? this.trash.get(id)?.item;
    if (!item) return null;
    const hue = [...(item.quickXorHash ?? item.id)].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
    const label = item.kind === 'video' ? '▶ vídeo' : 'foto';
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240">` +
      `<rect width="320" height="240" fill="hsl(${hue},55%,62%)"/>` +
      `<text x="160" y="128" font-family="sans-serif" font-size="22" text-anchor="middle" fill="#fff">${label}</text></svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  }

  async moveToTrash(id: string): Promise<'moved' | 'already-gone'> {
    this.enter('moveToTrash');
    const node = this.files.get(id);
    if (!node) return 'already-gone';
    this.files.delete(id);
    this.trash.set(id, node);
    return 'moved';
  }

  async restore(id: string): Promise<RestoreResult> {
    this.enter('restore');
    const node = this.trash.get(id);
    if (!node) return 'not-in-trash';
    const taken = this.childFiles(node.parentId).some((f) => f.name === node.item.name);
    if (taken || !this.folders.has(node.parentId)) return 'conflict';
    this.trash.delete(id);
    this.files.set(id, node);
    return 'restored';
  }

  async resolveFolderLink(url: string): Promise<CloudFolder> {
    this.enter('resolveFolderLink');
    if (!url.startsWith(LINK_PREFIX)) throw new InvalidLinkError('No modo demonstração, só dá para escolher as pastas fictícias da lista acima.');
    const node = this.folders.get(url.slice(LINK_PREFIX.length));
    if (!node) throw new InvalidLinkError('Não encontrei essa pasta. Confira se o link está completo.');
    return this.withCount(node.folder);
  }

  private enter(method: Method): void {
    this.calls.push(method);
    const fault = this.faults.find((f) => f.method === method);
    if (fault) {
      fault.times -= 1;
      if (fault.times <= 0) this.faults.splice(this.faults.indexOf(fault), 1);
      throw fault.error;
    }
  }

  private mustFolder(id: string): FolderNode {
    const node = this.folders.get(id);
    if (!node) throw new Error(`pasta ${id} não existe`);
    return node;
  }

  private childFolders(parentId: string): CloudFolder[] {
    return [...this.folders.values()]
      .filter((n) => n.parentId === parentId)
      .map((n) => n.folder)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private childFiles(parentId: string): CloudItem[] {
    return [...this.files.values()]
      .filter((n) => n.parentId === parentId)
      .map((n) => n.item)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private withCount(folder: CloudFolder): CloudFolder {
    return { ...folder, childCount: this.childFolders(folder.id).length + this.childFiles(folder.id).length };
  }
}
