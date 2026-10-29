import { groupIdentical } from './group-identical';

export interface LsjsonItem {
  Path: string;
  Name?: string;
  Size: number;
  MimeType?: string;
  IsDir?: boolean;
  Hashes?: Record<string, string>;
}

export interface ListingStats {
  files: number;
  photos: number;
  videos: number;
  identicalGroups: number;
  extraCopies: number;
  bytesFreeable: number;
  withoutHash: number;
}

const PHOTO_EXT = /\.(jpe?g|png|gif|heic|heif|webp|bmp|tiff?|dng|cr2|nef|arw)$/i;
const VIDEO_EXT = /\.(mp4|mov|avi|mkv|m4v|3gp|wmv|mpe?g|webm)$/i;

export function mediaKind(item: LsjsonItem): 'photo' | 'video' | null {
  const mime = item.MimeType ?? '';
  if (mime.startsWith('image/')) return 'photo';
  if (mime.startsWith('video/')) return 'video';
  const name = item.Path;
  if (PHOTO_EXT.test(name)) return 'photo';
  if (VIDEO_EXT.test(name)) return 'video';
  return null;
}

export function computeListingStats(items: LsjsonItem[]): ListingStats {
  const media = items.filter((i) => !i.IsDir && mediaKind(i) !== null);
  const sizeById = new Map<string, number>();
  const files = media.map((i) => {
    sizeById.set(i.Path, i.Size);
    return {
      id: i.Path,
      size: i.Size,
      quickXorHash: i.Hashes?.quickxor ?? i.Hashes?.QuickXorHash ?? null,
    };
  });
  const groups = groupIdentical(files);
  let extraCopies = 0;
  let bytesFreeable = 0;
  for (const g of groups) {
    extraCopies += g.fileIds.length - 1;
    // all members share the same size; extras = all but one
    bytesFreeable += (g.fileIds.length - 1) * (sizeById.get(g.fileIds[0]) ?? 0);
  }
  return {
    files: media.length,
    photos: media.filter((i) => mediaKind(i) === 'photo').length,
    videos: media.filter((i) => mediaKind(i) === 'video').length,
    identicalGroups: groups.length,
    extraCopies,
    bytesFreeable,
    withoutHash: files.filter((f) => !f.quickXorHash).length,
  };
}

export type RcloneItem = LsjsonItem;

/** Merges several listings, prefixing paths with the listing index so equal relative names stay distinct. */
export function combineListings(listings: RcloneItem[][]): RcloneItem[] {
  return listings.flatMap((items, idx) => items.map((i) => ({ ...i, Path: `${idx}:${i.Path}` })));
}
