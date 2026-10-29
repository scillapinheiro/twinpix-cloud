# Plano 5 — Acabamento da v1

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fechar a v1: itens da lista "Depois" do handoff, pendências pequenas registradas nos
planos 1-4, trava da pasta de teste + testes de contrato contra o OneDrive real (manuais), e
validação do agrupamento com as listagens reais do rclone (§10).

**Spec:** `docs/superpowers/specs/2026-10-29-twinpix-cloud-design.md` (§6 regras de prioridade
configuradas pelo usuário; §8; §9 "Fidelidade ao OneDrive real", "Integração com o OneDrive real",
"Dados reais (só local)"). Handoff: `docs/HANDOFF.md` (lista "Depois" e pendências de cada plano).

## Global Constraints

- Todas as constraints dos Planos 1-4 continuam valendo (pt-BR, commits sem `Co-Authored-By`, nunca
  ler `.env`, nunca usar a porta 4317, testes automáticos nunca chamam o OneDrive real).
- **Nada no OneDrive real fora da pasta de teste combinada com a autora** (`/TwinPix Teste`). Testes
  de contrato só rodam com variável de ambiente explícita e são **pulados** em `npm test`.
- Listagens reais (rclone) e qualquer arquivo com nomes de fotos da autora **nunca vão para o git**
  (ficam no scratchpad / `.superpowers/`, que é ignorado).
- README **não** é alterado neste plano (será reescrito no fechamento).

---

### Task 1: "Cancelar análise"

- API: `POST /api/scans/:id/cancel` → status novo `'cancelled'` (só para análises não concluídas; para
  o laço como o pausar); `latest()` ignora canceladas; canceladas não aparecem na tela inicial; ações
  já feitas continuam no Histórico. Migração não é necessária (status é texto).
- Web: em `ScanProgress`, botão "Cancelar análise" (confirmação em dois cliques, como o desfazer lote)
  para status `running/paused/waiting-network/needs-auth/error`; depois volta à tela inicial.
- Testes: cancelar para o laço; `latest` pula; tela inicial mostra a anterior concluída ou "Nova análise".

Commit: `feat: cancelar análise em andamento`.

### Task 2: Regra "pasta mais organizada" e tela de regras de prioridade

- Novo critério `{ type: 'deeperFolder' }` em `RuleCriterion`/`suggestKeep`/`isValidRules`/
  `criterionLabel` ("está numa pasta mais organizada (dentro de mais subpastas)"); maior nº de
  segmentos vence.
- Web: página `/regras` (link "Regras" no topo, ao lado de Histórico): lista ordenada dos critérios
  ativos com ↑ ↓ e remover, botão "Adicionar regra" com os critérios disponíveis (os de pasta pedem
  a pasta via o navegador de pastas existente ou campo de caminho), "Salvar" (`PUT /api/settings/rules`)
  e "Voltar ao padrão". Explicação em linguagem simples: "Quando há cópias, o app sugere manter a que
  vence a primeira regra; se empatar, passa para a próxima."
- Testes: critério novo (puro), validação, página salva a ordem e recusa lista vazia.

Commit: `feat: regra de pasta mais organizada e tela para escolher as regras`.

### Task 3: Pendências pequenas (lista consolidada)

Corrigir, com testes onde fizer sentido:
1. `invalid_client`/`unauthorized_client` no MSAL → reconectar (não "sem conexão").
2. `GraphClient`: limitar `Retry-After` a 60 s (como o backoff) e `fetch` com timeout (ex.: 60 s via
   `AbortSignal.timeout`) virando `OfflineError`.
3. Histórico/lote: mostrar `batches.error` só se for uma das frases fixas (`BATCH_ERRORS`); senão a
   frase genérica.
4. `BatchProgress`: botão "Desfazer este lote" também em `paused` (o servidor já aceita).
5. `BATCH_ERRORS.groupSkipped` sem a palavra "grupo"; rótulo "Próximo conjunto" só quando o lote
   aberto é de pastas.
6. Tela "Falta configurar" (sem Client ID) em linguagem simples, sem "Entra/.env/npm": "O TwinPix
   ainda não está ligado a uma conta da Microsoft. Siga o passo 'Usar com o seu OneDrive' do guia."
7. Atalhos: ignorar também inputs `date/time/range/color/file`.
8. Plural "1 arquivos" e similares nas telas (varrer com `plural()`).

Commit(s): `fix: ...` por grupo de itens.

### Task 4: Trava da pasta de teste e testes de contrato (manuais)

- `TWINPIX_TEST_FOLDER` (env, ex.: `/TwinPix Teste`): quando definida, `OneDriveProvider.moveToTrash`
  e `restore` **recusam** (erro) qualquer item cujo caminho não esteja dentro dessa pasta (consulta o
  item antes); a análise também só aceita raízes dentro dela. Testes unitários com Graph falso.
- Suíte de contrato `apps/api/src/cloud/contract.spec.ts`: o mesmo conjunto de verificações roda contra
  o `FakeCloudProvider` (sempre) e contra o `OneDriveProvider` real **só** com
  `TWINPIX_CONTRACT=1` + `TWINPIX_TEST_FOLDER` + token em cache (senão `describe.skip`). Cenário:
  listar a pasta de teste, upload/criação não é necessária se a autora colocar 3 fotos (2 iguais) lá;
  verificar mapeamento de campos, `getItem`, mover para a lixeira, `getItem` → null, restaurar.
- Script `npm run contract -w apps/api` documentado no handoff (não no README).

Commit: `feat: trava da pasta de teste e testes de contrato do provedor`.

### Task 5: Validação com as listagens reais (só local)

- Script `apps/api/scripts/validate-listing.ts` (fora do build; roda com `tsx`): lê um JSON de
  `rclone lsjson -R --files-only --hash --hash-type quickxor` e roda `groupIdentical` + contagens,
  imprimindo: arquivos, fotos/vídeos, grupos idênticos, cópias sobrando, bytes liberáveis.
- Rodar contra listagens novas geradas no scratchpad (só leitura no OneDrive) e registrar os números
  no handoff (comparando com §10, considerando que a autora já apagou muitos repetidos).
- Nenhuma listagem entra no git.

Commit: `chore: script de validação com listagens do rclone`.
