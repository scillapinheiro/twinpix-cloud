import type { CloudFolder, CloudItem, RestoreResult } from '@twinpix/shared';
import type { ChildrenPage, CloudProvider } from '../cloud-provider';
import { GraphError, InvalidLinkError } from '../errors';
import type { GraphClient } from './graph-client';
import { mapFile, mapFolder, type DriveItem } from './map-drive-item';

const SELECT =
  'id,name,size,webUrl,createdDateTime,lastModifiedDateTime,parentReference,file,folder,root,fileSystemInfo,photo,image,video';
const LINK_HOSTS = ['1drv.ms', 'onedrive.live.com'];

interface Page { value: DriveItem[]; '@odata.nextLink'?: string }

export function encodeShareUrl(url: string): string {
  return 'u!' + Buffer.from(url, 'utf8').toString('base64').replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-');
}

export class OneDriveProvider implements CloudProvider {
  private ownDriveId: string | null = null;

  constructor(private readonly graph: GraphClient) {}

  async getRoot(): Promise<CloudFolder> {
    const { data } = await this.graph.request<DriveItem>('GET', `/me/drive/root?$select=${SELECT}`);
    return mapFolder(data!);
  }

  async listFolders(parentId: string): Promise<CloudFolder[]> {
    const folders: CloudFolder[] = [];
    let token: string | null = null;
    do {
      const page = await this.listChildren(parentId, token);
      folders.push(...page.folders);
      token = page.nextPageToken;
    } while (token);
    return folders.sort((a, b) => a.name.localeCompare(b.name));
  }

  async listChildren(folderId: string, pageToken: string | null): Promise<ChildrenPage> {
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
    const { status } = await this.graph.request('DELETE', `/me/drive/items/${encodeURIComponent(id)}`);
    if (status === 404) return 'already-gone';
    if (status === 200 || status === 204) return 'moved';
    throw new GraphError(status, '');
  }

  async restore(id: string): Promise<RestoreResult> {
    const { status } = await this.graph.request('POST', `/me/drive/items/${encodeURIComponent(id)}/restore`, {});
    if (status === 404) return 'not-in-trash';
    if (status === 409) return 'conflict';
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
    const { status, data } = await this.graph.request<DriveItem>('GET', `/shares/${encodeShareUrl(url)}/driveItem?$select=${SELECT}`);
    if (status === 404 || !data) throw new InvalidLinkError('Não encontrei essa pasta. Confira se o link está completo.');
    if (!data.folder) throw new InvalidLinkError('Este link não é de uma pasta.');
    const own = await this.getOwnDriveId();
    if (data.parentReference?.driveId && data.parentReference.driveId.toLowerCase() !== own.toLowerCase()) {
      throw new InvalidLinkError('Esta pasta é de outra conta. Nesta versão, só dá para analisar pastas do seu próprio OneDrive.');
    }
    return mapFolder(data);
  }

  private async getOwnDriveId(): Promise<string> {
    if (!this.ownDriveId) {
      const { data } = await this.graph.request<{ id: string }>('GET', '/me/drive?$select=id');
      this.ownDriveId = data?.id ?? '';
    }
    return this.ownDriveId;
  }
}
