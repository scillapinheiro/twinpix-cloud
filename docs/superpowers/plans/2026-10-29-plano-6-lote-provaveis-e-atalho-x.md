# Plano 6 — Lote das prováveis regravações e atalho X

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (1) Tecla **X** na revisão um por um marca todas as cópias exceto a sugerida e abre a
confirmação. (2) **Lote das prováveis regravações**: resolver de uma vez os grupos de prováveis cópias
que parecem a mesma foto regravada, com prévia por par de pastas, miniaturas e linhas desmarcadas.

**Spec:** §6 "Lote das prováveis regravações" (decisão da autora em 29/10/2026) e proteção 1 atualizada.

**Architecture:** O lote atual (`BatchService`, `buildBatchLines`, `keeps`, `keep_id` fixado, trava,
desfazer) ganha um segundo tipo de linha/lote: `kind = 'probable'` (lote) que só aceita grupos
`probable` aprovados pelo filtro puro `isLikelyResave(group)`. A página do lote recebe um modo
`?tipo=provaveis`. Nada muda no lote das idênticas nem na revisão um por um, exceto o atalho X.

## Global Constraints

- Constraints dos Planos 1-5 continuam valendo (pt-BR, commits sem `Co-Authored-By`, nunca ler
  `.env`, nunca usar a porta 4317, testes sem OneDrive real).
- **Filtro de regravação (puro, testado):** grupo provável com exatamente **uma** cópia sem sufixo de
  cópia (`!hasCopySuffix(name)`); todas com mesmas dimensões, mesmo `takenAt`, mesma câmera
  (fabricante e modelo iguais, inclusive ambos nulos); maior tamanho ≤ 1,02 × menor; vídeos com
  durações não nulas a até 1000 ms. Fica a cópia sem sufixo.
- **Linhas desmarcadas por padrão** no lote das prováveis; aviso fixo da spec; miniaturas no "ver lista".
- Toda remoção via `ActionsService.apply` com `keeps`/`keep_id` e reconferência dentro da trava;
  sempre sobra uma cópia; lixeira; desfazer lote.
- Lote das idênticas e reconciliação de pastas **inalterados** (testes existentes continuam verdes).

---

### Task 1: Atalho X

- `apps/web/src/lib/shortcuts.ts`, `Review.tsx` (+spec): tecla `x`/`X` (mesmas regras de ignorar
  campos/modificadores/repeat) marca todas as cópias ativas exceto `suggestion.keepId` e abre o modal
  de confirmação (não move nada sozinho). Funciona nos dois tipos. Dica visível: "X marca as outras".
- Testes: X marca as não sugeridas e abre o modal; Enter depois confirma uma vez; X com o modal
  aberto não faz nada; X durante carregamento não faz nada; prováveis continuam abrindo sem marcas.

Commit: `feat(web): tecla X marca as outras cópias e abre a confirmação`.

### Task 2: Filtro puro `isLikelyResave` e linhas do lote de prováveis

- `apps/api/src/grouping/likely-resave.ts` (+spec): `isLikelyResave(files: CloudItem[]): { ok: true; keepId } | { ok: false; reason }`.
  Casos de teste: par foto `x.jpg`/`x 1.jpg` com 1% de diferença → ok, fica `x.jpg`; 5% → não;
  câmera diferente → não; dois sem sufixo → não; dimensões diferentes → não; vídeo com 1,5 s → não;
  3 cópias (1 sem sufixo + 2 com) dentro dos limites → ok.
- `buildBatchLines` aceita grupos `probable` aprovados (reaproveitar a mesma estrutura de linha, com
  a cópia que fica = `keepId` do filtro; motivo "regra: nome sem sufixo de cópia").

Commit: `feat: filtro de prováveis regravações para o lote`.

### Task 3: Lote de prováveis no servidor

- `BatchService.preview(scanId, kind = 'identical' | 'probable')` e `start(..., kind)`; `batches.kind`
  ganha `'probable'` (migração não necessária — texto); só grupos `probable` pendentes com ≥ 2 ativos
  aprovados por `isLikelyResave` no momento da prévia **e** reconferidos na execução (dentro do
  `expect`: o filtro continua aprovando e a cópia que fica continua a fixada).
- Rotas: `GET/POST /api/scans/:id/batch?kind=probable`. Histórico rotula "prováveis #N".
- Testes: prévia só com regravações; grupo editado (tamanho 5%) fora; execução move as com sufixo e
  mantém a sem sufixo; grupo que deixou de passar no filtro entre prévia e execução é pulado; desfazer
  lote restaura; lote de idênticas inalterado; asserção "todo grupo mantém uma cópia".

Commit: `feat: lote das prováveis regravações com as mesmas proteções`.

### Task 4: Página do lote em modo prováveis

- `Batch.tsx` lê `?tipo=provaveis`: título "Lote das prováveis regravações", aviso fixo da spec,
  **linhas desmarcadas por padrão**, "ver lista" já com miniaturas (garantir que apareçam de cara, sem
  precisar de clique extra por item), confirmação igual. Entradas: em `ScanProgress` e `Home`, botão
  secundário "Lote das prováveis (N)" quando houver grupos aprovados (contagem da prévia), e link no
  topo da revisão de prováveis.
- Testes: modo prováveis chama `?kind=probable`, linhas desmarcadas, aviso visível, POST com
  `kind=probable` e `keeps` das marcadas.

Commit: `feat(web): página do lote das prováveis regravações`.

### Task 5: Ponta a ponta

- Demo: garantir um par provável de regravação (diferença de tamanho ≤ 2%) e um par editado (> 2%).
- e2e: prévia de prováveis só com o par de regravação; executar; a cópia com sufixo vai para a
  lixeira; o par editado continua no um por um; desfazer restaura.
- `npm test && npm run typecheck && npm run build` + smoke PORT=4400.

Commit: `test: lote das prováveis de ponta a ponta na demo`.
