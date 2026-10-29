# Handoff — TwinPix Cloud

Última atualização: 29/10/2026 (2ª sessão)

## Objetivo e escopo

Ferramenta open source (repositório público `twinpix-cloud`, **fechado a contribuições**)
para encontrar fotos e vídeos repetidos no **OneDrive** e revisar **um grupo por vez,
lado a lado**, movendo para a lixeira o que a usuária escolher.

O escopo da v1 está na spec. Resumo:
- **Duplicatas:** idênticas e prováveis cópias, de fotos e vídeos.
- **Pastas:** várias pastas por análise e reconciliação de pastas.
- **Execução:** aplicação web local (NestJS + React).

Depois da v1:
- **v2:** Google Drive.
- **v3:** fotos parecidas.
- **Futuro:** app instalável com Electron.

## Estado atual

- **Brainstorming concluído em conversa.** A usuária aprovou:
  - o escopo;
  - a arquitetura;
  - o fluxo da varredura;
  - as regras e as proteções;
  - os layouts das telas.
- **Spec escrita:** `docs/superpowers/specs/2026-10-29-twinpix-cloud-design.md`.
  **§8 (erros) e §9 (testes) revisadas e reescritas na 2ª sessão**, com a aprovação da usuária:
  conferência da cópia que fica antes de mover, IDs contra pastas sobrepostas, diário de
  ações, falhas do desfazer, segurança do backend local, trava testada por propriedades,
  provedor falso cobrindo cada erro, testes de contrato e trava da pasta de teste.
  **Spec aprovada pela usuária em 29/10/2026.**
- **Esboços aprovados** em `.superpowers/brainstorm/1448353-1793247420/content/`:
  - `revisao-layout-v2.html`: layout escolhido;
  - `tres-copias-e-pastas.html`;
  - `reconciliacao.html`;
  - `revisao-layout.html`: versão 1, descartada.

  O servidor de esboços foi parado. Para reabrir, use a skill de brainstorming com
  `--project-dir /home/ene/twinpix-cloud`.
- **Repositório:** https://github.com/scillapinheiro/twinpix-cloud (remote SSH
  `git@github.com:scillapinheiro/twinpix-cloud.git`, branch `main`).
- **Autonomia (29/10/2026, noite):** a usuária liberou implementar, commitar e dar push sem
  pedir autorização a cada passo, para revisar de manhã. Commits **sem coautoria**.
- Existe um `.gitignore` com `.superpowers/`, `node_modules/`, `.env` e `*.sqlite`.

## Decisões tomadas, com o motivo

| Decisão | Motivo |
|---|---|
| Nome **TwinPix Cloud**, repositório `twinpix-cloud` | Já existem projetos pequenos chamados "TwinPix" (duplicatas locais/Mac); "Cloud" diferencia e destaca o foco em nuvem |
| Aplicação web local agora, pensada para Electron depois | A usuária queria um instalável como o programa antigo, mas aceitou a web local para começar |
| Stack TypeScript: NestJS + React (Vite) + SQLite, em monorepo | É a stack da usuária; o SQLite permite retomar a varredura |
| v1 sem semelhança visual | O problema real são backups duplicados (cópias exatas) |
| "Prováveis cópias" na v1 | Na análise real, 87 arquivos do tipo `nome 1.jpg` não eram idênticos, mas tinham as mesmas dimensões e a mesma data em que foram tirados |
| Reconciliação de pastas **na v1** | A usuária pediu. `Minhas imagens` tem pastas inteiras duplicadas |
| Um grupo por tela, com Excluir/Pular/Voltar | Igual ao programa antigo; a usuária quer ir etapa por etapa |
| Prováveis cópias **nunca** vêm pré-marcadas | Medo de excluir sem querer; podem ser a original e uma versão editada |
| Rótulos explícitos em todos os campos e câmera com fabricante | Acessibilidade para pessoas não técnicas |
| Licença MIT, `CONTRIBUTING.md` recusando PRs | Open source para fork, sem aceitar mudanças no projeto dela |

## Dados de referência

- Análises reais, **só leitura**, feitas com rclone: `onedrive:` (remote em
  `~/.config/rclone/rclone.conf`, conta pessoal, `drive_id 74C059BAED225922`).
  Os números estão na spec, §10.
- As listagens JSON usadas ficavam no scratchpad da sessão anterior, que é temporário.
  Para refazer:
  `rclone lsjson -R --files-only --hash --hash-type quickxor "onedrive:Imagens/Imagens da Câmera"`
  e `"onedrive:Minhas imagens"`.

## Pendências e próximo passo seguro

1. A usuária faz a aprovação final da spec (§8 e §9 já revisadas); ajustar o que pedir.
2. Com a spec aprovada, usar a skill **`superpowers:writing-plans`** para criar o plano
   de implementação.
3. O repositório no GitHub já existe. A usuária **autorizou o `git init` e o primeiro
   commit quando forem necessários** (previsto para quando a spec for aprovada, junto com
   o plano), **sem linha de coautoria** (`Co-Authored-By`). Push e commits seguintes
   continuam dependendo de pedido explícito.
4. No início da implementação, guiar o **registro do app no Microsoft Entra**
   (cliente público, redirect localhost, `Files.ReadWrite` + `offline_access`) e
   validar se a conta pessoal exige criar um diretório antes.

## Proibições

- **Commits sem coautoria**: nunca adicionar `Co-Authored-By` nem assinatura do Claude.
- Sem force-push e sem reescrever histórico.
- **Nunca mover, apagar ou alterar nada no OneDrive** durante o desenvolvimento,
  exceto numa pasta de teste combinada com ela.
- Não mexer no backup do notebook (`/home/ene/backup-notebook/`), que é outro
  assunto e segue em outra sessão.
- Pedir autorização antes de executar mudanças, conforme as regras da usuária.

## Prompt para nova sessão

```
Vamos continuar o projeto TwinPix Cloud (ferramenta para achar fotos e vídeos repetidos no OneDrive).
Diretório: /home/ene/twinpix-cloud
Leia primeiro, nesta ordem:
1. /home/ene/twinpix-cloud/docs/HANDOFF.md
2. /home/ene/twinpix-cloud/docs/superpowers/specs/2026-10-29-twinpix-cloud-design.md
3. a memória twinpix-cloud
O brainstorming foi aprovado; a spec foi escrita e as seções 8 e 9 já foram revisadas.
Antes de qualquer comando, diga o que pretende ler/verificar e espere minha autorização.
Depois me resuma o estado em poucas linhas e me ajude a fechar a aprovação da spec
e, com ela aprovada, a criar o plano de implementação (superpowers:writing-plans).
O git init e o primeiro commit (sem coautoria) estão autorizados quando necessário; fora isso,
não faça commit/push e não mexa em nada do meu OneDrive sem eu pedir.
```
