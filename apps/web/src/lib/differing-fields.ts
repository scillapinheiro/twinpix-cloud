import type { CloudItem } from '@twinpix/shared';
import { formatBytes, formatCamera, formatDate, formatDimensions, formatDuration } from './format';

export type FieldKey = 'name' | 'folderPath' | 'dimensions' | 'size' | 'takenAt' | 'modifiedAt' | 'camera' | 'duration';

export const FIELD_LABELS: Record<FieldKey, string> = {
  name: 'Arquivo',
  folderPath: 'Pasta',
  dimensions: 'Dimensões',
  size: 'Tamanho',
  takenAt: 'Tirada em',
  modifiedAt: 'Modificada em',
  camera: 'Câmera',
  duration: 'Duração',
};

export function fieldValue(file: CloudItem, key: FieldKey): string {
  switch (key) {
    case 'name': return file.name;
    case 'folderPath': return file.folderPath;
    case 'dimensions': return formatDimensions(file.width, file.height);
    case 'size': return formatBytes(file.size);
    case 'takenAt': return formatDate(file.takenAt ?? file.createdAt);
    case 'modifiedAt': return formatDate(file.modifiedAt);
    case 'camera': return formatCamera(file.cameraMake, file.cameraModel);
    case 'duration': return file.kind === 'video' ? formatDuration(file.durationMs) : '—';
  }
}

export function differingFields(files: CloudItem[]): Set<FieldKey> {
  const keys = Object.keys(FIELD_LABELS) as FieldKey[];
  return new Set(keys.filter((k) => new Set(files.map((f) => fieldValue(f, k))).size > 1));
}
