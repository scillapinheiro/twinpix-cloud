# Plano 3 — Reconciliação de pastas

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Encontrar pastas com conteúdo repetido (pares ou conjuntos, **independentemente do nome**),
mostrar em linguagem simples o que está nas duas e o que só existe em uma, e deixar a usuária
escolher em qual pasta manter as cópias repetidas — movendo as outras para a lixeira com as mesmas
proteções do lote, **sem nunca tocar arquivos únicos**.

**Architecture:** Função pura `findFolderClusters` agrupa pastas a partir dos grupos de idênticas;
função pura `planReconcile` monta, para uma pasta escolhida, a lista exata (grupo → cópia que fica →
cópias que saem). A execução **reaproveita o lote** (`BatchService`, `batches`/`batch_groups`,
`ActionsService.apply` com reconferência dentro da trava, pausar/continuar, desfazer, histórico): um
lote de `kind = 'folders'` grava, por grupo, a cópia que fica **e as cópias que saem**. A interface
ganha a página "Pastas repetidas" (um conjunto por tela, como nos esboços aprovados).

**Tech Stack:** igual aos planos anteriores.

**Spec:** `docs/superpowers/specs/2026-10-29-twinpix-cloud-design.md` — §4 (`grouping`), §5 passo 4
("Pastas repetidas"), §6 proteção 4, §7 "Reconciliação de pastas". Esboços aprovados:
`.superpowers/brainstorm/*/content/reconciliacao.html` e `tres-copias-e-pastas.html` (parte 2).

**Formato:** como no Plano 2 — interfaces, regras e casos de teste exatos; o código segue os
padrões existentes.

## Global Constraints

- Todas as constraints dos Planos 1 e 2 continuam valendo (pt-BR, rótulos explícitos, testes nunca
  chamam o OneDrive real, commits sem `Co-Authored-By`, nunca ler `.env`, nunca usar a porta 4317).
- **Arquivos que só existem em uma pasta do conjunto nunca são tocados.** Só saem cópias de grupos
  de **idênticas** que têm cópia **na pasta escolhida**, e só as cópias localizadas **nas outras
  pastas do conjunto** (cópias fora do conjunto e cópias extras dentro da pasta escolhida ficam).
- Toda remoção passa por `ActionsService.apply` (trava, conferência dos dois lados, reconferência
  dentro da trava). Nunca é possível excluir todas as cópias de um grupo.
- O que é executado é **exatamente o plano que a usuária viu** (mesmo padrão do `keeps` do lote):
  o navegador envia os itens vistos; se o plano recalculado for diferente → 400
  `'A prévia mudou. Abra as pastas repetidas de novo.'`.
- Pastas são comparadas pelo caminho exato da pasta que contém o arquivo (`folderPath`), sem
  recursão: subpastas são pastas diferentes.

## Definições (valem para todas as tarefas)

- **Arquivos de uma pasta**: arquivos ativos da análise (sem ação `done`/`pending`) com aquele
  `folderPath`, de qualquer tipo (inclusive sem hash).
- **Em comum entre A e B**: nº de grupos de idênticas (`status` diferente de `resolved`) com pelo
  menos uma cópia ativa em A **e** em B.
- **Par candidato**: em comum ≥ 2 **e** em comum ≥ 50% dos arquivos da menor das duas pastas.
- **Conjunto**: componente conexo dos pares candidatos (união de pares que compartilham pasta).
  Chave estável: `JSON.stringify(pastas ordenadas)`.
- **Só nesta pasta** (de uma pasta P no conjunto): arquivos de P sem cópia idêntica em **nenhuma
  outra pasta do conjunto** (inclui arquivos sem hash).
- **Situação** de cada pasta: `complete` ("Mais completa", a de mais arquivos — empate: a primeira
  pela ordem de sugestão), `contained` ("Toda contida na <pasta>": 0 arquivos só nela e todos os seus
  arquivos têm cópia numa única outra pasta do conjunto), `partial` ("Parcial: N em comum com a
  mais completa").
- **Sugerida para manter**: mais arquivos; empate → mais arquivos só nela; empate → caminho mais
  profundo (mais segmentos, ex.: pasta organizada); empate → ordem alfabética.

---

### Task 1: Funções puras — conjuntos de pastas e plano de reconciliação

**Files:** `apps/api/src/folders/folder-clusters.ts`, `apps/api/src/folders/reconcile-plan.ts` (+specs),
`packages/shared/index.d.ts`.

**Tipos (shared):**
```ts
export interface FolderStat { path: string; fileCount: number; bytes: number; uniqueCount: number;
  situation: 'complete' | 'contained' | 'partial'; containedIn: string | null; commonWithComplete: number }
export interface FolderCluster { key: string; folders: FolderStat[]; suggestedKeep: string;
  repeatedFiles: number; uniqueFiles: number; groupCount: number }
export interface ReconcileItem { groupId: number; keepId: string; deleteIds: string[] }
export interface ReconcilePlan { clusterKey: string; keepFolder: string; items: ReconcileItem[];
  deleteFiles: CloudItem[]; bytes: number; remaining: Array<{ path: string; fileCount: number }> }
```
**Funções:**
```ts
// files: arquivos ativos da análise; groups: grupos de idênticas não resolvidos com ids ativos
export function findFolderClusters(files: CloudItem[], groups: Array<{ groupId: number; fileIds: string[] }>): FolderCluster[]
export function uniqueFilesOf(cluster: FolderCluster, folder: string, files: CloudItem[], groups: ...): CloudItem[]
export function planReconcile(cluster: FolderCluster, keepFolder: string, files: CloudItem[],
  groups: Array<{ groupId: number; fileIds: string[] }>, pickKeep: (candidates: CloudItem[]) => string): ReconcilePlan
```
- `findFolderClusters` segue as Definições; ordena conjuntos por bytes liberáveis estimados (soma
  dos tamanhos das cópias que sairiam mantendo na sugerida) desc, depois chave.
- `planReconcile`: para cada grupo com cópia na `keepFolder` e cópias em outras pastas do conjunto:
  `keepId = pickKeep(cópias na keepFolder)`; `deleteIds` = cópias nas **outras pastas do conjunto**.
  Grupos sem cópia na `keepFolder` ficam fora. `remaining` = quantos arquivos restam em cada pasta.
  `keepFolder` fora do conjunto → lança erro.

**Testes:** par de pastas com nomes diferentes vira conjunto; pastas com só 1 em comum não; 50%
respeitado; 3 pastas conectadas viram um conjunto; situações `contained`/`partial`/`complete` e
"só nesta pasta" (inclui arquivo sem hash); sugestão com desempates; plano não inclui cópias fora
do conjunto nem cópias extras na pasta escolhida; `remaining` correto (a 2ª fica vazia no caso
contido). **Propriedade (fast-check):** para conjuntos/arquivos gerados, nenhum `deleteIds` contém
arquivo "só nesta pasta", nenhum contém o `keepId`, toda cópia removida está numa pasta do conjunto
diferente da escolhida, e todo grupo do plano mantém ≥ 1 cópia.

Commit: `feat: encontra pastas com conteúdo repetido e monta o plano de reconciliação`.

---

### Task 2: Lote de pastas — cópias que saem gravadas por grupo

**Files:** `apps/api/src/storage/schema.ts`, `db.ts` (+spec), `apps/api/src/batch/batch.service.ts`
(+spec), `packages/shared/index.d.ts`.

- Migração idempotente: `batches.kind TEXT NOT NULL DEFAULT 'lines'` e
  `batch_groups.delete_ids TEXT NULL` (JSON de ids).
- `BatchSummary.kind: 'lines' | 'folders'`; `HistoryEntry`/lista de lotes mostram o tipo.
- `BatchService.startFolders(scanId, plan: ReconcilePlan, sentItems: ReconcileItem[]): BatchSummary`
  (chamado pela Task 3): exige análise concluída e nenhum lote ativo; compara `sentItems` com
  `plan.items` (mesmos grupos, mesmo `keepId`, mesmo conjunto de `deleteIds`) → senão 400
  `'A prévia mudou. Abra as pastas repetidas de novo.'`; cria `batches` (`kind='folders'`) e
  `batch_groups` com `keep_id` e `delete_ids`.
- `processGroup` com `delete_ids` presente: recalcula a visão; exige `keep_id` e **todos** os
  `delete_ids` ativos no grupo; se não → `skipped`; chama
  `ActionsService.apply(groupId, deleteIds, { batchId, expect })` com `expect` dentro da trava
  conferindo de novo que `keep_id` e todos os `delete_ids` continuam ativos no grupo. Lotes `lines`
  seguem exatamente como hoje.
- Desfazer, pausar, continuar, retomar após reinício: iguais (sem mudança de lógica).

**Testes:** migração num banco antigo (aberto 2×); lote de pastas move só os `delete_ids` e mantém a
cópia extra que estava na pasta escolhida; grupo cujo `delete_id` sumiu/mudou → pulado sem mover;
itens enviados diferentes do plano → 400 e nada criado; desfazer restaura tudo; asserção de
segurança "todo grupo mantém uma cópia" e "nenhum arquivo único foi tocado" ao fim de cada cenário.

Commit: `feat: lote de pastas grava as cópias que saem e passa pelas mesmas proteções`.

---

### Task 3: Rotas das pastas repetidas

**Files:** `apps/api/src/folders/folders-reconcile.service.ts`, `folders-reconcile.controller.ts`,
`folders-reconcile.module.ts` (+spec), `apps/api/src/app.module.ts`.

- `GET /api/scans/:id/folder-clusters` → `FolderCluster[]` (análise rodando → 400
  `'Espere a análise terminar para ver as pastas repetidas.'`).
- `GET /api/scans/:id/folder-clusters/unique?key=<chave>&folder=<pasta>` → `CloudItem[]` ("ver lista").
- `GET /api/scans/:id/folder-clusters/plan?key=<chave>&keep=<pasta>` → `ReconcilePlan`
  (chave inexistente → 404 `'Esse conjunto de pastas não existe mais. Abra de novo.'`; pasta fora do
  conjunto → 400 `'Pasta escolhida inválida.'`). `pickKeep` = `suggestKeep(candidatos, regras).keepId`.
- `POST /api/scans/:id/folder-clusters/apply` `{ key, keepFolder, items }` → recalcula o plano e chama
  `BatchService.startFolders` → `BatchSummary`.
- Arquivos e grupos vêm do banco (arquivos ativos, grupos `identical` não `resolved`, ids ativos via
  `ReviewService.activeFileIds`).

**Testes:** demo/fake com pastas `07-06-07` e `minhas fotos/07-06-07` → 1 conjunto `contained`;
plano coerente; apply executa e o conjunto some da lista depois; 400/404 com mensagens.

Commit: `feat: rotas das pastas repetidas (conjuntos, plano e aplicar)`.

---

### Task 4: Página "Pastas repetidas"

**Files:** `apps/web/src/pages/FolderClusters.tsx` (+spec), `apps/web/src/components/ReconcileConfirmDialog.tsx`,
`apps/web/src/App.tsx` (rota `/pastas-repetidas/:scanId`), `ScanProgress.tsx` (entrada),
`History.tsx`/`BatchBits.tsx` (rótulo do tipo de lote), `styles.css`.

Seguir os esboços aprovados:
- Topo: "Pastas repetidas · N de M".
- **Duas pastas:** dois cartões lado a lado (📁 caminho; Arquivos; Tamanho; "Só nesta pasta: N
  arquivos" com "ver lista"); selo "★ Sugerida para manter" na sugerida. **Três ou mais:** tabela com
  colunas Pasta · Arquivos · Só nela (com "ver") · Situação.
- Quadro-resumo em linguagem simples: "48 arquivos estão nas duas · 4 só na primeira · 0 só na
  segunda" e a situação ("a segunda pasta está toda contida na primeira").
- Pergunta "O que fazer com os N arquivos repetidos?" com opções (rádio):
  "Manter em <pasta> (sugerida)" para cada pasta, e "Revisar um por um" (leva à revisão normal).
- 🔒 "Os N arquivos que só existem em <pasta> nunca são tocados."
- Prévia do resultado vinda do plano ("a 2ª pasta fica vazia"; "a 3ª fica só com os seus 2
  arquivos únicos").
- Barra fixa: ← Voltar · Pular · **Aplicar (N arquivos para a lixeira)** → modal de confirmação
  (lista completa conferível das que saem e das que ficam, espaço, "Nada é apagado de vez") →
  progresso reaproveitando o componente de progresso do lote (pausar, continuar, desfazer) →
  "Próximo conjunto".
- Entrada: em `ScanProgress`, com análise concluída e conjuntos existentes, botão secundário
  "Pastas repetidas (N)". No Histórico, lotes `folders` aparecem como "pastas #N".
- O POST envia `items` exatamente do plano mostrado.

**Testes:** duas pastas renderizam cartões, três renderizam tabela; "ver lista" dos únicos; trocar a
pasta escolhida recarrega o plano e o texto do resultado; "Revisar um por um" navega; modal confirma
e envia `items` do plano (uma vez só com clique duplo); "Pular"/"Voltar" navegam entre conjuntos;
entrada aparece só com análise concluída e conjuntos.

Commit: `feat(web): página de pastas repetidas com prévia, confirmação e progresso`.

---

### Task 5: Ponta a ponta

**Files:** `apps/api/src/app.e2e.spec.ts`.

- Demo: análise → `GET folder-clusters` acha o conjunto `07-06-07` → `plan` mantendo a pasta
  sugerida → `apply` com os itens → `done` → os 4 arquivos de `minhas fotos/07-06-07` na lixeira, os
  de `07-06-07` intactos, nenhum arquivo único tocado, cada grupo mantém a cópia escolhida →
  desfazer restaura tudo.
- Verificação: `npm test && npm run typecheck && npm run build` + smoke na demo (PORT=4400).
- README: **não mexer** (decisão da autora).

Commit: `test: reconciliação de pastas de ponta a ponta na demo`.
