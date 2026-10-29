import type { ICachePlugin, TokenCacheContext } from '@azure/msal-node';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

/** Guarda o cache do MSAL num arquivo legível só pelo usuário (0600). */
export function createTokenCachePlugin(file: string): ICachePlugin {
  return {
    async beforeCacheAccess(ctx: TokenCacheContext) {
      if (existsSync(file)) ctx.tokenCache.deserialize(readFileSync(file, 'utf8'));
    },
    async afterCacheAccess(ctx: TokenCacheContext) {
      if (!ctx.cacheHasChanged) return;
      writeFileSync(file, ctx.tokenCache.serialize(), { mode: 0o600 });
      chmodSync(file, 0o600);
    },
  };
}
