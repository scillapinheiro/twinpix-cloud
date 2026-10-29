# Handoff — TwinPix Cloud

Última atualização: 29/10/2026, noite (planos 1-5 concluídos; plano 6 em andamento)

## Objetivo e escopo

Ferramenta open source (repositório público `twinpix-cloud`, **fechado a contribuições**)
para encontrar fotos e vídeos repetidos no **OneDrive** e revisar **um grupo por vez,
lado a lado**, movendo para a lixeira o que a usuária escolher.

A spec aprovada está em `docs/superpowers/specs/2026-10-29-twinpix-cloud-design.md`.
A implementação foi dividida em planos:

| Plano | Conteúdo | Situação |
|---|---|---|
| **1** | Base + **cópias idênticas** de ponta a ponta + modo demonstração | **Implementado e revisado** (branch `plano-1-identicas`) |
| 2 | **Lote das idênticas** (prévia por par de pastas, inverter, desfazer lote) + atalhos de teclado | **Implementado e revisado** (29/10, tarde) |
| 3 | **Reconciliação de pastas** (`docs/superpowers/plans/2026-10-29-plano-3-reconciliacao-de-pastas.md`) | **Implementado e revisado** (29/10, tarde) |
| 4 | **Prováveis cópias** (`docs/superpowers/plans/2026-10-29-plano-4-provaveis-copias.md`) | **Implementado e revisado** (29/10, noite) |
| 5 | **Acabamento** (`docs/superpowers/plans/2026-10-29-plano-5-acabamento.md`): cancelar análise, regra "pasta mais organizada" + tela de Regras, pendências, trava da pasta de teste + contrato real, validação com listagens | **Implementado e revisado** (29/10, noite) |
| 6 | **Lote das prováveis regravações + tecla X** (`docs/superpowers/plans/2026-10-29-plano-6-lote-provaveis-e-atalho-x.md`) | Em execução |

## Estado atual

- Planos 1 a 5 implementados, cada tarefa revisada e cada plano com revisão final + onda de
  correções re-revisada. Tudo na branch **`plano-1-identicas`** no GitHub, **ainda não juntada
  na `main`** (o fechamento da v1 faz o merge, apaga as branches e reescreve o README).
- A autora usa o app **todo dia no OneDrive real** (login testado, lote, pastas repetidas,
  prováveis). Contrato com o OneDrive real passou na pasta `/TwinPix Teste`.
- Registro no Microsoft Entra feito pela autora (conta gratuita do Azure → "Diretório padrão");
  Client ID no `.env` da raiz (fora do git, permissão 600).
- Testes (fim do Plano 5): API 320 + 1 pulado (contrato real), web 130; typecheck e build OK.
- **Próximo:** Plano 6 (lote das prováveis regravações + tecla X), depois o fechamento da v1.

### Como experimentar

    npm install
    npm run demo          # arquivos fictícios, nada acontece no OneDrive

Com o OneDrive de verdade (só depois de combinar a pasta de teste):

    npm run build && npm start

### Plano 2 (lote + atalhos), concluído em 29/10/2026
- **Lote das idênticas:** botão "Revisar em lote" (análise concluída). Prévia agrupada por par de
  pastas, todas as linhas marcadas por padrão, "Marcar todas"/"Desmarcar todas", "ver lista" com
  miniatura, datas e tamanho (diferenças em laranja), ★ na cópia que fica e "Abrir no OneDrive".
  "⇄ Inverter"/"Manter em:" escolhe a pasta que fica. Grupos sem regra clara ficam fora.
- **Segurança do lote:** o navegador envia exatamente os grupos e a ★ vistos (`keeps`); se algo
  mudou, "A prévia mudou. Abra o lote de novo.". Cada grupo passa por `ActionsService.apply`
  (trava global, conferência dos dois lados, reconferência dentro da trava). A ★ fica gravada
  (`keep_id`); se a escolha mudar, o grupo é pulado. Pausar/continuar, retomada após reinício,
  espera sem internet, "Desfazer este lote" (página do lote e Histórico).
- **Atalhos na revisão um por um:** Enter abre a confirmação e Enter no modal move; P pula; ← volta.
- Testes: API 211, web 69; typecheck e build OK; teste de ponta a ponta do lote na demo.
- Pendências pequenas do Plano 2 (não bloqueiam): erros antigos gravados por builds intermediários
  podem aparecer crus no Histórico; atalhos não ignoram inputs de data/arquivo (não existem na
  revisão); contagem do desfazer pode errar por 1 numa corrida estreita com desfazer manual.

### Plano 3 (reconciliação de pastas), concluído em 29/10/2026
- **"Pastas repetidas (N)"** na tela da análise concluída → página `/pastas-repetidas/:scanId`,
  um conjunto por tela: cartões (2 pastas) ou tabela (3+), "Só nesta pasta" com "ver lista",
  situação ("toda contida", "parcial"), escolha "Manter em <pasta>" ou "Revisar um por um",
  resultado previsto, 🔒 arquivos únicos nunca tocados, confirmação com o que sai e a cópia que fica
  de cada repetido, progresso/pausar/desfazer (mesmo mecanismo do lote, tipo "pastas" no Histórico).
- Pastas comparadas pelo conteúdo (qualquer nome; pasta e subpasta podem formar par). Sugestão:
  mais arquivos → mais únicos → pasta mais profunda → alfabética.
- Segurança: o navegador envia o plano exato; o servidor recalcula e recusa se mudou; cada grupo
  passa pela trava com conferência dos arquivos que saem e da cópia que fica; cópias que
  continuam (extras/fora do conjunto) seguem visíveis para revisão. Só um lote aberto por vez
  (inclusive pausado); as páginas reencontram o lote aberto ao recarregar.
- Testado pela autora com dados reais (par ConfraeNe 2024 × Robô Paparazzi). Testes: API 249, web 94.
- Pendências pequenas: rótulo "Próximo conjunto" quando o lote aberto é de outro tipo; mensagem de
  grupo pulado com "grupo"; desfazer direto de lote pausado não aparece na tela.

### Plano 4 (prováveis cópias), concluído em 29/10/2026
- Grupos de **prováveis cópias**: mesmo nome-base (ignora " 1", " (2)", "-1"), mesmas dimensões,
  mesma data em que foi tirada (sem fallback), vídeos com duração a até 1 s; conteúdo diferente.
  Calculados **uma vez ao fim da análise**; análises antigas ganham os grupos ao iniciar o app
  (backfill protegido: se falhar, o app abre e tenta de novo depois).
- Revisão própria ("Revisar prováveis cópias" na tela inicial e na análise; `?tipo=provaveis`):
  **nada pré-marcado**, aviso "Podem ser a original e uma versão editada. Confira antes de excluir.",
  sem lote e fora das pastas repetidas. Grupos pulados continuam alcançáveis (botões e "Rever
  grupos pulados" para os dois tipos). A tela segue o tipo do grupo.
- Arquivo que some do OneDrive sai de todos os grupos da análise; contadores e revisão ignoram
  grupos sem duas cópias ativas (sem mudar o status deles; voltam após desfazer).
- Testes: API 285, web 114.

### Validação com dados reais (29/10/2026, 17h — listagens do rclone, só leitura)
| Pasta | Fotos e vídeos (out → agora) | Cópias idênticas sobrando (out → agora) |
|---|---|---|
| Imagens/Imagens da Câmera | 24.477 → 24.076 | 390 → **0** |
| Minhas imagens | 6.292 → 5.764 | 481 → **0** |
- Todas as cópias idênticas de fotos e vídeos dessas duas pastas foram resolvidas pela autora com o
  app. Restam 2 pares de arquivos de DVD (.BUP/.IFO, que são backups um do outro por definição — fora
  do escopo) e 2 arquivos sem hash.
- Contrato com o OneDrive real (pasta `/TwinPix Teste`): passou — listar, mapear, mover para a
  lixeira, restaurar; a pasta ficou idêntica. Comando: `TWINPIX_TEST_FOLDER='/TwinPix Teste'
  TWINPIX_CLIENT_ID='<id>' npm run contract -w apps/api` (usa o login salvo em `~/.twinpix-cloud`).
- Script: `npx tsx apps/api/scripts/validate-listing.ts <listagem.json> [...]` (listagens nunca no git).

## Decisões tomadas durante a implementação

Foram tomadas pelo Claude com a autonomia dada para a noite. A usuária pode rever qualquer uma.

| Decisão | Motivo |
|---|---|
| A posição dos grupos é fixada quando o grupo é encontrado e nunca muda | O plano renumerava os grupos no fim da análise; isso contradiz a spec §5 (revisar durante a análise e retomar do mesmo grupo). A spec prevaleceu. |
| Uma **trava global**: só uma ação de mover ou desfazer por vez, em todo o app | A revisão encontrou casos em que duas abas ou duas análises poderiam mandar cópias diferentes da mesma foto para a lixeira ao mesmo tempo, sem sobrar nenhuma. |
| Um arquivo com ação "movido" ou "em andamento" sai de **todos** os grupos, de qualquer análise | Mesmo motivo: um arquivo a caminho da lixeira nunca pode contar como "a cópia que fica". |
| Erro incerto ao mover (rede caiu, erro 5xx) é conferido no OneDrive; se não der para conferir, a ação fica "em andamento" e é acertada depois | A spec §8 pede que nada fique "pela metade"; antes aparecia "não foi movido" para um arquivo que podia estar na lixeira. |
| Grupo que mudou no OneDrive é **atualizado** com a situação atual, em vez de ficar travado como "desatualizado" | Antes a usuária ficaria presa no mesmo grupo sem conseguir avançar. |
| Proteção do servidor local contra endereço com maiúsculas (`/API/...`) e contra DNS rebinding (verificação do `Host`) | Achados de segurança na revisão. O token só vai para `graph.microsoft.com`. |
| Mensagens do login sempre fixas em português | O endereço de retorno do login podia exibir texto de terceiros dentro do app. |
| `npm` workspaces, em vez de `pnpm` | O `pnpm` não está instalado na máquina. |

## README final (decisão da autora, 29/10/2026)

Reescrever o README **uma vez só, no fim da v1**, depois de tudo pronto, mergeado na `main` e com
as branches apagadas. Seguir o padrão dos READMEs dela
(github.com/scillapinheiro/gama-academy-desafio-final e .../b7web-starbucks): título/logo
centralizado, menu de links, selos (licença), imagem de mockup, seções com emoji
(:computer: Projeto, :rocket: Tecnologias com badges `for-the-badge`, :eyes: demonstração/como
usar, :memo: Licença) e desenvolvedora com avatar do GitHub. Mockup e detalhes ficam a critério
do Claude. Até lá, não mexer no README além do necessário.

Conteúdo obrigatório (pedido da autora, 29/10/2026):
- **Como o projeto funciona**, em linguagem simples (só lê metadados, compara conteúdo e não nome,
  nada é apagado de vez, sempre sobra uma cópia, lixeira + desfazer).
- **Como usar** passo a passo: modo demonstração, registro na Microsoft (incluindo o caso da conta
  pessoal sem diretório → conta gratuita do Azure), conectar, escolher pastas/colar link, analisar.
- **Funcionalidades**, explicando a **diferença entre revisão um por um e lote** (quando usar
  cada um, prévia por par de pastas, inverter, desfazer lote, atalhos de teclado).
- **Licença:** open source (MIT) — **qualquer pessoa pode baixar, modificar e adaptar como
  quiser**, mas o projeto é pessoal e **não aceita pull requests** (fork é o caminho).

## Depois (ideias anotadas, fora dos planos atuais)

- Mostrar na tela da análise as pastas sem permissão (hoje são puladas em silêncio).
- Selo "idêntica à cópia X" dentro de grupos de prováveis com 3+ cópias (descartado por ora: os
  grupos reais da autora têm 2 cópias).
- Atualizar `@azure/msal-node` para a versão 7 (resolve alertas do `npm audit` em dependências
  indiretas; exige mudança de versão maior; nenhum alerta é alcançável no uso local).

## Pendências conhecidas (não bloqueiam)

- Testes de interface ainda faltando para alguns fluxos (link colado, clique duplo, falha parcial).
- Página do Histórico espera as ações pendentes serem conferidas (limitado pelo timeout de 60 s).
- Links de grupo "fantasma" antigos no banco são ignorados, não apagados (inócuos).

## Fechamento da v1 (depois do Plano 6)

1. Revisão final geral, merge de `plano-1-identicas` na `main`, apagar branches locais e remotas.
2. README final no padrão da autora (seção "README final" acima).
3. A autora testa tudo de uma vez.

## Dados de referência

- Análises reais, **só leitura**, feitas com rclone: `onedrive:` (remote em
  `~/.config/rclone/rclone.conf`, conta pessoal). Os números estão na spec, §10.
- Para refazer as listagens:
  `rclone lsjson -R --files-only --hash --hash-type quickxor "onedrive:Imagens/Imagens da Câmera"`
  e `"onedrive:Minhas imagens"`.

## Proibições

- **Commits sem coautoria**: nunca adicionar `Co-Authored-By` nem assinatura do Claude.
- Sem force-push e sem reescrever histórico.
- **Nunca mover, apagar ou alterar nada no OneDrive** durante o desenvolvimento,
  exceto na pasta de teste combinada: `/TwinPix Teste` (contém teste.jpg, "teste 1.jpg" e outra.jpg).
- Nunca ler, mostrar ou commitar o `.env`.
- Não mexer no backup do notebook (`/home/ene/backup-notebook/`), que é outro assunto.
- A autonomia da noite de 29/10 **não vale automaticamente** para as próximas sessões:
  perguntar antes de executar mudanças, conforme as regras da usuária.

## Prompt para nova sessão

```
Vamos continuar o projeto TwinPix Cloud (ferramenta para achar fotos e vídeos repetidos no OneDrive).
Diretório: /home/ene/twinpix-cloud — branch plano-1-identicas
Leia primeiro, nesta ordem:
1. /home/ene/twinpix-cloud/docs/HANDOFF.md
2. /home/ene/twinpix-cloud/docs/superpowers/specs/2026-10-29-twinpix-cloud-design.md
3. a memória twinpix-cloud
Os planos 1-5 foram implementados e revisados; ver a tabela de planos e o "Fechamento da v1".
Antes de qualquer comando, diga o que pretende ler/verificar e espere minha autorização.
Depois me resuma o estado em poucas linhas e me ajude com o próximo passo do handoff.
Não mexa em nada do meu OneDrive fora da pasta de teste combinada; commits sem coautoria.
```
