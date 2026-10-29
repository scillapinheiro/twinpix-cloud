import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createTokenCachePlugin } from './token-cache';

function context(serialized: string, changed: boolean) {
  let loaded = '';
  return {
    cacheHasChanged: changed,
    tokenCache: {
      serialize: () => serialized,
      deserialize: (s: string) => { loaded = s; },
    },
    get loaded() { return loaded; },
  };
}

describe('cache de token', () => {
  it('grava só quando muda, com permissão 0600, e lê de volta', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'twinpix-'));
    const file = join(dir, 'msal-cache.json');
    const plugin = createTokenCachePlugin(file);

    await plugin.afterCacheAccess(context('{"a":1}', true) as any);
    expect(readFileSync(file, 'utf8')).toBe('{"a":1}');
    expect(statSync(file).mode & 0o777).toBe(0o600);

    await plugin.afterCacheAccess(context('{"b":2}', false) as any);
    expect(readFileSync(file, 'utf8')).toBe('{"a":1}');

    const ctx = context('', false);
    await plugin.beforeCacheAccess(ctx as any);
    expect(ctx.loaded).toBe('{"a":1}');
  });
});
