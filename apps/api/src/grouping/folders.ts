import type { NestedRoot } from '@twinpix/shared';

function trimSlash(p: string): string {
  return p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p;
}

export function isInsideFolder(folderPath: string, folder: string): boolean {
  const child = trimSlash(folderPath).toLowerCase();
  const parent = trimSlash(folder).toLowerCase();
  if (parent === '/') return true;
  return child === parent || child.startsWith(parent + '/');
}

export function findNestedRoots(paths: string[]): NestedRoot[] {
  const result: NestedRoot[] = [];
  for (const inner of paths) {
    for (const outer of paths) {
      if (inner !== outer && isInsideFolder(inner, outer)) result.push({ inner, outer });
    }
  }
  return result;
}
