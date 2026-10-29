import type { CloudFolder, CloudItem, RestoreResult } from '@twinpix/shared';

export interface ChildrenPage {
  files: CloudItem[];
  folders: CloudFolder[];
  nextPageToken: string | null;
}

export interface CloudProvider {
  getRoot(): Promise<CloudFolder>;
  listFolders(parentId: string): Promise<CloudFolder[]>;
  listChildren(folderId: string, pageToken: string | null): Promise<ChildrenPage>;
  getItem(id: string): Promise<CloudItem | null>;
  getThumbnailUrl(id: string): Promise<string | null>;
  moveToTrash(id: string): Promise<'moved' | 'already-gone'>;
  restore(id: string): Promise<RestoreResult>;
  resolveFolderLink(url: string): Promise<CloudFolder>;
}
