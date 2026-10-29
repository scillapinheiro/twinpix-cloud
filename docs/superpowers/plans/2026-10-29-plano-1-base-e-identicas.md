# Plano 1 — Base e cópias idênticas de ponta a ponta

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar o TwinPix Cloud funcionando para **cópias idênticas**: conectar o OneDrive,
escolher pastas, varrer (retomável), revisar um grupo por vez, confirmar, mover para a lixeira,
ver histórico e desfazer — mais um **modo demonstração** com provedor falso.

**Architecture:** Monorepo npm workspaces. `apps/api` (NestJS, CommonJS) expõe uma API REST em
`127.0.0.1:4317` protegida por token de sessão; a lógica de domínio fica em funções puras
(`grouping`, `rules`, `actions/deletion-plan`) e serviços finos que usam uma interface
`CloudProvider` (implementações `OneDriveProvider` e `FakeCloudProvider`) e SQLite
(`better-sqlite3`). `apps/web` (React + Vite, `HashRouter`) consome a API.
`packages/shared` contém **apenas tipos** (`index.d.ts`), importados com `import type`.

**Tech Stack:** Node 22, TypeScript 5, NestJS 11, better-sqlite3, @azure/msal-node 3,
React 19, Vite 7, react-router-dom 7, Vitest 3 (+ unplugin-swc na API), fast-check 4,
Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-29-twinpix-cloud-design.md`

## Global Constraints

- Node ≥ 22; gerenciador **npm workspaces** (pnpm não está instalado).
- Todo texto de interface em **português do Brasil**, com **rótulos explícitos** e sem jargão (spec §7).
- **Testes nunca chamam o OneDrive real**; usam `FakeCloudProvider` ou `fetch` simulado (spec §9).
- **Nada de segredos no repositório**: Client ID só em `.env` (ignorado pelo git) (spec §3).
- Backend escuta **só em `127.0.0.1`**, porta padrão **4317**; toda rota `/api/*` exige o
  cabeçalho `X-TwinPix-Token`, exceto `/api/auth/login` e `/api/auth/callback` (spec §8).
- **Nunca é possível excluir todas as cópias de um grupo** (spec §6, proteção 4).
- Antes de mover, conferir **o arquivo que sai e as cópias que ficam** (spec §8).
- Pré-marcação existe **apenas** nas idênticas (spec §6, proteção 1).
- Tudo vai para a **lixeira** do OneDrive; nunca exclusão definitiva (spec §6, proteção 2).
- Commits **sem** linha `Co-Authored-By` nem assinatura de IA (pedido da autora).
- Mensagens de commit no padrão `tipo: descrição em português` (`feat:`, `test:`, `docs:`, `chore:`).

## Fora deste plano (planos seguintes)

- Plano 2: prováveis cópias (nome-base com sufixos, dimensões, data, duração ±1 s) e
  **lote** (aplicar a regra em todas as idênticas).
- Plano 3: reconciliação de pastas.
- Plano 4: testes de contrato contra o OneDrive real, trava da pasta de teste, validação com
  as listagens reais do rclone (§10), acabamento do README.

## Estrutura de arquivos

```
package.json                      workspaces e scripts raiz
tsconfig.base.json
.env.example                      TWINPIX_CLIENT_ID=
LICENSE  CONTRIBUTING.md  README.md
packages/shared/index.d.ts        tipos compartilhados (só tipos)
apps/api/
  src/main.ts                     bootstrap: middleware de sessão, estáticos, 127.0.0.1, abre navegador
  src/app.module.ts               composição dos módulos
  src/config.ts                   leitura de env/argv
  src/tokens.ts                   tokens de injeção
  src/http/domain-error.filter.ts erros de domínio → HTTP
  src/security/session.middleware.ts
  src/security/open-browser.ts
  src/storage/{schema.ts,db.ts,rows.ts}
  src/grouping/{name-base.ts,group-identical.ts,folders.ts}
  src/rules/suggest-keep.ts
  src/actions/{deletion-plan.ts,actions.service.ts,actions.controller.ts,actions.module.ts}
  src/cloud/{cloud-provider.ts,errors.ts,fake-cloud-provider.ts,demo-seed.ts,cloud.module.ts,
             folders.controller.ts,files.controller.ts}
  src/cloud/onedrive/{map-drive-item.ts,graph-client.ts,onedrive-provider.ts}
  src/auth/{auth.service.ts,token-cache.ts,auth.controller.ts,auth.module.ts}
  src/scan/{scan.service.ts,scan.controller.ts,scan.module.ts}
  src/review/{review.service.ts,review.controller.ts,review.module.ts,rules-settings.ts}
apps/web/
  src/main.tsx  src/App.tsx  src/styles.css
  src/lib/{api.ts,session.ts,format.ts,differing-fields.ts}
  src/components/{FileCard.tsx,Thumbnail.tsx}
  src/pages/{Home.tsx,FolderPicker.tsx,ScanProgress.tsx,Review.tsx,Confirm.tsx,History.tsx}
```

Testes ficam ao lado do código: `*.spec.ts` / `*.spec.tsx`.

---

### Task 1: Esqueleto do monorepo, tipos compartilhados e documentos do projeto

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `.env.example`, `LICENSE`, `CONTRIBUTING.md`, `README.md`
- Modify: `.gitignore` (acrescentar `dist/`)
- Create: `packages/shared/package.json`, `packages/shared/index.d.ts`
- Create: `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/tsconfig.build.json`, `apps/api/nest-cli.json`, `apps/api/vitest.config.ts`, `apps/api/src/smoke.spec.ts`
- Create: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/vite.config.ts`, `apps/web/index.html`, `apps/web/src/main.tsx`, `apps/web/src/App.tsx`, `apps/web/src/test-setup.ts`, `apps/web/src/App.spec.tsx`

**Interfaces:**
- Produces: todos os tipos de `@twinpix/shared` abaixo (usados por todas as tasks); scripts
  `npm test`, `npm run typecheck`, `npm run build`, `npm run dev`, `npm run demo`.

- [ ] **Step 1: Arquivos raiz**

`package.json`:
```json
{
  "name": "twinpix-cloud",
  "version": "0.1.0",
  "private": true,
  "license": "MIT",
  "engines": { "node": ">=22" },
  "workspaces": ["packages/*", "apps/*"],
  "scripts": {
    "dev": "npm run dev -w apps/api & npm run dev -w apps/web & wait",
    "build": "npm run build -w apps/web && npm run build -w apps/api",
    "start": "npm run start -w apps/api",
    "demo": "npm run build && node apps/api/dist/main.js --demo",
    "test": "npm run test -ws --if-present",
    "typecheck": "npm run typecheck -ws --if-present"
  },
  "devDependencies": { "typescript": "^5.9.0" }
}
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2022",
    "skipLibCheck": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  }
}
```

`.env.example`:
```
# Client ID do app registrado no Microsoft Entra (veja o README)
TWINPIX_CLIENT_ID=
```

`.gitignore` — acrescentar a linha `dist/` (manter as existentes).

`LICENSE`: texto padrão MIT, `Copyright (c) 2026 Priscilla Lemos Pinheiro`.

`CONTRIBUTING.md`:
```markdown
# Contribuições

Obrigada pelo interesse! O TwinPix Cloud é open source, mas **não aceita pull requests**.
É um projeto pessoal, mantido do jeito que a autora precisa.

Você pode — e é bem-vindo a — fazer um **fork** e adaptar como quiser, dentro da licença MIT.
Issues com relatos de bugs podem ser abertas, mas não há garantia de resposta.
```

`README.md` (versão inicial; a Task 17 completa):
```markdown
# TwinPix Cloud

Encontra fotos e vídeos repetidos no OneDrive e deixa você revisar **um grupo por vez,
lado a lado**, movendo para a lixeira só o que escolher.

> Em desenvolvimento.
```

- [ ] **Step 2: Tipos compartilhados**

`packages/shared/package.json`:
```json
{ "name": "@twinpix/shared", "version": "0.1.0", "private": true, "types": "index.d.ts" }
```

`packages/shared/index.d.ts`:
```ts
export type MediaKind = 'photo' | 'video';

export interface CloudItem {
  id: string;
  name: string;
  /** Caminho da pasta que contém o arquivo, ex.: "/Imagens/2015". Raiz = "/". */
  folderPath: string;
  size: number;
  quickXorHash: string | null;
  mimeType: string;
  kind: MediaKind;
  /** photo.takenDateTime; null quando o OneDrive não informa. */
  takenAt: string | null;
  createdAt: string;
  modifiedAt: string;
  width: number | null;
  height: number | null;
  cameraMake: string | null;
  cameraModel: string | null;
  /** Duração do vídeo em milissegundos. */
  durationMs: number | null;
  webUrl: string;
}

export interface CloudFolder {
  id: string;
  name: string;
  /** Caminho completo, ex.: "/Minhas imagens/07-06-07". Raiz = "/". */
  path: string;
  childCount: number;
}

export type ScanStatus = 'running' | 'paused' | 'waiting-network' | 'needs-auth' | 'done' | 'error';

export interface ScanSummary {
  id: number;
  status: ScanStatus;
  roots: CloudFolder[];
  foldersDone: number;
  foldersTotal: number;
  filesFound: number;
  unanalyzedCount: number;
  groupsTotal: number;
  groupsPending: number;
  groupsSkipped: number;
  bytesFreed: number;
  error: string | null;
}

export type GroupStatus = 'pending' | 'skipped' | 'resolved' | 'stale';

export type RuleCriterion =
  | { type: 'largestResolution' }
  | { type: 'largestSize' }
  | { type: 'oldestTaken' }
  | { type: 'oldestModified' }
  | { type: 'inFolder'; path: string }
  | { type: 'notInFolder'; path: string }
  | { type: 'noCopySuffix' };

export interface Suggestion {
  keepId: string;
  /** Ex.: "regra: mais antiga (tirada em)". */
  reason: string;
}

export interface GroupView {
  id: number;
  scanId: number;
  kind: 'identical';
  status: GroupStatus;
  /** Posição 1-based entre todos os grupos da varredura. */
  position: number;
  total: number;
  files: CloudItem[];
  suggestion: Suggestion;
  preMarkedIds: string[];
  bytesFreedSoFar: number;
}

export interface DeletionPreview {
  groupId: number;
  deleteFiles: CloudItem[];
  keepFiles: CloudItem[];
  bytes: number;
}

export type ActionStatus = 'pending' | 'done' | 'failed' | 'undone';

export interface ActionResult {
  actionId: number;
  fileId: string;
  fileName: string;
  status: ActionStatus;
  error: string | null;
}

export interface ApplyResult {
  groupId: number;
  /** true quando algo mudou no OneDrive desde a varredura; nada foi movido. */
  stale: boolean;
  results: ActionResult[];
}

export interface HistoryEntry {
  actionId: number;
  groupId: number;
  file: CloudItem;
  status: ActionStatus;
  error: string | null;
  createdAt: string;
}

export type RestoreResult = 'restored' | 'not-in-trash' | 'conflict';

export interface UndoResponse {
  result: RestoreResult;
  message: string;
}

export interface AuthStatus {
  /** false quando falta TWINPIX_CLIENT_ID no .env (e não é modo demonstração). */
  configured: boolean;
  connected: boolean;
  accountName: string | null;
  demo: boolean;
}

export interface NestedRoot {
  inner: string;
  outer: string;
}
```

- [ ] **Step 3: Pacote da API**

`apps/api/package.json`:
```json
{
  "name": "@twinpix/api",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "build": "nest build",
    "dev": "TWINPIX_DEV_ORIGIN=http://localhost:5173 TWINPIX_SESSION_TOKEN=dev-local nest start --watch",
    "start": "node dist/main.js",
    "test": "vitest run",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "dependencies": {
    "@azure/msal-node": "^3.0.0",
    "@nestjs/common": "^11.0.0",
    "@nestjs/core": "^11.0.0",
    "@nestjs/platform-express": "^11.0.0",
    "better-sqlite3": "^12.0.0",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@nestjs/cli": "^11.0.0",
    "@swc/core": "^1.7.0",
    "@twinpix/shared": "*",
    "@types/better-sqlite3": "^7.6.11",
    "@types/express": "^5.0.0",
    "@types/node": "^22.0.0",
    "@types/supertest": "^6.0.2",
    "express": "^5.0.0",
    "fast-check": "^4.0.0",
    "supertest": "^7.0.0",
    "unplugin-swc": "^1.5.1",
    "vitest": "^3.2.0"
  }
}
```

`apps/api/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "commonjs",
    "moduleResolution": "node",
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "outDir": "dist",
    "rootDir": "src",
    "types": ["node"]
  },
  "include": ["src"]
}
```

`apps/api/tsconfig.build.json`:
```json
{ "extends": "./tsconfig.json", "exclude": ["src/**/*.spec.ts"] }
```

`apps/api/nest-cli.json`:
```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "sourceRoot": "src",
  "compilerOptions": { "tsConfigPath": "tsconfig.build.json", "deleteOutDir": true }
}
```

`apps/api/vitest.config.ts`:
```ts
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [swc.vite()],
  test: { environment: 'node', include: ['src/**/*.spec.ts'] },
});
```

`apps/api/src/smoke.spec.ts`:
```ts
import { describe, expect, it } from 'vitest';

describe('ambiente de testes da API', () => {
  it('roda', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 4: Pacote web**

`apps/web/package.json`:
```json
{
  "name": "@twinpix/web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-router-dom": "^7.0.0"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.6.0",
    "@testing-library/react": "^16.1.0",
    "@testing-library/user-event": "^14.5.2",
    "@twinpix/shared": "*",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^5.0.0",
    "jsdom": "^26.0.0",
    "vite": "^7.0.0",
    "vitest": "^3.2.0"
  }
}
```

`apps/web/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "verbatimModuleSyntax": true,
    "noEmit": true,
    "types": ["vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src", "vite.config.ts"]
}
```

`apps/web/vite.config.ts`:
```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://127.0.0.1:4317' } },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
  },
});
```

`apps/web/index.html`:
```html
<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>TwinPix Cloud</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`apps/web/src/test-setup.ts`:
```ts
import '@testing-library/jest-dom/vitest';
```

`apps/web/src/App.tsx` (provisório; a Task 14 substitui):
```tsx
export function App() {
  return <h1>TwinPix Cloud</h1>;
}
```

`apps/web/src/main.tsx`:
```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

`apps/web/src/App.spec.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import { App } from './App';

it('mostra o nome do app', () => {
  render(<App />);
  expect(screen.getByRole('heading', { name: 'TwinPix Cloud' })).toBeInTheDocument();
});
```

- [ ] **Step 5: Instalar e rodar**

Run: `npm install && npm test && npm run typecheck`
Expected: as duas suítes passam (1 teste cada) e o typecheck não mostra erros.
Se alguma versão listada não existir, use a maior versão estável disponível do mesmo pacote e
registre a troca no relatório da task.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: esqueleto do monorepo, tipos compartilhados e documentos do projeto"
```

---

### Task 2: Armazenamento SQLite

**Files:**
- Create: `apps/api/src/storage/schema.ts`, `apps/api/src/storage/db.ts`, `apps/api/src/storage/rows.ts`
- Test: `apps/api/src/storage/db.spec.ts`

**Interfaces:**
- Produces:
  - `class Db { readonly sql: Database.Database; constructor(file: string); close(): void }`
  - `interface FileRow` (colunas da tabela `files`)
  - `rowToItem(row: FileRow): CloudItem`
  - `insertFile(sql, scanId: number, item: CloudItem): void` (INSERT OR IGNORE)
  - `getFilesByIds(sql, scanId: number, ids: string[]): CloudItem[]`
  - `nowIso(): string`
  - Tabelas: `scans`, `scan_roots`, `scan_folders`, `files`, `dup_groups`, `dup_group_files`, `actions`, `settings`.

- [ ] **Step 1: Teste**

`apps/api/src/storage/db.spec.ts`:
```ts
import type { CloudItem } from '@twinpix/shared';
import { describe, expect, it } from 'vitest';
import { Db } from './db';
import { getFilesByIds, insertFile } from './rows';

export const sampleItem = (over: Partial<CloudItem> = {}): CloudItem => ({
  id: 'f1',
  name: 'foto.jpg',
  folderPath: '/Imagens',
  size: 1000,
  quickXorHash: 'h1',
  mimeType: 'image/jpeg',
  kind: 'photo',
  takenAt: '2015-02-06T22:26:31Z',
  createdAt: '2015-02-07T10:00:00Z',
  modifiedAt: '2015-02-07T10:00:00Z',
  width: 4000,
  height: 3000,
  cameraMake: 'Samsung',
  cameraModel: 'SM-G900',
  durationMs: null,
  webUrl: 'https://onedrive.live.com/f1',
  ...over,
});

describe('Db', () => {
  it('cria o esquema e pode ser aberto de novo sem erro', () => {
    const db = new Db(':memory:');
    const tables = db.sql
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r: any) => r.name);
    expect(tables).toEqual(
      expect.arrayContaining(['actions', 'dup_group_files', 'dup_groups', 'files', 'scan_folders', 'scan_roots', 'scans', 'settings']),
    );
    db.close();
  });

  it('grava e lê um arquivo sem perder campos', () => {
    const db = new Db(':memory:');
    db.sql.prepare("INSERT INTO scans (id, created_at, status) VALUES (1, 'x', 'running')").run();
    const item = sampleItem();
    insertFile(db.sql, 1, item);
    insertFile(db.sql, 1, item); // repetido é ignorado
    expect(getFilesByIds(db.sql, 1, ['f1'])).toEqual([item]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -w apps/api -- src/storage`
Expected: FAIL — `Cannot find module './db'`.

- [ ] **Step 3: Implementação**

`apps/api/src/storage/schema.ts`:
```ts
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS scans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  cursor_group_id INTEGER
);
CREATE TABLE IF NOT EXISTS scan_roots (
  scan_id INTEGER NOT NULL REFERENCES scans(id),
  folder_id TEXT NOT NULL,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  child_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (scan_id, folder_id)
);
CREATE TABLE IF NOT EXISTS scan_folders (
  scan_id INTEGER NOT NULL REFERENCES scans(id),
  folder_id TEXT NOT NULL,
  path TEXT NOT NULL,
  status TEXT NOT NULL,
  page_token TEXT,
  seq INTEGER NOT NULL,
  PRIMARY KEY (scan_id, folder_id)
);
CREATE TABLE IF NOT EXISTS files (
  scan_id INTEGER NOT NULL REFERENCES scans(id),
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  folder_path TEXT NOT NULL,
  size INTEGER NOT NULL,
  quick_xor_hash TEXT,
  mime_type TEXT NOT NULL,
  kind TEXT NOT NULL,
  taken_at TEXT,
  created_at TEXT NOT NULL,
  modified_at TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  camera_make TEXT,
  camera_model TEXT,
  duration_ms INTEGER,
  web_url TEXT NOT NULL,
  PRIMARY KEY (scan_id, id)
);
CREATE INDEX IF NOT EXISTS files_hash ON files (scan_id, quick_xor_hash, size);
CREATE TABLE IF NOT EXISTS dup_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_id INTEGER NOT NULL REFERENCES scans(id),
  kind TEXT NOT NULL,
  key TEXT NOT NULL,
  position INTEGER NOT NULL,
  status TEXT NOT NULL,
  UNIQUE (scan_id, kind, key)
);
CREATE TABLE IF NOT EXISTS dup_group_files (
  group_id INTEGER NOT NULL REFERENCES dup_groups(id),
  file_id TEXT NOT NULL,
  PRIMARY KEY (group_id, file_id)
);
CREATE TABLE IF NOT EXISTS actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES dup_groups(id),
  file_id TEXT NOT NULL,
  kept_file_id TEXT NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;
```

`apps/api/src/storage/db.ts`:
```ts
import Database from 'better-sqlite3';
import { SCHEMA } from './schema';

export class Db {
  readonly sql: Database.Database;

  constructor(file: string) {
    this.sql = new Database(file);
    this.sql.pragma('journal_mode = WAL');
    this.sql.pragma('foreign_keys = ON');
    this.sql.exec(SCHEMA);
  }

  close(): void {
    this.sql.close();
  }
}
```

`apps/api/src/storage/rows.ts`:
```ts
import type { CloudItem, MediaKind } from '@twinpix/shared';
import type Database from 'better-sqlite3';

export interface FileRow {
  scan_id: number;
  id: string;
  name: string;
  folder_path: string;
  size: number;
  quick_xor_hash: string | null;
  mime_type: string;
  kind: MediaKind;
  taken_at: string | null;
  created_at: string;
  modified_at: string;
  width: number | null;
  height: number | null;
  camera_make: string | null;
  camera_model: string | null;
  duration_ms: number | null;
  web_url: string;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function rowToItem(r: FileRow): CloudItem {
  return {
    id: r.id,
    name: r.name,
    folderPath: r.folder_path,
    size: r.size,
    quickXorHash: r.quick_xor_hash,
    mimeType: r.mime_type,
    kind: r.kind,
    takenAt: r.taken_at,
    createdAt: r.created_at,
    modifiedAt: r.modified_at,
    width: r.width,
    height: r.height,
    cameraMake: r.camera_make,
    cameraModel: r.camera_model,
    durationMs: r.duration_ms,
    webUrl: r.web_url,
  };
}

export function insertFile(sql: Database.Database, scanId: number, i: CloudItem): void {
  sql
    .prepare(
      `INSERT OR IGNORE INTO files (scan_id, id, name, folder_path, size, quick_xor_hash, mime_type, kind,
        taken_at, created_at, modified_at, width, height, camera_make, camera_model, duration_ms, web_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      scanId, i.id, i.name, i.folderPath, i.size, i.quickXorHash, i.mimeType, i.kind,
      i.takenAt, i.createdAt, i.modifiedAt, i.width, i.height, i.cameraMake, i.cameraModel,
      i.durationMs, i.webUrl,
    );
}

export function getFilesByIds(sql: Database.Database, scanId: number, ids: string[]): CloudItem[] {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  const rows = sql
    .prepare(`SELECT * FROM files WHERE scan_id = ? AND id IN (${placeholders}) ORDER BY folder_path, name`)
    .all(scanId, ...ids) as FileRow[];
  return rows.map(rowToItem);
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test -w apps/api -- src/storage`
Expected: PASS (2 testes).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/storage
git commit -m "feat: armazenamento SQLite com esquema da v1"
```

---

### Task 3: Agrupamento de idênticas, sufixo de cópia e pastas aninhadas

**Files:**
- Create: `apps/api/src/grouping/name-base.ts`, `apps/api/src/grouping/group-identical.ts`, `apps/api/src/grouping/folders.ts`
- Test: `apps/api/src/grouping/name-base.spec.ts`, `apps/api/src/grouping/group-identical.spec.ts`, `apps/api/src/grouping/folders.spec.ts`

**Interfaces:**
- Produces:
  - `splitExtension(name: string): { stem: string; ext: string }`
  - `hasCopySuffix(name: string): boolean`
  - `baseName(name: string): string` (minúsculas, sem sufixo, com extensão)
  - `interface IdenticalGroup { key: string; fileIds: string[] }`
  - `groupIdentical(files: Array<Pick<CloudItem, 'id' | 'quickXorHash' | 'size'>>): IdenticalGroup[]`
  - `isInsideFolder(folderPath: string, folder: string): boolean`
  - `findNestedRoots(paths: string[]): NestedRoot[]`

- [ ] **Step 1: Testes**

`apps/api/src/grouping/name-base.spec.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { baseName, hasCopySuffix } from './name-base';

describe('hasCopySuffix', () => {
  it.each([
    'nome 1.jpg',
    'nome (2).jpg',
    'nome-1.jpg',
    '20150206_222631_LLS 1.jpg',
    'VID_20160101 12.mp4',
  ])('reconhece sufixo de cópia em %s', (name) => {
    expect(hasCopySuffix(name)).toBe(true);
  });

  it.each([
    'nome.jpg',
    'Viagem 2015.jpg',
    'IMG-20150206-WA0001.jpg',
    'DSC_0001.JPG',
    'foto-10.jpg',
    'foto-12.jpg',
    '20150206_222631_LLS.jpg',
    '.jpg',
  ])('não confunde nome legítimo com cópia: %s', (name) => {
    expect(hasCopySuffix(name)).toBe(false);
  });
});

describe('baseName', () => {
  it('remove o sufixo e normaliza maiúsculas e extensão', () => {
    expect(baseName('Nome 1.JPG')).toBe('nome.jpg');
    expect(baseName('nome (2).jpg')).toBe('nome.jpg');
    expect(baseName('nome-1.jpg')).toBe('nome.jpg');
    expect(baseName('nome.jpg')).toBe('nome.jpg');
  });

  it('mantém nomes sem sufixo', () => {
    expect(baseName('IMG-20150206-WA0001.jpg')).toBe('img-20150206-wa0001.jpg');
  });
});
```

`apps/api/src/grouping/group-identical.spec.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { groupIdentical } from './group-identical';

describe('groupIdentical', () => {
  it('agrupa por hash e tamanho', () => {
    const groups = groupIdentical([
      { id: 'a', quickXorHash: 'h1', size: 10 },
      { id: 'b', quickXorHash: 'h1', size: 10 },
      { id: 'c', quickXorHash: 'h2', size: 10 },
    ]);
    expect(groups).toEqual([{ key: 'h1:10', fileIds: ['a', 'b'] }]);
  });

  it('não agrupa mesmo hash com tamanho diferente', () => {
    expect(
      groupIdentical([
        { id: 'a', quickXorHash: 'h1', size: 10 },
        { id: 'b', quickXorHash: 'h1', size: 11 },
      ]),
    ).toEqual([]);
  });

  it('ignora arquivos sem hash', () => {
    expect(
      groupIdentical([
        { id: 'a', quickXorHash: null, size: 10 },
        { id: 'b', quickXorHash: null, size: 10 },
      ]),
    ).toEqual([]);
  });

  it('o mesmo arquivo visto duas vezes (pastas sobrepostas) não vira cópia de si mesmo', () => {
    expect(
      groupIdentical([
        { id: 'a', quickXorHash: 'h1', size: 10 },
        { id: 'a', quickXorHash: 'h1', size: 10 },
      ]),
    ).toEqual([]);
  });
});
```

`apps/api/src/grouping/folders.spec.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { findNestedRoots, isInsideFolder } from './folders';

describe('isInsideFolder', () => {
  it('considera a própria pasta e subpastas', () => {
    expect(isInsideFolder('/A', '/A')).toBe(true);
    expect(isInsideFolder('/A/B', '/A')).toBe(true);
    expect(isInsideFolder('/AB', '/A')).toBe(false);
    expect(isInsideFolder('/qualquer', '/')).toBe(true);
  });
});

describe('findNestedRoots', () => {
  it('aponta pasta escolhida que está dentro de outra escolhida', () => {
    expect(findNestedRoots(['/Minhas imagens', '/Minhas imagens/minhas fotos', '/Outra'])).toEqual([
      { inner: '/Minhas imagens/minhas fotos', outer: '/Minhas imagens' },
    ]);
  });

  it('não confunde prefixo de nome com subpasta', () => {
    expect(findNestedRoots(['/Fotos', '/Fotos antigas'])).toEqual([]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -w apps/api -- src/grouping`
Expected: FAIL — módulos não encontrados.

- [ ] **Step 3: Implementação**

`apps/api/src/grouping/name-base.ts`:
```ts
/** Sufixos que o backup/cópia acrescenta: " 1", " 12", " (2)", "-1". */
const COPY_SUFFIX = /(?: \(\d{1,2}\)| \d{1,2}|-[1-9])$/;

export function splitExtension(name: string): { stem: string; ext: string } {
  const i = name.lastIndexOf('.');
  if (i <= 0) return { stem: name, ext: '' };
  return { stem: name.slice(0, i), ext: name.slice(i).toLowerCase() };
}

export function hasCopySuffix(name: string): boolean {
  const { stem } = splitExtension(name);
  return stem.length > 0 && COPY_SUFFIX.test(stem) && stem.replace(COPY_SUFFIX, '').length > 0;
}

export function baseName(name: string): string {
  const { stem, ext } = splitExtension(name);
  const stripped = hasCopySuffix(name) ? stem.replace(COPY_SUFFIX, '') : stem;
  return stripped.toLowerCase() + ext;
}
```

Observação: `'foto-10'` não casa porque `-[1-9]$` exige um único dígito depois do hífen, e
`'Viagem 2015'` não casa porque ` \d{1,2}$` exige espaço seguido de no máximo 2 dígitos no fim.

`apps/api/src/grouping/group-identical.ts`:
```ts
import type { CloudItem } from '@twinpix/shared';

export interface IdenticalGroup {
  key: string;
  fileIds: string[];
}

export function groupIdentical(
  files: Array<Pick<CloudItem, 'id' | 'quickXorHash' | 'size'>>,
): IdenticalGroup[] {
  const byKey = new Map<string, Set<string>>();
  for (const f of files) {
    if (!f.quickXorHash) continue;
    const key = `${f.quickXorHash}:${f.size}`;
    let ids = byKey.get(key);
    if (!ids) {
      ids = new Set();
      byKey.set(key, ids);
    }
    ids.add(f.id);
  }
  return [...byKey]
    .filter(([, ids]) => ids.size > 1)
    .map(([key, ids]) => ({ key, fileIds: [...ids].sort() }));
}
```

`apps/api/src/grouping/folders.ts`:
```ts
import type { NestedRoot } from '@twinpix/shared';

function trimSlash(p: string): string {
  return p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p;
}

export function isInsideFolder(folderPath: string, folder: string): boolean {
  const child = trimSlash(folderPath);
  const parent = trimSlash(folder);
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
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test -w apps/api -- src/grouping`
Expected: PASS. Se algum caso negativo de `hasCopySuffix` falhar, ajuste a regex (não os testes)
e explique a mudança no relatório.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/grouping
git commit -m "feat: agrupamento de idênticas, sufixo de cópia e pastas aninhadas"
```

---

### Task 4: Regras de prioridade (quem manter)

**Files:**
- Create: `apps/api/src/rules/suggest-keep.ts`
- Test: `apps/api/src/rules/suggest-keep.spec.ts`

**Interfaces:**
- Consumes: `hasCopySuffix` (Task 3), `isInsideFolder` (Task 3).
- Produces:
  - `type RuleFile = Pick<CloudItem, 'id' | 'name' | 'folderPath' | 'size' | 'width' | 'height' | 'takenAt' | 'createdAt' | 'modifiedAt'>`
  - `DEFAULT_RULES: RuleCriterion[]` = `[noCopySuffix, oldestTaken, oldestModified]`
  - `criterionLabel(c: RuleCriterion): string`
  - `suggestKeep(files: RuleFile[], rules: RuleCriterion[]): Suggestion` (lança erro com lista vazia)
  - `isValidRules(value: unknown): value is RuleCriterion[]`

- [ ] **Step 1: Teste**

`apps/api/src/rules/suggest-keep.spec.ts`:
```ts
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES, isValidRules, suggestKeep, type RuleFile } from './suggest-keep';

const f = (over: Partial<RuleFile> & { id: string }): RuleFile => ({
  name: `${over.id}.jpg`,
  folderPath: '/Imagens',
  size: 100,
  width: 100,
  height: 100,
  takenAt: '2015-01-01T00:00:00Z',
  createdAt: '2015-01-01T00:00:00Z',
  modifiedAt: '2015-01-01T00:00:00Z',
  ...over,
});

describe('suggestKeep', () => {
  it('aplica o primeiro critério que desempata e informa o motivo', () => {
    const s = suggestKeep(
      [f({ id: 'a', width: 100, height: 100 }), f({ id: 'b', width: 200, height: 200 })],
      [{ type: 'largestResolution' }, { type: 'oldestTaken' }],
    );
    expect(s).toEqual({ keepId: 'b', reason: 'regra: maior resolução' });
  });

  it('pula critério empatado e usa o próximo', () => {
    const s = suggestKeep(
      [f({ id: 'a', takenAt: '2016-01-01T00:00:00Z' }), f({ id: 'b', takenAt: '2015-01-01T00:00:00Z' })],
      [{ type: 'largestResolution' }, { type: 'oldestTaken' }],
    );
    expect(s).toEqual({ keepId: 'b', reason: 'regra: mais antiga (tirada em)' });
  });

  it('sem data em que foi tirada, usa a data de criação', () => {
    const s = suggestKeep(
      [f({ id: 'a', takenAt: null, createdAt: '2014-01-01T00:00:00Z' }), f({ id: 'b' })],
      [{ type: 'oldestTaken' }],
    );
    expect(s.keepId).toBe('a');
  });

  it('prefere nome sem sufixo de cópia', () => {
    const s = suggestKeep([f({ id: 'a', name: 'x 1.jpg' }), f({ id: 'b', name: 'x.jpg' })], DEFAULT_RULES);
    expect(s).toEqual({ keepId: 'b', reason: 'regra: nome sem sufixo de cópia' });
  });

  it('está na pasta X / não está na pasta Y', () => {
    const files = [f({ id: 'a', folderPath: '/Backup/2015' }), f({ id: 'b', folderPath: '/Fotos' })];
    expect(suggestKeep(files, [{ type: 'inFolder', path: '/Fotos' }])).toEqual({
      keepId: 'b',
      reason: 'regra: está na pasta /Fotos',
    });
    expect(suggestKeep(files, [{ type: 'notInFolder', path: '/Fotos' }]).keepId).toBe('a');
  });

  it('maior tamanho e mais antiga (modificada em)', () => {
    expect(suggestKeep([f({ id: 'a', size: 1 }), f({ id: 'b', size: 2 })], [{ type: 'largestSize' }]).keepId).toBe('b');
    expect(
      suggestKeep(
        [f({ id: 'a', modifiedAt: '2020-01-01T00:00:00Z' }), f({ id: 'b', modifiedAt: '2019-01-01T00:00:00Z' })],
        [{ type: 'oldestModified' }],
      ).keepId,
    ).toBe('b');
  });

  it('empate total: primeira em ordem alfabética de pasta e nome', () => {
    const s = suggestKeep([f({ id: 'b', folderPath: '/Z' }), f({ id: 'a', folderPath: '/A' })], DEFAULT_RULES);
    expect(s).toEqual({ keepId: 'a', reason: 'regra: primeira em ordem alfabética' });
  });

  it('propriedade: sempre devolve um arquivo do grupo', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.string({ minLength: 1, maxLength: 5 }), { minLength: 1, maxLength: 6 }),
        fc.integer({ min: 0, max: 1000 }),
        (ids, seed) => {
          const files = ids.map((id, i) => f({ id, size: (seed * (i + 1)) % 7 }));
          const s = suggestKeep(files, [{ type: 'largestSize' }, ...DEFAULT_RULES]);
          return ids.includes(s.keepId);
        },
      ),
    );
  });
});

describe('isValidRules', () => {
  it('aceita lista válida e recusa formato errado', () => {
    expect(isValidRules([{ type: 'inFolder', path: '/A' }, { type: 'oldestTaken' }])).toBe(true);
    expect(isValidRules([{ type: 'inFolder' }])).toBe(false);
    expect(isValidRules([{ type: 'qualquer' }])).toBe(false);
    expect(isValidRules('x')).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -w apps/api -- src/rules`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: Implementação**

`apps/api/src/rules/suggest-keep.ts`:
```ts
import type { CloudItem, RuleCriterion, Suggestion } from '@twinpix/shared';
import { isInsideFolder } from '../grouping/folders';
import { hasCopySuffix } from '../grouping/name-base';

export type RuleFile = Pick<
  CloudItem,
  'id' | 'name' | 'folderPath' | 'size' | 'width' | 'height' | 'takenAt' | 'createdAt' | 'modifiedAt'
>;

export const DEFAULT_RULES: RuleCriterion[] = [
  { type: 'noCopySuffix' },
  { type: 'oldestTaken' },
  { type: 'oldestModified' },
];

export function criterionLabel(c: RuleCriterion): string {
  switch (c.type) {
    case 'largestResolution': return 'maior resolução';
    case 'largestSize': return 'maior tamanho';
    case 'oldestTaken': return 'mais antiga (tirada em)';
    case 'oldestModified': return 'mais antiga (modificada em)';
    case 'inFolder': return `está na pasta ${c.path}`;
    case 'notInFolder': return `não está na pasta ${c.path}`;
    case 'noCopySuffix': return 'nome sem sufixo de cópia';
  }
}

const time = (iso: string | null): number => (iso ? Date.parse(iso) : Number.NaN);

/** Quanto maior, melhor. */
function score(c: RuleCriterion, file: RuleFile): number {
  switch (c.type) {
    case 'largestResolution':
      return file.width && file.height ? file.width * file.height : -1;
    case 'largestSize':
      return file.size;
    case 'oldestTaken': {
      const t = time(file.takenAt ?? file.createdAt);
      return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : -t;
    }
    case 'oldestModified': {
      const t = time(file.modifiedAt);
      return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : -t;
    }
    case 'inFolder':
      return isInsideFolder(file.folderPath, c.path) ? 1 : 0;
    case 'notInFolder':
      return isInsideFolder(file.folderPath, c.path) ? 0 : 1;
    case 'noCopySuffix':
      return hasCopySuffix(file.name) ? 0 : 1;
  }
}

function alphabetical(a: RuleFile, b: RuleFile): number {
  return a.folderPath.localeCompare(b.folderPath) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}

export function suggestKeep(files: RuleFile[], rules: RuleCriterion[]): Suggestion {
  if (files.length === 0) throw new Error('Grupo vazio.');
  let candidates = [...files];
  for (const rule of rules) {
    const best = Math.max(...candidates.map((f) => score(rule, f)));
    const narrowed = candidates.filter((f) => score(rule, f) === best);
    if (narrowed.length < candidates.length) {
      candidates = narrowed;
      if (candidates.length === 1) {
        return { keepId: candidates[0].id, reason: `regra: ${criterionLabel(rule)}` };
      }
    }
  }
  const first = [...candidates].sort(alphabetical)[0];
  return { keepId: first.id, reason: 'regra: primeira em ordem alfabética' };
}

const SIMPLE = new Set(['largestResolution', 'largestSize', 'oldestTaken', 'oldestModified', 'noCopySuffix']);

export function isValidRules(value: unknown): value is RuleCriterion[] {
  if (!Array.isArray(value)) return false;
  return value.every((c) => {
    if (!c || typeof c !== 'object') return false;
    const type = (c as { type?: unknown }).type;
    if (typeof type !== 'string') return false;
    if (SIMPLE.has(type)) return true;
    if (type === 'inFolder' || type === 'notInFolder') {
      const path = (c as { path?: unknown }).path;
      return typeof path === 'string' && path.startsWith('/');
    }
    return false;
  });
}
```

Atenção ao caso "pula critério empatado e usa o próximo": se o critério deixa **um** candidato,
o motivo é esse critério; se reduz para mais de um, continua; se não reduz, passa adiante.

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test -w apps/api -- src/rules`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/rules
git commit -m "feat: regras de prioridade com motivo da sugestão"
```

---

### Task 5: Trava de exclusão (nunca excluir todas as cópias)

**Files:**
- Create: `apps/api/src/actions/deletion-plan.ts`
- Test: `apps/api/src/actions/deletion-plan.spec.ts`

**Interfaces:**
- Produces:
  - `class UnsafeDeletionError extends Error`
  - `planDeletion(groupFileIds: string[], deleteIds: string[]): { deleteIds: string[]; keepIds: string[] }`

- [ ] **Step 1: Teste (com propriedade)**

`apps/api/src/actions/deletion-plan.spec.ts`:
```ts
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { planDeletion, UnsafeDeletionError } from './deletion-plan';

describe('planDeletion', () => {
  it('separa o que sai do que fica', () => {
    expect(planDeletion(['a', 'b', 'c'], ['b'])).toEqual({ deleteIds: ['b'], keepIds: ['a', 'c'] });
  });

  it('recusa excluir todas as cópias', () => {
    expect(() => planDeletion(['a', 'b'], ['a', 'b'])).toThrow(UnsafeDeletionError);
  });

  it('recusa seleção vazia', () => {
    expect(() => planDeletion(['a', 'b'], [])).toThrow(UnsafeDeletionError);
  });

  it('recusa arquivo de fora do grupo', () => {
    expect(() => planDeletion(['a', 'b'], ['z'])).toThrow(UnsafeDeletionError);
  });

  it('IDs repetidos na seleção contam uma vez só', () => {
    expect(() => planDeletion(['a', 'b'], ['a', 'a'])).not.toThrow();
    expect(planDeletion(['a', 'b'], ['a', 'a']).deleteIds).toEqual(['a']);
  });

  it('propriedade: ou recusa, ou sempre sobra pelo menos uma cópia do grupo', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.string({ minLength: 1, maxLength: 4 }), { minLength: 1, maxLength: 8 }),
        fc.array(fc.string({ minLength: 1, maxLength: 4 }), { maxLength: 10 }),
        (group, selection) => {
          try {
            const plan = planDeletion(group, selection);
            const all = new Set([...plan.deleteIds, ...plan.keepIds]);
            return (
              plan.keepIds.length > 0 &&
              plan.deleteIds.every((id) => group.includes(id)) &&
              plan.deleteIds.every((id) => !plan.keepIds.includes(id)) &&
              all.size === group.length
            );
          } catch (e) {
            return e instanceof UnsafeDeletionError;
          }
        },
      ),
      { numRuns: 500 },
    );
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -w apps/api -- src/actions/deletion-plan`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: Implementação**

`apps/api/src/actions/deletion-plan.ts`:
```ts
export class UnsafeDeletionError extends Error {}

export function planDeletion(
  groupFileIds: string[],
  deleteIds: string[],
): { deleteIds: string[]; keepIds: string[] } {
  const group = new Set(groupFileIds);
  const toDelete = new Set(deleteIds);
  if (toDelete.size === 0) throw new UnsafeDeletionError('Nenhuma cópia marcada para excluir.');
  for (const id of toDelete) {
    if (!group.has(id)) throw new UnsafeDeletionError('Um dos arquivos marcados não pertence a este grupo.');
  }
  const keepIds = [...group].filter((id) => !toDelete.has(id));
  if (keepIds.length === 0) {
    throw new UnsafeDeletionError('Não é possível excluir todas as cópias de um grupo. Deixe pelo menos uma.');
  }
  return { deleteIds: [...toDelete], keepIds };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test -w apps/api -- src/actions/deletion-plan`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/actions/deletion-plan.ts apps/api/src/actions/deletion-plan.spec.ts
git commit -m "feat: trava que impede excluir todas as cópias de um grupo"
```

---

### Task 6: Interface `CloudProvider`, erros e provedor falso (com dados de demonstração)

**Files:**
- Create: `apps/api/src/cloud/cloud-provider.ts`, `apps/api/src/cloud/errors.ts`, `apps/api/src/cloud/fake-cloud-provider.ts`, `apps/api/src/cloud/demo-seed.ts`
- Test: `apps/api/src/cloud/fake-cloud-provider.spec.ts`

**Interfaces:**
- Produces:
  - ```ts
    interface ChildrenPage { files: CloudItem[]; folders: CloudFolder[]; nextPageToken: string | null }
    interface CloudProvider {
      getRoot(): Promise<CloudFolder>;
      listFolders(parentId: string): Promise<CloudFolder[]>;
      listChildren(folderId: string, pageToken: string | null): Promise<ChildrenPage>;
      getItem(id: string): Promise<CloudItem | null>;      // null = não existe mais
      getThumbnailUrl(id: string): Promise<string | null>;
      moveToTrash(id: string): Promise<'moved' | 'already-gone'>;
      restore(id: string): Promise<RestoreResult>;
      resolveFolderLink(url: string): Promise<CloudFolder>; // lança InvalidLinkError
    }
    ```
  - Erros: `OfflineError`, `ReconnectRequiredError`, `ForbiddenError`, `InvalidLinkError`, `GraphError(status, body)`.
  - `class FakeCloudProvider implements CloudProvider` com: `pageSize`, `rootId = 'root'`,
    `addFolder(parentId, name): CloudFolder`, `addFile(parentId, partial): CloudItem`,
    `updateFile(id, patch)`, `removeFile(id)`, `failNext(method, error, times?)`,
    `calls: string[]`, `isInTrash(id): boolean`.
  - `seedDemo(p: FakeCloudProvider): void`.

- [ ] **Step 1: Teste**

`apps/api/src/cloud/fake-cloud-provider.spec.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { InvalidLinkError, OfflineError } from './errors';
import { FakeCloudProvider } from './fake-cloud-provider';
import { seedDemo } from './demo-seed';

describe('FakeCloudProvider', () => {
  it('lista filhos paginados, pastas primeiro', async () => {
    const p = new FakeCloudProvider();
    p.pageSize = 2;
    const sub = p.addFolder(p.rootId, 'Sub');
    p.addFile(p.rootId, { name: 'a.jpg' });
    p.addFile(p.rootId, { name: 'b.jpg' });
    const page1 = await p.listChildren(p.rootId, null);
    expect(page1.folders.map((f) => f.name)).toEqual(['Sub']);
    expect(page1.files.map((f) => f.name)).toEqual(['a.jpg']);
    const page2 = await p.listChildren(p.rootId, page1.nextPageToken);
    expect(page2.files.map((f) => f.name)).toEqual(['b.jpg']);
    expect(page2.nextPageToken).toBeNull();
    expect(sub.path).toBe('/Sub');
  });

  it('move para a lixeira e restaura', async () => {
    const p = new FakeCloudProvider();
    const f = p.addFile(p.rootId, { name: 'a.jpg' });
    expect(await p.moveToTrash(f.id)).toBe('moved');
    expect(await p.getItem(f.id)).toBeNull();
    expect(await p.moveToTrash(f.id)).toBe('already-gone');
    expect(await p.restore(f.id)).toBe('restored');
    expect(await p.getItem(f.id)).not.toBeNull();
    expect(await p.restore(f.id)).toBe('not-in-trash');
  });

  it('restaurar com nome ocupado dá conflito', async () => {
    const p = new FakeCloudProvider();
    const f = p.addFile(p.rootId, { name: 'a.jpg' });
    await p.moveToTrash(f.id);
    p.addFile(p.rootId, { name: 'a.jpg' });
    expect(await p.restore(f.id)).toBe('conflict');
  });

  it('injeta falhas', async () => {
    const p = new FakeCloudProvider();
    p.failNext('listChildren', new OfflineError('sem rede'));
    await expect(p.listChildren(p.rootId, null)).rejects.toBeInstanceOf(OfflineError);
    await expect(p.listChildren(p.rootId, null)).resolves.toBeDefined();
  });

  it('resolve link de pasta e recusa link inválido', async () => {
    const p = new FakeCloudProvider();
    const sub = p.addFolder(p.rootId, 'Sub');
    expect(await p.resolveFolderLink(`https://fake.onedrive/${sub.id}`)).toEqual(sub);
    await expect(p.resolveFolderLink('https://example.com/x')).rejects.toBeInstanceOf(InvalidLinkError);
  });

  it('dados de demonstração têm pastas e cópias idênticas', async () => {
    const p = new FakeCloudProvider();
    seedDemo(p);
    const folders = await p.listFolders(p.rootId);
    expect(folders.map((f) => f.name)).toEqual(['Imagens', 'Minhas imagens']);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -w apps/api -- src/cloud/fake`
Expected: FAIL — módulos não encontrados.

- [ ] **Step 3: Implementação**

`apps/api/src/cloud/errors.ts`:
```ts
export class OfflineError extends Error {
  constructor(message = 'Sem conexão com a internet.') { super(message); }
}
export class ReconnectRequiredError extends Error {
  constructor(message = 'A conexão com o OneDrive expirou. Conecte de novo.') { super(message); }
}
export class ForbiddenError extends Error {
  constructor(message = 'Sem permissão para este item do OneDrive.') { super(message); }
}
export class InvalidLinkError extends Error {}
export class GraphError extends Error {
  constructor(readonly status: number, readonly body: string) {
    super(`O OneDrive respondeu com erro ${status}.`);
  }
}
```

`apps/api/src/cloud/cloud-provider.ts`:
```ts
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
```

`apps/api/src/cloud/fake-cloud-provider.ts`:
```ts
import type { CloudFolder, CloudItem, RestoreResult } from '@twinpix/shared';
import type { ChildrenPage, CloudProvider } from './cloud-provider';
import { InvalidLinkError } from './errors';

type Method = keyof CloudProvider;

interface FolderNode { folder: CloudFolder; parentId: string | null }
interface FileNode { item: CloudItem; parentId: string }

const LINK_PREFIX = 'https://fake.onedrive/';

export class FakeCloudProvider implements CloudProvider {
  pageSize = 50;
  readonly rootId = 'root';
  readonly calls: string[] = [];
  private folders = new Map<string, FolderNode>();
  private files = new Map<string, FileNode>();
  private trash = new Map<string, FileNode>();
  private faults: Array<{ method: Method; error: Error; times: number }> = [];
  private nextId = 1;

  constructor() {
    this.folders.set(this.rootId, {
      folder: { id: this.rootId, name: 'OneDrive', path: '/', childCount: 0 },
      parentId: null,
    });
  }

  addFolder(parentId: string, name: string): CloudFolder {
    const parent = this.mustFolder(parentId);
    const path = parent.folder.path === '/' ? `/${name}` : `${parent.folder.path}/${name}`;
    const folder: CloudFolder = { id: `folder-${this.nextId++}`, name, path, childCount: 0 };
    this.folders.set(folder.id, { folder, parentId });
    return folder;
  }

  addFile(parentId: string, partial: Partial<CloudItem> & { name: string }): CloudItem {
    const parent = this.mustFolder(parentId);
    const id = partial.id ?? `file-${this.nextId++}`;
    const isVideo = partial.kind === 'video' || /\.(mp4|mov)$/i.test(partial.name);
    const item: CloudItem = {
      folderPath: parent.folder.path,
      size: 1000,
      quickXorHash: `hash-${id}`,
      mimeType: isVideo ? 'video/mp4' : 'image/jpeg',
      kind: isVideo ? 'video' : 'photo',
      takenAt: '2015-02-06T22:26:31Z',
      createdAt: '2015-02-07T10:00:00Z',
      modifiedAt: '2015-02-07T10:00:00Z',
      width: 4000,
      height: 3000,
      cameraMake: null,
      cameraModel: null,
      durationMs: isVideo ? 10_000 : null,
      webUrl: `https://fake.onedrive/view/${id}`,
      ...partial,
      id,
    };
    this.files.set(id, { item, parentId });
    return item;
  }

  updateFile(id: string, patch: Partial<CloudItem>): void {
    const node = this.files.get(id);
    if (!node) throw new Error(`arquivo ${id} não existe`);
    node.item = { ...node.item, ...patch };
  }

  /** Simula exclusão feita fora do app (ex.: pelo celular). */
  removeFile(id: string): void {
    this.files.delete(id);
  }

  isInTrash(id: string): boolean {
    return this.trash.has(id);
  }

  failNext(method: Method, error: Error, times = 1): void {
    this.faults.push({ method, error, times });
  }

  async getRoot(): Promise<CloudFolder> {
    this.enter('getRoot');
    return this.withCount(this.mustFolder(this.rootId).folder);
  }

  async listFolders(parentId: string): Promise<CloudFolder[]> {
    this.enter('listFolders');
    return this.childFolders(parentId).map((f) => this.withCount(f));
  }

  async listChildren(folderId: string, pageToken: string | null): Promise<ChildrenPage> {
    this.enter('listChildren');
    const entries: Array<{ folder?: CloudFolder; file?: CloudItem }> = [
      ...this.childFolders(folderId).map((folder) => ({ folder: this.withCount(folder) })),
      ...this.childFiles(folderId).map((file) => ({ file })),
    ];
    const start = pageToken ? Number(pageToken) : 0;
    const slice = entries.slice(start, start + this.pageSize);
    const next = start + this.pageSize < entries.length ? String(start + this.pageSize) : null;
    return {
      folders: slice.flatMap((e) => (e.folder ? [e.folder] : [])),
      files: slice.flatMap((e) => (e.file ? [e.file] : [])),
      nextPageToken: next,
    };
  }

  async getItem(id: string): Promise<CloudItem | null> {
    this.enter('getItem');
    return this.files.get(id)?.item ?? null;
  }

  async getThumbnailUrl(id: string): Promise<string | null> {
    this.enter('getThumbnailUrl');
    const item = this.files.get(id)?.item ?? this.trash.get(id)?.item;
    if (!item) return null;
    const hue = [...(item.quickXorHash ?? item.id)].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
    const label = item.kind === 'video' ? '▶ vídeo' : 'foto';
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240">` +
      `<rect width="320" height="240" fill="hsl(${hue},55%,62%)"/>` +
      `<text x="160" y="128" font-family="sans-serif" font-size="22" text-anchor="middle" fill="#fff">${label}</text></svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  }

  async moveToTrash(id: string): Promise<'moved' | 'already-gone'> {
    this.enter('moveToTrash');
    const node = this.files.get(id);
    if (!node) return 'already-gone';
    this.files.delete(id);
    this.trash.set(id, node);
    return 'moved';
  }

  async restore(id: string): Promise<RestoreResult> {
    this.enter('restore');
    const node = this.trash.get(id);
    if (!node) return 'not-in-trash';
    const taken = this.childFiles(node.parentId).some((f) => f.name === node.item.name);
    if (taken || !this.folders.has(node.parentId)) return 'conflict';
    this.trash.delete(id);
    this.files.set(id, node);
    return 'restored';
  }

  async resolveFolderLink(url: string): Promise<CloudFolder> {
    this.enter('resolveFolderLink');
    if (!url.startsWith(LINK_PREFIX)) throw new InvalidLinkError('Este link não é do OneDrive.');
    const node = this.folders.get(url.slice(LINK_PREFIX.length));
    if (!node) throw new InvalidLinkError('Não encontrei essa pasta. Confira se o link está completo.');
    return this.withCount(node.folder);
  }

  private enter(method: Method): void {
    this.calls.push(method);
    const fault = this.faults.find((f) => f.method === method);
    if (fault) {
      fault.times -= 1;
      if (fault.times <= 0) this.faults.splice(this.faults.indexOf(fault), 1);
      throw fault.error;
    }
  }

  private mustFolder(id: string): FolderNode {
    const node = this.folders.get(id);
    if (!node) throw new Error(`pasta ${id} não existe`);
    return node;
  }

  private childFolders(parentId: string): CloudFolder[] {
    return [...this.folders.values()]
      .filter((n) => n.parentId === parentId)
      .map((n) => n.folder)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private childFiles(parentId: string): CloudItem[] {
    return [...this.files.values()]
      .filter((n) => n.parentId === parentId)
      .map((n) => n.item)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private withCount(folder: CloudFolder): CloudFolder {
    return { ...folder, childCount: this.childFolders(folder.id).length + this.childFiles(folder.id).length };
  }
}
```

`apps/api/src/cloud/demo-seed.ts`:
```ts
import type { FakeCloudProvider } from './fake-cloud-provider';

/** Árvore fictícia parecida com o caso real (spec §10), para o modo demonstração. */
export function seedDemo(p: FakeCloudProvider): void {
  const imagens = p.addFolder(p.rootId, 'Imagens');
  const camera = p.addFolder(imagens.id, 'Imagens da Câmera');
  const c2015 = p.addFolder(camera.id, '2015');
  const c2016 = p.addFolder(camera.id, '2016');
  const minhas = p.addFolder(p.rootId, 'Minhas imagens');
  const dia = p.addFolder(minhas.id, '07-06-07');
  const minhasFotos = p.addFolder(minhas.id, 'minhas fotos');
  const diaCopia = p.addFolder(minhasFotos.id, '07-06-07');

  const samsung = { cameraMake: 'Samsung', cameraModel: 'SM-G900M' };

  // Backup que rodou duas vezes: "nome.jpg" + "nome 1.jpg" idênticos.
  for (let i = 0; i < 6; i++) {
    const n = `20150206_2226${10 + i}`;
    const common = { size: 2_400_000 + i, quickXorHash: `demo-${n}`, takenAt: `2015-02-06T22:26:${10 + i}Z`, ...samsung };
    p.addFile(c2015.id, { name: `${n}.jpg`, ...common, modifiedAt: '2015-02-07T08:00:00Z' });
    p.addFile(c2015.id, { name: `${n} 1.jpg`, ...common, modifiedAt: '2015-04-21T19:30:00Z' });
  }

  // Vídeo duplicado.
  const video = { size: 48_000_000, quickXorHash: 'demo-video-1', kind: 'video' as const, durationMs: 31_000, width: 1920, height: 1080, ...samsung };
  p.addFile(c2016.id, { name: 'VID_20160101_101010.mp4', ...video, takenAt: '2016-01-01T10:10:10Z' });
  p.addFile(c2016.id, { name: 'VID_20160101_101010 1.mp4', ...video, takenAt: '2016-01-01T10:10:10Z' });

  // Três cópias da mesma foto em pastas diferentes.
  const tripla = { size: 3_100_000, quickXorHash: 'demo-tripla', takenAt: '2016-03-05T15:00:00Z', ...samsung };
  p.addFile(c2016.id, { name: 'IMG_20160305_150000.jpg', ...tripla });
  p.addFile(c2016.id, { name: 'IMG_20160305_150000 (2).jpg', ...tripla, modifiedAt: '2017-01-01T00:00:00Z' });
  p.addFile(minhas.id, { name: 'IMG_20160305_150000.jpg', ...tripla, modifiedAt: '2018-06-01T00:00:00Z' });

  // Pasta inteira duplicada (fotos de 2007), câmera antiga.
  const canon = { cameraMake: 'Canon', cameraModel: 'PowerShot A530', width: 2048, height: 1536 };
  for (let i = 1; i <= 4; i++) {
    const common = { size: 800_000 + i, quickXorHash: `demo-2007-${i}`, takenAt: `2007-06-07T1${i}:00:00Z`, ...canon };
    p.addFile(dia.id, { name: `IMG_000${i}.JPG`, ...common });
    p.addFile(diaCopia.id, { name: `IMG_000${i}.JPG`, ...common, modifiedAt: '2012-01-01T00:00:00Z' });
  }

  // Arquivos únicos e um sem hash (vai para "não analisados").
  p.addFile(c2016.id, { name: 'IMG_20160401_090000.jpg', size: 2_000_000, ...samsung });
  p.addFile(c2016.id, { name: 'IMG_20160402_090000.jpg', size: 2_100_000, quickXorHash: null, ...samsung });
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test -w apps/api -- src/cloud/fake`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/cloud
git commit -m "feat: interface CloudProvider, erros e provedor falso com dados de demonstração"
```

---

### Task 7: Provedor OneDrive (Microsoft Graph)

**Files:**
- Create: `apps/api/src/cloud/onedrive/map-drive-item.ts`, `apps/api/src/cloud/onedrive/graph-client.ts`, `apps/api/src/cloud/onedrive/onedrive-provider.ts`
- Test: `apps/api/src/cloud/onedrive/map-drive-item.spec.ts`, `apps/api/src/cloud/onedrive/graph-client.spec.ts`, `apps/api/src/cloud/onedrive/onedrive-provider.spec.ts`

**Interfaces:**
- Consumes: `CloudProvider`, `ChildrenPage`, erros (Task 6).
- Produces:
  - `interface DriveItem` (subconjunto do recurso driveItem do Graph)
  - `folderPathOf(item: DriveItem): string`, `mapFile(item: DriveItem): CloudItem | null`, `mapFolder(item: DriveItem): CloudFolder`
  - `interface TokenSource { getAccessToken(forceRefresh: boolean): Promise<string> }` (lança `ReconnectRequiredError`)
  - `class GraphClient { constructor(tokens: TokenSource, opts?: { fetch?: typeof fetch; sleep?: (ms: number) => Promise<void>; maxRetries?: number }); request<T>(method: string, pathOrUrl: string, body?: unknown): Promise<{ status: number; data: T | null }> }`
  - `class OneDriveProvider implements CloudProvider { constructor(graph: GraphClient) }`
  - `encodeShareUrl(url: string): string`

Referência do Graph: `GET /me/drive/root`, `GET /me/drive/items/{id}/children`,
`GET /me/drive/items/{id}`, `GET /me/drive/items/{id}/thumbnails/0/large`,
`DELETE /me/drive/items/{id}` (vai para a lixeira), `POST /me/drive/items/{id}/restore`
(OneDrive pessoal), `GET /shares/{u!base64url}/driveItem`. `video.duration` vem em **milissegundos**.

- [ ] **Step 1: Testes**

`apps/api/src/cloud/onedrive/map-drive-item.spec.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { folderPathOf, mapFile, mapFolder, type DriveItem } from './map-drive-item';

// Exemplo no formato real de resposta do Graph (dados anonimizados).
const photo: DriveItem = {
  id: 'ABC!101',
  name: '20150206_222631_LLS.jpg',
  size: 2481234,
  webUrl: 'https://onedrive.live.com/?id=ABC%21101',
  createdDateTime: '2015-02-07T10:00:00Z',
  lastModifiedDateTime: '2015-02-07T10:00:00Z',
  parentReference: { driveId: 'abc', id: 'ABC!100', path: '/drive/root:/Imagens/Imagens%20da%20C%C3%A2mera' },
  file: { mimeType: 'image/jpeg', hashes: { quickXorHash: 'q1==' } },
  fileSystemInfo: { createdDateTime: '2015-02-06T22:26:31Z' },
  image: { width: 4128, height: 2322 },
  photo: { takenDateTime: '2015-02-06T22:26:31Z', cameraMake: 'samsung', cameraModel: 'SM-G900M' },
};

describe('mapeamento de driveItem', () => {
  it('converte caminho do Graph para caminho legível', () => {
    expect(folderPathOf(photo)).toBe('/Imagens/Imagens da Câmera');
    expect(folderPathOf({ ...photo, parentReference: { path: '/drive/root:' } })).toBe('/');
    expect(folderPathOf({ ...photo, parentReference: { path: '/drives/abc/root:/X' } })).toBe('/X');
  });

  it('mapeia foto com todos os campos', () => {
    expect(mapFile(photo)).toEqual({
      id: 'ABC!101',
      name: '20150206_222631_LLS.jpg',
      folderPath: '/Imagens/Imagens da Câmera',
      size: 2481234,
      quickXorHash: 'q1==',
      mimeType: 'image/jpeg',
      kind: 'photo',
      takenAt: '2015-02-06T22:26:31Z',
      createdAt: '2015-02-06T22:26:31Z',
      modifiedAt: '2015-02-07T10:00:00Z',
      width: 4128,
      height: 2322,
      cameraMake: 'samsung',
      cameraModel: 'SM-G900M',
      durationMs: null,
      webUrl: 'https://onedrive.live.com/?id=ABC%21101',
    });
  });

  it('vídeo: duração em milissegundos e dimensões do vídeo', () => {
    const v = mapFile({
      ...photo,
      name: 'v.mp4',
      file: { mimeType: 'video/mp4', hashes: { quickXorHash: 'q2' } },
      image: undefined,
      photo: undefined,
      video: { width: 1920, height: 1080, duration: 31000 },
    });
    expect(v).toMatchObject({ kind: 'video', durationMs: 31000, width: 1920, height: 1080, takenAt: null });
  });

  it('ignora arquivos que não são foto nem vídeo e aceita hash ausente', () => {
    expect(mapFile({ ...photo, file: { mimeType: 'application/pdf' }, image: undefined, photo: undefined })).toBeNull();
    expect(mapFile({ ...photo, file: { mimeType: 'image/heic' } })?.quickXorHash).toBeNull();
  });

  it('mapeia pasta, incluindo a raiz', () => {
    expect(mapFolder({ ...photo, name: 'Sub', file: undefined, folder: { childCount: 3 } })).toEqual({
      id: 'ABC!101',
      name: 'Sub',
      path: '/Imagens/Imagens da Câmera/Sub',
      childCount: 3,
    });
    expect(mapFolder({ ...photo, name: 'root', root: {}, parentReference: undefined, folder: { childCount: 2 } }).path).toBe('/');
  });
});
```

`apps/api/src/cloud/onedrive/graph-client.spec.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';
import { ForbiddenError, OfflineError, ReconnectRequiredError } from '../errors';
import { GraphClient } from './graph-client';

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(body === null ? null : JSON.stringify(body), { status, headers });

function setup(responses: Array<Response | Error>) {
  const fetchMock = vi.fn(async () => {
    const next = responses.shift();
    if (!next) throw new Error('sem resposta configurada');
    if (next instanceof Error) throw next;
    return next;
  });
  const tokens = { getAccessToken: vi.fn(async (force: boolean) => (force ? 'novo' : 'velho')) };
  const sleep = vi.fn(async () => {});
  const client = new GraphClient(tokens, { fetch: fetchMock as unknown as typeof fetch, sleep, maxRetries: 3 });
  return { client, fetchMock, tokens, sleep };
}

describe('GraphClient', () => {
  it('respeita Retry-After no 429 e tenta de novo', async () => {
    const { client, sleep } = setup([json(429, {}, { 'Retry-After': '7' }), json(200, { ok: 1 })]);
    await expect(client.request('GET', '/me/drive/root')).resolves.toEqual({ status: 200, data: { ok: 1 } });
    expect(sleep).toHaveBeenCalledWith(7000);
  });

  it('503 sem Retry-After usa backoff exponencial', async () => {
    const { client, sleep } = setup([json(503, {}), json(503, {}), json(200, {})]);
    await client.request('GET', '/x');
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000, 2000]);
  });

  it('401 renova o token uma vez', async () => {
    const { client, tokens } = setup([json(401, {}), json(200, {})]);
    await client.request('GET', '/x');
    expect(tokens.getAccessToken.mock.calls.map((c) => c[0])).toEqual([false, true]);
  });

  it('401 de novo depois de renovar pede reconexão', async () => {
    const { client } = setup([json(401, {}), json(401, {})]);
    await expect(client.request('GET', '/x')).rejects.toBeInstanceOf(ReconnectRequiredError);
  });

  it('falha de rede vira OfflineError', async () => {
    const { client } = setup([new TypeError('fetch failed')]);
    await expect(client.request('GET', '/x')).rejects.toBeInstanceOf(OfflineError);
  });

  it('403 vira ForbiddenError; 404 e 409 voltam como status', async () => {
    const a = setup([json(403, {})]);
    await expect(a.client.request('GET', '/x')).rejects.toBeInstanceOf(ForbiddenError);
    const b = setup([json(404, {}), json(409, {})]);
    await expect(b.client.request('GET', '/x')).resolves.toEqual({ status: 404, data: null });
    await expect(b.client.request('POST', '/x', {})).resolves.toEqual({ status: 409, data: null });
  });

  it('usa a URL completa quando recebe um nextLink', async () => {
    const { client, fetchMock } = setup([json(200, {})]);
    await client.request('GET', 'https://graph.microsoft.com/v1.0/me/drive/items/1/children?$skiptoken=abc');
    expect((fetchMock.mock.calls[0] as unknown[])[0]).toBe('https://graph.microsoft.com/v1.0/me/drive/items/1/children?$skiptoken=abc');
  });
});
```

`apps/api/src/cloud/onedrive/onedrive-provider.spec.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';
import { InvalidLinkError } from '../errors';
import type { GraphClient } from './graph-client';
import { encodeShareUrl, OneDriveProvider } from './onedrive-provider';

function fakeGraph(routes: Record<string, { status: number; data: unknown }>) {
  const request = vi.fn(async (method: string, path: string) => {
    const key = `${method} ${path.split('?')[0]}`;
    const r = routes[key];
    if (!r) throw new Error(`rota não simulada: ${key}`);
    return r;
  });
  return { graph: { request } as unknown as GraphClient, request };
}

const folderItem = (id: string, name: string, parent = '/drive/root:') => ({
  id, name, webUrl: '', createdDateTime: '', lastModifiedDateTime: '',
  parentReference: { driveId: 'meu', path: parent }, folder: { childCount: 1 },
});

describe('OneDriveProvider', () => {
  it('lista filhos e devolve o nextLink como token de página', async () => {
    const { graph } = fakeGraph({
      'GET /me/drive/items/F/children': {
        status: 200,
        data: {
          value: [
            folderItem('S', 'Sub', '/drive/root:/Pai'),
            { id: 'P', name: 'a.jpg', size: 1, webUrl: '', createdDateTime: 'c', lastModifiedDateTime: 'm',
              parentReference: { path: '/drive/root:/Pai' }, file: { mimeType: 'image/jpeg', hashes: { quickXorHash: 'h' } } },
            { id: 'D', name: 'doc.pdf', size: 1, webUrl: '', createdDateTime: 'c', lastModifiedDateTime: 'm',
              parentReference: { path: '/drive/root:/Pai' }, file: { mimeType: 'application/pdf' } },
          ],
          '@odata.nextLink': 'https://graph.microsoft.com/v1.0/next',
        },
      },
    });
    const page = await new OneDriveProvider(graph).listChildren('F', null);
    expect(page.folders.map((f) => f.path)).toEqual(['/Pai/Sub']);
    expect(page.files.map((f) => f.id)).toEqual(['P']);
    expect(page.nextPageToken).toBe('https://graph.microsoft.com/v1.0/next');
  });

  it('getItem devolve null quando o arquivo sumiu', async () => {
    const { graph } = fakeGraph({ 'GET /me/drive/items/X': { status: 404, data: null } });
    expect(await new OneDriveProvider(graph).getItem('X')).toBeNull();
  });

  it('lixeira e restauração mapeiam os status', async () => {
    const { graph } = fakeGraph({
      'DELETE /me/drive/items/A': { status: 204, data: null },
      'DELETE /me/drive/items/B': { status: 404, data: null },
      'POST /me/drive/items/A/restore': { status: 200, data: {} },
      'POST /me/drive/items/B/restore': { status: 404, data: null },
      'POST /me/drive/items/C/restore': { status: 409, data: null },
    });
    const p = new OneDriveProvider(graph);
    expect(await p.moveToTrash('A')).toBe('moved');
    expect(await p.moveToTrash('B')).toBe('already-gone');
    expect(await p.restore('A')).toBe('restored');
    expect(await p.restore('B')).toBe('not-in-trash');
    expect(await p.restore('C')).toBe('conflict');
  });

  it('codifica o link de compartilhamento no formato u!base64url', () => {
    expect(encodeShareUrl('https://1drv.ms/f/s!abc')).toBe('u!aHR0cHM6Ly8xZHJ2Lm1zL2YvcyFhYmM');
  });

  it('link: recusa domínio estranho, arquivo e pasta de outra conta', async () => {
    const enc = encodeShareUrl('https://1drv.ms/f/s!abc');
    const own = { 'GET /me/drive': { status: 200, data: { id: 'meu' } } };
    const p1 = new OneDriveProvider(fakeGraph(own).graph);
    await expect(p1.resolveFolderLink('https://example.com/x')).rejects.toBeInstanceOf(InvalidLinkError);

    const p2 = new OneDriveProvider(fakeGraph({ ...own, [`GET /shares/${enc}/driveItem`]: { status: 200, data: { ...folderItem('A', 'a.jpg'), folder: undefined, file: { mimeType: 'image/jpeg' } } } }).graph);
    await expect(p2.resolveFolderLink('https://1drv.ms/f/s!abc')).rejects.toThrow('não é de uma pasta');

    const other = { ...folderItem('F', 'Pasta'), parentReference: { driveId: 'outro', path: '/drive/root:' } };
    const p3 = new OneDriveProvider(fakeGraph({ ...own, [`GET /shares/${enc}/driveItem`]: { status: 200, data: other } }).graph);
    await expect(p3.resolveFolderLink('https://1drv.ms/f/s!abc')).rejects.toThrow('outra conta');

    const p4 = new OneDriveProvider(fakeGraph({ ...own, [`GET /shares/${enc}/driveItem`]: { status: 200, data: folderItem('F', 'Pasta') } }).graph);
    await expect(p4.resolveFolderLink('https://1drv.ms/f/s!abc')).resolves.toMatchObject({ id: 'F', path: '/Pasta' });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -w apps/api -- src/cloud/onedrive`
Expected: FAIL — módulos não encontrados.

- [ ] **Step 3: Implementação**

`apps/api/src/cloud/onedrive/map-drive-item.ts`:
```ts
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
```

`apps/api/src/cloud/onedrive/graph-client.ts`:
```ts
import { ForbiddenError, GraphError, OfflineError, ReconnectRequiredError } from '../errors';

export interface TokenSource {
  getAccessToken(forceRefresh: boolean): Promise<string>;
}

interface Options {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  maxRetries?: number;
}

const BASE = 'https://graph.microsoft.com/v1.0';
const MAX_WAIT_MS = 60_000;

export class GraphClient {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxRetries: number;

  constructor(private readonly tokens: TokenSource, opts: Options = {}) {
    this.fetchImpl = opts.fetch ?? fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.maxRetries = opts.maxRetries ?? 6;
  }

  async request<T>(method: string, pathOrUrl: string, body?: unknown): Promise<{ status: number; data: T | null }> {
    const url = pathOrUrl.startsWith('https://') ? pathOrUrl : `${BASE}${pathOrUrl}`;
    let forceRefresh = false;
    let refreshed = false;
    let retries = 0;
    for (;;) {
      const token = await this.tokens.getAccessToken(forceRefresh);
      forceRefresh = false;
      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          },
          body: body !== undefined ? JSON.stringify(body) : undefined,
        });
      } catch {
        throw new OfflineError();
      }

      if (res.status === 401) {
        if (refreshed) throw new ReconnectRequiredError();
        refreshed = true;
        forceRefresh = true;
        continue;
      }
      if ((res.status === 429 || res.status === 503) && retries < this.maxRetries) {
        const retryAfter = Number(res.headers.get('Retry-After'));
        const wait = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : Math.min(2 ** retries * 1000, MAX_WAIT_MS);
        retries += 1;
        await this.sleep(wait);
        continue;
      }
      if (res.status === 403) throw new ForbiddenError();
      if (res.status === 404 || res.status === 409) return { status: res.status, data: null };
      if (!res.ok) throw new GraphError(res.status, await res.text());
      if (res.status === 204) return { status: 204, data: null };
      const text = await res.text();
      return { status: res.status, data: text ? (JSON.parse(text) as T) : null };
    }
  }
}
```

`apps/api/src/cloud/onedrive/onedrive-provider.ts`:
```ts
import type { CloudFolder, CloudItem, RestoreResult } from '@twinpix/shared';
import type { ChildrenPage, CloudProvider } from '../cloud-provider';
import { InvalidLinkError } from '../errors';
import type { GraphClient } from './graph-client';
import { mapFile, mapFolder, type DriveItem } from './map-drive-item';

const SELECT =
  'id,name,size,webUrl,createdDateTime,lastModifiedDateTime,parentReference,file,folder,root,fileSystemInfo,photo,image,video';
const LINK_HOSTS = ['1drv.ms', 'onedrive.live.com'];

interface Page { value: DriveItem[]; '@odata.nextLink'?: string }

export function encodeShareUrl(url: string): string {
  return 'u!' + Buffer.from(url, 'utf8').toString('base64').replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-');
}

export class OneDriveProvider implements CloudProvider {
  private ownDriveId: string | null = null;

  constructor(private readonly graph: GraphClient) {}

  async getRoot(): Promise<CloudFolder> {
    const { data } = await this.graph.request<DriveItem>('GET', `/me/drive/root?$select=${SELECT}`);
    return mapFolder(data!);
  }

  async listFolders(parentId: string): Promise<CloudFolder[]> {
    const folders: CloudFolder[] = [];
    let token: string | null = null;
    do {
      const page = await this.listChildren(parentId, token);
      folders.push(...page.folders);
      token = page.nextPageToken;
    } while (token);
    return folders.sort((a, b) => a.name.localeCompare(b.name));
  }

  async listChildren(folderId: string, pageToken: string | null): Promise<ChildrenPage> {
    const url = pageToken ?? `/me/drive/items/${encodeURIComponent(folderId)}/children?$top=200&$select=${SELECT}`;
    const { data } = await this.graph.request<Page>('GET', url);
    const value = data?.value ?? [];
    return {
      folders: value.filter((i) => i.folder).map(mapFolder),
      files: value.map(mapFile).filter((f): f is CloudItem => f !== null),
      nextPageToken: data?.['@odata.nextLink'] ?? null,
    };
  }

  async getItem(id: string): Promise<CloudItem | null> {
    const { status, data } = await this.graph.request<DriveItem>('GET', `/me/drive/items/${encodeURIComponent(id)}?$select=${SELECT}`);
    if (status === 404 || !data) return null;
    return mapFile(data);
  }

  async getThumbnailUrl(id: string): Promise<string | null> {
    const { data } = await this.graph.request<{ url?: string }>('GET', `/me/drive/items/${encodeURIComponent(id)}/thumbnails/0/large`);
    return data?.url ?? null;
  }

  async moveToTrash(id: string): Promise<'moved' | 'already-gone'> {
    const { status } = await this.graph.request('DELETE', `/me/drive/items/${encodeURIComponent(id)}`);
    return status === 404 ? 'already-gone' : 'moved';
  }

  async restore(id: string): Promise<RestoreResult> {
    const { status } = await this.graph.request('POST', `/me/drive/items/${encodeURIComponent(id)}/restore`, {});
    if (status === 404) return 'not-in-trash';
    if (status === 409) return 'conflict';
    return 'restored';
  }

  async resolveFolderLink(url: string): Promise<CloudFolder> {
    let host: string;
    try {
      host = new URL(url).hostname;
    } catch {
      throw new InvalidLinkError('Isso não parece um link. Copie o endereço da pasta no OneDrive e cole aqui.');
    }
    if (!LINK_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) {
      throw new InvalidLinkError('Este link não é do OneDrive.');
    }
    const { status, data } = await this.graph.request<DriveItem>('GET', `/shares/${encodeShareUrl(url)}/driveItem?$select=${SELECT}`);
    if (status === 404 || !data) throw new InvalidLinkError('Não encontrei essa pasta. Confira se o link está completo.');
    if (!data.folder) throw new InvalidLinkError('Este link não é de uma pasta.');
    const own = await this.getOwnDriveId();
    if (data.parentReference?.driveId && data.parentReference.driveId !== own) {
      throw new InvalidLinkError('Esta pasta é de outra conta. Nesta versão, só dá para analisar pastas do seu próprio OneDrive.');
    }
    return mapFolder(data);
  }

  private async getOwnDriveId(): Promise<string> {
    if (!this.ownDriveId) {
      const { data } = await this.graph.request<{ id: string }>('GET', '/me/drive?$select=id');
      this.ownDriveId = data?.id ?? '';
    }
    return this.ownDriveId;
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test -w apps/api -- src/cloud/onedrive`
Expected: PASS. (O valor esperado de `encodeShareUrl` foi conferido com
`Buffer.from(url).toString('base64url')`.)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/cloud/onedrive
git commit -m "feat: provedor OneDrive via Microsoft Graph com retry, renovação de token e lixeira"
```

---

### Task 8: Configuração, módulo de nuvem e autenticação Microsoft (PKCE)

**Files:**
- Create: `apps/api/src/config.ts`, `apps/api/src/tokens.ts`
- Create: `apps/api/src/auth/token-cache.ts`, `apps/api/src/auth/auth.service.ts`, `apps/api/src/auth/auth.controller.ts`, `apps/api/src/auth/auth.module.ts`
- Create: `apps/api/src/cloud/cloud.module.ts`
- Test: `apps/api/src/config.spec.ts`, `apps/api/src/auth/token-cache.spec.ts`, `apps/api/src/auth/auth.service.spec.ts`

**Interfaces:**
- Consumes: `GraphClient`, `TokenSource`, `OneDriveProvider` (Task 7), `FakeCloudProvider`, `seedDemo` (Task 6), `ReconnectRequiredError`.
- Produces:
  - `interface AppConfig { port; provider: 'onedrive' | 'fake'; demo; clientId: string | null; authority; dataDir; dbFile; sessionToken; uiOrigin; allowedOrigins: string[]; openBrowser; webDist }`
  - `loadConfig(env?, argv?): AppConfig`, `loadDotEnv(file?): void`
  - Tokens: `CONFIG = 'CONFIG'`, `DB = 'DB'`, `CLOUD_PROVIDER = 'CLOUD_PROVIDER'`
  - `createTokenCachePlugin(file: string): ICachePlugin` (grava com permissão `0600`)
  - `class AuthService implements TokenSource { status(): Promise<AuthStatus>; loginUrl(): Promise<string>; handleCallback(code: string, state: string): Promise<void>; logout(): Promise<void>; getAccessToken(force: boolean): Promise<string> }`
  - Rotas: `GET /api/auth/status`, `GET /api/auth/login` (redireciona), `GET /api/auth/callback`, `POST /api/auth/logout`
  - `CloudModule` (global) exporta `CLOUD_PROVIDER`; `AuthModule` exporta `AuthService`.

- [ ] **Step 1: Testes**

`apps/api/src/config.spec.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

describe('loadConfig', () => {
  it('padrões: OneDrive, porta 4317, origens locais', () => {
    const c = loadConfig({ TWINPIX_DATA_DIR: '/tmp/x' }, ['node', 'main.js']);
    expect(c.provider).toBe('onedrive');
    expect(c.port).toBe(4317);
    expect(c.uiOrigin).toBe('http://127.0.0.1:4317');
    expect(c.allowedOrigins).toEqual(['http://127.0.0.1:4317', 'http://localhost:4317']);
    expect(c.dbFile).toBe('/tmp/x/twinpix.sqlite');
    expect(c.sessionToken).toMatch(/^[0-9a-f]{48}$/);
    expect(c.clientId).toBeNull();
  });

  it('--demo usa o provedor falso e banco próprio', () => {
    const c = loadConfig({ TWINPIX_DATA_DIR: '/tmp/x' }, ['node', 'main.js', '--demo']);
    expect(c.provider).toBe('fake');
    expect(c.demo).toBe(true);
    expect(c.dbFile).toBe('/tmp/x/demo.sqlite');
  });

  it('modo dev aceita a origem do Vite e não abre o navegador', () => {
    const c = loadConfig({ TWINPIX_DEV_ORIGIN: 'http://localhost:5173', TWINPIX_SESSION_TOKEN: 'dev-local' }, []);
    expect(c.allowedOrigins).toContain('http://localhost:5173');
    expect(c.uiOrigin).toBe('http://localhost:5173');
    expect(c.openBrowser).toBe(false);
    expect(c.sessionToken).toBe('dev-local');
  });
});
```

`apps/api/src/auth/token-cache.spec.ts`:
```ts
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
```

`apps/api/src/auth/auth.service.spec.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';
import { ReconnectRequiredError } from '../cloud/errors';
import { loadConfig } from '../config';
import { AuthService } from './auth.service';

function fakePca(accounts: Array<{ name?: string; username: string }>, silent?: () => Promise<unknown>) {
  return {
    getTokenCache: () => ({ getAllAccounts: async () => accounts, removeAccount: vi.fn(async () => {}) }),
    acquireTokenSilent: vi.fn(silent ?? (async () => ({ accessToken: 'tok' }))),
    getAuthCodeUrl: vi.fn(async () => 'https://login.microsoftonline.com/authorize?x'),
    acquireTokenByCode: vi.fn(async () => ({ accessToken: 'tok' })),
  };
}

const config = loadConfig({ TWINPIX_DATA_DIR: '/tmp/twinpix-test', TWINPIX_CLIENT_ID: 'cid' }, []);

describe('AuthService', () => {
  it('sem Client ID aparece como não configurado', async () => {
    const s = new AuthService({ ...config, clientId: null }, () => fakePca([]) as any);
    expect(await s.status()).toEqual({ configured: false, connected: false, accountName: null, demo: false });
  });

  it('modo demonstração aparece sempre conectado', async () => {
    const s = new AuthService({ ...config, demo: true, provider: 'fake', clientId: null }, () => fakePca([]) as any);
    expect(await s.status()).toMatchObject({ connected: true, demo: true, accountName: 'Modo demonstração' });
  });

  it('com conta no cache: conectado e devolve token', async () => {
    const pca = fakePca([{ name: 'Priscilla', username: 'p@x' }]);
    const s = new AuthService(config, () => pca as any);
    expect(await s.status()).toMatchObject({ configured: true, connected: true, accountName: 'Priscilla' });
    expect(await s.getAccessToken(true)).toBe('tok');
    expect(pca.acquireTokenSilent).toHaveBeenCalledWith(expect.objectContaining({ forceRefresh: true }));
  });

  it('sem conta ou renovação falhando pede reconexão', async () => {
    await expect(new AuthService(config, () => fakePca([]) as any).getAccessToken(false)).rejects.toBeInstanceOf(ReconnectRequiredError);
    const failing = fakePca([{ username: 'p@x' }], async () => { throw new Error('invalid_grant'); });
    await expect(new AuthService(config, () => failing as any).getAccessToken(false)).rejects.toBeInstanceOf(ReconnectRequiredError);
  });

  it('callback com state desconhecido é recusado', async () => {
    const s = new AuthService(config, () => fakePca([]) as any);
    await expect(s.handleCallback('code', 'state-falso')).rejects.toThrow('expirou');
  });

  it('login gera URL e o callback troca o código usando o verificador PKCE', async () => {
    const pca = fakePca([]);
    const s = new AuthService(config, () => pca as any);
    await s.loginUrl();
    const req = pca.getAuthCodeUrl.mock.calls[0][0] as { state: string; codeChallengeMethod: string };
    expect(req.codeChallengeMethod).toBe('S256');
    await s.handleCallback('code-1', req.state);
    expect(pca.acquireTokenByCode).toHaveBeenCalledWith(expect.objectContaining({ code: 'code-1', codeVerifier: expect.any(String) }));
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -w apps/api -- src/config src/auth`
Expected: FAIL — módulos não encontrados.

- [ ] **Step 3: Implementação**

`apps/api/src/tokens.ts`:
```ts
export const CONFIG = 'CONFIG';
export const DB = 'DB';
export const CLOUD_PROVIDER = 'CLOUD_PROVIDER';
```

`apps/api/src/config.ts`:
```ts
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export interface AppConfig {
  port: number;
  provider: 'onedrive' | 'fake';
  demo: boolean;
  clientId: string | null;
  authority: string;
  dataDir: string;
  dbFile: string;
  sessionToken: string;
  uiOrigin: string;
  allowedOrigins: string[];
  openBrowser: boolean;
  webDist: string;
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  argv: string[] = process.argv,
): AppConfig {
  const demo = argv.includes('--demo');
  const port = Number(env.PORT ?? 4317);
  const devOrigin = env.TWINPIX_DEV_ORIGIN || null;
  const dataDir = env.TWINPIX_DATA_DIR ?? join(homedir(), '.twinpix-cloud');
  return {
    port,
    demo,
    provider: demo || env.TWINPIX_PROVIDER === 'fake' ? 'fake' : 'onedrive',
    clientId: env.TWINPIX_CLIENT_ID || null,
    authority: env.TWINPIX_AUTHORITY ?? 'https://login.microsoftonline.com/consumers',
    dataDir,
    dbFile: join(dataDir, demo ? 'demo.sqlite' : 'twinpix.sqlite'),
    sessionToken: env.TWINPIX_SESSION_TOKEN ?? randomBytes(24).toString('hex'),
    uiOrigin: devOrigin ?? `http://127.0.0.1:${port}`,
    allowedOrigins: [`http://127.0.0.1:${port}`, `http://localhost:${port}`, ...(devOrigin ? [devOrigin] : [])],
    openBrowser: env.TWINPIX_NO_BROWSER !== '1' && !devOrigin,
    webDist: resolve(__dirname, '../../web/dist'),
  };
}

/** Carrega o .env da raiz do repositório, se existir. */
export function loadDotEnv(file = resolve(__dirname, '../../../.env')): void {
  if (existsSync(file)) process.loadEnvFile(file);
}
```

`apps/api/src/auth/token-cache.ts`:
```ts
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
```

`apps/api/src/auth/auth.service.ts`:
```ts
import { CryptoProvider, PublicClientApplication } from '@azure/msal-node';
import { Inject, Injectable } from '@nestjs/common';
import type { AuthStatus } from '@twinpix/shared';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ReconnectRequiredError } from '../cloud/errors';
import type { TokenSource } from '../cloud/onedrive/graph-client';
import type { AppConfig } from '../config';
import { CONFIG } from '../tokens';
import { createTokenCachePlugin } from './token-cache';

const SCOPES = ['Files.ReadWrite', 'offline_access'];

type Pca = Pick<PublicClientApplication, 'getTokenCache' | 'acquireTokenSilent' | 'getAuthCodeUrl' | 'acquireTokenByCode'>;
export type PcaFactory = (config: AppConfig) => Pca;

const defaultFactory: PcaFactory = (config) => {
  mkdirSync(config.dataDir, { recursive: true });
  return new PublicClientApplication({
    auth: { clientId: config.clientId!, authority: config.authority },
    cache: { cachePlugin: createTokenCachePlugin(join(config.dataDir, 'msal-cache.json')) },
  });
};

export const PCA_FACTORY = 'PCA_FACTORY';

@Injectable()
export class AuthService implements TokenSource {
  private pca: Pca | null = null;
  private readonly pending = new Map<string, { verifier: string; createdAt: number }>();
  private readonly crypto = new CryptoProvider();

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(PCA_FACTORY) private readonly factory: PcaFactory = defaultFactory,
  ) {}

  get redirectUri(): string {
    return `http://localhost:${this.config.port}/api/auth/callback`;
  }

  async status(): Promise<AuthStatus> {
    if (this.config.demo || this.config.provider === 'fake') {
      return { configured: true, connected: true, accountName: 'Modo demonstração', demo: true };
    }
    if (!this.config.clientId) return { configured: false, connected: false, accountName: null, demo: false };
    const account = await this.firstAccount();
    return { configured: true, connected: !!account, accountName: account ? account.name ?? account.username : null, demo: false };
  }

  async loginUrl(): Promise<string> {
    const { verifier, challenge } = await this.crypto.generatePkceCodes();
    const state = this.crypto.createNewGuid();
    this.pending.set(state, { verifier, createdAt: Date.now() });
    return this.client().getAuthCodeUrl({
      scopes: SCOPES,
      redirectUri: this.redirectUri,
      codeChallenge: challenge,
      codeChallengeMethod: 'S256',
      state,
      prompt: 'select_account',
    });
  }

  async handleCallback(code: string, state: string): Promise<void> {
    const entry = this.pending.get(state);
    this.pending.delete(state);
    if (!entry || Date.now() - entry.createdAt > 10 * 60_000) {
      throw new Error('O pedido de login expirou. Tente conectar de novo.');
    }
    await this.client().acquireTokenByCode({
      code,
      scopes: SCOPES,
      redirectUri: this.redirectUri,
      codeVerifier: entry.verifier,
    });
  }

  async logout(): Promise<void> {
    const cache = this.client().getTokenCache();
    for (const account of await cache.getAllAccounts()) await cache.removeAccount(account);
  }

  async getAccessToken(forceRefresh: boolean): Promise<string> {
    const account = await this.firstAccount();
    if (!account) throw new ReconnectRequiredError('Conecte o seu OneDrive para continuar.');
    try {
      const result = await this.client().acquireTokenSilent({ account, scopes: SCOPES, forceRefresh });
      if (!result?.accessToken) throw new Error('sem token');
      return result.accessToken;
    } catch {
      throw new ReconnectRequiredError();
    }
  }

  private async firstAccount() {
    if (!this.config.clientId) return null;
    const accounts = await this.client().getTokenCache().getAllAccounts();
    return accounts[0] ?? null;
  }

  private client(): Pca {
    if (!this.pca) this.pca = this.factory(this.config);
    return this.pca;
  }
}
```

`apps/api/src/auth/auth.controller.ts`:
```ts
import { Controller, Get, HttpCode, Inject, Post, Query, Res } from '@nestjs/common';
import type { AuthStatus } from '@twinpix/shared';
import type { Response } from 'express';
import type { AppConfig } from '../config';
import { CONFIG } from '../tokens';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  @Get('status')
  status(): Promise<AuthStatus> {
    return this.auth.status();
  }

  @Get('login')
  async login(@Res() res: Response): Promise<void> {
    res.redirect(await this.auth.loginUrl());
  }

  @Get('callback')
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error_description') errorDescription: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const back = `${this.config.uiOrigin}/#/`;
    if (!code || !state) {
      res.redirect(`${back}?erro=${encodeURIComponent(errorDescription ?? 'Login cancelado.')}`);
      return;
    }
    try {
      await this.auth.handleCallback(code, state);
      res.redirect(back);
    } catch (e) {
      res.redirect(`${back}?erro=${encodeURIComponent((e as Error).message)}`);
    }
  }

  @Post('logout')
  @HttpCode(204)
  logout(): Promise<void> {
    return this.auth.logout();
  }
}
```

`apps/api/src/auth/auth.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService, PCA_FACTORY } from './auth.service';

@Module({
  controllers: [AuthController],
  providers: [AuthService, { provide: PCA_FACTORY, useValue: undefined }],
  exports: [AuthService],
})
export class AuthModule {}
```

(Com `useValue: undefined`, o parâmetro padrão `defaultFactory` do construtor é usado.)

`apps/api/src/cloud/cloud.module.ts`:
```ts
import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthService } from '../auth/auth.service';
import type { AppConfig } from '../config';
import { CLOUD_PROVIDER, CONFIG } from '../tokens';
import type { CloudProvider } from './cloud-provider';
import { seedDemo } from './demo-seed';
import { FakeCloudProvider } from './fake-cloud-provider';
import { GraphClient } from './onedrive/graph-client';
import { OneDriveProvider } from './onedrive/onedrive-provider';

@Global()
@Module({
  imports: [AuthModule],
  providers: [
    {
      provide: CLOUD_PROVIDER,
      inject: [CONFIG, AuthService],
      useFactory: (config: AppConfig, auth: AuthService): CloudProvider => {
        if (config.provider === 'fake') {
          const fake = new FakeCloudProvider();
          fake.pageSize = 5;
          seedDemo(fake);
          return fake;
        }
        return new OneDriveProvider(new GraphClient(auth));
      },
    },
  ],
  exports: [CLOUD_PROVIDER],
})
export class CloudModule {}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test -w apps/api -- src/config src/auth && npm run typecheck -w apps/api`
Expected: PASS e typecheck sem erros. Se a assinatura do `@azure/msal-node` instalado divergir
(ex.: `generatePkceCodes`), ajuste o código à API real e registre no relatório.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/config.ts apps/api/src/config.spec.ts apps/api/src/tokens.ts apps/api/src/auth apps/api/src/cloud/cloud.module.ts
git commit -m "feat: configuração, login Microsoft com PKCE e cache de token protegido"
```

---

### Task 9: Segurança do backend local, filtro de erros e bootstrap

**Files:**
- Create: `apps/api/src/security/session.middleware.ts`, `apps/api/src/security/open-browser.ts`, `apps/api/src/http/domain-error.filter.ts`, `apps/api/src/app.module.ts`, `apps/api/src/main.ts`
- Test: `apps/api/src/security/session.middleware.spec.ts`, `apps/api/src/http/domain-error.filter.spec.ts`

**Interfaces:**
- Consumes: `AppConfig`, `loadConfig`, `loadDotEnv`, tokens (Task 8); `Db` (Task 2); erros (Tasks 5 e 6); `AuthModule`, `CloudModule` (Task 8).
- Produces:
  - `SESSION_HEADER = 'x-twinpix-token'`
  - `sessionMiddleware(token: string, allowedOrigins: string[]): RequestHandler`
  - `DomainErrorFilter` (global): `UnsafeDeletionError`/`InvalidLinkError` → 400; `ReconnectRequiredError` → 409 `{ code: 'needs-auth' }`; `ForbiddenError` → 403; `OfflineError` → 503 `{ code: 'offline' }`; `GraphError` → 502. Corpo sempre `{ message, code? }`.
  - `AppModule.forRoot(config: AppConfig): DynamicModule` — fornece `CONFIG` e `DB` globalmente.
    **Tasks seguintes acrescentam seus módulos ao array `imports` de `forRoot`.**
  - `openBrowser(url: string): void`

- [ ] **Step 1: Testes**

`apps/api/src/security/session.middleware.spec.ts`:
```ts
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { sessionMiddleware } from './session.middleware';

function app() {
  const a = express();
  a.use(sessionMiddleware('segredo', ['http://127.0.0.1:4317']));
  a.get('/api/coisa', (_req, res) => { res.json({ ok: true }); });
  a.get('/api/auth/login', (_req, res) => { res.json({ login: true }); });
  a.get('/index.html', (_req, res) => { res.send('ok'); });
  return a;
}

describe('sessionMiddleware', () => {
  it('recusa API sem token', async () => {
    await request(app()).get('/api/coisa').expect(401);
  });

  it('recusa token errado', async () => {
    await request(app()).get('/api/coisa').set('X-TwinPix-Token', 'outro').expect(401);
  });

  it('aceita token certo', async () => {
    await request(app()).get('/api/coisa').set('X-TwinPix-Token', 'segredo').expect(200);
  });

  it('recusa origem de outro site mesmo com token', async () => {
    await request(app())
      .get('/api/coisa')
      .set('X-TwinPix-Token', 'segredo')
      .set('Origin', 'https://site-malicioso.example')
      .expect(403);
  });

  it('deixa passar login e arquivos estáticos', async () => {
    await request(app()).get('/api/auth/login').expect(200);
    await request(app()).get('/index.html').expect(200);
  });
});
```

`apps/api/src/http/domain-error.filter.spec.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';
import { UnsafeDeletionError } from '../actions/deletion-plan';
import { ForbiddenError, InvalidLinkError, OfflineError, ReconnectRequiredError } from '../cloud/errors';
import { DomainErrorFilter, toHttp } from './domain-error.filter';

describe('toHttp', () => {
  it.each([
    [new UnsafeDeletionError('x'), 400, undefined],
    [new InvalidLinkError('x'), 400, undefined],
    [new ReconnectRequiredError(), 409, 'needs-auth'],
    [new ForbiddenError(), 403, undefined],
    [new OfflineError(), 503, 'offline'],
  ])('%s', (error, status, code) => {
    expect(toHttp(error as Error)).toMatchObject({ status, body: { message: (error as Error).message, code } });
  });

  it('erro desconhecido vira 500 com mensagem genérica', () => {
    expect(toHttp(new Error('detalhe interno'))).toEqual({
      status: 500,
      body: { message: 'Algo deu errado. Tente de novo.' },
    });
  });

  it('o filtro escreve a resposta', () => {
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    const host = { switchToHttp: () => ({ getResponse: () => ({ status }) }) };
    new DomainErrorFilter().catch(new OfflineError(), host as any);
    expect(status).toHaveBeenCalledWith(503);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -w apps/api -- src/security src/http`
Expected: FAIL — módulos não encontrados.

- [ ] **Step 3: Implementação**

`apps/api/src/security/session.middleware.ts`:
```ts
import type { RequestHandler } from 'express';
import { timingSafeEqual } from 'node:crypto';

export const SESSION_HEADER = 'x-twinpix-token';
const EXEMPT = new Set(['/api/auth/login', '/api/auth/callback']);

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function sessionMiddleware(token: string, allowedOrigins: string[]): RequestHandler {
  return (req, res, next) => {
    if (!req.path.startsWith('/api/') || EXEMPT.has(req.path)) return next();
    const origin = req.headers.origin;
    if (origin && !allowedOrigins.includes(origin)) {
      res.status(403).json({ message: 'Origem não permitida.' });
      return;
    }
    const given = req.headers[SESSION_HEADER];
    if (typeof given !== 'string' || !safeEqual(given, token)) {
      res.status(401).json({
        message: 'Sessão inválida. Abra o TwinPix Cloud pelo endereço mostrado no terminal.',
        code: 'session',
      });
      return;
    }
    next();
  };
}
```

`apps/api/src/http/domain-error.filter.ts`:
```ts
import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import type { Response } from 'express';
import { UnsafeDeletionError } from '../actions/deletion-plan';
import { ForbiddenError, GraphError, InvalidLinkError, OfflineError, ReconnectRequiredError } from '../cloud/errors';

export function toHttp(e: Error): { status: number; body: { message: string; code?: string } } {
  if (e instanceof HttpException) return { status: e.getStatus(), body: { message: e.message } };
  if (e instanceof UnsafeDeletionError || e instanceof InvalidLinkError) return { status: 400, body: { message: e.message } };
  if (e instanceof ReconnectRequiredError) return { status: 409, body: { message: e.message, code: 'needs-auth' } };
  if (e instanceof ForbiddenError) return { status: 403, body: { message: e.message } };
  if (e instanceof OfflineError) return { status: 503, body: { message: e.message, code: 'offline' } };
  if (e instanceof GraphError) return { status: 502, body: { message: e.message } };
  return { status: 500, body: { message: 'Algo deu errado. Tente de novo.' } };
}

@Catch()
export class DomainErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const error = exception instanceof Error ? exception : new Error(String(exception));
    const { status, body } = toHttp(error);
    if (status === 500) console.error(error);
    host.switchToHttp().getResponse<Response>().status(status).json(body);
  }
}
```

`apps/api/src/security/open-browser.ts`:
```ts
import { spawn } from 'node:child_process';

export function openBrowser(url: string): void {
  const [cmd, args] =
    process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : ['xdg-open', [url]];
  try {
    spawn(cmd, args as string[], { stdio: 'ignore', detached: true }).unref();
  } catch {
    // Sem navegador disponível: o endereço já foi mostrado no terminal.
  }
}
```

`apps/api/src/app.module.ts`:
```ts
import { DynamicModule, Global, Module } from '@nestjs/common';
import { mkdirSync, rmSync } from 'node:fs';
import { AuthModule } from './auth/auth.module';
import { CloudModule } from './cloud/cloud.module';
import type { AppConfig } from './config';
import { Db } from './storage/db';
import { CONFIG, DB } from './tokens';

@Global()
@Module({})
class CoreModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: CoreModule,
      providers: [
        { provide: CONFIG, useValue: config },
        {
          provide: DB,
          useFactory: () => {
            mkdirSync(config.dataDir, { recursive: true });
            if (config.demo) rmSync(config.dbFile, { force: true });
            return new Db(config.dbFile);
          },
        },
      ],
      exports: [CONFIG, DB],
    };
  }
}

@Module({})
export class AppModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [CoreModule.forRoot(config), AuthModule, CloudModule],
    };
  }
}
```

`apps/api/src/main.ts`:
```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { existsSync } from 'node:fs';
import { AppModule } from './app.module';
import { loadConfig, loadDotEnv } from './config';
import { DomainErrorFilter } from './http/domain-error.filter';
import { openBrowser } from './security/open-browser';
import { sessionMiddleware } from './security/session.middleware';

async function bootstrap(): Promise<void> {
  loadDotEnv();
  const config = loadConfig();
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config), {
    logger: ['error', 'warn'],
  });
  app.use(sessionMiddleware(config.sessionToken, config.allowedOrigins));
  app.setGlobalPrefix('api');
  app.useGlobalFilters(new DomainErrorFilter());
  app.enableShutdownHooks();
  if (existsSync(config.webDist)) app.useStaticAssets(config.webDist);

  await app.listen(config.port, '127.0.0.1');

  const url = `${config.uiOrigin}/#token=${config.sessionToken}`;
  console.log(`\nTwinPix Cloud ${config.demo ? '(modo demonstração) ' : ''}rodando.`);
  console.log(`Abra no navegador: ${url}\n`);
  if (config.openBrowser) openBrowser(url);
}

void bootstrap();
```

- [ ] **Step 4: Rodar, compilar e subir**

Run: `npm test -w apps/api -- src/security src/http && npm run build -w apps/api`
Expected: PASS e build sem erros.

Run (verificação manual rápida):
```bash
TWINPIX_NO_BROWSER=1 TWINPIX_SESSION_TOKEN=t TWINPIX_DATA_DIR=$(mktemp -d) node apps/api/dist/main.js --demo &
sleep 3
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4317/api/auth/status            # 401
curl -s -H 'X-TwinPix-Token: t' http://127.0.0.1:4317/api/auth/status                      # {"configured":true,"connected":true,...}
kill %1
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/security apps/api/src/http apps/api/src/app.module.ts apps/api/src/main.ts
git commit -m "feat: backend local protegido por token de sessão, filtro de erros e bootstrap"
```

---

### Task 10: Varredura retomável e navegador de pastas

**Files:**
- Create: `apps/api/src/scan/scan.service.ts`, `apps/api/src/scan/scan.controller.ts`, `apps/api/src/scan/scan.module.ts`
- Create: `apps/api/src/cloud/folders.controller.ts`, `apps/api/src/cloud/files.controller.ts`
- Modify: `apps/api/src/cloud/cloud.module.ts` (registrar os dois controllers), `apps/api/src/app.module.ts` (importar `ScanModule`)
- Test: `apps/api/src/scan/scan.service.spec.ts`

**Interfaces:**
- Consumes: `Db`, `insertFile`, `getFilesByIds`, `rowToItem`, `nowIso` (Task 2); `groupIdentical`, `findNestedRoots` (Task 3); `CloudProvider` e erros (Task 6).
- Produces:
  - `SCAN_OPTIONS = 'SCAN_OPTIONS'`, `interface ScanOptions { offlineRetryMs: number; sleep?: (ms: number) => Promise<void> }`
  - `class ScanService { start(roots: CloudFolder[]): number; summary(scanId: number): ScanSummary; latest(): ScanSummary | null; pause(scanId: number): void; resume(scanId: number): void; whenIdle(scanId: number): Promise<void>; unanalyzed(scanId: number): CloudItem[]; onModuleInit(): void }`
  - Grupos gravados em `dup_groups` com `kind = 'identical'`, `key = 'hash:size'`, `status = 'pending'`, `position` crescente pela ordem de descoberta.
  - Rotas: `POST /api/scans` `{ roots: CloudFolder[] }` → `ScanSummary`; `GET /api/scans/latest` → `ScanSummary | null`; `GET /api/scans/:id`; `POST /api/scans/:id/pause`; `POST /api/scans/:id/resume`; `GET /api/scans/:id/unanalyzed` → `CloudItem[]`.
  - Rotas: `GET /api/folders/root` → `CloudFolder`; `GET /api/folders/:id/children` → `CloudFolder[]`; `POST /api/folders/resolve-link` `{ url }` → `CloudFolder`; `POST /api/folders/check-nesting` `{ paths: string[] }` → `NestedRoot[]`.
  - Rota: `GET /api/files/:id/thumbnail` → `{ url: string | null }`.

- [ ] **Step 1: Teste**

`apps/api/src/scan/scan.service.spec.ts`:
```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { ForbiddenError, OfflineError, ReconnectRequiredError } from '../cloud/errors';
import { FakeCloudProvider } from '../cloud/fake-cloud-provider';
import { Db } from '../storage/db';
import { ScanService } from './scan.service';

let db: Db;
let cloud: FakeCloudProvider;
let scan: ScanService;

function tree() {
  const a = cloud.addFolder(cloud.rootId, 'A');
  const sub = cloud.addFolder(a.id, 'Sub');
  const b = cloud.addFolder(cloud.rootId, 'B');
  cloud.addFile(a.id, { name: 'x.jpg', quickXorHash: 'h1', size: 10 });
  cloud.addFile(sub.id, { name: 'x 1.jpg', quickXorHash: 'h1', size: 10 });
  cloud.addFile(b.id, { name: 'y.jpg', quickXorHash: 'h2', size: 20 });
  cloud.addFile(b.id, { name: 'y 1.jpg', quickXorHash: 'h2', size: 20 });
  cloud.addFile(b.id, { name: 'sem-hash.jpg', quickXorHash: null });
  cloud.addFile(b.id, { name: 'unica.jpg', quickXorHash: 'h3', size: 30 });
  return { a, sub, b };
}

beforeEach(() => {
  db = new Db(':memory:');
  cloud = new FakeCloudProvider();
  cloud.pageSize = 2;
  scan = new ScanService(db, cloud, { offlineRetryMs: 0 });
});

describe('ScanService', () => {
  it('varre várias pastas com subpastas e agrupa idênticas entre elas', async () => {
    const { a, b } = tree();
    const id = scan.start([a, b]);
    await scan.whenIdle(id);
    const s = scan.summary(id);
    expect(s.status).toBe('done');
    expect(s.filesFound).toBe(6);
    expect(s.foldersDone).toBe(3);
    expect(s.foldersTotal).toBe(3);
    expect(s.unanalyzedCount).toBe(1);
    expect(s.groupsTotal).toBe(2);
    expect(s.groupsPending).toBe(2);
    expect(scan.unanalyzed(id).map((f) => f.name)).toEqual(['sem-hash.jpg']);
  });

  it('pasta escolhida dentro de outra escolhida não duplica arquivos', async () => {
    const { a, sub } = tree();
    const id = scan.start([a, sub]);
    await scan.whenIdle(id);
    expect(scan.summary(id).filesFound).toBe(2);
    expect(scan.summary(id).groupsTotal).toBe(1);
  });

  it('sem internet: espera e continua sozinha', async () => {
    const { a } = tree();
    cloud.failNext('listChildren', new OfflineError(), 2);
    const id = scan.start([a]);
    await scan.whenIdle(id);
    expect(scan.summary(id).status).toBe('done');
    expect(scan.summary(id).filesFound).toBe(2);
  });

  it('token expirado: pausa pedindo reconexão e retoma sem perder nada', async () => {
    const { a, b } = tree();
    const id = scan.start([a, b]);
    await scan.whenIdle(id);
    // nova varredura que falha logo na primeira chamada (a falha é registrada ANTES do start,
    // porque start() já chama listChildren de forma síncrona)
    cloud.failNext('listChildren', new ReconnectRequiredError());
    const id2 = scan.start([a, b]);
    await scan.whenIdle(id2);
    expect(scan.summary(id2).status).toBe('needs-auth');
    scan.resume(id2);
    await scan.whenIdle(id2);
    expect(scan.summary(id2)).toMatchObject({ status: 'done', filesFound: 6 });
  });

  it('pausar e retomar continua de onde parou, incluindo a página', async () => {
    const { a, b } = tree();
    const id = scan.start([a, b]);
    scan.pause(id);
    await scan.whenIdle(id);
    expect(scan.summary(id).status).toBe('paused');
    scan.resume(id);
    await scan.whenIdle(id);
    expect(scan.summary(id)).toMatchObject({ status: 'done', filesFound: 6, groupsTotal: 2 });
  });

  it('retomada após reinício do app (onModuleInit) termina a varredura', async () => {
    const { a, b } = tree();
    const id = scan.start([a, b]);
    scan.pause(id);
    await scan.whenIdle(id);
    db.sql.prepare("UPDATE scans SET status = 'running' WHERE id = ?").run(id);
    const again = new ScanService(db, cloud, { offlineRetryMs: 0 });
    again.onModuleInit();
    await again.whenIdle(id);
    expect(again.summary(id).status).toBe('done');
  });

  it('pasta sem permissão é pulada e o resto continua', async () => {
    const { a, b } = tree();
    cloud.failNext('listChildren', new ForbiddenError());
    const id = scan.start([a, b]);
    await scan.whenIdle(id);
    expect(scan.summary(id).status).toBe('done');
  });

  it('grupos ganham posição pela ordem de descoberta e não se repetem', async () => {
    const { a, b } = tree();
    const id = scan.start([a, b]);
    await scan.whenIdle(id);
    const rows = db.sql.prepare('SELECT key, position FROM dup_groups WHERE scan_id = ? ORDER BY position').all(id);
    expect(rows).toEqual([
      { key: 'h1:10', position: 1 },
      { key: 'h2:20', position: 2 },
    ]);
  });

  it('latest devolve a varredura mais recente', async () => {
    const { a } = tree();
    expect(scan.latest()).toBeNull();
    const id = scan.start([a]);
    await scan.whenIdle(id);
    expect(scan.latest()?.id).toBe(id);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -w apps/api -- src/scan`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: Implementação**

`apps/api/src/scan/scan.service.ts`:
```ts
import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import type { CloudFolder, CloudItem, ScanStatus, ScanSummary } from '@twinpix/shared';
import type { CloudProvider } from '../cloud/cloud-provider';
import { ForbiddenError, OfflineError, ReconnectRequiredError } from '../cloud/errors';
import { groupIdentical } from '../grouping/group-identical';
import type { Db } from '../storage/db';
import { insertFile, nowIso, rowToItem, type FileRow } from '../storage/rows';
import { CLOUD_PROVIDER, DB } from '../tokens';

export const SCAN_OPTIONS = 'SCAN_OPTIONS';

export interface ScanOptions {
  offlineRetryMs: number;
  sleep?: (ms: number) => Promise<void>;
}

interface FolderRow { folder_id: string; path: string; page_token: string | null }

@Injectable()
export class ScanService implements OnModuleInit {
  private readonly running = new Map<number, Promise<void>>();
  private readonly pauseRequested = new Set<number>();
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOUD_PROVIDER) private readonly cloud: CloudProvider,
    @Inject(SCAN_OPTIONS) private readonly options: ScanOptions,
  ) {
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  onModuleInit(): void {
    const rows = this.db.sql
      .prepare("SELECT id FROM scans WHERE status IN ('running', 'waiting-network')")
      .all() as Array<{ id: number }>;
    for (const { id } of rows) this.launch(id);
  }

  start(roots: CloudFolder[]): number {
    const sql = this.db.sql;
    const id = sql.transaction(() => {
      const { lastInsertRowid } = sql
        .prepare("INSERT INTO scans (created_at, status) VALUES (?, 'running')")
        .run(nowIso());
      const scanId = Number(lastInsertRowid);
      for (const r of roots) {
        sql.prepare('INSERT OR IGNORE INTO scan_roots (scan_id, folder_id, name, path, child_count) VALUES (?, ?, ?, ?, ?)')
          .run(scanId, r.id, r.name, r.path, r.childCount);
        this.enqueueFolder(scanId, r.id, r.path);
      }
      return scanId;
    })();
    this.launch(id);
    return id;
  }

  pause(scanId: number): void {
    if (this.running.has(scanId)) this.pauseRequested.add(scanId);
    else this.setStatus(scanId, 'paused');
  }

  resume(scanId: number): void {
    this.pauseRequested.delete(scanId);
    if (!this.running.has(scanId)) this.launch(scanId);
  }

  whenIdle(scanId: number): Promise<void> {
    return this.running.get(scanId) ?? Promise.resolve();
  }

  latest(): ScanSummary | null {
    const row = this.db.sql.prepare('SELECT id FROM scans ORDER BY id DESC LIMIT 1').get() as { id: number } | undefined;
    return row ? this.summary(row.id) : null;
  }

  summary(scanId: number): ScanSummary {
    const sql = this.db.sql;
    const scan = sql.prepare('SELECT status, error FROM scans WHERE id = ?').get(scanId) as
      | { status: ScanStatus; error: string | null }
      | undefined;
    if (!scan) throw new Error(`Varredura ${scanId} não existe.`);
    const roots = (sql.prepare('SELECT folder_id, name, path, child_count FROM scan_roots WHERE scan_id = ?').all(scanId) as Array<{
      folder_id: string; name: string; path: string; child_count: number;
    }>).map((r) => ({ id: r.folder_id, name: r.name, path: r.path, childCount: r.child_count }));
    const count = (q: string, ...p: unknown[]) => (sql.prepare(q).get(scanId, ...p) as { n: number }).n;
    return {
      id: scanId,
      status: scan.status,
      roots,
      foldersDone: count("SELECT COUNT(*) n FROM scan_folders WHERE scan_id = ? AND status != 'pending'"),
      foldersTotal: count('SELECT COUNT(*) n FROM scan_folders WHERE scan_id = ?'),
      filesFound: count('SELECT COUNT(*) n FROM files WHERE scan_id = ?'),
      unanalyzedCount: count('SELECT COUNT(*) n FROM files WHERE scan_id = ? AND quick_xor_hash IS NULL'),
      groupsTotal: count('SELECT COUNT(*) n FROM dup_groups WHERE scan_id = ?'),
      groupsPending: count("SELECT COUNT(*) n FROM dup_groups WHERE scan_id = ? AND status IN ('pending', 'stale')"),
      groupsSkipped: count("SELECT COUNT(*) n FROM dup_groups WHERE scan_id = ? AND status = 'skipped'"),
      bytesFreed: (sql.prepare(
        `SELECT COALESCE(SUM(f.size), 0) n FROM actions a
         JOIN dup_groups g ON g.id = a.group_id
         JOIN files f ON f.scan_id = g.scan_id AND f.id = a.file_id
         WHERE g.scan_id = ? AND a.status = 'done'`,
      ).get(scanId) as { n: number }).n,
      error: scan.error,
    };
  }

  unanalyzed(scanId: number): CloudItem[] {
    const rows = this.db.sql
      .prepare('SELECT * FROM files WHERE scan_id = ? AND quick_xor_hash IS NULL ORDER BY folder_path, name')
      .all(scanId) as FileRow[];
    return rows.map(rowToItem);
  }

  private launch(scanId: number): void {
    const job = this.run(scanId).finally(() => this.running.delete(scanId));
    this.running.set(scanId, job);
  }

  private async run(scanId: number): Promise<void> {
    this.setStatus(scanId, 'running');
    for (;;) {
      if (this.pauseRequested.delete(scanId)) {
        this.setStatus(scanId, 'paused');
        return;
      }
      const folder = this.db.sql
        .prepare("SELECT folder_id, path, page_token FROM scan_folders WHERE scan_id = ? AND status = 'pending' ORDER BY seq LIMIT 1")
        .get(scanId) as FolderRow | undefined;
      if (!folder) {
        this.regroup(scanId);
        this.setStatus(scanId, 'done');
        return;
      }
      try {
        const finished = await this.processFolder(scanId, folder);
        if (!finished) continue; // pausa pedida no meio da pasta; o topo do laço trata
        this.regroup(scanId);
      } catch (e) {
        if (e instanceof OfflineError) {
          this.setStatus(scanId, 'waiting-network');
          await this.sleep(this.options.offlineRetryMs);
          this.setStatus(scanId, 'running');
          continue;
        }
        if (e instanceof ReconnectRequiredError) {
          this.setStatus(scanId, 'needs-auth', e.message);
          return;
        }
        if (e instanceof ForbiddenError) {
          this.db.sql.prepare("UPDATE scan_folders SET status = 'forbidden' WHERE scan_id = ? AND folder_id = ?")
            .run(scanId, folder.folder_id);
          continue;
        }
        this.setStatus(scanId, 'error', (e as Error).message);
        return;
      }
    }
  }

  /** Devolve false se parou no meio por pedido de pausa. */
  private async processFolder(scanId: number, folder: FolderRow): Promise<boolean> {
    const sql = this.db.sql;
    let token = folder.page_token;
    for (;;) {
      const page = await this.cloud.listChildren(folder.folder_id, token);
      sql.transaction(() => {
        for (const f of page.files) insertFile(sql, scanId, f);
        for (const sub of page.folders) this.enqueueFolder(scanId, sub.id, sub.path);
        sql.prepare('UPDATE scan_folders SET page_token = ? WHERE scan_id = ? AND folder_id = ?')
          .run(page.nextPageToken, scanId, folder.folder_id);
        if (!page.nextPageToken) {
          sql.prepare("UPDATE scan_folders SET status = 'done' WHERE scan_id = ? AND folder_id = ?")
            .run(scanId, folder.folder_id);
        }
      })();
      if (!page.nextPageToken) return true;
      token = page.nextPageToken;
      if (this.pauseRequested.has(scanId)) return false;
    }
  }

  private enqueueFolder(scanId: number, folderId: string, path: string): void {
    const sql = this.db.sql;
    const { n } = sql.prepare('SELECT COALESCE(MAX(seq), 0) + 1 n FROM scan_folders WHERE scan_id = ?').get(scanId) as { n: number };
    sql.prepare("INSERT OR IGNORE INTO scan_folders (scan_id, folder_id, path, status, seq) VALUES (?, ?, ?, 'pending', ?)")
      .run(scanId, folderId, path, n);
  }

  private regroup(scanId: number): void {
    const sql = this.db.sql;
    const files = sql
      .prepare('SELECT id, quick_xor_hash AS quickXorHash, size FROM files WHERE scan_id = ? AND quick_xor_hash IS NOT NULL ORDER BY folder_path, name')
      .all(scanId) as Array<{ id: string; quickXorHash: string; size: number }>;
    const groups = groupIdentical(files);
    sql.transaction(() => {
      for (const g of groups) {
        let row = sql.prepare("SELECT id FROM dup_groups WHERE scan_id = ? AND kind = 'identical' AND key = ?").get(scanId, g.key) as
          | { id: number }
          | undefined;
        if (!row) {
          const { n } = sql.prepare('SELECT COALESCE(MAX(position), 0) + 1 n FROM dup_groups WHERE scan_id = ?').get(scanId) as { n: number };
          const { lastInsertRowid } = sql
            .prepare("INSERT INTO dup_groups (scan_id, kind, key, position, status) VALUES (?, 'identical', ?, ?, 'pending')")
            .run(scanId, g.key, n);
          row = { id: Number(lastInsertRowid) };
        }
        for (const fileId of g.fileIds) {
          sql.prepare('INSERT OR IGNORE INTO dup_group_files (group_id, file_id) VALUES (?, ?)').run(row.id, fileId);
        }
      }
    })();
  }

  private setStatus(scanId: number, status: ScanStatus, error: string | null = null): void {
    this.db.sql.prepare('UPDATE scans SET status = ?, error = ? WHERE id = ?').run(status, error, scanId);
  }
}
```

Observação sobre a ordem dos grupos: `regroup` percorre arquivos ordenados por pasta e nome, e
`groupIdentical` preserva a ordem de inserção do `Map`, então a primeira chave descoberta recebe
a menor posição. Se o teste de posição falhar por ordem, ordene `groups` pela menor
`folder_path/name` de cada grupo antes de inserir.

`apps/api/src/scan/scan.controller.ts`:
```ts
import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, BadRequestException } from '@nestjs/common';
import type { CloudFolder, CloudItem, ScanSummary } from '@twinpix/shared';
import { ScanService } from './scan.service';

@Controller('scans')
export class ScanController {
  constructor(private readonly scans: ScanService) {}

  @Post()
  start(@Body() body: { roots?: CloudFolder[] }): ScanSummary {
    const roots = body?.roots;
    if (!Array.isArray(roots) || roots.length === 0 || !roots.every((r) => typeof r?.id === 'string' && typeof r?.path === 'string')) {
      throw new BadRequestException('Escolha pelo menos uma pasta.');
    }
    return this.scans.summary(this.scans.start(roots));
  }

  @Get('latest')
  latest(): ScanSummary | null {
    return this.scans.latest();
  }

  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number): ScanSummary {
    return this.scans.summary(id);
  }

  @Post(':id/pause')
  @HttpCode(200)
  pause(@Param('id', ParseIntPipe) id: number): ScanSummary {
    this.scans.pause(id);
    return this.scans.summary(id);
  }

  @Post(':id/resume')
  @HttpCode(200)
  resume(@Param('id', ParseIntPipe) id: number): ScanSummary {
    this.scans.resume(id);
    return this.scans.summary(id);
  }

  @Get(':id/unanalyzed')
  unanalyzed(@Param('id', ParseIntPipe) id: number): CloudItem[] {
    return this.scans.unanalyzed(id);
  }
}
```

`apps/api/src/scan/scan.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { ScanController } from './scan.controller';
import { SCAN_OPTIONS, ScanService } from './scan.service';

@Module({
  controllers: [ScanController],
  providers: [ScanService, { provide: SCAN_OPTIONS, useValue: { offlineRetryMs: 30_000 } }],
  exports: [ScanService],
})
export class ScanModule {}
```

`apps/api/src/cloud/folders.controller.ts`:
```ts
import { BadRequestException, Body, Controller, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';
import type { CloudFolder, NestedRoot } from '@twinpix/shared';
import { findNestedRoots } from '../grouping/folders';
import { CLOUD_PROVIDER } from '../tokens';
import type { CloudProvider } from './cloud-provider';

@Controller('folders')
export class FoldersController {
  constructor(@Inject(CLOUD_PROVIDER) private readonly cloud: CloudProvider) {}

  @Get('root')
  root(): Promise<CloudFolder> {
    return this.cloud.getRoot();
  }

  @Get(':id/children')
  children(@Param('id') id: string): Promise<CloudFolder[]> {
    return this.cloud.listFolders(id);
  }

  @Post('resolve-link')
  @HttpCode(200)
  resolve(@Body() body: { url?: string }): Promise<CloudFolder> {
    if (typeof body?.url !== 'string' || !body.url.trim()) throw new BadRequestException('Cole o link da pasta.');
    return this.cloud.resolveFolderLink(body.url.trim());
  }

  @Post('check-nesting')
  @HttpCode(200)
  checkNesting(@Body() body: { paths?: string[] }): NestedRoot[] {
    return findNestedRoots(Array.isArray(body?.paths) ? body.paths.filter((p) => typeof p === 'string') : []);
  }
}
```

`apps/api/src/cloud/files.controller.ts`:
```ts
import { Controller, Get, Inject, Param } from '@nestjs/common';
import { CLOUD_PROVIDER } from '../tokens';
import type { CloudProvider } from './cloud-provider';

@Controller('files')
export class FilesController {
  constructor(@Inject(CLOUD_PROVIDER) private readonly cloud: CloudProvider) {}

  @Get(':id/thumbnail')
  async thumbnail(@Param('id') id: string): Promise<{ url: string | null }> {
    return { url: await this.cloud.getThumbnailUrl(id) };
  }
}
```

Em `apps/api/src/cloud/cloud.module.ts`, acrescentar ao decorator `@Module`:
```ts
  controllers: [FoldersController, FilesController],
```
(com os imports correspondentes). Em `apps/api/src/app.module.ts`, acrescentar `ScanModule` ao
array `imports` de `AppModule.forRoot`.

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test -w apps/api -- src/scan && npm run typecheck -w apps/api`
Expected: PASS e typecheck sem erros.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/scan apps/api/src/cloud apps/api/src/app.module.ts
git commit -m "feat: varredura retomável de várias pastas e navegador de pastas"
```

---

### Task 11: Revisão de grupos (atual, pular, voltar) e regras configuráveis

**Files:**
- Create: `apps/api/src/review/rules-settings.ts`, `apps/api/src/review/review.service.ts`, `apps/api/src/review/review.controller.ts`, `apps/api/src/review/review.module.ts`
- Modify: `apps/api/src/app.module.ts` (importar `ReviewModule`)
- Test: `apps/api/src/review/review.service.spec.ts`

**Interfaces:**
- Consumes: `Db`, `getFilesByIds` (Task 2); `suggestKeep`, `DEFAULT_RULES`, `isValidRules` (Task 4); `ScanService` (Task 10, nos testes).
- Produces:
  - `getRules(db: Db): RuleCriterion[]`, `setRules(db: Db, rules: RuleCriterion[]): void`
  - `class ReviewService { view(groupId: number): GroupView; current(scanId: number): GroupView | null; skip(groupId: number): GroupView | null; previous(groupId: number): GroupView | null; unskipAll(scanId: number): void; activeFileIds(groupId: number): string[] }`
    - `activeFileIds` = arquivos do grupo **sem** ação `done` (já na lixeira); usado pelas ações.
    - `current` grava `scans.cursor_group_id`; retoma a partir dele.
  - Rotas: `GET /api/scans/:id/groups/current` → `GroupView | null`; `POST /api/scans/:id/unskip`;
    `GET /api/groups/:id` → `GroupView`; `POST /api/groups/:id/skip` → próximo `GroupView | null`;
    `GET /api/groups/:id/previous` → `GroupView | null`;
    `GET /api/settings/rules` → `RuleCriterion[]`; `PUT /api/settings/rules` → `RuleCriterion[]`.

- [ ] **Step 1: Teste**

`apps/api/src/review/review.service.spec.ts`:
```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { FakeCloudProvider } from '../cloud/fake-cloud-provider';
import { ScanService } from '../scan/scan.service';
import { Db } from '../storage/db';
import { ReviewService } from './review.service';
import { getRules, setRules } from './rules-settings';

let db: Db;
let review: ReviewService;
let scanId: number;

beforeEach(async () => {
  db = new Db(':memory:');
  const cloud = new FakeCloudProvider();
  const a = cloud.addFolder(cloud.rootId, 'A');
  for (const n of [1, 2, 3]) {
    cloud.addFile(a.id, { name: `f${n}.jpg`, quickXorHash: `h${n}`, size: n * 100, modifiedAt: '2015-01-01T00:00:00Z' });
    cloud.addFile(a.id, { name: `f${n} 1.jpg`, quickXorHash: `h${n}`, size: n * 100, modifiedAt: '2016-01-01T00:00:00Z' });
  }
  const scan = new ScanService(db, cloud, { offlineRetryMs: 0 });
  scanId = scan.start([a]);
  await scan.whenIdle(scanId);
  review = new ReviewService(db);
});

describe('ReviewService', () => {
  it('grupo atual começa no primeiro, com sugestão, motivo e pré-marcação', () => {
    const g = review.current(scanId)!;
    expect(g).toMatchObject({ position: 1, total: 3, kind: 'identical', status: 'pending' });
    expect(g.files.map((f) => f.name)).toEqual(['f1 1.jpg', 'f1.jpg']);
    const keep = g.files.find((f) => f.id === g.suggestion.keepId)!;
    expect(keep.name).toBe('f1.jpg');
    expect(g.suggestion.reason).toBe('regra: nome sem sufixo de cópia');
    expect(g.preMarkedIds).toEqual(g.files.filter((f) => f.id !== keep.id).map((f) => f.id));
  });

  it('pular vai para o próximo e o cursor é lembrado', () => {
    const g1 = review.current(scanId)!;
    const g2 = review.skip(g1.id)!;
    expect(g2.position).toBe(2);
    expect(review.current(scanId)!.id).toBe(g2.id);
  });

  it('voltar mostra o grupo anterior, mesmo já pulado', () => {
    const g1 = review.current(scanId)!;
    const g2 = review.skip(g1.id)!;
    const back = review.previous(g2.id)!;
    expect(back.id).toBe(g1.id);
    expect(back.status).toBe('skipped');
    expect(review.previous(g1.id)).toBeNull();
  });

  it('depois de pular todos, current é null; rever puladas recomeça', () => {
    let g = review.current(scanId);
    while (g) g = review.skip(g.id);
    expect(review.current(scanId)).toBeNull();
    review.unskipAll(scanId);
    expect(review.current(scanId)!.position).toBe(1);
  });

  it('usa as regras configuradas', () => {
    setRules(db, [{ type: 'oldestModified' }]);
    expect(getRules(db)).toEqual([{ type: 'oldestModified' }]);
    const g = review.current(scanId)!;
    expect(g.suggestion.reason).toBe('regra: mais antiga (modificada em)');
  });

  it('arquivo já na lixeira sai da lista do grupo', () => {
    const g = review.current(scanId)!;
    db.sql.prepare("INSERT INTO actions (group_id, file_id, kept_file_id, status, created_at, updated_at) VALUES (?, ?, ?, 'done', 'x', 'x')")
      .run(g.id, g.preMarkedIds[0], g.suggestion.keepId);
    expect(review.activeFileIds(g.id)).toEqual([g.suggestion.keepId]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -w apps/api -- src/review`
Expected: FAIL — módulos não encontrados.

- [ ] **Step 3: Implementação**

`apps/api/src/review/rules-settings.ts`:
```ts
import type { RuleCriterion } from '@twinpix/shared';
import { DEFAULT_RULES, isValidRules } from '../rules/suggest-keep';
import type { Db } from '../storage/db';

const KEY = 'rules';

export function getRules(db: Db): RuleCriterion[] {
  const row = db.sql.prepare('SELECT value FROM settings WHERE key = ?').get(KEY) as { value: string } | undefined;
  if (!row) return DEFAULT_RULES;
  const parsed: unknown = JSON.parse(row.value);
  return isValidRules(parsed) ? parsed : DEFAULT_RULES;
}

export function setRules(db: Db, rules: RuleCriterion[]): void {
  db.sql.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(KEY, JSON.stringify(rules));
}
```

`apps/api/src/review/review.service.ts`:
```ts
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { GroupStatus, GroupView } from '@twinpix/shared';
import { suggestKeep } from '../rules/suggest-keep';
import type { Db } from '../storage/db';
import { getFilesByIds } from '../storage/rows';
import { DB } from '../tokens';
import { getRules } from './rules-settings';

interface GroupRow { id: number; scan_id: number; position: number; status: GroupStatus }

@Injectable()
export class ReviewService {
  constructor(@Inject(DB) private readonly db: Db) {}

  activeFileIds(groupId: number): string[] {
    return (this.db.sql
      .prepare(
        `SELECT gf.file_id FROM dup_group_files gf
         WHERE gf.group_id = ?
           AND NOT EXISTS (SELECT 1 FROM actions a WHERE a.group_id = gf.group_id AND a.file_id = gf.file_id AND a.status = 'done')
         ORDER BY gf.file_id`,
      )
      .all(groupId) as Array<{ file_id: string }>).map((r) => r.file_id);
  }

  view(groupId: number): GroupView {
    const g = this.group(groupId);
    const files = getFilesByIds(this.db.sql, g.scan_id, this.activeFileIds(groupId));
    const suggestion = suggestKeep(files, getRules(this.db));
    const position = (this.db.sql
      .prepare('SELECT COUNT(*) n FROM dup_groups WHERE scan_id = ? AND position <= ?')
      .get(g.scan_id, g.position) as { n: number }).n;
    const total = (this.db.sql.prepare('SELECT COUNT(*) n FROM dup_groups WHERE scan_id = ?').get(g.scan_id) as { n: number }).n;
    const bytesFreedSoFar = (this.db.sql
      .prepare(
        `SELECT COALESCE(SUM(f.size), 0) n FROM actions a
         JOIN dup_groups g ON g.id = a.group_id
         JOIN files f ON f.scan_id = g.scan_id AND f.id = a.file_id
         WHERE g.scan_id = ? AND a.status = 'done'`,
      )
      .get(g.scan_id) as { n: number }).n;
    return {
      id: g.id,
      scanId: g.scan_id,
      kind: 'identical',
      status: g.status,
      position,
      total,
      files,
      suggestion,
      preMarkedIds: files.filter((f) => f.id !== suggestion.keepId).map((f) => f.id),
      bytesFreedSoFar,
    };
  }

  current(scanId: number): GroupView | null {
    const sql = this.db.sql;
    const cursor = sql.prepare('SELECT cursor_group_id c FROM scans WHERE id = ?').get(scanId) as { c: number | null } | undefined;
    if (!cursor) throw new NotFoundException('Varredura não encontrada.');
    const cursorPos = cursor.c
      ? ((sql.prepare('SELECT position p FROM dup_groups WHERE id = ?').get(cursor.c) as { p: number } | undefined)?.p ?? 0)
      : 0;
    const pick = (q: string, ...p: unknown[]) => sql.prepare(q).get(...p) as { id: number } | undefined;
    const next =
      pick("SELECT id FROM dup_groups WHERE scan_id = ? AND status IN ('pending','stale') AND position >= ? ORDER BY position LIMIT 1", scanId, cursorPos) ??
      pick("SELECT id FROM dup_groups WHERE scan_id = ? AND status IN ('pending','stale') ORDER BY position LIMIT 1", scanId);
    if (!next) return null;
    sql.prepare('UPDATE scans SET cursor_group_id = ? WHERE id = ?').run(next.id, scanId);
    return this.view(next.id);
  }

  skip(groupId: number): GroupView | null {
    const g = this.group(groupId);
    this.db.sql.prepare("UPDATE dup_groups SET status = 'skipped' WHERE id = ? AND status IN ('pending','stale')").run(groupId);
    return this.current(g.scan_id);
  }

  previous(groupId: number): GroupView | null {
    const g = this.group(groupId);
    const prev = this.db.sql
      .prepare('SELECT id FROM dup_groups WHERE scan_id = ? AND position < ? ORDER BY position DESC LIMIT 1')
      .get(g.scan_id, g.position) as { id: number } | undefined;
    if (!prev) return null;
    this.db.sql.prepare('UPDATE scans SET cursor_group_id = ? WHERE id = ?').run(prev.id, g.scan_id);
    return this.view(prev.id);
  }

  unskipAll(scanId: number): void {
    this.db.sql.prepare("UPDATE dup_groups SET status = 'pending' WHERE scan_id = ? AND status = 'skipped'").run(scanId);
    this.db.sql.prepare('UPDATE scans SET cursor_group_id = NULL WHERE id = ?').run(scanId);
  }

  private group(groupId: number): GroupRow {
    const g = this.db.sql.prepare('SELECT id, scan_id, position, status FROM dup_groups WHERE id = ?').get(groupId) as GroupRow | undefined;
    if (!g) throw new NotFoundException('Grupo não encontrado.');
    return g;
  }
}
```

`apps/api/src/review/review.controller.ts`:
```ts
import { BadRequestException, Body, Controller, Get, HttpCode, Inject, Param, ParseIntPipe, Post, Put } from '@nestjs/common';
import type { GroupView, RuleCriterion } from '@twinpix/shared';
import { isValidRules } from '../rules/suggest-keep';
import type { Db } from '../storage/db';
import { DB } from '../tokens';
import { ReviewService } from './review.service';
import { getRules, setRules } from './rules-settings';

@Controller()
export class ReviewController {
  constructor(
    private readonly review: ReviewService,
    @Inject(DB) private readonly db: Db,
  ) {}

  @Get('scans/:id/groups/current')
  current(@Param('id', ParseIntPipe) id: number): GroupView | null {
    return this.review.current(id);
  }

  @Post('scans/:id/unskip')
  @HttpCode(204)
  unskip(@Param('id', ParseIntPipe) id: number): void {
    this.review.unskipAll(id);
  }

  @Get('groups/:id')
  view(@Param('id', ParseIntPipe) id: number): GroupView {
    return this.review.view(id);
  }

  @Post('groups/:id/skip')
  @HttpCode(200)
  skip(@Param('id', ParseIntPipe) id: number): GroupView | null {
    return this.review.skip(id);
  }

  @Get('groups/:id/previous')
  previous(@Param('id', ParseIntPipe) id: number): GroupView | null {
    return this.review.previous(id);
  }

  @Get('settings/rules')
  rules(): RuleCriterion[] {
    return getRules(this.db);
  }

  @Put('settings/rules')
  saveRules(@Body() body: unknown): RuleCriterion[] {
    if (!isValidRules(body) || body.length === 0) throw new BadRequestException('Lista de regras inválida.');
    setRules(this.db, body);
    return body;
  }
}
```

Nota: o Nest serializa `null` como corpo vazio com status 200. No cliente web, trate corpo vazio
como `null` (a Task 14 já faz isso em `apiFetch`).

`apps/api/src/review/review.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { ReviewController } from './review.controller';
import { ReviewService } from './review.service';

@Module({ controllers: [ReviewController], providers: [ReviewService], exports: [ReviewService] })
export class ReviewModule {}
```

Em `apps/api/src/app.module.ts`, acrescentar `ReviewModule` ao array `imports`.

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test -w apps/api -- src/review && npm run typecheck -w apps/api`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/review apps/api/src/app.module.ts
git commit -m "feat: revisão grupo a grupo com pular, voltar e regras configuráveis"
```

---

### Task 12: Ações — confirmação, lixeira com conferência, diário, histórico e desfazer

**Files:**
- Create: `apps/api/src/actions/actions.service.ts`, `apps/api/src/actions/actions.controller.ts`, `apps/api/src/actions/actions.module.ts`
- Modify: `apps/api/src/app.module.ts` (importar `ActionsModule`)
- Test: `apps/api/src/actions/actions.service.spec.ts`

**Interfaces:**
- Consumes: `planDeletion`, `UnsafeDeletionError` (Task 5); `ReviewService.activeFileIds`, `ReviewService.view` (Task 11); `CloudProvider` e erros (Task 6); `getFilesByIds`, `nowIso` (Task 2).
- Produces:
  - `class ActionsService { preview(groupId, deleteIds): DeletionPreview; apply(groupId, deleteIds): Promise<ApplyResult>; recoverPending(): Promise<void>; history(): HistoryEntry[]; undo(actionId): Promise<UndoResponse>; onModuleInit(): Promise<void> }`
  - Rotas: `POST /api/groups/:id/preview` `{ deleteIds }` → `DeletionPreview`;
    `POST /api/groups/:id/apply` `{ deleteIds }` → `ApplyResult`;
    `GET /api/history` → `HistoryEntry[]`; `POST /api/actions/:id/undo` → `UndoResponse`.
  - Regras do `apply`:
    1. `planDeletion(activeFileIds(groupId), deleteIds)`.
    2. Para **todos** os IDs (saem e ficam): `getItem`; se `null` ou `quickXorHash`/`size` diferentes
       do gravado → grupo `stale`, devolve `{ stale: true, results: [] }` sem mover nada.
    3. Para cada ID que sai: grava ação `pending` **antes**; chama `moveToTrash`; atualiza para
       `done` ou `failed` (com mensagem).
    4. Grupo vira `resolved` se todas deram certo; senão fica `pending`.

- [ ] **Step 1: Teste**

`apps/api/src/actions/actions.service.spec.ts`:
```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { OfflineError } from '../cloud/errors';
import { FakeCloudProvider } from '../cloud/fake-cloud-provider';
import { ReviewService } from '../review/review.service';
import { ScanService } from '../scan/scan.service';
import { Db } from '../storage/db';
import { UnsafeDeletionError } from './deletion-plan';
import { ActionsService } from './actions.service';

let db: Db;
let cloud: FakeCloudProvider;
let review: ReviewService;
let actions: ActionsService;
let groupId: number;
let keep: string;
let extra: string[];

beforeEach(async () => {
  db = new Db(':memory:');
  cloud = new FakeCloudProvider();
  const a = cloud.addFolder(cloud.rootId, 'A');
  cloud.addFile(a.id, { id: 'orig', name: 'x.jpg', quickXorHash: 'h', size: 500 });
  cloud.addFile(a.id, { id: 'c1', name: 'x 1.jpg', quickXorHash: 'h', size: 500 });
  cloud.addFile(a.id, { id: 'c2', name: 'x (2).jpg', quickXorHash: 'h', size: 500 });
  const scan = new ScanService(db, cloud, { offlineRetryMs: 0 });
  const scanId = scan.start([a]);
  await scan.whenIdle(scanId);
  review = new ReviewService(db);
  actions = new ActionsService(db, cloud, review);
  const g = review.current(scanId)!;
  groupId = g.id;
  keep = g.suggestion.keepId;
  extra = g.preMarkedIds;
});

describe('ActionsService', () => {
  it('prévia mostra contagem, espaço e listas', () => {
    const p = actions.preview(groupId, extra);
    expect(p.deleteFiles.map((f) => f.id).sort()).toEqual(['c1', 'c2']);
    expect(p.keepFiles.map((f) => f.id)).toEqual(['orig']);
    expect(p.bytes).toBe(1000);
  });

  it('prévia e aplicação recusam excluir todas', async () => {
    expect(() => actions.preview(groupId, ['orig', 'c1', 'c2'])).toThrow(UnsafeDeletionError);
    await expect(actions.apply(groupId, ['orig', 'c1', 'c2'])).rejects.toBeInstanceOf(UnsafeDeletionError);
    expect(cloud.calls).not.toContain('moveToTrash');
  });

  it('move para a lixeira, registra histórico e resolve o grupo', async () => {
    const r = await actions.apply(groupId, extra);
    expect(r.stale).toBe(false);
    expect(r.results.map((x) => x.status)).toEqual(['done', 'done']);
    expect(cloud.isInTrash('c1') && cloud.isInTrash('c2')).toBe(true);
    expect(cloud.isInTrash(keep)).toBe(false);
    expect(review.view(groupId).status).toBe('resolved');
    expect(actions.history()).toHaveLength(2);
  });

  it('se a cópia que fica sumiu, nada é movido e o grupo fica desatualizado', async () => {
    cloud.removeFile(keep);
    const r = await actions.apply(groupId, extra);
    expect(r).toEqual({ groupId, stale: true, results: [] });
    expect(cloud.calls).not.toContain('moveToTrash');
    expect(review.view(groupId).status).toBe('stale');
  });

  it('se a cópia que fica mudou de conteúdo, nada é movido', async () => {
    cloud.updateFile(keep, { quickXorHash: 'editada' });
    expect((await actions.apply(groupId, extra)).stale).toBe(true);
    expect(cloud.calls).not.toContain('moveToTrash');
  });

  it('se o arquivo que sai mudou, nada é movido', async () => {
    cloud.updateFile('c1', { size: 999 });
    expect((await actions.apply(groupId, extra)).stale).toBe(true);
  });

  it('falha parcial: cada item tem seu resultado e o grupo continua pendente', async () => {
    cloud.failNext('moveToTrash', new OfflineError());
    const r = await actions.apply(groupId, extra);
    expect(r.results.map((x) => x.status).sort()).toEqual(['done', 'failed']);
    expect(r.results.find((x) => x.status === 'failed')!.error).toBe('Sem conexão com a internet.');
    expect(review.view(groupId).status).toBe('pending');
    expect(review.activeFileIds(groupId)).toHaveLength(2);
  });

  it('diário: ação pendente após fechar o app é acertada na volta', async () => {
    const now = new Date().toISOString();
    const ins = db.sql.prepare("INSERT INTO actions (group_id, file_id, kept_file_id, status, created_at, updated_at) VALUES (?, ?, ?, 'pending', ?, ?)");
    ins.run(groupId, 'c1', keep, now, now);
    ins.run(groupId, 'c2', keep, now, now);
    await cloud.moveToTrash('c1'); // chegou a ser movido antes de o app fechar
    await actions.recoverPending();
    const statuses = db.sql.prepare('SELECT file_id, status FROM actions ORDER BY file_id').all();
    expect(statuses).toEqual([
      { file_id: 'c1', status: 'done' },
      { file_id: 'c2', status: 'failed' },
    ]);
  });

  it('desfazer restaura e devolve o grupo para revisão', async () => {
    const r = await actions.apply(groupId, ['c1']);
    const u = await actions.undo(r.results[0].actionId);
    expect(u.result).toBe('restored');
    expect(cloud.isInTrash('c1')).toBe(false);
    expect(actions.history()[0].status).toBe('undone');
    expect(review.view(groupId).status).toBe('pending');
  });

  it('desfazer: item que já saiu da lixeira e nome ocupado', async () => {
    const r = await actions.apply(groupId, ['c1', 'c2']);
    // simula a lixeira esvaziada pelo OneDrive
    await cloud.restore('c1');
    cloud.removeFile('c1');
    expect((await actions.undo(r.results.find((x) => x.fileId === 'c1')!.actionId)).message).toMatch('já saiu da lixeira');
    const [pastaA] = await cloud.listFolders(cloud.rootId);
    cloud.addFile(pastaA.id, { name: 'x (2).jpg' });
    expect((await actions.undo(r.results.find((x) => x.fileId === 'c2')!.actionId)).result).toBe('conflict');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -w apps/api -- src/actions/actions.service`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: Implementação**

`apps/api/src/actions/actions.service.ts`:
```ts
import { BadRequestException, Inject, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import type { ActionResult, ActionStatus, ApplyResult, DeletionPreview, HistoryEntry, UndoResponse } from '@twinpix/shared';
import type { CloudProvider } from '../cloud/cloud-provider';
import { ReviewService } from '../review/review.service';
import type { Db } from '../storage/db';
import { getFilesByIds, nowIso, rowToItem, type FileRow } from '../storage/rows';
import { CLOUD_PROVIDER, DB } from '../tokens';
import { planDeletion } from './deletion-plan';

const UNDO_MESSAGES = {
  restored: 'Arquivo restaurado para a pasta original.',
  'not-in-trash': 'Não é mais possível restaurar: o arquivo já saiu da lixeira do OneDrive.',
  conflict:
    'Não foi possível restaurar: já existe um arquivo com o mesmo nome na pasta original, ou a pasta foi apagada. ' +
    'Confira a lixeira em onedrive.live.com.',
} as const;

@Injectable()
export class ActionsService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOUD_PROVIDER) private readonly cloud: CloudProvider,
    private readonly review: ReviewService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.recoverPending();
  }

  preview(groupId: number, deleteIds: string[]): DeletionPreview {
    const { scanId, plan } = this.plan(groupId, deleteIds);
    const deleteFiles = getFilesByIds(this.db.sql, scanId, plan.deleteIds);
    const keepFiles = getFilesByIds(this.db.sql, scanId, plan.keepIds);
    return { groupId, deleteFiles, keepFiles, bytes: deleteFiles.reduce((s, f) => s + f.size, 0) };
  }

  async apply(groupId: number, deleteIds: string[]): Promise<ApplyResult> {
    const { scanId, plan } = this.plan(groupId, deleteIds);
    const stored = new Map(getFilesByIds(this.db.sql, scanId, [...plan.deleteIds, ...plan.keepIds]).map((f) => [f.id, f]));

    // Confere o que sai E o que fica antes de mover qualquer coisa.
    for (const id of [...plan.keepIds, ...plan.deleteIds]) {
      const current = await this.cloud.getItem(id);
      const before = stored.get(id)!;
      if (!current || current.quickXorHash !== before.quickXorHash || current.size !== before.size) {
        this.setGroupStatus(groupId, 'stale');
        return { groupId, stale: true, results: [] };
      }
    }

    const keptRef = plan.keepIds[0];
    const results: ActionResult[] = [];
    for (const id of plan.deleteIds) {
      const now = nowIso();
      const { lastInsertRowid } = this.db.sql
        .prepare("INSERT INTO actions (group_id, file_id, kept_file_id, status, created_at, updated_at) VALUES (?, ?, ?, 'pending', ?, ?)")
        .run(groupId, id, keptRef, now, now);
      const actionId = Number(lastInsertRowid);
      let status: ActionStatus = 'done';
      let error: string | null = null;
      try {
        await this.cloud.moveToTrash(id);
      } catch (e) {
        status = 'failed';
        error = (e as Error).message;
      }
      this.setActionStatus(actionId, status, error);
      results.push({ actionId, fileId: id, fileName: stored.get(id)!.name, status, error });
    }
    this.setGroupStatus(groupId, results.every((r) => r.status === 'done') ? 'resolved' : 'pending');
    return { groupId, stale: false, results };
  }

  async recoverPending(): Promise<void> {
    const pending = this.db.sql.prepare("SELECT id, file_id FROM actions WHERE status = 'pending'").all() as Array<{ id: number; file_id: string }>;
    for (const a of pending) {
      try {
        const item = await this.cloud.getItem(a.file_id);
        if (item) this.setActionStatus(a.id, 'failed', 'Interrompida antes de mover; nada foi alterado.');
        else this.setActionStatus(a.id, 'done', null);
      } catch {
        // Sem conexão agora: tenta de novo na próxima inicialização.
      }
    }
  }

  history(): HistoryEntry[] {
    const rows = this.db.sql
      .prepare(
        `SELECT a.id action_id, a.group_id, a.status, a.error, a.created_at action_created_at, f.*
         FROM actions a
         JOIN dup_groups g ON g.id = a.group_id
         JOIN files f ON f.scan_id = g.scan_id AND f.id = a.file_id
         ORDER BY a.id DESC`,
      )
      .all() as Array<FileRow & { action_id: number; group_id: number; status: ActionStatus; error: string | null; action_created_at: string }>;
    return rows.map((r) => ({
      actionId: r.action_id,
      groupId: r.group_id,
      file: rowToItem(r),
      status: r.status,
      error: r.error,
      createdAt: r.action_created_at,
    }));
  }

  async undo(actionId: number): Promise<UndoResponse> {
    const a = this.db.sql.prepare('SELECT id, group_id, file_id, status FROM actions WHERE id = ?').get(actionId) as
      | { id: number; group_id: number; file_id: string; status: ActionStatus }
      | undefined;
    if (!a) throw new NotFoundException('Ação não encontrada.');
    if (a.status !== 'done') throw new BadRequestException('Só dá para desfazer arquivos que foram para a lixeira.');
    const result = await this.cloud.restore(a.file_id);
    if (result === 'restored') {
      this.setActionStatus(a.id, 'undone', null);
      this.setGroupStatus(a.group_id, 'pending');
    }
    return { result, message: UNDO_MESSAGES[result] };
  }

  private plan(groupId: number, deleteIds: string[]) {
    const view = this.review.view(groupId);
    const plan = planDeletion(this.review.activeFileIds(groupId), Array.isArray(deleteIds) ? deleteIds : []);
    return { scanId: view.scanId, plan };
  }

  private setActionStatus(id: number, status: ActionStatus, error: string | null): void {
    this.db.sql.prepare('UPDATE actions SET status = ?, error = ?, updated_at = ? WHERE id = ?').run(status, error, nowIso(), id);
  }

  private setGroupStatus(groupId: number, status: 'pending' | 'resolved' | 'stale'): void {
    this.db.sql.prepare('UPDATE dup_groups SET status = ? WHERE id = ?').run(status, groupId);
  }
}
```

`apps/api/src/actions/actions.controller.ts`:
```ts
import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post } from '@nestjs/common';
import type { ApplyResult, DeletionPreview, HistoryEntry, UndoResponse } from '@twinpix/shared';
import { ActionsService } from './actions.service';

@Controller()
export class ActionsController {
  constructor(private readonly actions: ActionsService) {}

  @Post('groups/:id/preview')
  @HttpCode(200)
  preview(@Param('id', ParseIntPipe) id: number, @Body() body: { deleteIds?: string[] }): DeletionPreview {
    return this.actions.preview(id, body?.deleteIds ?? []);
  }

  @Post('groups/:id/apply')
  @HttpCode(200)
  apply(@Param('id', ParseIntPipe) id: number, @Body() body: { deleteIds?: string[] }): Promise<ApplyResult> {
    return this.actions.apply(id, body?.deleteIds ?? []);
  }

  @Get('history')
  history(): HistoryEntry[] {
    return this.actions.history();
  }

  @Post('actions/:id/undo')
  @HttpCode(200)
  undo(@Param('id', ParseIntPipe) id: number): Promise<UndoResponse> {
    return this.actions.undo(id);
  }
}
```

`apps/api/src/actions/actions.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { ReviewModule } from '../review/review.module';
import { ActionsController } from './actions.controller';
import { ActionsService } from './actions.service';

@Module({ imports: [ReviewModule], controllers: [ActionsController], providers: [ActionsService] })
export class ActionsModule {}
```

Em `apps/api/src/app.module.ts`, acrescentar `ActionsModule` ao array `imports`.

- [ ] **Step 4: Rodar tudo da API**

Run: `npm test -w apps/api && npm run typecheck -w apps/api && npm run build -w apps/api`
Expected: todas as suítes passam; build sem erros.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/actions apps/api/src/app.module.ts
git commit -m "feat: lixeira com conferência dos dois lados, diário de ações, histórico e desfazer"
```

---

### Task 13: Teste de ponta a ponta da API (modo demonstração)

**Files:**
- Test: `apps/api/src/app.e2e.spec.ts`

**Interfaces:**
- Consumes: `AppModule.forRoot`, `loadConfig`, `sessionMiddleware`, `DomainErrorFilter` (Task 9) e todas as rotas.

- [ ] **Step 1: Teste**

`apps/api/src/app.e2e.spec.ts`:
```ts
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { GroupView, ScanSummary } from '@twinpix/shared';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from './app.module';
import { loadConfig } from './config';
import { DomainErrorFilter } from './http/domain-error.filter';
import { sessionMiddleware } from './security/session.middleware';

let app: INestApplication;
const T = 'tok';

beforeAll(async () => {
  const config = loadConfig(
    { TWINPIX_DATA_DIR: mkdtempSync(join(tmpdir(), 'twinpix-e2e-')), TWINPIX_SESSION_TOKEN: T },
    ['node', 'main.js', '--demo'],
  );
  const mod = await Test.createTestingModule({ imports: [AppModule.forRoot(config)] }).compile();
  app = mod.createNestApplication({ logger: false });
  app.use(sessionMiddleware(config.sessionToken, config.allowedOrigins));
  app.setGlobalPrefix('api');
  app.useGlobalFilters(new DomainErrorFilter());
  await app.init();
});

afterAll(async () => {
  await app.close();
});

const api = () => ({
  get: (p: string) => request(app.getHttpServer()).get(p).set('X-TwinPix-Token', T),
  post: (p: string, body?: object) => request(app.getHttpServer()).post(p).set('X-TwinPix-Token', T).send(body ?? {}),
});

async function waitDone(id: number): Promise<ScanSummary> {
  for (let i = 0; i < 100; i++) {
    const { body } = await api().get(`/api/scans/${id}`);
    if (body.status === 'done') return body;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('varredura não terminou');
}

describe('API em modo demonstração', () => {
  it('fluxo completo: pastas → varredura → revisão → lixeira → desfazer', async () => {
    await request(app.getHttpServer()).get('/api/auth/status').expect(401);
    expect((await api().get('/api/auth/status')).body).toMatchObject({ connected: true, demo: true });

    const root = (await api().get('/api/folders/root')).body;
    const folders = (await api().get(`/api/folders/${encodeURIComponent(root.id)}/children`)).body;
    expect(folders.map((f: { name: string }) => f.name)).toEqual(['Imagens', 'Minhas imagens']);

    const nesting = (await api().post('/api/folders/check-nesting', { paths: ['/Imagens', '/Imagens/Imagens da Câmera'] })).body;
    expect(nesting).toHaveLength(1);

    const started = (await api().post('/api/scans', { roots: folders })).body as ScanSummary;
    const done = await waitDone(started.id);
    expect(done.groupsTotal).toBeGreaterThanOrEqual(10);
    expect(done.unanalyzedCount).toBe(1);

    const group = (await api().get(`/api/scans/${started.id}/groups/current`)).body as GroupView;
    expect(group.position).toBe(1);

    await api().post(`/api/groups/${group.id}/preview`, { deleteIds: group.files.map((f) => f.id) }).expect(400);
    const preview = (await api().post(`/api/groups/${group.id}/preview`, { deleteIds: group.preMarkedIds })).body;
    expect(preview.deleteFiles).toHaveLength(group.preMarkedIds.length);

    const applied = (await api().post(`/api/groups/${group.id}/apply`, { deleteIds: group.preMarkedIds })).body;
    expect(applied.stale).toBe(false);
    expect(applied.results.every((r: { status: string }) => r.status === 'done')).toBe(true);

    const history = (await api().get('/api/history')).body;
    expect(history.length).toBe(group.preMarkedIds.length);
    const undo = (await api().post(`/api/actions/${history[0].actionId}/undo`)).body;
    expect(undo.result).toBe('restored');

    expect((await api().get(`/api/files/${group.files[0].id}/thumbnail`)).body.url).toMatch(/^data:image\/svg\+xml/);
  });

  it('link inválido devolve 400 com mensagem', async () => {
    const r = await api().post('/api/folders/resolve-link', { url: 'https://example.com' }).expect(400);
    expect(r.body.message).toBe('Este link não é do OneDrive.');
  });
});
```

- [ ] **Step 2: Rodar**

Run: `npm test -w apps/api -- src/app.e2e`
Expected: PASS. Se falhar, corrija o código de produção (não o teste) e explique no relatório.
Corpo vazio para respostas `null` do Nest é esperado (veja nota da Task 11).

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/app.e2e.spec.ts
git commit -m "test: fluxo completo da API em modo demonstração"
```

---

### Task 14: Web — cliente da API, sessão, rotas, início e escolha de pastas

**Files:**
- Create: `apps/web/src/lib/api.ts`, `apps/web/src/lib/session.ts`, `apps/web/src/lib/format.ts`, `apps/web/src/styles.css`, `apps/web/src/pages/Home.tsx`, `apps/web/src/pages/FolderPicker.tsx`
- Modify: `apps/web/src/App.tsx` (substituir), `apps/web/src/main.tsx` (capturar token e importar CSS), `apps/web/src/App.spec.tsx` (substituir)
- Test: `apps/web/src/lib/format.spec.ts`, `apps/web/src/lib/session.spec.ts`, `apps/web/src/pages/FolderPicker.spec.tsx`, `apps/web/src/App.spec.tsx`

**Interfaces:**
- Produces:
  - `captureTokenFromHash(): void` (lê `#token=...`, guarda em `sessionStorage['twinpix-token']`, limpa o hash)
  - `getToken(): string | null`
  - `class ApiError extends Error { status: number; code?: string }`
  - `apiFetch<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T>` (envia `X-TwinPix-Token`; corpo vazio → `null`)
  - `formatBytes(n: number): string` (pt-BR: "2,1 GB"), `formatDate(iso: string | null): string` (pt-BR "06/02/2015 22:26" ou "—"), `formatCamera(make, model): string`, `formatDimensions(w, h): string`, `formatDuration(ms): string`
  - Rotas (HashRouter): `/` Home, `/pastas` FolderPicker, `/varredura/:id` ScanProgress, `/revisao/:scanId` e `/revisao/:scanId/grupo/:groupId` Review, `/confirmar` Confirm, `/historico` History.
    As páginas das Tasks 15 e 16 começam como componentes simples definidos nesta task e são substituídas depois.

- [ ] **Step 1: Testes**

`apps/web/src/lib/format.spec.ts`:
```ts
import { formatBytes, formatCamera, formatDate, formatDimensions, formatDuration } from './format';

it('formata bytes em pt-BR', () => {
  expect(formatBytes(0)).toBe('0 B');
  expect(formatBytes(2_100_000_000)).toBe('2,1 GB');
  expect(formatBytes(2_481_234)).toBe('2,5 MB');
  expect(formatBytes(800)).toBe('800 B');
});

it('formata data, câmera, dimensões e duração', () => {
  expect(formatDate(null)).toBe('—');
  expect(formatDate('2015-02-06T22:26:31Z')).toMatch(/06\/02\/2015/);
  expect(formatCamera('samsung', 'SM-G900M')).toBe('samsung SM-G900M');
  expect(formatCamera(null, null)).toBe('—');
  expect(formatDimensions(4128, 2322)).toBe('4128 × 2322');
  expect(formatDimensions(null, null)).toBe('—');
  expect(formatDuration(31_000)).toBe('0:31');
  expect(formatDuration(null)).toBe('—');
});
```

`apps/web/src/lib/session.spec.ts`:
```ts
import { captureTokenFromHash, getToken } from './session';

it('captura o token do endereço e limpa o hash', () => {
  window.location.hash = '#token=abc123';
  captureTokenFromHash();
  expect(getToken()).toBe('abc123');
  expect(window.location.hash).toBe('');
});
```

`apps/web/src/pages/FolderPicker.spec.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { FolderPicker } from './FolderPicker';

const routes: Record<string, unknown> = {
  'GET /api/folders/root': { id: 'root', name: 'OneDrive', path: '/', childCount: 2 },
  'GET /api/folders/root/children': [
    { id: 'a', name: 'Minhas imagens', path: '/Minhas imagens', childCount: 1 },
    { id: 'b', name: 'Imagens', path: '/Imagens', childCount: 1 },
  ],
  'GET /api/folders/a/children': [{ id: 'a1', name: 'minhas fotos', path: '/Minhas imagens/minhas fotos', childCount: 0 }],
  'POST /api/folders/check-nesting': [{ inner: '/Minhas imagens/minhas fotos', outer: '/Minhas imagens' }],
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${url}`;
    return new Response(JSON.stringify(routes[key] ?? null), { status: 200 });
  }));
});

it('escolhe pastas, entra em subpasta e avisa sobre pasta dentro de outra', async () => {
  render(<MemoryRouter><FolderPicker /></MemoryRouter>);
  await userEvent.click(await screen.findByRole('checkbox', { name: 'Escolher a pasta Minhas imagens' }));
  await userEvent.click(screen.getByRole('button', { name: 'Abrir Minhas imagens' }));
  await userEvent.click(await screen.findByRole('checkbox', { name: 'Escolher a pasta minhas fotos' }));
  expect(await screen.findByText(/já está incluída em/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Iniciar análise/ })).toBeEnabled();
});
```

`apps/web/src/App.spec.tsx` (substituir):
```tsx
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { App } from './App';

it('sem Client ID mostra como configurar', async () => {
  vi.stubGlobal('fetch', vi.fn(async () =>
    new Response(JSON.stringify({ configured: false, connected: false, accountName: null, demo: false }), { status: 200 }),
  ));
  render(<App />);
  expect(await screen.findByText(/TWINPIX_CLIENT_ID/)).toBeInTheDocument();
});

it('desconectado mostra o botão de conectar', async () => {
  vi.stubGlobal('fetch', vi.fn(async () =>
    new Response(JSON.stringify({ configured: true, connected: false, accountName: null, demo: false }), { status: 200 }),
  ));
  render(<App />);
  expect(await screen.findByRole('link', { name: 'Conectar ao OneDrive' })).toHaveAttribute('href', '/api/auth/login');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -w apps/web`
Expected: FAIL — módulos não encontrados.

- [ ] **Step 3: Implementação**

`apps/web/src/lib/session.ts`:
```ts
const KEY = 'twinpix-token';

export function captureTokenFromHash(): void {
  const match = window.location.hash.match(/^#token=([^&]+)$/);
  if (!match) return;
  try {
    sessionStorage.setItem(KEY, decodeURIComponent(match[1]));
  } catch {
    // sessionStorage indisponível: a API responderá com sessão inválida.
  }
  history.replaceState(null, '', window.location.pathname + window.location.search);
}

export function getToken(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}
```

`apps/web/src/lib/api.ts`:
```ts
import { getToken } from './session';

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
  }
}

export async function apiFetch<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers['X-TwinPix-Token'] = token;
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? 'GET',
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiError('Não consegui falar com o TwinPix Cloud. Ele ainda está rodando no terminal?', 0);
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(data?.message ?? `Erro ${res.status}`, res.status, data?.code);
  return data as T;
}
```

`apps/web/src/lib/format.ts`:
```ts
export function formatBytes(n: number): string {
  if (n < 1000) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = n;
  let unit = -1;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${value.toLocaleString('pt-BR', { maximumFractionDigits: 1, minimumFractionDigits: 1 })} ${units[unit]}`;
}

export function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function formatCamera(make: string | null, model: string | null): string {
  const text = [make, model].filter(Boolean).join(' ');
  return text || '—';
}

export function formatDimensions(w: number | null, h: number | null): string {
  return w && h ? `${w} × ${h}` : '—';
}

export function formatDuration(ms: number | null): string {
  if (ms === null) return '—';
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
```

`apps/web/src/main.tsx` (substituir):
```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { captureTokenFromHash } from './lib/session';
import './styles.css';

captureTokenFromHash();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

`apps/web/src/App.tsx` (substituir; `ScanProgress`, `Review`, `Confirm`, `History` são criados
como componentes provisórios nesta task e completados nas Tasks 15 e 16):
```tsx
import { HashRouter, Link, Route, Routes } from 'react-router-dom';
import { Confirm } from './pages/Confirm';
import { FolderPicker } from './pages/FolderPicker';
import { History } from './pages/History';
import { Home } from './pages/Home';
import { Review } from './pages/Review';
import { ScanProgress } from './pages/ScanProgress';

export function App() {
  return (
    <HashRouter>
      <header className="topbar">
        <Link to="/" className="brand">TwinPix Cloud</Link>
        <nav>
          <Link to="/historico">Histórico</Link>
        </nav>
      </header>
      <main className="page">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/pastas" element={<FolderPicker />} />
          <Route path="/varredura/:id" element={<ScanProgress />} />
          <Route path="/revisao/:scanId" element={<Review />} />
          <Route path="/revisao/:scanId/grupo/:groupId" element={<Review />} />
          <Route path="/confirmar" element={<Confirm />} />
          <Route path="/historico" element={<History />} />
        </Routes>
      </main>
    </HashRouter>
  );
}
```

Componentes provisórios (um arquivo cada):
```tsx
// apps/web/src/pages/ScanProgress.tsx
export function ScanProgress() { return <p>Análise em andamento…</p>; }
// apps/web/src/pages/Review.tsx
export function Review() { return <p>Revisão</p>; }
// apps/web/src/pages/Confirm.tsx
export function Confirm() { return <p>Confirmação</p>; }
// apps/web/src/pages/History.tsx
export function History() { return <p>Histórico</p>; }
```

`apps/web/src/pages/Home.tsx`:
```tsx
import type { AuthStatus, ScanSummary } from '@twinpix/shared';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ApiError, apiFetch } from '../lib/api';
import { formatBytes } from '../lib/format';

export function Home() {
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [latest, setLatest] = useState<ScanSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [params] = useSearchParams();
  const loginError = params.get('erro');

  useEffect(() => {
    apiFetch<AuthStatus>('/api/auth/status')
      .then(async (s) => {
        setAuth(s);
        if (s.connected) setLatest(await apiFetch<ScanSummary | null>('/api/scans/latest'));
      })
      .catch((e: ApiError) => setError(e.message));
  }, []);

  if (error) return <p className="alert">{error}</p>;
  if (!auth) return <p>Carregando…</p>;

  if (!auth.configured) {
    return (
      <section className="card">
        <h1>Falta configurar</h1>
        <p>
          Para conectar ao OneDrive, registre o app no Microsoft Entra e coloque o Client ID no arquivo
          <code> .env </code> da pasta do projeto, na linha <code>TWINPIX_CLIENT_ID=</code>. O passo a passo está no README.
        </p>
        <p>Enquanto isso, você pode experimentar com <code>npm run demo</code>.</p>
      </section>
    );
  }

  if (!auth.connected) {
    return (
      <section className="card">
        <h1>Encontre fotos e vídeos repetidos no seu OneDrive</h1>
        {loginError && <p className="alert">Não foi possível conectar: {loginError}</p>}
        <p>O TwinPix Cloud só lê informações dos arquivos. Nada é apagado sem você confirmar, e tudo vai para a lixeira do OneDrive.</p>
        <a className="button primary" href="/api/auth/login">Conectar ao OneDrive</a>
      </section>
    );
  }

  return (
    <section className="card">
      <h1>Olá{auth.accountName ? `, ${auth.accountName}` : ''}!</h1>
      {auth.demo && <p className="notice">Modo demonstração: os arquivos são fictícios e nada acontece no seu OneDrive.</p>}
      {latest && (
        <div className="latest">
          <p>
            Última análise: {latest.filesFound} arquivos, {latest.groupsPending} grupos para revisar,
            {' '}{formatBytes(latest.bytesFreed)} liberados.
          </p>
          <div className="row">
            <Link className="button" to={`/varredura/${latest.id}`}>Ver análise</Link>
            {latest.groupsPending > 0 && <Link className="button primary" to={`/revisao/${latest.id}`}>Continuar revisão</Link>}
          </div>
        </div>
      )}
      <Link className="button" to="/pastas">Nova análise</Link>
    </section>
  );
}
```

`apps/web/src/pages/FolderPicker.tsx`:
```tsx
import type { CloudFolder, NestedRoot, ScanSummary } from '@twinpix/shared';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError, apiFetch } from '../lib/api';

export function FolderPicker() {
  const navigate = useNavigate();
  const [trail, setTrail] = useState<CloudFolder[]>([]);
  const [children, setChildren] = useState<CloudFolder[]>([]);
  const [chosen, setChosen] = useState<CloudFolder[]>([]);
  const [nested, setNested] = useState<NestedRoot[]>([]);
  const [link, setLink] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const current = trail[trail.length - 1];

  useEffect(() => {
    apiFetch<CloudFolder>('/api/folders/root').then((root) => setTrail([root])).catch((e: ApiError) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!current) return;
    apiFetch<CloudFolder[]>(`/api/folders/${encodeURIComponent(current.id)}/children`)
      .then(setChildren)
      .catch((e: ApiError) => setError(e.message));
  }, [current]);

  useEffect(() => {
    if (chosen.length < 2) {
      setNested([]);
      return;
    }
    apiFetch<NestedRoot[]>('/api/folders/check-nesting', { method: 'POST', body: { paths: chosen.map((c) => c.path) } })
      .then(setNested)
      .catch(() => setNested([]));
  }, [chosen]);

  const isChosen = (f: CloudFolder) => chosen.some((c) => c.id === f.id);
  const toggle = (f: CloudFolder) => setChosen((list) => (isChosen(f) ? list.filter((c) => c.id !== f.id) : [...list, f]));

  async function addFromLink() {
    setError(null);
    try {
      const folder = await apiFetch<CloudFolder>('/api/folders/resolve-link', { method: 'POST', body: { url: link } });
      if (!isChosen(folder)) setChosen((list) => [...list, folder]);
      setLink('');
    } catch (e) {
      setError((e as ApiError).message);
    }
  }

  async function start() {
    setBusy(true);
    try {
      const scan = await apiFetch<ScanSummary>('/api/scans', { method: 'POST', body: { roots: chosen } });
      navigate(`/varredura/${scan.id}`);
    } catch (e) {
      setError((e as ApiError).message);
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h1>Escolha as pastas para analisar</h1>
      <p>A análise inclui todas as subpastas e compara os arquivos entre todas as pastas escolhidas.</p>
      {error && <p className="alert">{error}</p>}

      <nav className="breadcrumb" aria-label="Caminho">
        {trail.map((f, i) => (
          <button key={f.id} type="button" className="link" onClick={() => setTrail(trail.slice(0, i + 1))}>
            {i === 0 ? 'OneDrive' : f.name}
          </button>
        ))}
      </nav>

      <ul className="folder-list">
        {children.length === 0 && <li className="muted">Nenhuma subpasta aqui.</li>}
        {children.map((f) => (
          <li key={f.id}>
            <label>
              <input type="checkbox" checked={isChosen(f)} onChange={() => toggle(f)} aria-label={`Escolher a pasta ${f.name}`} />
              {f.name}
            </label>
            <button type="button" className="link" onClick={() => setTrail([...trail, f])} aria-label={`Abrir ${f.name}`}>
              abrir ›
            </button>
          </li>
        ))}
      </ul>

      <div className="link-input">
        <label htmlFor="folder-link">Ou cole o link de uma pasta do OneDrive</label>
        <div className="row">
          <input id="folder-link" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://1drv.ms/f/…" />
          <button type="button" className="button" onClick={addFromLink} disabled={!link.trim()}>Adicionar</button>
        </div>
      </div>

      <h2>Pastas escolhidas ({chosen.length})</h2>
      <ul className="chosen-list">
        {chosen.map((c) => (
          <li key={c.id}>
            {c.path}
            <button type="button" className="link" onClick={() => toggle(c)} aria-label={`Remover ${c.path}`}>remover</button>
          </li>
        ))}
      </ul>
      {nested.map((n) => (
        <p key={n.inner} className="notice">
          A pasta {n.inner} já está incluída em {n.outer}. Os arquivos dela não serão contados duas vezes.
        </p>
      ))}

      <button type="button" className="button primary" disabled={chosen.length === 0 || busy} onClick={start}>
        Iniciar análise ({chosen.length} {chosen.length === 1 ? 'pasta' : 'pastas'})
      </button>
    </section>
  );
}
```

`apps/web/src/styles.css`:
```css
:root {
  --bg: #f6f7f9;
  --card: #ffffff;
  --text: #1d2330;
  --muted: #5d6676;
  --border: #d9dde5;
  --primary: #2459d6;
  --primary-text: #ffffff;
  --danger: #c4382b;
  --diff: #f28c28;
  --diff-bg: #fff3e6;
  --ok: #2e8540;
  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  color: var(--text);
  background: var(--bg);
  line-height: 1.5;
}
body { margin: 0; background: var(--bg); }
.topbar { display: flex; justify-content: space-between; align-items: center; padding: 12px 24px; background: var(--card); border-bottom: 1px solid var(--border); }
.brand { font-weight: 700; font-size: 1.2rem; color: var(--text); text-decoration: none; }
.topbar nav a { color: var(--primary); }
.page { max-width: 1200px; margin: 24px auto; padding: 0 16px; }
.card { background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 24px; margin-bottom: 16px; }
.row { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
.button { display: inline-block; padding: 10px 18px; border-radius: 8px; border: 1px solid var(--border); background: var(--card); color: var(--text); font-size: 1rem; cursor: pointer; text-decoration: none; }
.button.primary { background: var(--primary); border-color: var(--primary); color: var(--primary-text); }
.button.danger { background: var(--danger); border-color: var(--danger); color: #fff; }
.button:disabled { opacity: 0.5; cursor: not-allowed; }
.link { background: none; border: none; color: var(--primary); cursor: pointer; font-size: inherit; padding: 0 4px; }
.alert { background: #fdecea; color: var(--danger); border-radius: 8px; padding: 12px; }
.notice { background: var(--diff-bg); border-left: 4px solid var(--diff); padding: 10px 12px; border-radius: 4px; }
.muted { color: var(--muted); }
.breadcrumb { display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 8px; }
.breadcrumb button::after { content: ' /'; color: var(--muted); }
.folder-list, .chosen-list { list-style: none; padding: 0; }
.folder-list li, .chosen-list li { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid var(--border); }
.link-input input { flex: 1; min-width: 240px; padding: 10px; border: 1px solid var(--border); border-radius: 8px; font-size: 1rem; }
.progress { height: 12px; background: var(--border); border-radius: 6px; overflow: hidden; }
.progress > div { height: 100%; background: var(--primary); }
.group-header { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 8px; }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; margin: 16px 0; }
.file-card { border: 2px solid var(--border); border-radius: 10px; padding: 12px; background: var(--card); }
.file-card.marked { border-color: var(--danger); }
.file-card img { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; border-radius: 6px; background: var(--border); }
.file-card dl { display: grid; grid-template-columns: max-content 1fr; gap: 2px 8px; margin: 8px 0; }
.file-card dt { color: var(--muted); }
.file-card dd { margin: 0; word-break: break-word; }
.file-card .diff { background: var(--diff-bg); color: #8a4a06; font-weight: 600; border-radius: 3px; padding: 0 3px; }
.badge-keep { display: inline-block; background: #e7f4ea; color: var(--ok); border-radius: 12px; padding: 2px 10px; font-weight: 600; }
.legend { color: var(--muted); font-size: 0.9rem; }
.legend .diff { background: var(--diff-bg); color: #8a4a06; padding: 0 4px; }
.summary-common dl { display: grid; grid-template-columns: max-content 1fr; gap: 2px 8px; }
table { border-collapse: collapse; width: 100%; }
th, td { text-align: left; padding: 8px; border-bottom: 1px solid var(--border); }
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test -w apps/web && npm run typecheck -w apps/web`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat(web): cliente da API, sessão, tela inicial e escolha de pastas"
```

---

### Task 15: Web — progresso da varredura e revisão com cartões lado a lado

**Files:**
- Create: `apps/web/src/lib/differing-fields.ts`, `apps/web/src/components/Thumbnail.tsx`, `apps/web/src/components/FileCard.tsx`
- Modify: `apps/web/src/pages/ScanProgress.tsx`, `apps/web/src/pages/Review.tsx` (substituir os provisórios)
- Test: `apps/web/src/lib/differing-fields.spec.ts`, `apps/web/src/components/FileCard.spec.tsx`, `apps/web/src/pages/Review.spec.tsx`

**Interfaces:**
- Consumes: `apiFetch`, `ApiError`, formatadores (Task 14); tipos `GroupView`, `ScanSummary`, `CloudItem`.
- Produces:
  - `type FieldKey = 'name' | 'folderPath' | 'dimensions' | 'size' | 'takenAt' | 'modifiedAt' | 'camera' | 'duration'`
  - `FIELD_LABELS: Record<FieldKey, string>` = Arquivo, Pasta, Dimensões, Tamanho, Tirada em, Modificada em, Câmera, Duração
  - `fieldValue(file: CloudItem, key: FieldKey): string`
  - `differingFields(files: CloudItem[]): Set<FieldKey>`
  - `<FileCard file isSuggested reason marked lockDelete onToggle diffs fields />`
    — `lockDelete` desabilita marcar quando ela é a última cópia sem marca (trava na interface).
  - A tela de revisão navega para `/confirmar` com `state: { groupId, scanId, deleteIds }`.

- [ ] **Step 1: Testes**

`apps/web/src/lib/differing-fields.spec.ts`:
```ts
import type { CloudItem } from '@twinpix/shared';
import { differingFields, fieldValue } from './differing-fields';

const item = (over: Partial<CloudItem>): CloudItem => ({
  id: 'x', name: 'a.jpg', folderPath: '/A', size: 100, quickXorHash: 'h', mimeType: 'image/jpeg', kind: 'photo',
  takenAt: '2015-02-06T22:26:31Z', createdAt: '2015-02-06T22:26:31Z', modifiedAt: '2015-02-07T10:00:00Z',
  width: 10, height: 10, cameraMake: 'Canon', cameraModel: 'A530', durationMs: null, webUrl: '', ...over,
});

it('aponta só os campos que mudam entre as cópias', () => {
  const d = differingFields([item({ id: '1' }), item({ id: '2', name: 'a 1.jpg', modifiedAt: '2015-04-21T19:30:00Z' })]);
  expect([...d].sort()).toEqual(['modifiedAt', 'name']);
});

it('duração só conta para vídeos', () => {
  expect(fieldValue(item({}), 'duration')).toBe('—');
  expect(fieldValue(item({ kind: 'video', durationMs: 31_000 }), 'duration')).toBe('0:31');
});
```

`apps/web/src/components/FileCard.spec.tsx`:
```tsx
import type { CloudItem } from '@twinpix/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { FileCard } from './FileCard';

const file: CloudItem = {
  id: 'f1', name: '20150206_222631_LLS 1.jpg', folderPath: '/Imagens', size: 2_481_234, quickXorHash: 'h',
  mimeType: 'image/jpeg', kind: 'photo', takenAt: '2015-02-06T22:26:31Z', createdAt: '2015-02-06T22:26:31Z',
  modifiedAt: '2015-04-21T19:30:00Z', width: 4128, height: 2322, cameraMake: 'samsung', cameraModel: 'SM-G900M',
  durationMs: null, webUrl: 'https://onedrive.live.com/x',
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ url: null }), { status: 200 })));
});

const fields = ['name', 'folderPath', 'dimensions', 'size', 'takenAt', 'modifiedAt', 'camera'] as const;

it('mostra todos os campos com rótulo, câmera com fabricante e link do OneDrive', () => {
  render(<FileCard file={file} isSuggested={false} reason="" marked={false} lockDelete={false} onToggle={() => {}} diffs={new Set()} fields={[...fields]} />);
  for (const label of ['Arquivo', 'Pasta', 'Dimensões', 'Tamanho', 'Tirada em', 'Modificada em', 'Câmera']) {
    expect(screen.getByText(label)).toBeInTheDocument();
  }
  expect(screen.getByText('samsung SM-G900M')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Abrir no OneDrive/ })).toHaveAttribute('href', 'https://onedrive.live.com/x');
});

it('destaca diferenças e mostra o selo de sugerida com o motivo', () => {
  render(<FileCard file={file} isSuggested reason="regra: mais antiga (tirada em)" marked={false} lockDelete={false} onToggle={() => {}} diffs={new Set(['name'])} fields={[...fields]} />);
  expect(screen.getByText(file.name)).toHaveClass('diff');
  expect(screen.getByText('★ Sugerida para manter (regra: mais antiga (tirada em))')).toBeInTheDocument();
});

it('trava: não deixa marcar a última cópia que sobraria', async () => {
  const onToggle = vi.fn();
  render(<FileCard file={file} isSuggested={false} reason="" marked={false} lockDelete onToggle={onToggle} diffs={new Set()} fields={[...fields]} />);
  const box = screen.getByRole('checkbox', { name: 'Excluir esta cópia' });
  expect(box).toBeDisabled();
  expect(screen.getByText('É a única cópia que sobraria.')).toBeInTheDocument();
  await userEvent.click(box);
  expect(onToggle).not.toHaveBeenCalled();
});
```

`apps/web/src/pages/Review.spec.tsx`:
```tsx
import type { GroupView } from '@twinpix/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { vi } from 'vitest';
import { Review } from './Review';

const base = {
  quickXorHash: 'h', mimeType: 'image/jpeg', kind: 'photo' as const, takenAt: '2015-02-06T22:26:31Z',
  createdAt: '2015-02-06T22:26:31Z', width: 10, height: 10, cameraMake: 'Canon', cameraModel: 'A530',
  durationMs: null, webUrl: '', size: 1000, folderPath: '/A',
};
const group: GroupView = {
  id: 7, scanId: 1, kind: 'identical', status: 'pending', position: 12, total: 445,
  files: [
    { ...base, id: 'a', name: 'x.jpg', modifiedAt: '2015-02-07T10:00:00Z' },
    { ...base, id: 'b', name: 'x 1.jpg', modifiedAt: '2015-04-21T19:30:00Z' },
  ],
  suggestion: { keepId: 'a', reason: 'regra: nome sem sufixo de cópia' },
  preMarkedIds: ['b'],
  bytesFreedSoFar: 2_100_000_000,
};

function Where() {
  const loc = useLocation();
  return <pre data-testid="where">{JSON.stringify({ path: loc.pathname, state: loc.state })}</pre>;
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/thumbnail')) return new Response(JSON.stringify({ url: null }));
    return new Response(JSON.stringify(group));
  }));
});

it('mostra o cabeçalho do grupo, pré-marca a cópia e segue para a confirmação', async () => {
  render(
    <MemoryRouter initialEntries={['/revisao/1']}>
      <Routes>
        <Route path="/revisao/:scanId" element={<Review />} />
        <Route path="/confirmar" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
  expect(await screen.findByText(/Grupo 12 de 445/)).toBeInTheDocument();
  expect(screen.getByText(/Cópias idênticas/)).toBeInTheDocument();
  expect(screen.getByText(/2,1 GB liberados até agora/)).toBeInTheDocument();
  const boxes = screen.getAllByRole('checkbox', { name: 'Excluir esta cópia' });
  expect(boxes[0]).not.toBeChecked();
  expect(boxes[1]).toBeChecked();
  await userEvent.click(screen.getByRole('button', { name: 'Excluir marcadas (1)' }));
  expect(screen.getByTestId('where').textContent).toContain('"deleteIds":["b"]');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -w apps/web`
Expected: FAIL — módulos não encontrados.

- [ ] **Step 3: Implementação**

`apps/web/src/lib/differing-fields.ts`:
```ts
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
```

`apps/web/src/components/Thumbnail.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';

export function Thumbnail({ fileId, alt }: { fileId: string; alt: string }) {
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    apiFetch<{ url: string | null }>(`/api/files/${encodeURIComponent(fileId)}/thumbnail`)
      .then((r) => alive && setUrl(r.url))
      .catch(() => alive && setUrl(null));
    return () => { alive = false; };
  }, [fileId]);
  if (url === undefined) return <div className="thumb-placeholder" aria-label="Carregando miniatura" />;
  if (url === null) return <div className="thumb-placeholder" role="img" aria-label="Miniatura indisponível">sem miniatura</div>;
  return <img src={url} alt={alt} />;
}
```

Acrescentar em `styles.css`:
```css
.thumb-placeholder { width: 100%; aspect-ratio: 4 / 3; border-radius: 6px; background: var(--border); display: grid; place-items: center; color: var(--muted); }
```

`apps/web/src/components/FileCard.tsx`:
```tsx
import type { CloudItem } from '@twinpix/shared';
import { FIELD_LABELS, fieldValue, type FieldKey } from '../lib/differing-fields';
import { Thumbnail } from './Thumbnail';

interface Props {
  file: CloudItem;
  isSuggested: boolean;
  reason: string;
  marked: boolean;
  /** true quando marcar esta cópia deixaria o grupo sem nenhuma. */
  lockDelete: boolean;
  onToggle: () => void;
  diffs: Set<FieldKey>;
  fields: FieldKey[];
}

export function FileCard({ file, isSuggested, reason, marked, lockDelete, onToggle, diffs, fields }: Props) {
  const disabled = lockDelete && !marked;
  return (
    <article className={`file-card${marked ? ' marked' : ''}`}>
      <Thumbnail fileId={file.id} alt={file.name} />
      {isSuggested && <p className="badge-keep">★ Sugerida para manter ({reason})</p>}
      <dl>
        {fields.map((key) => (
          <div key={key} style={{ display: 'contents' }}>
            <dt>{FIELD_LABELS[key]}</dt>
            <dd><span className={diffs.has(key) ? 'diff' : undefined}>{fieldValue(file, key)}</span></dd>
          </div>
        ))}
      </dl>
      <label className="row">
        <input type="checkbox" checked={marked} disabled={disabled} onChange={onToggle} aria-label="Excluir esta cópia" />
        Excluir esta cópia
      </label>
      {disabled && <p className="muted">É a única cópia que sobraria.</p>}
      <a href={file.webUrl} target="_blank" rel="noreferrer">Abrir no OneDrive ↗</a>
    </article>
  );
}
```

`apps/web/src/pages/Review.tsx` (substituir):
```tsx
import type { GroupView } from '@twinpix/shared';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { FileCard } from '../components/FileCard';
import { ApiError, apiFetch } from '../lib/api';
import { FIELD_LABELS, differingFields, fieldValue, type FieldKey } from '../lib/differing-fields';
import { formatBytes } from '../lib/format';

export function Review() {
  const { scanId, groupId } = useParams();
  const navigate = useNavigate();
  const [group, setGroup] = useState<GroupView | null | undefined>(undefined);
  const [marked, setMarked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  function show(g: GroupView | null) {
    setGroup(g);
    setMarked(new Set(g?.preMarkedIds ?? []));
  }

  useEffect(() => {
    const path = groupId ? `/api/groups/${groupId}` : `/api/scans/${scanId}/groups/current`;
    apiFetch<GroupView | null>(path).then(show).catch((e: ApiError) => setError(e.message));
  }, [scanId, groupId]);

  const diffs = useMemo(() => differingFields(group?.files ?? []), [group]);
  const allFields = useMemo<FieldKey[]>(() => {
    const keys = Object.keys(FIELD_LABELS) as FieldKey[];
    return keys.filter((k) => k !== 'duration' || group?.files.some((f) => f.kind === 'video'));
  }, [group]);
  const many = (group?.files.length ?? 0) >= 3;
  const cardFields = many ? allFields.filter((k) => diffs.has(k)) : allFields;
  const commonFields = many ? allFields.filter((k) => !diffs.has(k)) : [];

  if (error) return <p className="alert">{error}</p>;
  if (group === undefined) return <p>Carregando…</p>;
  if (group === null) {
    return (
      <section className="card">
        <h1>Revisão concluída</h1>
        <p>Não há mais grupos pendentes nesta análise.</p>
        <div className="row">
          <button type="button" className="button" onClick={async () => {
            await apiFetch(`/api/scans/${scanId}/unskip`, { method: 'POST' });
            show(await apiFetch<GroupView | null>(`/api/scans/${scanId}/groups/current`));
          }}>Rever grupos pulados</button>
          <Link className="button" to={`/varredura/${scanId}`}>Ver resumo da análise</Link>
        </div>
      </section>
    );
  }

  const toggle = (id: string) =>
    setMarked((m) => {
      const next = new Set(m);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const unmarkedCount = group.files.length - marked.size;

  async function skip() {
    show(await apiFetch<GroupView | null>(`/api/groups/${group!.id}/skip`, { method: 'POST' }));
  }
  async function back() {
    const prev = await apiFetch<GroupView | null>(`/api/groups/${group!.id}/previous`);
    if (prev) show(prev);
  }

  return (
    <section>
      <div className="group-header card">
        <strong>
          Grupo {group.position} de {group.total} · Cópias idênticas · {formatBytes(group.bytesFreedSoFar)} liberados até agora
        </strong>
        {group.status === 'stale' && (
          <p className="notice">Este grupo mudou no OneDrive desde a análise. Confira as cópias antes de excluir.</p>
        )}
        {group.status === 'resolved' && <p className="muted">Este grupo já foi resolvido.</p>}
        {group.status === 'skipped' && <p className="muted">Você pulou este grupo.</p>}
      </div>

      {many && commonFields.length > 0 && (
        <div className="card summary-common">
          <h2>Igual em todas as cópias</h2>
          <dl>
            {commonFields.map((k) => (
              <div key={k} style={{ display: 'contents' }}>
                <dt>{FIELD_LABELS[k]}</dt>
                <dd>{fieldValue(group.files[0], k)}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      <p className="legend">Campos em <span className="diff">laranja</span> são diferentes entre as cópias.</p>

      <div className="cards">
        {group.files.map((f) => (
          <FileCard
            key={f.id}
            file={f}
            isSuggested={f.id === group.suggestion.keepId}
            reason={group.suggestion.reason}
            marked={marked.has(f.id)}
            lockDelete={unmarkedCount <= 1}
            onToggle={() => toggle(f.id)}
            diffs={diffs}
            fields={cardFields}
          />
        ))}
      </div>

      <div className="row">
        <button type="button" className="button" onClick={back} disabled={group.position <= 1}>← Voltar</button>
        <button type="button" className="button" onClick={skip}>Pular</button>
        <button
          type="button"
          className="button danger"
          disabled={marked.size === 0 || group.status === 'resolved'}
          onClick={() => navigate('/confirmar', { state: { groupId: group.id, scanId: group.scanId, deleteIds: [...marked] } })}
        >
          Excluir marcadas ({marked.size})
        </button>
      </div>
    </section>
  );
}
```

`apps/web/src/pages/ScanProgress.tsx` (substituir):
```tsx
import type { CloudItem, ScanSummary } from '@twinpix/shared';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, apiFetch } from '../lib/api';
import { formatBytes } from '../lib/format';

const STATUS_TEXT: Record<ScanSummary['status'], string> = {
  running: 'Analisando… (só lendo informações; nada é baixado)',
  paused: 'Análise pausada.',
  'waiting-network': 'Sem conexão. A análise continua sozinha quando a internet voltar.',
  'needs-auth': 'A conexão com o OneDrive expirou.',
  done: 'Análise concluída.',
  error: 'A análise parou por um erro.',
};

export function ScanProgress() {
  const { id } = useParams();
  const [scan, setScan] = useState<ScanSummary | null>(null);
  const [unanalyzed, setUnanalyzed] = useState<CloudItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const s = await apiFetch<ScanSummary>(`/api/scans/${id}`);
        setScan(s);
        if (s.status === 'running' || s.status === 'waiting-network') timer = setTimeout(load, 2000);
      } catch (e) {
        setError((e as ApiError).message);
      }
    };
    void load();
    return () => clearTimeout(timer);
  }, [id]);

  async function act(action: 'pause' | 'resume') {
    setScan(await apiFetch<ScanSummary>(`/api/scans/${id}/${action}`, { method: 'POST' }));
    if (action === 'resume') setTimeout(() => window.location.reload(), 300);
  }

  if (error) return <p className="alert">{error}</p>;
  if (!scan) return <p>Carregando…</p>;
  const pct = scan.foldersTotal ? Math.round((scan.foldersDone / scan.foldersTotal) * 100) : 0;

  return (
    <section className="card">
      <h1>Análise</h1>
      <p>Pastas: {scan.roots.map((r) => r.path).join(', ')}</p>
      <p className={scan.status === 'error' || scan.status === 'needs-auth' ? 'alert' : undefined}>
        {STATUS_TEXT[scan.status]} {scan.error && scan.status === 'error' ? `(${scan.error})` : ''}
      </p>
      <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Progresso da análise">
        <div style={{ width: `${pct}%` }} />
      </div>
      <ul>
        <li>Pastas analisadas: {scan.foldersDone} de {scan.foldersTotal}</li>
        <li>Fotos e vídeos encontrados: {scan.filesFound}</li>
        <li>Grupos de cópias idênticas: {scan.groupsTotal} ({scan.groupsPending} para revisar, {scan.groupsSkipped} pulados)</li>
        <li>Espaço liberado: {formatBytes(scan.bytesFreed)}</li>
        <li>
          Não analisados (o OneDrive não informou a impressão digital do arquivo): {scan.unanalyzedCount}
          {scan.unanalyzedCount > 0 && unanalyzed === null && (
            <button type="button" className="link" onClick={async () => setUnanalyzed(await apiFetch<CloudItem[]>(`/api/scans/${id}/unanalyzed`))}>
              ver lista
            </button>
          )}
        </li>
      </ul>
      {unanalyzed && (
        <ul className="muted">
          {unanalyzed.map((f) => <li key={f.id}>{f.folderPath}/{f.name}</li>)}
        </ul>
      )}
      <div className="row">
        {scan.status === 'running' && <button type="button" className="button" onClick={() => act('pause')}>Pausar</button>}
        {(scan.status === 'paused' || scan.status === 'error' || scan.status === 'needs-auth') && (
          <button type="button" className="button" onClick={() => act('resume')}>Continuar análise</button>
        )}
        {scan.status === 'needs-auth' && <a className="button primary" href="/api/auth/login">Conectar de novo</a>}
        {scan.groupsPending > 0 && (
          <Link className="button primary" to={`/revisao/${scan.id}`}>
            {scan.status === 'done' ? 'Começar a revisão' : 'Começar a revisão enquanto a análise continua'}
          </Link>
        )}
      </div>
    </section>
  );
}
```

Observação: o botão "Continuar análise" aparece também em `needs-auth`, para que dê para
retomar depois de reconectar.

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test -w apps/web && npm run typecheck -w apps/web`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat(web): progresso da análise e revisão com cartões lado a lado"
```

---

### Task 16: Web — confirmação, resultado e histórico com desfazer

**Files:**
- Modify: `apps/web/src/pages/Confirm.tsx`, `apps/web/src/pages/History.tsx` (substituir os provisórios)
- Test: `apps/web/src/pages/Confirm.spec.tsx`, `apps/web/src/pages/History.spec.tsx`

**Interfaces:**
- Consumes: `location.state = { groupId, scanId, deleteIds }` (Task 15); rotas `preview`, `apply`, `history`, `undo` (Task 12).

- [ ] **Step 1: Testes**

`apps/web/src/pages/Confirm.spec.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi } from 'vitest';
import { Confirm } from './Confirm';

const file = (id: string, name: string) => ({
  id, name, folderPath: '/A', size: 1_000_000, quickXorHash: 'h', mimeType: 'image/jpeg', kind: 'photo',
  takenAt: null, createdAt: '2015-01-01T00:00:00Z', modifiedAt: '2015-01-01T00:00:00Z', width: 1, height: 1,
  cameraMake: null, cameraModel: null, durationMs: null, webUrl: '',
});

function renderAt(apply: unknown) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/preview')) {
      return new Response(JSON.stringify({ groupId: 7, deleteFiles: [file('b', 'x 1.jpg')], keepFiles: [file('a', 'x.jpg')], bytes: 1_000_000 }));
    }
    return new Response(JSON.stringify(apply));
  }));
  render(
    <MemoryRouter initialEntries={[{ pathname: '/confirmar', state: { groupId: 7, scanId: 1, deleteIds: ['b'] } }]}>
      <Routes>
        <Route path="/confirmar" element={<Confirm />} />
        <Route path="/revisao/:scanId" element={<p>tela de revisão</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

it('mostra contagem, espaço e listas antes de mover', async () => {
  renderAt({ groupId: 7, stale: false, results: [] });
  expect(await screen.findByText(/1 arquivo vai para a lixeira do OneDrive/)).toBeInTheDocument();
  expect(screen.getByText(/1,0 MB/)).toBeInTheDocument();
  expect(screen.getByText('/A/x 1.jpg')).toBeInTheDocument();
  expect(screen.getByText('/A/x.jpg')).toBeInTheDocument();
});

it('depois de mover mostra o resultado de cada arquivo', async () => {
  renderAt({ groupId: 7, stale: false, results: [{ actionId: 1, fileId: 'b', fileName: 'x 1.jpg', status: 'done', error: null }] });
  await userEvent.click(await screen.findByRole('button', { name: 'Mover para a lixeira' }));
  expect(await screen.findByText('x 1.jpg: movido para a lixeira')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Próximo grupo' }));
  expect(screen.getByText('tela de revisão')).toBeInTheDocument();
});

it('grupo desatualizado: avisa que nada foi movido', async () => {
  renderAt({ groupId: 7, stale: true, results: [] });
  await userEvent.click(await screen.findByRole('button', { name: 'Mover para a lixeira' }));
  expect(await screen.findByText(/Nada foi movido/)).toBeInTheDocument();
});
```

`apps/web/src/pages/History.spec.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { History } from './History';

it('lista o histórico e desfaz', async () => {
  const entry = {
    actionId: 3, groupId: 7, status: 'done', error: null, createdAt: '2026-10-29T10:00:00Z',
    file: { id: 'b', name: 'x 1.jpg', folderPath: '/A', size: 1000 },
  };
  const fetchMock = vi.fn(async (url: string) => {
    if (url.endsWith('/undo')) return new Response(JSON.stringify({ result: 'restored', message: 'Arquivo restaurado para a pasta original.' }));
    return new Response(JSON.stringify([entry]));
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<MemoryRouter><History /></MemoryRouter>);
  expect(await screen.findByText('/A/x 1.jpg')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Desfazer' }));
  expect(await screen.findByText('Arquivo restaurado para a pasta original.')).toBeInTheDocument();
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -w apps/web -- src/pages/Confirm src/pages/History`
Expected: FAIL.

- [ ] **Step 3: Implementação**

`apps/web/src/pages/Confirm.tsx` (substituir):
```tsx
import type { ApplyResult, DeletionPreview } from '@twinpix/shared';
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ApiError, apiFetch } from '../lib/api';
import { formatBytes } from '../lib/format';

interface State { groupId: number; scanId: number; deleteIds: string[] }

const STATUS_TEXT = { done: 'movido para a lixeira', failed: 'não foi movido', pending: 'pendente', undone: 'restaurado' } as const;

export function Confirm() {
  const navigate = useNavigate();
  const state = useLocation().state as State | null;
  const [preview, setPreview] = useState<DeletionPreview | null>(null);
  const [result, setResult] = useState<ApplyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!state) return;
    apiFetch<DeletionPreview>(`/api/groups/${state.groupId}/preview`, { method: 'POST', body: { deleteIds: state.deleteIds } })
      .then(setPreview)
      .catch((e: ApiError) => setError(e.message));
  }, [state]);

  if (!state) return <p className="alert">Nada para confirmar. Volte para a revisão.</p>;
  if (error) return <p className="alert">{error}</p>;
  if (!preview) return <p>Carregando…</p>;

  const nextGroup = () => navigate(`/revisao/${state.scanId}`);

  if (result) {
    return (
      <section className="card">
        <h1>Resultado</h1>
        {result.stale ? (
          <p className="notice">
            Este grupo mudou no OneDrive desde a análise (algum arquivo foi alterado, movido ou apagado). Nada foi movido.
            Revise o grupo de novo antes de excluir.
          </p>
        ) : (
          <ul>
            {result.results.map((r) => (
              <li key={r.actionId} className={r.status === 'failed' ? 'alert' : undefined}>
                {r.fileName}: {STATUS_TEXT[r.status]}{r.error ? ` (${r.error})` : ''}
              </li>
            ))}
          </ul>
        )}
        <p className="muted">Mudou de ideia? Dá para desfazer no Histórico enquanto o arquivo estiver na lixeira.</p>
        <button type="button" className="button primary" onClick={nextGroup}>Próximo grupo</button>
      </section>
    );
  }

  const n = preview.deleteFiles.length;
  return (
    <section className="card">
      <h1>Confirmar</h1>
      <p>
        <strong>{n} {n === 1 ? 'arquivo vai' : 'arquivos vão'} para a lixeira do OneDrive</strong>, liberando {formatBytes(preview.bytes)}.
        Nada é apagado de vez: você pode restaurar pelo Histórico ou pela lixeira do OneDrive.
      </p>
      <h2>Vão para a lixeira</h2>
      <ul>{preview.deleteFiles.map((f) => <li key={f.id}>{f.folderPath === '/' ? '' : f.folderPath}/{f.name}</li>)}</ul>
      <h2>Ficam onde estão</h2>
      <ul>{preview.keepFiles.map((f) => <li key={f.id}>{f.folderPath === '/' ? '' : f.folderPath}/{f.name}</li>)}</ul>
      <div className="row">
        <button type="button" className="button" onClick={() => navigate(-1)}>Voltar</button>
        <button
          type="button"
          className="button danger"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              setResult(await apiFetch<ApplyResult>(`/api/groups/${state.groupId}/apply`, { method: 'POST', body: { deleteIds: state.deleteIds } }));
            } catch (e) {
              setError((e as ApiError).message);
            }
          }}
        >
          Mover para a lixeira
        </button>
      </div>
    </section>
  );
}
```

`apps/web/src/pages/History.tsx` (substituir):
```tsx
import type { HistoryEntry, UndoResponse } from '@twinpix/shared';
import { useEffect, useState } from 'react';
import { ApiError, apiFetch } from '../lib/api';
import { formatBytes, formatDate } from '../lib/format';

const STATUS_TEXT = { done: 'Na lixeira', failed: 'Não foi movido', pending: 'Pendente', undone: 'Restaurado' } as const;

export function History() {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [messages, setMessages] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);

  const load = () => apiFetch<HistoryEntry[]>('/api/history').then(setEntries).catch((e: ApiError) => setError(e.message));
  useEffect(() => { void load(); }, []);

  async function undo(actionId: number) {
    try {
      const r = await apiFetch<UndoResponse>(`/api/actions/${actionId}/undo`, { method: 'POST' });
      setMessages((m) => ({ ...m, [actionId]: r.message }));
      if (r.result === 'restored') {
        setEntries((list) => list?.map((e) => (e.actionId === actionId ? { ...e, status: 'undone' } : e)) ?? null);
      }
    } catch (e) {
      setMessages((m) => ({ ...m, [actionId]: (e as ApiError).message }));
    }
  }

  if (error) return <p className="alert">{error}</p>;
  if (!entries) return <p>Carregando…</p>;

  return (
    <section className="card">
      <h1>Histórico</h1>
      {entries.length === 0 && <p className="muted">Nenhum arquivo foi movido ainda.</p>}
      <table>
        <thead>
          <tr><th>Arquivo</th><th>Tamanho</th><th>Quando</th><th>Situação</th><th /></tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.actionId}>
              <td>{e.file.folderPath === '/' ? '' : e.file.folderPath}/{e.file.name}</td>
              <td>{formatBytes(e.file.size)}</td>
              <td>{formatDate(e.createdAt)}</td>
              <td>{STATUS_TEXT[e.status]}{e.error ? ` (${e.error})` : ''}</td>
              <td>
                {e.status === 'done' && <button type="button" className="button" onClick={() => undo(e.actionId)}>Desfazer</button>}
                {messages[e.actionId] && <p className="muted">{messages[e.actionId]}</p>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
```

- [ ] **Step 4: Rodar tudo**

Run: `npm test && npm run typecheck`
Expected: todas as suítes da API e da web passam.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat(web): confirmação com contagem e espaço, resultado e histórico com desfazer"
```

---

### Task 17: README, verificação final e atualização do handoff

**Files:**
- Modify: `README.md`, `docs/HANDOFF.md`

- [ ] **Step 1: README completo**

Substituir `README.md` por:
```markdown
# TwinPix Cloud

Encontra fotos e vídeos repetidos no **OneDrive** e deixa você revisar **um grupo por vez,
lado a lado**, movendo para a lixeira só o que escolher.

- Compara várias pastas (e todas as subpastas) de uma vez.
- Nada é baixado: a análise usa só as informações dos arquivos.
- Nada é apagado de vez: tudo vai para a **lixeira do OneDrive**, e dá para desfazer.
- Nunca deixa excluir todas as cópias de um grupo.

> Versão atual: cópias **idênticas**. Prováveis cópias e reconciliação de pastas vêm a seguir.

## Experimentar sem conectar (modo demonstração)

Requer Node 22 ou mais novo.

    npm install
    npm run demo

O navegador abre com arquivos fictícios. Nada acontece no seu OneDrive.

## Usar com o seu OneDrive

1. Acesse https://entra.microsoft.com com a sua conta Microsoft.
   Com conta pessoal, pode ser preciso criar um diretório (gratuito) antes.
2. Vá em **Registros de aplicativo → Novo registro**:
   - Nome: `TwinPix Cloud` (ou o que quiser);
   - Tipos de conta: **Somente contas pessoais da Microsoft**;
   - URI de redirecionamento: plataforma **Cliente público/nativo (móvel e área de trabalho)**,
     endereço `http://localhost:4317/api/auth/callback`.
3. Em **Permissões de API → Adicionar permissão → Microsoft Graph → Permissões delegadas**,
   marque `Files.ReadWrite` e `offline_access`.
4. Copie o **ID do aplicativo (cliente)**.
5. Na pasta do projeto, copie `.env.example` para `.env` e preencha `TWINPIX_CLIENT_ID=`.
6. Rode:

       npm install
       npm run build
       npm start

O endereço com o token de sessão aparece no terminal e o navegador abre sozinho.

## Desenvolvimento

    npm run dev        # API em 127.0.0.1:4317 e interface em http://localhost:5173
    npm test           # testes da API e da interface
    npm run typecheck

Em modo dev, abra `http://localhost:5173/#token=dev-local`.

## Como criar o seu provedor

O app fala com a nuvem só pela interface `CloudProvider`
(`apps/api/src/cloud/cloud-provider.ts`). Para outra nuvem, implemente essa interface
(veja `onedrive/onedrive-provider.ts` e `fake-cloud-provider.ts` como exemplos) e registre a
implementação em `apps/api/src/cloud/cloud.module.ts`.

## Segurança

- O servidor escuta só em `127.0.0.1` e exige um token de sessão em toda chamada.
- O token da Microsoft fica em `~/.twinpix-cloud/msal-cache.json`, legível só pelo seu usuário.
- Nenhum segredo vai para o repositório: o Client ID fica no `.env`.

## Licença e contribuições

MIT. Este projeto **não aceita pull requests**; faça um fork se quiser adaptar. Veja `CONTRIBUTING.md`.
```

- [ ] **Step 2: Verificação completa**

Run:
```bash
npm test && npm run typecheck && npm run build
```
Expected: tudo passa.

Run (demo de ponta a ponta pela API real compilada):
```bash
DIR=$(mktemp -d)
TWINPIX_NO_BROWSER=1 TWINPIX_SESSION_TOKEN=t TWINPIX_DATA_DIR=$DIR node apps/api/dist/main.js --demo > $DIR/log.txt 2>&1 &
PID=$!
sleep 3
H='X-TwinPix-Token: t'
curl -s -o /dev/null -w 'index: %{http_code}\n' http://127.0.0.1:4317/
ROOTS=$(curl -s -H "$H" http://127.0.0.1:4317/api/folders/root/children)
curl -s -H "$H" -H 'Content-Type: application/json' -d "{\"roots\":$ROOTS}" http://127.0.0.1:4317/api/scans
sleep 2
curl -s -H "$H" http://127.0.0.1:4317/api/scans/latest
kill $PID
```
Expected: `index: 200`; o resumo final com `"status":"done"` e `groupsTotal` ≥ 10.

- [ ] **Step 3: Handoff**

Atualizar `docs/HANDOFF.md`: estado (plano 1 implementado, o que foi verificado e como),
próximos passos (registro no Entra e primeiro teste real numa **pasta de teste combinada**;
Plano 2 — prováveis cópias e lote), e qualquer desvio do plano registrado pelos implementadores.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/HANDOFF.md
git commit -m "docs: README com modo demonstração e registro no Entra; handoff atualizado"
```
