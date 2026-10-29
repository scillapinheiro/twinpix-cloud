# Plano 2 — Lote das idênticas e atalhos de teclado

> **Escopo fechado em 29/10/2026 (com a autora):** depois da Task 8, ideias novas vão para a lista
> "Depois" do `docs/HANDOFF.md`, não para este plano.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir resolver centenas de grupos de cópias idênticas de uma vez, com uma prévia
agrupada por par de pastas, execução segura em segundo plano e "desfazer este lote"; e acelerar
a revisão um por um com atalhos de teclado.

**Architecture:** O lote reaproveita o caminho seguro existente: cada grupo do lote passa por
`ActionsService.apply` (trava global, conferência dos dois lados, diário, refresh de grupo
mudado). Um módulo novo `apps/api/src/batch/` monta a prévia (função pura `buildBatchLines`) e
executa o lote num laço em segundo plano, persistido em SQLite (`batches`, `batch_groups`) para
retomar após reinício. A interface ganha a página `/lote/:scanId`, uma seção de lotes no
Histórico e atalhos na revisão.

**Tech Stack:** o mesmo do Plano 1 (NestJS 11, better-sqlite3, React 19, Vitest, Testing Library).

**Spec:** `docs/superpowers/specs/2026-10-29-twinpix-cloud-design.md` — §6 "Lote das idênticas".

**Nota de formato:** diferente do Plano 1, as tarefas trazem interfaces, SQL, regras e casos de
teste exatos, mas não o código completo: o código existente já estabelece os padrões (ver os
arquivos citados em cada tarefa) e os implementadores do Plano 1 trabalharam bem a partir de
requisitos assim nas tarefas 18-20.

## Global Constraints

- Todas as constraints do Plano 1 continuam valendo (pt-BR com rótulos explícitos, testes nunca
  chamam o OneDrive real, 127.0.0.1 + token de sessão, commits sem `Co-Authored-By`, nunca ler o `.env`).
- **Só cópias idênticas entram em lote.** (Hoje todos os grupos são idênticos; o filtro por
  `kind = 'identical'` já deve existir no código do lote para quando houver prováveis cópias.)
- **Cada grupo do lote passa por `ActionsService.apply`** — nunca mover arquivos por outro caminho.
  Nunca é possível excluir todas as cópias; conferência dos dois lados; tudo vai para a lixeira.
- **Grupos sem regra clara** (`suggestion.fallback === true`) **nunca entram em lote.**
- **Grupo que mudou desde a prévia** (outra linha, regra de empate, arquivos diferentes) é
  **pulado** e continua pendente para a revisão um por um.
- Banco existente da autora (`~/.twinpix-cloud/twinpix.sqlite`) precisa continuar abrindo:
  mudanças de esquema com **migração** idempotente.

## Estrutura de arquivos

```
apps/api/src/storage/schema.ts        + tabelas batches, batch_groups
apps/api/src/storage/db.ts            + migração (actions.batch_id)
apps/api/src/rules/suggest-keep.ts    Suggestion.fallback
apps/api/src/actions/actions.service.ts  apply(..., { batchId }) ; history com batchId
apps/api/src/batch/batch-lines.ts     função pura buildBatchLines
apps/api/src/batch/batch.service.ts   prévia, início, laço, pausar/continuar, retomar, desfazer
apps/api/src/batch/batch.controller.ts
apps/api/src/batch/batch.module.ts
packages/shared/index.d.ts            tipos novos
apps/web/src/pages/Batch.tsx          página do lote
apps/web/src/components/BatchConfirmDialog.tsx
apps/web/src/pages/History.tsx        seção "Lotes"
apps/web/src/pages/Review.tsx, ScanProgress.tsx, components/ConfirmDialog.tsx  atalhos e entradas
```

---

### Task 1: Base — sugestão com `fallback`, migração do banco e `batchId` nas ações

**Files:** `packages/shared/index.d.ts`, `apps/api/src/rules/suggest-keep.ts` (+spec),
`apps/api/src/storage/schema.ts`, `apps/api/src/storage/db.ts` (+spec),
`apps/api/src/actions/actions.service.ts` (+spec), `apps/web` (onde `Suggestion` for montado em testes).

**Interfaces (Produces):**
- `Suggestion { keepId: string; reason: string; fallback: boolean }` — `fallback` é `true` só quando
  a escolha caiu na ordem alfabética (`regra: primeira em ordem alfabética`).
- `HistoryEntry` ganha `batchId: number | null`.
- Tipos novos em `@twinpix/shared`:
  ```ts
  export interface BatchItem { groupId: number; keep: { name: string; folderPath: string };
    remove: Array<{ id: string; name: string; folderPath: string; size: number }> }
  export interface BatchLine { key: string; keepFolder: string; removeFolders: string[];
    reasons: string[]; groupCount: number; fileCount: number; bytes: number; items: BatchItem[] }
  export interface BatchPreview { scanId: number; lines: BatchLine[]; tiesCount: number; pendingCount: number }
  export type BatchStatus = 'running' | 'paused' | 'waiting-network' | 'needs-auth' | 'done' | 'undoing' | 'undone' | 'error';
  export interface BatchSummary { id: number; scanId: number; status: BatchStatus; createdAt: string;
    totalGroups: number; doneGroups: number; skippedGroups: number; movedFiles: number; movedBytes: number;
    failedFiles: number; restoredFiles: number; notRestoredFiles: number; error: string | null }
  ```
- `ActionsService.apply(groupId: number, deleteIds: string[], opts?: { batchId?: number }): Promise<ApplyResult>`
  grava `batch_id` nas ações.

**SQL (schema.ts, `CREATE TABLE IF NOT EXISTS`):**
```sql
CREATE TABLE IF NOT EXISTS batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_id INTEGER NOT NULL REFERENCES scans(id),
  created_at TEXT NOT NULL,
  status TEXT NOT NULL,
  error TEXT
);
CREATE TABLE IF NOT EXISTS batch_groups (
  batch_id INTEGER NOT NULL REFERENCES batches(id),
  group_id INTEGER NOT NULL REFERENCES dup_groups(id),
  line_key TEXT NOT NULL,
  seq INTEGER NOT NULL,
  status TEXT NOT NULL,          -- pending | done | skipped
  PRIMARY KEY (batch_id, group_id)
);
```
**Migração (db.ts, depois do `exec(SCHEMA)`):** se `PRAGMA table_info(actions)` não tiver
`batch_id`, `ALTER TABLE actions ADD COLUMN batch_id INTEGER REFERENCES batches(id)`.

**Testes:**
- `suggestKeep`: `fallback` false quando uma regra decide; true no empate total.
- `Db`: abrir um banco **criado com o esquema antigo** (crie a tabela `actions` sem `batch_id` num
  arquivo temporário antes) migra e abre de novo sem erro; `batches`/`batch_groups` existem.
- `ActionsService.apply(..., { batchId })` grava `batch_id`; `history()` devolve `batchId`
  (null quando não é lote).
- Testes da web que constroem `Suggestion` ganham `fallback: false`.

Commit: `feat: base do lote (sugestão com empate, migração do banco e lote nas ações)`.

---

### Task 2: Prévia do lote — função pura `buildBatchLines`

**Files:** `apps/api/src/batch/batch-lines.ts` (+spec).

**Interfaces:**
```ts
export interface BatchGroupInput { groupId: number; kind: 'identical'; files: CloudItem[]; suggestion: Suggestion }
export function lineKeyOf(keepFolder: string, removeFolders: string[]): string // JSON.stringify([keep, [...removeFolders].sort()])
export function buildBatchLines(groups: BatchGroupInput[]): { lines: BatchLine[]; tiesCount: number }
```
**Regras:**
- Ignora grupos com `kind !== 'identical'` e com menos de 2 arquivos.
- `suggestion.fallback` → conta em `tiesCount`, fica fora das linhas.
- Para cada grupo: `keep` = arquivo `suggestion.keepId`; `remove` = os outros; `keepFolder` =
  `keep.folderPath`; `removeFolders` = pastas distintas dos removidos, ordenadas.
- Agrupa por `lineKeyOf`. `reasons` = motivos distintos (sem o prefixo `regra: `), ordenados.
  `fileCount` = total de removidos; `bytes` = soma dos tamanhos removidos; `items` em ordem de groupId.
- Linhas ordenadas por `bytes` desc, depois `groupCount` desc, depois `key`.
- Função pura, sem I/O. **Invariante:** em todo item, `keep` nunca está em `remove` e `remove`
  nunca contém todos os arquivos do grupo.

**Testes:** pastas diferentes com nomes diferentes formam linhas distintas; dois grupos com mesmo
par de pastas formam uma linha com contagens/bytes somados; grupo com cópias em 2 pastas de saída
gera `removeFolders` com as duas; empate → `tiesCount`; ordenação; **propriedade (fast-check)**:
para grupos gerados aleatoriamente, todo item mantém exatamente o `keepId` e remove só os outros.

Commit: `feat: prévia do lote agrupada por par de pastas`.

---

### Task 3: `BatchService` — prévia, execução segura em segundo plano, pausar/continuar, desfazer

**Files:** `apps/api/src/batch/batch.service.ts`, `batch.controller.ts`, `batch.module.ts` (+spec),
`apps/api/src/app.module.ts` (importar `BatchModule`). Consome `ReviewService.view`/`activeFileIds`,
`ActionsService.apply/undo`, `buildBatchLines`, `CloudProvider` só indiretamente (via ActionsService).

**Comportamento:**
- `preview(scanId): BatchPreview` — grupos da análise com `status = 'pending'` e `kind = 'identical'`;
  para cada um, `ReviewService.view(id)` dá `files` e `suggestion`; `buildBatchLines`.
  `pendingCount` = nº de grupos pendentes considerados. Varredura em andamento (`running`,
  `waiting-network`) → `BadRequestException('Espere a análise terminar para revisar em lote.')`.
- `start(scanId, lineKeys: string[]): BatchSummary` — recalcula a prévia; seleciona os grupos das
  linhas pedidas (chaves desconhecidas → 400 `'A prévia mudou. Abra o lote de novo.'`; lista vazia →
  400 `'Escolha pelo menos uma linha.'`); cria `batches` (status `running`) e `batch_groups`
  (`seq` em ordem das linhas e dos itens, `status = 'pending'`); dispara o laço sem aguardar.
  Só um lote rodando por vez no app: se houver outro `running/waiting-network/undoing` → 400
  `'Já existe um lote em andamento.'`.
- **Laço** (um grupo por vez, na ordem `seq`):
  1. pausa pedida → status `paused`, sai.
  2. Recalcula o grupo (`view`): se `fallback`, ou a chave da linha (`lineKeyOf`) mudou, ou o grupo
     não está mais `pending` → `batch_groups.status = 'skipped'`.
  3. Senão `ActionsService.apply(groupId, view.preMarkedIds, { batchId })`. `stale: true` → `skipped`.
     Caso contrário → `done` (as contagens de arquivos movidos/falhos vêm das ações).
  4. `OfflineError` → status `waiting-network`, espera `offlineRetryMs` (injetável, 0 nos testes),
     volta `running` e repete o **mesmo** grupo. `ReconnectRequiredError` → `needs-auth`, sai.
     Outro erro num grupo → registra em `batches.error`, marca o grupo `skipped` e segue.
  5. Fim → `done`.
- `summary(batchId): BatchSummary` — contagens:
  `totalGroups`, `doneGroups` (status done), `skippedGroups`, `movedFiles`/`movedBytes`
  (ações `done` do lote, somando `files.size`), `failedFiles` (ações `failed`),
  `restoredFiles` (ações `undone`), `notRestoredFiles` (contador gravado pelo desfazer).
  Para `notRestoredFiles`, acrescente a coluna `not_restored INTEGER NOT NULL DEFAULT 0` em `batches`
  (no `CREATE TABLE` e na migração da Task 1, se já tiver sido feita — ajuste a migração para criar a
  coluna se faltar).
- `list(): BatchSummary[]` (mais recente primeiro).
- `pause(id)`, `resume(id)` (relança o laço; também vale para `needs-auth` e `paused`),
  `onModuleInit()` relança lotes `running`/`waiting-network` e desfazeres `undoing`.
- `undo(id)`: só para lote `done`/`paused`/`error` (senão 400). Status `undoing`; em segundo plano,
  para cada ação `done` do lote (mais recente primeiro) chama `ActionsService.undo(actionId)`;
  `restored` conta em `restoredFiles`; outros resultados somam `not_restored`. Fim → `undone`.
  `OfflineError` → espera e repete como no laço.
- `whenIdle(id)` para testes.

**Rotas** (todas sob o token de sessão): `GET /api/scans/:id/batch` → `BatchPreview`;
`POST /api/scans/:id/batch` `{ lineKeys }` → `BatchSummary`; `GET /api/batches` → `BatchSummary[]`;
`GET /api/batches/:id`; `POST /api/batches/:id/pause|resume|undo` → `BatchSummary`.

**Testes (FakeCloudProvider + Db em memória):**
- prévia: 2 pares de pastas → 2 linhas; empate fora; análise rodando → 400.
- execução: move todas as cópias marcadas das linhas escolhidas e **mantém exatamente a sugerida**
  em cada grupo; linhas não escolhidas ficam intocadas; `summary` com contagens certas;
  histórico com `batchId`.
- grupo alterado no OneDrive entre a prévia e a execução → `skipped`, nada movido nele, continua pendente.
- grupo que virou empate entre a prévia e a execução (mude as regras via `setRules`) → `skipped`.
- sem internet no meio (`failNext('getItem', new OfflineError(), 2)`) → espera e termina `done`.
- pausar e continuar; reinício (`onModuleInit` numa instância nova) termina o lote.
- só um lote por vez; chaves desconhecidas → 400.
- desfazer o lote restaura todos os arquivos (`restoredFiles` = movidos) e os grupos voltam a pendente;
  arquivo que saiu da lixeira conta em `notRestoredFiles`.
- **Segurança:** em nenhum cenário acima um grupo fica sem cópia fora da lixeira (asserção explícita
  percorrendo os grupos no fim de cada teste).

Commit: `feat: lote das idênticas em segundo plano com pausar, retomar e desfazer`.

---

### Task 4: Página do lote

**Files:** `apps/web/src/pages/Batch.tsx` (+spec), `apps/web/src/components/BatchConfirmDialog.tsx`,
`apps/web/src/App.tsx` (rota `/lote/:scanId`), `apps/web/src/pages/ScanProgress.tsx` e
`apps/web/src/pages/Review.tsx` (entradas), `apps/web/src/styles.css`.

**Comportamento:**
- Entrada: em `ScanProgress`, quando `status === 'done'` e `groupsPending > 0`, botão secundário
  **"Revisar em lote"** ao lado de "Começar a revisão". Na revisão, link discreto "Revisar em lote"
  no cabeçalho do grupo.
- Prévia (`GET /api/scans/:id/batch`):
  - Título "Revisar em lote" e explicação curta: "Só cópias idênticas. Em cada grupo, fica a cópia
    sugerida pela regra; as outras vão para a lixeira do OneDrive. Dá para desfazer pelo Histórico."
  - Uma linha por par de pastas, **marcada por padrão**, em linguagem simples:
    "**140 grupos** · fica em **Viagem Praia** · sai de **Backup celular 2015** · 1,2 GB" e
    "regra: …" (se várias, lista curta). Botão "ver lista" expande os itens
    ("fica: /Viagem Praia/foto.jpg · sai: /Backup celular 2015/foto.jpg").
  - Aviso quando `tiesCount > 0`: "N grupos sem regra clara ficam para a revisão um por um."
  - Rodapé fixo (mesmo estilo da barra da revisão) com o total das linhas marcadas e o botão
    vermelho **"Mover para a lixeira (N arquivos)"** (desabilitado com 0).
  - Sem linhas: "Não há grupos para o lote." + botão para a revisão um por um.
- Confirmação em modal (mesmo padrão de `ConfirmDialog`: role dialog, Esc, foco, `inert` no fundo):
  "N arquivos de G grupos vão para a lixeira do OneDrive, liberando X. Em cada grupo fica a cópia
  sugerida. Nada é apagado de vez." Botões "Voltar" e "Mover para a lixeira" (proteção contra clique
  duplo; erro inline com nova tentativa).
- Progresso (após `POST`), na própria página, consultando `GET /api/batches/:id` a cada 1 s:
  barra (grupos feitos/total), "N arquivos movidos · X liberados", textos por status
  (`waiting-network`: "Sem conexão. Continua sozinho quando a internet voltar.";
  `needs-auth`: botão "Conectar de novo"; `paused`: "Continuar"), botão "Pausar".
  Ao terminar: resumo (movidos, pulados → "voltam para a revisão um por um", falhas), botões
  **"Revisão um por um"** (se ainda houver pendentes), **"Ver histórico"** e **"Desfazer este lote"**
  (pede confirmação simples no próprio botão: 1º clique vira "Confirmar desfazer").
- Tudo em pt-BR, rótulos explícitos.

**Testes:** prévia renderiza linhas marcadas e o aviso de empate; desmarcar uma linha atualiza o
total e o botão; "ver lista" mostra os caminhos; modal confirma e chama `POST` com as `lineKeys`
marcadas (uma vez só com clique duplo); progresso mostra status e resumo final; "Desfazer este lote"
pede confirmação e chama a rota; `ScanProgress` mostra "Revisar em lote" só com análise concluída
e pendentes.

Commit: `feat(web): página do lote com prévia por par de pastas, confirmação e progresso`.

---

### Task 5: Lotes no Histórico

**Files:** `apps/web/src/pages/History.tsx` (+spec).

**Comportamento:** acima da tabela, seção "Lotes" (só se houver) com `GET /api/batches`: data,
status em português, "N arquivos movidos · X", restaurados, e botão "Desfazer este lote" (com a mesma
confirmação em dois cliques) para lotes `done`/`paused`/`error`; durante `undoing` mostra progresso
(consulta a cada 1 s). Na tabela, entradas com `batchId` exibem "lote #N" ao lado da data.

**Testes:** seção aparece com lotes; desfazer lote chama a rota após confirmar; rótulo "lote #N".

Commit: `feat(web): lotes no histórico com desfazer lote`.

---

### Task 6: Atalhos de teclado na revisão

**Files:** `apps/web/src/pages/Review.tsx`, `apps/web/src/components/ConfirmDialog.tsx` (+specs),
`apps/web/src/styles.css`.

**Comportamento:**
- Na revisão (modal fechado): **Enter** abre a confirmação (se houver marcadas); **P** = Pular;
  **←** = Voltar (se habilitado). Ignorar quando o foco está em `input`, `textarea`, `select`,
  `[contenteditable]` ou com Ctrl/Alt/Meta pressionado, ou se o evento já foi tratado.
- No modal: **Enter** = "Mover para a lixeira" (antes do envio, se não estiver ocupado);
  depois do resultado, Enter = "Próximo grupo" (ou "Conferir o grupo atualizado"); **Esc** fecha
  antes do envio (já existe).
- Dicas visíveis e discretas nos botões: "Pular (P)", "← Voltar", "Excluir marcadas (Enter)",
  "Mover para a lixeira (Enter)". Legenda curta na faixa: "Atalhos: Enter confirma · P pula · ← volta".

**Testes:** Enter abre o modal e Enter de novo confirma (POST apply uma vez); P pula (POST skip);
← volta; teclas ignoradas com foco num input; Enter não faz nada com 0 marcadas.

Commit: `feat(web): atalhos de teclado na revisão (Enter, P, ←)`.

---

### Task 8: "Inverter" — escolher em qual pasta a cópia fica, por linha do lote

*(Pedido da autora em 29/10/2026: a regra olha o arquivo, não a organização das pastas; às vezes a
cópia sugerida está "solta" e a que sairia está numa pasta organizada.)*

**Files:** `packages/shared/index.d.ts`, `apps/api/src/batch/batch-lines.ts` (+spec),
`apps/api/src/batch/batch.service.ts`/`batch.controller.ts` (+spec), `apps/api/src/storage/schema.ts`
e `db.ts` (migração), `apps/web/src/pages/Batch.tsx`, `components/BatchConfirmDialog.tsx` (+spec).

**Interfaces:**
- `BatchLine.keepOptions: string[]` = `[keepFolder, ...removeFolders]` (todas as pastas onde cada
  grupo da linha tem cópia — por construção da linha, todo grupo tem cópia em cada uma delas).
- `POST /api/scans/:id/batch` aceita `{ lineKeys: string[]; keepFolders?: Record<string, string> }`
  (chave da linha → pasta escolhida). Pasta fora de `keepOptions` da linha → 400
  `'Pasta escolhida inválida. Abra o lote de novo.'`. Sem entrada = pasta sugerida.
- `batch_groups.keep_folder TEXT NULL` (no CREATE e na migração idempotente).

**Execução (BatchService):** igual à atual, exceto quando o grupo tem `keep_folder`:
- continua exigindo que a chave natural da linha (`lineKeyOf` da sugestão atual) seja a gravada
  e que não haja empate — a composição do grupo não pode ter mudado;
- `candidatos` = arquivos ativos do grupo cuja pasta é `keep_folder`; nenhum → `skipped`;
- a cópia que fica = `suggestKeep(candidatos, regras).keepId` (desempate dentro da pasta escolhida);
- `deleteIds` = todos os outros arquivos ativos; o `expect` dentro da trava confere de novo
  (mesma chave natural, mesma cópia escolhida ainda presente); sempre via `ActionsService.apply`.

**Interface (Batch.tsx):**
- Em cada linha: se `removeFolders.length === 1`, botão **"⇄ Inverter: manter em <pasta>"**
  (e, invertida, "⇄ Voltar à sugestão: manter em <pasta>"); se houver mais pastas, um seletor
  rotulado **"Manter em:"** com as `keepOptions`.
- A linha mostra o resultado escolhido: "fica em X · sai de Y, Z" e um selo discreto
  "escolhido por você" quando diferente da sugestão; o "ver lista" mostra os arquivos já na
  escolha atual (fica = a cópia na pasta escolhida).
- O modal de confirmação mostra, para linhas alteradas, "fica em <pasta escolhida>".
- O POST envia `keepFolders` só das linhas marcadas e alteradas.

**Conferir as fotos na prévia** *(pedido da autora ao testar: nomes diferentes nas duas cópias e
sem como ver as fotos)*:
- `BatchItem.keep` e cada item de `remove` ganham `id` e `webUrl`.
- No "ver lista", cada arquivo aparece com **miniatura pequena** (componente `Thumbnail` existente,
  carregada só quando a lista é aberta), o caminho completo e o link **"Abrir no OneDrive ↗"**.
- Cada arquivo mostra também **Tirada em**, **Modificada em** e **Tamanho**, numa linha compacta;
  os dados que **diferem entre as cópias do grupo ficam em laranja** (mesma regra de
  `differingFields` da revisão um por um); a cópia que fica vem com ★. Para isso, `keep` e `remove`
  em `BatchItem` passam a ser `CloudItem` completos (ou incluir `takenAt`, `createdAt`,
  `modifiedAt`, `size`, `webUrl`, `id`).
- Uma frase explica: "São cópias idênticas: o conteúdo é o mesmo byte a byte, mesmo quando o nome
  do arquivo é diferente."
- Em listas longas, mostrar os primeiros 20 itens e um botão "mostrar mais" (para não carregar
  centenas de miniaturas de uma vez).

**Testes:** `keepOptions` na prévia; API recusa pasta inválida; "ver lista" mostra miniatura e
link "Abrir no OneDrive" de cada arquivo e o "mostrar mais"; lote com uma linha invertida move
as cópias da pasta sugerida e mantém a da pasta escolhida (e a asserção de segurança "todo grupo
mantém uma cópia" continua); grupo que mudou de composição é pulado também com inversão; interface:
inverter troca o texto e o "ver lista", e o POST leva `keepFolders`.

Commit: `feat: lote permite escolher em qual pasta a cópia fica (inverter)`.

---

### Task 7: Teste de ponta a ponta do lote, README e handoff

**Files:** `apps/api/src/app.e2e.spec.ts` (novo caso), `README.md`, `docs/HANDOFF.md` (o controlador
atualiza o handoff — o implementador só faz e2e e README).

- e2e (modo demonstração): análise das duas pastas → `GET /api/scans/:id/batch` com ≥ 2 linhas →
  `POST` com todas (uma delas invertida via `keepFolders`) → aguarda `done` → todos os grupos não-empate resolvidos e **cada grupo mantém
  uma cópia** → `POST /api/batches/:id/undo` → aguarda `undone` → `restoredFiles === movedFiles`.
- README: **não mexer** (decisão da autora em 29/10: o README será reescrito uma única vez no fim
  da v1, no padrão dos projetos dela, depois de tudo mergeado e das branches limpas).
- Verificação: `npm test && npm run typecheck && npm run build` e smoke da demo (PORT=4400, nunca a
  4317) passando pelo lote via API.

Commit: `test: lote de ponta a ponta na demo`.
