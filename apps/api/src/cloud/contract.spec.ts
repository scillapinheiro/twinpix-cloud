/**
 * Testes de contrato do provedor: o mesmo cenário roda contra o FakeCloudProvider (sempre) e contra
 * o OneDrive real (só com TWINPIX_CONTRACT=1 + TWINPIX_TEST_FOLDER + TWINPIX_CLIENT_ID + login em
 * cache). No real, a pasta de teste precisa ter exatamente teste.jpg e "teste 1.jpg" (iguais) e
 * outra.jpg; o cenário move "teste 1.jpg" para a lixeira, restaura e confere que a pasta ficou igual.
 * Rodar: TWINPIX_TEST_FOLDER='/TwinPix Teste' TWINPIX_CLIENT_ID=... npm run contract -w apps/api
 */
import type { CloudFolder, CloudItem } from '@twinpix/shared';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { AuthService } from '../auth/auth.service';
import { loadConfig } from '../config';
import type { CloudProvider } from './cloud-provider';
import { FakeCloudProvider } from './fake-cloud-provider';
import { GraphClient } from './onedrive/graph-client';
import { OneDriveProvider } from './onedrive/onedrive-provider';

const EXPECTED = [
  { name: 'outra.jpg', size: 4790 },
  { name: 'teste 1.jpg', size: 11585 },
  { name: 'teste.jpg', size: 11585 },
];
const TO_TRASH = 'teste 1.jpg';

interface Ctx {
  provider: CloudProvider;
  testFolder: string;
  /** Espera entre conferências (o OneDrive pode demorar um pouco para refletir a mudança). */
  pollMs: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function findFolder(p: CloudProvider, path: string): Promise<CloudFolder> {
  let current = await p.getRoot();
  for (const name of path.split('/').filter(Boolean)) {
    const subs = await p.listFolders(current.id);
    const next = subs.find((f) => f.name === name) ?? subs.find((f) => f.name.toLowerCase() === name.toLowerCase());
    if (!next) throw new Error(`Pasta de teste não encontrada: ${path}`);
    current = next;
  }
  return current;
}

async function listAll(p: CloudProvider, folderId: string): Promise<CloudItem[]> {
  const files: CloudItem[] = [];
  let token: string | null = null;
  do {
    const page = await p.listChildren(folderId, token);
    files.push(...page.files);
    token = page.nextPageToken;
  } while (token);
  return files.sort((a, b) => a.name.localeCompare(b.name));
}

const snapshot = (files: CloudItem[]) => files.map((f) => ({ id: f.id, name: f.name, size: f.size, hash: f.quickXorHash }));

async function eventually<T>(ctx: Ctx, read: () => Promise<T>, ok: (v: T) => boolean): Promise<T> {
  let v = await read();
  for (let i = 0; i < 15 && !ok(v); i++) {
    await sleep(ctx.pollMs);
    v = await read();
  }
  return v;
}

function contractSuite(name: string, makeCtx: () => Promise<Ctx>, timeout: number): void {
  describe(name, () => {
    let ctx: Ctx;
    let trashedId: string | null = null;

    afterAll(async () => {
      // rede de segurança: nunca deixar a cópia na lixeira se o cenário quebrou no meio
      if (ctx && trashedId) await ctx.provider.restore(trashedId).catch(() => undefined);
    }, timeout);

    it('lista, mapeia, move para a lixeira, restaura e deixa a pasta como estava', async () => {
      ctx = await makeCtx();
      const p = ctx.provider;
      const folder = await findFolder(p, ctx.testFolder);
      expect(folder.path.toLowerCase()).toBe(ctx.testFolder.toLowerCase());

      // 1. listagem: exatamente as 3 fotos combinadas (senão para antes de mexer em qualquer coisa)
      const before = await listAll(p, folder.id);
      expect(before.map((f) => ({ name: f.name, size: f.size }))).toEqual(EXPECTED);

      // 2. mapeamento de campos
      for (const f of before) {
        expect(f.id).toEqual(expect.any(String));
        expect(f.id).not.toBe('');
        expect(f.folderPath.toLowerCase()).toBe(ctx.testFolder.toLowerCase());
        expect(f.kind).toBe('photo');
        expect(f.mimeType).toBe('image/jpeg');
        expect(f.quickXorHash).toEqual(expect.any(String));
        expect(f.webUrl).toMatch(/^https:\/\//);
        expect(Number.isNaN(Date.parse(f.createdAt))).toBe(false);
        expect(Number.isNaN(Date.parse(f.modifiedAt))).toBe(false);
        expect(f.durationMs).toBeNull();
        if (f.width !== null || f.height !== null) {
          expect(f.width).toBeGreaterThan(0);
          expect(f.height).toBeGreaterThan(0);
        }
      }
      const [outra, copia, original] = before;
      expect(copia.quickXorHash).toBe(original.quickXorHash);
      expect(outra.quickXorHash).not.toBe(original.quickXorHash);
      expect(new Set(before.map((f) => f.id)).size).toBe(3);

      // 3. getItem devolve o mesmo arquivo
      const target = before.find((f) => f.name === TO_TRASH)!;
      const fields = (f: CloudItem) => ({
        id: f.id, name: f.name, folderPath: f.folderPath, size: f.size, quickXorHash: f.quickXorHash,
        mimeType: f.mimeType, kind: f.kind, webUrl: f.webUrl,
      });
      const got = await p.getItem(target.id);
      expect(got && fields(got)).toEqual(fields(target));

      // 4. lixeira: some do OneDrive
      expect(await p.moveToTrash(target.id)).toBe('moved');
      trashedId = target.id;
      expect(await eventually(ctx, () => p.getItem(target.id), (v) => v === null)).toBeNull();

      // 5. restauração: volta com o mesmo id para a mesma pasta
      expect(await p.restore(target.id)).toBe('restored');
      trashedId = null;
      const back = await eventually(ctx, () => p.getItem(target.id), (v) => v !== null);
      expect(back && fields(back)).toEqual(fields(target));

      // 6. a pasta ficou exatamente como estava
      const after = await eventually(ctx, () => listAll(p, folder.id), (v) => v.length === before.length);
      expect(snapshot(after)).toEqual(snapshot(before));
    }, timeout);
  });
}

contractSuite('contrato: FakeCloudProvider', async () => {
  const fake = new FakeCloudProvider();
  const t = fake.addFolder(fake.rootId, 'TwinPix Teste');
  fake.addFolder(fake.rootId, 'Outra pasta');
  fake.addFile(t.id, { name: 'teste.jpg', size: 11585, quickXorHash: 'igual' });
  fake.addFile(t.id, { name: 'teste 1.jpg', size: 11585, quickXorHash: 'igual' });
  fake.addFile(t.id, { name: 'outra.jpg', size: 4790, quickXorHash: 'diferente' });
  return { provider: fake, testFolder: '/TwinPix Teste', pollMs: 0 };
}, 5_000);

const config = loadConfig(process.env, []);
const missing = [
  !config.testFolder && 'TWINPIX_TEST_FOLDER',
  !config.clientId && 'TWINPIX_CLIENT_ID',
  !existsSync(join(config.dataDir, 'msal-cache.json')) && `login em cache (${join(config.dataDir, 'msal-cache.json')})`,
].filter((m): m is string => !!m);

if (process.env.TWINPIX_CONTRACT === '1' && missing.length === 0) {
  contractSuite('contrato: OneDrive real (pasta de teste)', async () => {
    // a trava fica ligada: o próprio cenário real só consegue mexer dentro da pasta de teste
    const provider = new OneDriveProvider(new GraphClient(new AuthService(config)), { testFolder: config.testFolder });
    return { provider, testFolder: config.testFolder!, pollMs: 1_000 };
  }, 120_000);
} else if (process.env.TWINPIX_CONTRACT === '1') {
  describe('contrato: OneDrive real (pasta de teste)', () => {
    it('pré-requisitos', () => {
      expect.fail(`Faltando para rodar contra o OneDrive real: ${missing.join(', ')}.`);
    });
  });
} else {
  describe.skip('contrato: OneDrive real (pasta de teste) — defina TWINPIX_CONTRACT=1', () => {
    it('pulado', () => undefined);
  });
}
