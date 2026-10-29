import type { CloudItem } from '@twinpix/shared';
import { baseName } from './name-base';

export interface ProbableGroup {
  key: string;
  fileIds: string[];
}

/** Vídeos cuja duração difere em até isto (ms) encadeiam no mesmo grupo. */
const VIDEO_DURATION_TOLERANCE_MS = 1000;

type Candidate = CloudItem & {
  width: number;
  height: number;
  takenAt: string;
};

function isCandidate(f: CloudItem): f is Candidate {
  return f.width != null && f.height != null && f.takenAt != null;
}

/** Pelo menos dois conteúdos diferentes: hashes distintos ou hash ausente em algum. */
function hasDifferentContents(files: CloudItem[]): boolean {
  const hashes = new Set<string>();
  for (const f of files) {
    if (!f.quickXorHash) return true;
    hashes.add(f.quickXorHash);
  }
  return hashes.size > 1;
}

export function groupProbable(files: CloudItem[]): ProbableGroup[] {
  const seen = new Set<string>();
  const buckets = new Map<string, Candidate[]>();
  for (const f of files) {
    if (seen.has(f.id)) continue;
    seen.add(f.id);
    if (!isCandidate(f)) continue;
    if (f.kind === 'video' && f.durationMs == null) continue;
    const key = `p:${f.kind}:${baseName(f.name)}:${f.width}x${f.height}:${f.takenAt}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = [];
      buckets.set(key, bucket);
    }
    bucket.push(f);
  }

  const result: ProbableGroup[] = [];
  const emit = (key: string, members: Candidate[]) => {
    if (members.length > 1 && hasDifferentContents(members)) {
      result.push({ key, fileIds: members.map((m) => m.id).sort() });
    }
  };

  for (const [key, members] of buckets) {
    if (members[0].kind !== 'video') {
      emit(key, members);
      continue;
    }
    const sorted = [...members].sort(
      (a, b) => (a.durationMs as number) - (b.durationMs as number) || (a.id < b.id ? -1 : 1),
    );
    let chain: Candidate[] = [];
    let index = 0;
    for (const f of sorted) {
      const last = chain[chain.length - 1];
      if (last && (f.durationMs as number) - (last.durationMs as number) > VIDEO_DURATION_TOLERANCE_MS) {
        emit(`${key}:${index}`, chain);
        index++;
        chain = [];
      }
      chain.push(f);
    }
    emit(`${key}:${index}`, chain);
  }
  return result.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}
