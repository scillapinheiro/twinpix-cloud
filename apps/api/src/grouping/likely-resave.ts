import type { CloudItem } from '@twinpix/shared';
import { hasCopySuffix } from './name-base';

export type ResaveVerdict = { ok: true; keepId: string } | { ok: false; reason: string };

const MAX_SIZE_RATIO = 1.02;
const MAX_DURATION_DIFF_MS = 1000;

/** Decide se um grupo de prováveis cópias é uma regravação segura (só o nome ganhou sufixo). */
export function isLikelyResave(files: CloudItem[]): ResaveVerdict {
  const no = (reason: string): ResaveVerdict => ({ ok: false, reason });
  if (files.length < 2) return no('menos de 2 arquivos');

  const plain = files.filter((f) => !hasCopySuffix(f.name));
  if (plain.length !== 1) return no('não há exatamente uma cópia sem sufixo');

  const first = files[0];
  if (files.some((f) => f.kind !== first.kind)) return no('tipos misturados');
  if (files.some((f) => f.width === null || f.height === null)) return no('dimensões ausentes');
  if (files.some((f) => f.width !== first.width || f.height !== first.height)) return no('dimensões diferentes');
  if (files.some((f) => f.takenAt === null)) return no('data de captura ausente');
  if (files.some((f) => f.takenAt !== first.takenAt)) return no('data de captura diferente');
  if (files.some((f) => f.cameraMake !== first.cameraMake || f.cameraModel !== first.cameraModel)) return no('câmera diferente');

  const sizes = files.map((f) => f.size);
  if (Math.max(...sizes) > MAX_SIZE_RATIO * Math.min(...sizes)) return no('tamanhos diferem mais de 2%');

  if (first.kind === 'video') {
    const durations = files.map((f) => f.durationMs);
    if (durations.some((d) => d === null)) return no('duração ausente');
    const ds = durations as number[];
    if (Math.max(...ds) - Math.min(...ds) > MAX_DURATION_DIFF_MS) return no('durações diferem mais de 1 s');
  }

  return { ok: true, keepId: plain[0].id };
}
