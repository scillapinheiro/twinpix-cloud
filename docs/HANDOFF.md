# Handoff — TwinPix Cloud

Última atualização: 29/10/2026, fim da madrugada (sessão de implementação noturna)

## Objetivo e escopo

Ferramenta open source (repositório público `twinpix-cloud`, **fechado a contribuições**)
para encontrar fotos e vídeos repetidos no **OneDrive** e revisar **um grupo por vez,
lado a lado**, movendo para a lixeira o que a usuária escolher.

A spec aprovada está em `docs/superpowers/specs/2026-10-29-twinpix-cloud-design.md`.
A implementação foi dividida em planos:

| Plano | Conteúdo | Situação |
|---|---|---|
| **1** | Base + **cópias idênticas** de ponta a ponta + modo demonstração | **Implementado e revisado** (branch `plano-1-identicas`) |
| 2 | **Lote das idênticas** (prévia por par de pastas, desfazer lote) + atalhos de teclado | Em planejamento (ordem redefinida com a autora em 29/10) |
| 3 | Reconciliação de pastas | A planejar |
| 4 | Prováveis cópias | A planejar |
| 5 | Testes de contrato com o OneDrive real, trava da pasta de teste, validação com as listagens do rclone (§10), acabamento | A planejar |

## Estado atual

- **Plano 1 implementado** em `docs/superpowers/plans/2026-10-29-plano-1-base-e-identicas.md`:
  17 tarefas, cada uma revisada (especificação e qualidade), com rodadas de correção quando
  necessário, e uma **revisão final do conjunto** seguida de uma onda de correções re-revisada.
- **Branch `plano-1-identicas` no GitHub**, ainda **não juntada na `main`**. A decisão de
  juntar é da usuária.
- **Verificação final:** `npm test` (API 148 testes, web 24; após os ajustes de interface, web 33), `npm run typecheck` e
  `npm run build` passam. O modo demonstração foi testado de ponta a ponta pela API compilada:
  análise, grupo, mover para a lixeira, histórico e desfazer.
- **Nada foi feito no OneDrive real.** Todos os testes usam o provedor falso.
- **Registro no Microsoft Entra concluído pela usuária** (29/10/2026): conta pessoal exigiu
  criar a conta gratuita do Azure ("Diretório padrão"). App "TwinPix Cloud", só contas
  pessoais, cliente público com redirect `http://localhost:4317/api/auth/callback`,
  permissões delegadas `Files.ReadWrite`, `offline_access` e `User.Read`. O Client ID está
  no `.env` da raiz (fora do git, permissão 600).
- **O login real ainda não foi testado.**

- **Ajustes de interface pedidos pela autora após testar a demo (29/10/2026, manhã)** — spec §7
  atualizada e implementados: confirmação e resultado em **modal** sobre a revisão, cartões em
  tela cheia (2→2, 3→3, 4+→2 por linha, 1 no celular), selo só "★ Sugerida para manter" com a
  regra numa faixa de legenda, barra de ações fixa no rodapé, botões da tela inicial lado a
  lado, visual arredondado com a fonte **Nunito** (embutida). Testes: API 148, web 33.
- **Paleta "Violeta e menta"** escolhida pela autora entre três opções (prints comparativos) e
  aplicada: título e faixa violeta, botões principais preenchidos, borda menta na cópia
  sugerida, progresso violeta. Testes: API 148, web 34. Pendência pequena: o link "ver lista"
  usa fonte serifada (falta `font-family: inherit` em `.link`).

### Como experimentar

    npm install
    npm run demo          # arquivos fictícios, nada acontece no OneDrive

Com o OneDrive de verdade (só depois de combinar a pasta de teste):

    npm run build && npm start

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

## Depois (ideias anotadas, fora dos planos atuais)

- Botão **"Cancelar análise"** (hoje: Pausar + Nova análise).
- Regra "preferir a cópia que está dentro de mais subpastas" (pastas organizadas vs. soltas).
- Tela para configurar as regras de prioridade (hoje só pela API).

## Pendências conhecidas (não bloqueiam; ficaram registradas pela revisão)

- Falha de configuração do app na Microsoft *depois* de um login bem-sucedido (por exemplo,
  um registro apagado) aparece como "sem conexão" e a análise fica esperando.
  Correção de uma linha: tratar `invalid_client` e `unauthorized_client` como "reconectar".
- Um grupo pode aparecer com uma foto só quando uma exclusão não pôde ser confirmada; dá para
  pular. O `Retry-After` da Microsoft não tem limite de espera e as requisições não têm timeout
  próprio. Com a trava global, uma espera longa segura todas as ações.
- A página do Histórico espera as ações pendentes serem conferidas antes de abrir.
- As regras de prioridade só podem ser mudadas pela API. Ainda não existe tela para isso.
- Pastas sem permissão não aparecem na tela da análise.
- Ainda não há testes de alguns fluxos da interface: link colado, clique duplo e falha parcial.
- A tela "Falta configurar" usa termos técnicos (Entra, `.env`).
- `npm audit` aponta vulnerabilidades em dependências indiretas.

## Pendências e próximo passo seguro

1. Modo demonstração revisado pela autora (29/10, manhã): layout e paleta aprovados.
2. **Combinar uma pasta de teste** no OneDrive. Sugestão: uma pasta nova com algumas fotos
   copiadas, incluindo repetidas de propósito. Primeiro teste real **só nela**: conectar,
   analisar, mover uma cópia, desfazer.
3. Decidir se a branch `plano-1-identicas` vai para a `main`.
4. Escrever e executar o **Plano 2** (prováveis cópias e lote) com
   `superpowers:writing-plans`.

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
  exceto numa pasta de teste combinada com ela.
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
O Plano 1 (base + cópias idênticas + modo demonstração) foi implementado e revisado.
Antes de qualquer comando, diga o que pretende ler/verificar e espere minha autorização.
Depois me resuma o estado em poucas linhas e me ajude com o próximo passo do handoff.
Não mexa em nada do meu OneDrive fora da pasta de teste combinada; commits sem coautoria.
```
