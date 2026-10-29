import type { CloudFolder, CloudItem, RestoreResult } from '@twinpix/shared';
import type { ChildrenPage, CloudProvider } from '../cloud-provider';
import { GraphError, InvalidLinkError, TestFolderLockError } from '../errors';
import { isInsideFolder } from '../test-folder';
import type { GraphClient } from './graph-client';
import { folderPathOf, mapFile, mapFolder, type DriveItem } from './map-drive-item';

const SELECT =
  'id,name,size,webUrl,createdDateTime,lastModifiedDateTime,parentReference,file,folder,root,fileSystemInfo,photo,image,video';
const LINK_HOSTS = ['1drv.ms', 'onedrive.live.com'];

interface Page { value: DriveItem[]; '@odata.nextLink'?: string }

export function encodeShareUrl(url: string): string {
  return 'u!' + Buffer.from(url, 'utf8').toString('base64').replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-');
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

export type OneDriveAddress =
  | { kind: 'path'; driveId: string; path: string }
  | { kind: 'item'; driveId: string; itemId: string }
  | { kind: 'share' };

/** Classifica o endereço colado: barra do navegador (novo/antigo) ou link de compartilhamento. null = inválido. */
export function parseOneDriveAddress(url: string): OneDriveAddress | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  if (u.hostname !== 'onedrive.live.com') return { kind: 'share' };
  if (u.searchParams.has('redeem')) return { kind: 'share' };
  const id = u.searchParams.get('id');
  if (!id) return { kind: 'share' };
  if (id.startsWith('/')) {
    const m = /^\/personal\/([^/]+)\/Documents(?:\/(.*))?$/is.exec(id);
    if (!m || CONTROL.test(id)) return null;
    const path = (m[2] ?? '').replace(/\/+$/, '');
    if (path !== '' && path.split('/').some((seg) => seg.trim() === '' || seg === '.' || seg === '..')) return null;
    return { kind: 'path', driveId: m[1], path };
  }
  const cid = u.searchParams.get('cid');
  if (cid && (id === 'root' || /^[0-9a-f]+!\d+$/i.test(id))) return { kind: 'item', driveId: cid, itemId: id };
  return { kind: 'share' };
}

const OTHER_ACCOUNT = 'Esta pasta é de outra conta. Nesta versão, só dá para analisar pastas do seu próprio OneDrive.';

export interface OneDriveOptions {
  /** Trava da pasta de teste ("/TwinPix Teste"); null = sem trava. */
  testFolder?: string | null;
}

export class OneDriveProvider implements CloudProvider {
  private ownDriveId: string | null = null;
  private readonly testFolder: string | null;
  /**
   * Com a trava: ids que ESTE processo conferiu (arquivo dentro da pasta de teste) e tentou mover para
   * a lixeira. Item na lixeira não pode ser consultado (o Graph responde 404), então a restauração só é
   * permitida para esses ids; qualquer outro é recusado sem chamar o OneDrive.
   */
  private readonly trashedHere = new Set<string>();

  constructor(private readonly graph: GraphClient, opts: OneDriveOptions = {}) {
    this.testFolder = opts.testFolder ?? null;
  }

  async getRoot(): Promise<CloudFolder> {
    const { data } = await this.graph.request<DriveItem>('GET', `/me/drive/root?$select=${SELECT}`);
    return mapFolder(data!);
  }

  async listFolders(parentId: string): Promise<CloudFolder[]> {
    const folders: CloudFolder[] = [];
    let token: string | null = null;
    do {
      // o seletor de pastas navega a partir da raiz: só lista nomes, não passa pela trava
      const page = await this.fetchChildren(parentId, token);
      folders.push(...page.folders);
      token = page.nextPageToken;
    } while (token);
    return folders.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Usado pela análise: com a trava, a pasta precisa estar dentro da pasta de teste. */
  async listChildren(folderId: string, pageToken: string | null): Promise<ChildrenPage> {
    if (this.testFolder && !pageToken) {
      const { status, data } = await this.graph.request<DriveItem>('GET', `/me/drive/items/${encodeURIComponent(folderId)}?$select=${SELECT}`);
      if (status === 404 || !data?.folder || !isInsideFolder(mapFolder(data).path, this.testFolder)) {
        throw new TestFolderLockError(this.testFolder, 'analisar pastas');
      }
    }
    return this.fetchChildren(folderId, pageToken);
  }

  private async fetchChildren(folderId: string, pageToken: string | null): Promise<ChildrenPage> {
    const url = pageToken ?? `/me/drive/items/${encodeURIComponent(folderId)}/children?$top=200&$select=${SELECT}`;
    const { data } = await this.graph.request<Page>('GET', url);
    const value = data?.value ?? [];
    return {
      folders: value.filter((i) => i.folder).map(mapFolder),
      files: value.map(mapFile).filter((f): f is CloudItem => f !== null),
      nextPageToken: data?.['@odata.nextLink'] ?? null,
    };
  }

  async getItem(id: string): Promise<CloudItem | null> {
    const { status, data } = await this.graph.request<DriveItem>('GET', `/me/drive/items/${encodeURIComponent(id)}?$select=${SELECT}`);
    if (status === 404 || !data) return null;
    return mapFile(data);
  }

  async getThumbnailUrl(id: string): Promise<string | null> {
    const { data } = await this.graph.request<{ url?: string }>('GET', `/me/drive/items/${encodeURIComponent(id)}/thumbnails/0/large`);
    return data?.url ?? null;
  }

  async moveToTrash(id: string): Promise<'moved' | 'already-gone'> {
    if (this.testFolder) {
      const { status, data } = await this.graph.request<DriveItem>('GET', `/me/drive/items/${encodeURIComponent(id)}?$select=${SELECT}`);
      if (status === 404 || !data) return 'already-gone';
      // só arquivos com caminho conhecido dentro da pasta (nunca a própria pasta nem pastas)
      if (!data.file || !data.parentReference?.path || !isInsideFolder(folderPathOf(data), this.testFolder)) {
        throw new TestFolderLockError(this.testFolder);
      }
      // antes do DELETE: se a resposta se perder (tempo esgotado, 503 seguido de 404), ainda dá para
      // restaurar; a restauração só devolve o item para a pasta que acabou de ser conferida
      this.trashedHere.add(id);
    }
    const { status } = await this.graph.request('DELETE', `/me/drive/items/${encodeURIComponent(id)}`);
    if (status === 404) return 'already-gone';
    if (status === 200 || status === 204) return 'moved';
    throw new GraphError(status, '');
  }

  async restore(id: string): Promise<RestoreResult> {
    if (this.testFolder && !this.trashedHere.has(id)) throw new TestFolderLockError(this.testFolder);
    const { status } = await this.graph.request('POST', `/me/drive/items/${encodeURIComponent(id)}/restore`, {});
    if (status === 404) return 'not-in-trash';
    if (status === 409) return 'conflict';
    this.trashedHere.delete(id);
    return 'restored';
  }

  async resolveFolderLink(url: string): Promise<CloudFolder> {
    let host: string;
    try {
      host = new URL(url).hostname;
    } catch {
      throw new InvalidLinkError('Isso não parece um link. Copie o endereço da pasta no OneDrive e cole aqui.');
    }
    if (!LINK_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) {
      throw new InvalidLinkError('Este link não é do OneDrive.');
    }
    const addr = parseOneDriveAddress(url);
    if (!addr) throw new InvalidLinkError('Isso não parece um link. Copie o endereço da pasta no OneDrive e cole aqui.');
    const own = await this.getOwnDriveId();
    if (addr.kind !== 'share' && addr.driveId.toLowerCase() !== own.toLowerCase()) throw new InvalidLinkError(OTHER_ACCOUNT);
    if (addr.kind === 'path' && addr.path === '') return this.getRoot();
    if (addr.kind === 'item' && addr.itemId === 'root') return this.getRoot();
    const route = addr.kind === 'share'
      ? `/shares/${encodeShareUrl(url)}/driveItem`
      : addr.kind === 'path'
        ? `/me/drive/root:/${addr.path.split('/').map(encodeURIComponent).join('/')}`
        : `/me/drive/items/${encodeURIComponent(addr.itemId)}`;
    const { status, data } = await this.graph.request<DriveItem>('GET', `${route}?$select=${SELECT}`);
    return mapFolder(this.requireFolder(status, data, own));
  }

  private requireFolder(status: number, data: DriveItem | null | undefined, own: string): DriveItem {
    if (status === 404 || !data) throw new InvalidLinkError('Não encontrei essa pasta. Confira se o link está completo.');
    if (!data.folder) throw new InvalidLinkError('Este link não é de uma pasta.');
    if (!data.root) {
      const drive = data.parentReference?.driveId;
      if (!drive || drive.toLowerCase() !== own.toLowerCase()) throw new InvalidLinkError(OTHER_ACCOUNT);
    }
    return data;
  }

  private async getOwnDriveId(): Promise<string> {
    if (!this.ownDriveId) {
      const { data } = await this.graph.request<{ id: string }>('GET', '/me/drive?$select=id');
      if (!data?.id) return '';
      this.ownDriveId = data.id;
    }
    return this.ownDriveId;
  }
}
