# Plano 4 — Prováveis cópias

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Encontrar arquivos que **não são idênticos** byte a byte mas são provavelmente a mesma
foto/vídeo (ex.: `nome.jpg` e `nome 1.jpg` com mesmas dimensões e mesma data em que foi tirada) e
deixar a usuária revisá-los **um por um**, **sem nada pré-marcado**, com o aviso de que podem ser a
original e uma versão editada.

**Architecture:** Função pura `groupProbable` (módulo `grouping`) gera grupos `kind = 'probable'`
gravados em `dup_groups` pela varredura (e calculados uma vez para análises já concluídas). A
revisão um por um passa a filtrar por tipo; a interface ganha a entrada "Revisar prováveis cópias"
e o modo "Prováveis cópias" na tela de revisão. Remoção pelo caminho de sempre
(`ActionsService.apply`). Lote e reconciliação **continuam só com idênticas**.

**Spec:** `docs/superpowers/specs/2026-10-29-twinpix-cloud-design.md` — §5 passo 4 ("Prováveis
cópias"), §6 proteção 1, §7 (topo "Grupo N de M · Prováveis cópias", aviso), §10 (87 arquivos
`nome 1.jpg` reais).

## Global Constraints

- Todas as constraints dos Planos 1-3 continuam valendo (pt-BR, testes sem OneDrive real, commits
  sem `Co-Authored-By`, nunca ler `.env`, nunca usar a porta 4317).
- **Prováveis cópias nunca vêm pré-marcadas** (`preMarkedIds = []`); aparece só o selo
  "★ Sugerida para manter".
- **Nunca entram em lote nem em reconciliação de pastas** (os filtros `kind = 'identical'` existentes
  devem continuar valendo — verificar).
- Aviso fixo na revisão: **"Podem ser a original e uma versão editada. Confira antes de excluir."**
- Nunca é possível excluir todas as cópias de um grupo; tudo vai para a lixeira; desfazer funciona.

## Definição (vale para todas as tarefas)

Dois ou mais arquivos ativos da análise formam um **grupo de prováveis cópias** quando:
- mesmo tipo (`photo`/`video`);
- mesmo **nome-base** (`baseName` existente: ignora sufixos ` 1`, ` (2)`, `-1`, maiúsculas e a
  extensão em minúsculas);
- mesmas **dimensões** (`width` e `height` não nulos e iguais);
- mesma **data em que foi tirada** (`takenAt` não nulo e igual — **sem** fallback para a data de
  criação, que no backup do celular é a data do upload);
- **vídeos:** durações (`durationMs` não nulo) a no máximo **1000 ms** uma da outra (agrupar em
  cadeia após ordenar por duração; uma diferença > 1000 ms inicia novo grupo);
- o grupo precisa ter **pelo menos dois conteúdos diferentes** (hashes distintos, ou hash ausente
  em algum): se todos forem idênticos, é caso das idênticas e não entra aqui.
- Chave estável do grupo: `p:${kind}:${baseName}:${width}x${height}:${takenAt}` (+ `:${id do primeiro
  membro da cadeia na ordem (durationMs, id)}` para vídeos).

---

### Task 1: Função pura `groupProbable`

**Files:** `apps/api/src/grouping/group-probable.ts` (+spec).

```ts
export interface ProbableGroup { key: string; fileIds: string[] }
export function groupProbable(files: CloudItem[]): ProbableGroup[]
```
**Testes:** `nome.jpg` + `nome 1.jpg` com hashes diferentes, mesmas dimensões e mesmo takenAt →
grupo; dimensões diferentes → não; takenAt diferente ou nulo → não; todos com o mesmo hash → não;
`nome (2).jpg` e `NOME-1.JPG` entram; nomes legítimos que não são sufixo (`foto-10.jpg`,
`Viagem 2015.jpg`) não juntam com outros; vídeos 31000 e 31800 ms → grupo, 31000 e 33000 → não,
cadeia 31000/31900/32800 → um grupo; fotos e vídeos com mesmo nome-base não se misturam; mesmo id
repetido não vira cópia de si mesmo. **Propriedade (fast-check):** todo grupo tem ≥ 2 ids distintos,
todos com mesmo nome-base/dimensões/takenAt e pelo menos 2 conteúdos diferentes.

Commit: `feat: encontra prováveis cópias (mesmo nome-base, dimensões e data)`.

---

### Task 2: Varredura e revisão com prováveis cópias

**Files:** `apps/api/src/scan/scan.service.ts` (+spec), `apps/api/src/review/review.service.ts`,
`review.controller.ts` (+spec), `apps/api/src/storage/schema.ts`/`db.ts` (+spec), `packages/shared/index.d.ts`,
specs de lote e pastas (verificação).

- Os grupos de `groupProbable` (`kind='probable'`) são calculados **uma vez, quando a análise
  termina** (não a cada pasta), com posição fixa na inserção. Assim as chaves não mudam durante a
  varredura. (A revisão de prováveis só fica disponível com a análise concluída.)
- Análises **já concluídas** antes deste plano: coluna `scans.probable_done INTEGER NOT NULL
  DEFAULT 0` (migração idempotente); `onModuleInit` calcula os grupos prováveis das análises
  `done` com `probable_done = 0` e marca 1. Análises novas marcam 1 ao terminar.
- `ScanSummary` ganha `probableTotal`, `probablePending`, `probableSkipped`; os campos atuais
  (`groupsTotal`, `groupsPending`, `groupsSkipped`, `bytesFreed`) passam a contar **só idênticas**
  (ou todos para `bytesFreed` — bytes liberados contam tudo).
- `GroupView.kind: 'identical' | 'probable'`; para `probable`, `preMarkedIds = []`.
  `position`/`total` contam só grupos do mesmo tipo.
- `ReviewService.current(scanId, kind = 'identical')`, `skip`/`previous`/`unskipAll` respeitam o tipo
  do grupo (cursor por tipo: `scans.cursor_group_id` para idênticas e nova coluna
  `scans.cursor_probable_id` para prováveis). Rotas: `GET /api/scans/:id/groups/current?kind=probable`,
  `POST /api/scans/:id/unskip?kind=probable`.
- `current` pula (e marca `resolved`) grupos com menos de 2 arquivos ativos (um arquivo pode ter saído
  por outro grupo).
- **Verificar e testar** que o lote (`BatchService.preview`) e as pastas (`FoldersReconcileService`)
  ignoram grupos `probable`.

**Testes:** varredura cria grupos prováveis no fixture; reanálise não duplica; backfill de análise
concluída antiga; `current(kind)` e cursores independentes; `preMarkedIds` vazio; grupo com 1 ativo é
pulado; lote/pastas ignoram prováveis; aplicar/desfazer num grupo provável funcionam.

Commit: `feat: varredura e revisão de prováveis cópias, sem pré-marcação`.

---

### Task 3: Interface — revisar prováveis cópias

**Files:** `apps/web/src/pages/ScanProgress.tsx`, `Review.tsx` (+specs), `apps/web/src/App.tsx`.

- `ScanProgress`: linha "Prováveis cópias: N (M para revisar)" e, com pendentes, botão secundário
  **"Revisar prováveis cópias"** → `/revisao/:scanId?tipo=provaveis`.
- `Review`: lê `tipo` da URL (padrão idênticas) e usa `kind=probable` nas rotas; cabeçalho
  "Grupo N de M · Prováveis cópias · X liberados até agora"; aviso fixo destacado (laranja suave,
  ícone ⚠): "Podem ser a original e uma versão editada. Confira antes de excluir."; nenhum cartão
  marcado ao abrir; o link "Revisar em lote" **não** aparece no modo prováveis; tela de fim com
  "Rever grupos pulados" no mesmo tipo. Atalhos e modal funcionam igual (Enter com 0 marcadas não faz
  nada). A navegação por URL (`/revisao/:scanId/grupo/:id`) preserva `?tipo=provaveis`.

**Testes:** botão aparece só com pendentes; Review em modo prováveis chama `kind=probable`, mostra o
aviso e nenhum marcado; marcar uma e confirmar envia só ela; "Revisar em lote" ausente; navegação
preserva o tipo.

Commit: `feat(web): revisão de prováveis cópias com aviso e sem pré-marcação`.

---

### Task 4: Ponta a ponta

**Files:** `apps/api/src/cloud/demo-seed.ts`, `apps/api/src/app.e2e.spec.ts`.

- Demo: acrescentar um par provável de foto (mesmo nome-base com " 1", mesmas dimensões e takenAt,
  hashes e tamanhos diferentes) e um par de vídeo (durações 31000 e 31500 ms, hashes diferentes).
  Ajustar contagens de outros testes só se mudarem.
- e2e: análise → `probableTotal ≥ 2` → `current?kind=probable` sem pré-marcação → aplicar uma cópia →
  desfazer; o lote (`GET /api/scans/:id/batch`) não inclui os grupos prováveis.
- Verificação: `npm test && npm run typecheck && npm run build` + smoke na demo (PORT=4400).
- README: não mexer.

Commit: `test: prováveis cópias de ponta a ponta na demo`.
