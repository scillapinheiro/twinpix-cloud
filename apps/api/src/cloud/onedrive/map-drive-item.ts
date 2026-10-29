import type { CloudFolder, CloudItem } from '@twinpix/shared';

export interface DriveItem {
  id: string;
  name: string;
  size?: number;
  webUrl: string;
  createdDateTime: string;
  lastModifiedDateTime: string;
  parentReference?: { driveId?: string; id?: string; path?: string };
  file?: { mimeType?: string; hashes?: { quickXorHash?: string } };
  folder?: { childCount: number };
  root?: Record<string, unknown>;
  fileSystemInfo?: { createdDateTime?: string };
  photo?: { takenDateTime?: string; cameraMake?: string; cameraModel?: string };
  image?: { width?: number; height?: number };
  video?: { width?: number; height?: number; duration?: number };
}

const ROOT_PREFIX = /^\/drives?(?:\/[^/]+)?\/root:/;

export function folderPathOf(item: DriveItem): string {
  const raw = item.parentReference?.path;
  if (!raw) return '/';
  const rest = raw.replace(ROOT_PREFIX, '');
  const decoded = decodeURIComponent(rest);
  return decoded === '' ? '/' : decoded;
}

function join(folder: string, name: string): string {
  return folder === '/' ? `/${name}` : `${folder}/${name}`;
}

export function mapFile(item: DriveItem): CloudItem | null {
  if (!item.file) return null;
  const mime = item.file.mimeType ?? '';
  const kind = item.video || mime.startsWith('video/') ? 'video' : item.photo || item.image || mime.startsWith('image/') ? 'photo' : null;
  if (!kind) return null;
  const dims = item.image ?? item.video;
  return {
    id: item.id,
    name: item.name,
    folderPath: folderPathOf(item),
    size: item.size ?? 0,
    quickXorHash: item.file.hashes?.quickXorHash ?? null,
    mimeType: mime,
    kind,
    takenAt: item.photo?.takenDateTime ?? null,
    createdAt: item.fileSystemInfo?.createdDateTime ?? item.createdDateTime,
    modifiedAt: item.lastModifiedDateTime,
    width: dims?.width ?? null,
    height: dims?.height ?? null,
    cameraMake: item.photo?.cameraMake ?? null,
    cameraModel: item.photo?.cameraModel ?? null,
    durationMs: item.video?.duration ?? null,
    webUrl: item.webUrl,
  };
}

export function mapFolder(item: DriveItem): CloudFolder {
  return {
    id: item.id,
    name: item.name,
    path: item.root ? '/' : join(folderPathOf(item), item.name),
    childCount: item.folder?.childCount ?? 0,
  };
}
