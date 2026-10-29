# TwinPix Cloud — Design (v1)

Data: 29/10/2026 · Status: **aprovada pela autora em 29/10/2026**

## 1. Objetivo

Encontrar fotos e vídeos repetidos em pastas do **OneDrive** e permitir revisar,
**um grupo por vez, lado a lado**, decidindo o que mover para a lixeira.

Motivação real: o backup automático do celular/tablet rodou mais de uma vez e
gerou cópias (`nome.mp4` + `nome 1.mp4`), além de pastas inteiras duplicadas.

Inspiração: um programa de desktop antigo que a autora usava. Ele rodava numa
pasta local, mostrava 2 ou 3 fotos por vez e tinha os botões **Excluir** e **Pular**.

## 2. Escopo

| Versão | Conteúdo |
|---|---|
| **v1** | OneDrive · cópias **idênticas** e **prováveis cópias** · fotos e vídeos · **reconciliação de pastas** · aplicação web local |
| v2 | Google Drive (mesma interface de provedor) |
| v3 | Fotos **parecidas** (redimensionadas, recomprimidas) por *perceptual hash* |
| Futuro | App instalável (Electron), **juntar** pastas (mover arquivos exclusivos) |

Fora da v1: semelhança visual, mover/juntar pastas, outros provedores, exclusão definitiva.

## 3. Distribuição

- Repositório público `twinpix-cloud`, **open source, mas fechado a contribuições**.
  O `CONTRIBUTING.md` explica que pull requests não são aceitos e que o caminho é o fork.
- Licença **MIT** (sugerida; a autora pode trocar por GPL se quiser que forks também sejam abertos).
- README com uma seção "como criar o seu provedor", para quem quiser adaptar a outras nuvens.
- Nenhum segredo no repositório. Cada usuário registra o próprio app na Microsoft
  e coloca o Client ID em `.env` (fica fora do git).

## 4. Arquitetura

Monorepo TypeScript:

```
apps/api   NestJS   (backend local)
apps/web   React + Vite (interface no navegador)
packages/shared  tipos compartilhados
```

Uso: o usuário roda um comando, e o backend sobe em `localhost` e abre o navegador.
A estrutura foi pensada para ser "embrulhada" em Electron depois, sem reescrita.

### Módulos do backend (uma responsabilidade cada)

| Módulo | Responsabilidade |
|---|---|
| `auth` | Login Microsoft (OAuth 2.0 + PKCE, cliente público); guarda o token localmente (ver §8, segurança) |
| `cloud` | **Interface `CloudProvider`**: `listarPastas`, `listarRecursivo`, `obterMiniatura`, `moverParaLixeira`, `restaurar`, `linkWeb`. Implementação v1: `onedrive` (Microsoft Graph) |
| `scan` | Varredura recursiva de uma ou **várias pastas**, em segundo plano, com progresso, retomável |
| `grouping` | Monta os grupos de idênticas e de prováveis cópias e faz a **reconciliação de pastas** |
| `rules` | Função pura: dados um grupo e os critérios ordenados, devolve qual manter e o motivo |
| `actions` | Move para a lixeira, guarda o histórico, desfaz; aplica as travas de segurança |
| `storage` | SQLite local: varreduras, arquivos, grupos, decisões, histórico |

O `similarity` (v3) entra depois como um módulo novo, sem alterar os demais.

## 5. Fluxo

1. **Conectar o OneDrive** (tela de permissão da Microsoft).
2. **Escolher uma ou mais pastas**: pelo navegador de pastas (forma principal) ou
   colando o link da pasta do OneDrive (atalho). A análise inclui **todas as subpastas**
   e compara os arquivos **entre todas as pastas escolhidas**.
3. **Varredura** (só metadados, nada é baixado):
   - lista recursivamente fotos e vídeos;
   - guarda nome, caminho, tamanho, `quickXorHash`, data em que foi tirada
     (`photo.takenDateTime`, com fallback para a data de criação), data de modificação,
     dimensões, câmera (fabricante + modelo) e, nos vídeos, a duração.
4. **Agrupamento**:
   - **Idênticas**: mesmo `quickXorHash` **e** mesmo tamanho.
   - **Prováveis cópias**: hash diferente, mas **mesmo nome-base**
     (ignorando sufixos como ` 1`, ` (2)`, `-1`) **e** mesmas dimensões **e**
     mesma data em que foi tirada. Nos vídeos, a duração precisa bater em ±1 s.
   - **Pastas repetidas**: pares ou conjuntos de pastas que compartilham arquivos
     idênticos, classificados em *idênticas*, *contida em* ou *sobreposição parcial*.
5. **Revisão** (um grupo por tela, com progresso; ver §7).
6. **Confirmação** e **mover para a lixeira** do OneDrive.

A revisão das idênticas pode começar enquanto a varredura ainda roda.
Parar e continuar outro dia retoma do mesmo grupo.

## 6. Regras e proteções

### Regras de prioridade (quem manter)
Lista **ordenada** de critérios, configurada pelo usuário, aplicada como desempate.
Exemplo: 1º maior resolução → 2º mais antiga → 3º está na pasta X.
Critérios v1: maior resolução, maior tamanho, mais antiga (tirada em), mais antiga
(modificada em), está na pasta X / não está na pasta Y, nome sem sufixo de cópia.
A sugestão sempre mostra o **motivo** ("regra: mais antiga").

### Proteções
1. **Prováveis cópias nunca vêm pré-marcadas**: aparece só o selo "sugerida para manter".
   Pré-marcação existe **apenas** nas idênticas.
2. **Nunca exclui de verdade**: tudo vai para a **lixeira do OneDrive**.
3. **Tela de confirmação** antes de qualquer exclusão, inclusive em lote, com a
   contagem, o espaço liberado e a lista conferível.
4. **Trava**: nunca é possível excluir todas as cópias de um grupo.
   Na reconciliação, um arquivo só vai para a lixeira se uma cópia idêntica dele permanecer.
   **Arquivos exclusivos de uma pasta nunca são tocados.**
5. **Histórico + desfazer**, enquanto o arquivo ainda estiver na lixeira.
6. **Lote** (aplicar a regra em todas as idênticas) é uma ação separada e opcional.
   O fluxo padrão é grupo a grupo.

## 7. Telas (esboços aprovados em `.superpowers/brainstorm/*/content/`)

### Revisão de grupo: cartões lado a lado (`revisao-layout-v2.html`)
- Topo: "Grupo 12 de 445 · Prováveis cópias · 2,1 GB liberados até agora".
- Nas prováveis cópias, aviso: "Podem ser a original e uma versão editada. Confira antes de excluir."
- Um cartão por cópia: miniatura grande, **todos os campos com rótulo**
  (Arquivo — nome completo; Pasta; Dimensões; Tamanho; Tirada em; Modificada em;
  Câmera — fabricante + modelo), selo **"★ Sugerida para manter"** (sem a regra no selo),
  caixa "Excluir esta cópia" e link "Abrir no OneDrive ↗".
- **Faixa de legenda no topo**, acima dos cartões, explicando o selo e as cores:
  "★ Sugerida para manter — escolhida pela regra: <motivo> · Campos em laranja são
  diferentes entre as cópias". *(Ajuste da autora em 29/10/2026, após testar a demo.)*
- **Diferenças entre as cópias destacadas em laranja.**
- Botões: ← Voltar · Pular · Excluir marcadas.
- **Confirmação e resultado em modal** sobre a revisão (não sai da tela): o modal mostra
  contagem, espaço liberado e listas; ao confirmar, o mesmo modal mostra o resultado e o
  botão "Próximo grupo", que fecha o modal e carrega o grupo seguinte. Esc/Voltar fecham sem
  fazer nada. *(Ajuste da autora em 29/10/2026.)*
- Público-alvo inclui pessoas não técnicas: rótulos explícitos, sem jargão.

### Layout dos cartões *(ajuste da autora em 29/10/2026)*
- Os cartões **ocupam toda a largura da tela**, todos do mesmo tamanho; a miniatura mostra a
  mídia inteira (sem cortar).
- 2 mídias → 2 por linha; 3 mídias → 3 por linha; **4 ou mais → no máximo 2 por linha**
  (4 = 2+2; 5 = 2+2+1). Em tela estreita, 1 por linha.

### Identidade visual da v1 *(ajuste da autora em 29/10/2026)*
- Sem estudo de identidade completo: só o essencial para uma v1 "bonitinha".
- **Fonte principal: Nunito** (arredondada, legível), usada no texto e no nome/logo
  "TwinPix Cloud"; embutida no app (funciona sem internet).
- Visual **arredondado** (cantos generosos, sombras suaves), paleta curta: azul principal,
  vermelho só para excluir, laranja para diferenças, verde para "sugerida para manter".
- Botões de ação lado a lado (ex.: tela inicial: Ver análise · Continuar revisão · Nova análise).
- Telas de análise e histórico continuam como páginas (não modais).

### Três ou mais cópias (`tres-copias-e-pastas.html`, parte 1)
- Cartões conforme "Layout dos cartões" acima (3 por linha com 3 cópias; 2 por linha a partir de 4).
- Campos iguais em todas as cópias aparecem uma vez, num resumo no topo;
  cada cartão mostra só o que muda.

### Reconciliação de pastas (`reconciliacao.html` e `tres-copias-e-pastas.html`, parte 2)
- Duas pastas: cartões lado a lado. Três ou mais: tabela com Arquivos, "Só nela"
  (com "ver lista") e Situação.
- Quadro-resumo em linguagem simples, indicando quantos arquivos são únicos e que eles nunca serão tocados.
- Escolha de em qual pasta manter as cópias repetidas, ou "Revisar um por um".
- Prévia do resultado ("a 2ª pasta fica vazia") e botão com a contagem
  ("Aplicar (110 arquivos para a lixeira)") → tela de confirmação.

## 8. Tratamento de erros

### Comunicação com o OneDrive
- **Limite de requisições (HTTP 429/503)**: respeitar `Retry-After`, com backoff exponencial;
  a varredura pausa e continua sozinha.
- **Sem internet**: a varredura pausa e mostra "sem conexão"; continua quando a rede volta.
  Ações em andamento ficam pendentes no diário (ver abaixo), nunca pela metade.
- **Token expirado**: renovação automática; se falhar (token revogado, senha trocada),
  pede reconexão sem perder a varredura.
- **Sem permissão (403)**: a v1 trabalha só com o **próprio drive** do usuário; pastas de
  "Compartilhados comigo" não aparecem no navegador de pastas. Se mesmo assim vier 403,
  o item é marcado "sem permissão" e não entra em nenhuma ação.
- **Link colado inválido** (não é do OneDrive, é de outra conta ou não é uma pasta):
  mensagem explicando o motivo, sem iniciar a varredura.
- **Miniatura indisponível** (comum em vídeos e HEIC): o cartão mostra um ícone
  de foto/vídeo no lugar; os dados e a ação continuam disponíveis.

### Varredura e agrupamento
- **Pastas escolhidas que se sobrepõem** (uma dentro da outra): os arquivos são
  identificados pelo **ID do item** no OneDrive, nunca pelo caminho, então o mesmo arquivo
  nunca vira cópia de si mesmo. A tela de escolha avisa: "esta pasta já está incluída em …".
- **Arquivo sem hash** (o OneDrive às vezes não calcula): fica fora das idênticas e
  aparece em "não analisados".

### Ações (mover para a lixeira)
- **Conferência antes de cada item**: antes de mover, o backend busca de novo
  **o arquivo que sai e a cópia que fica**. Os dois precisam existir e manter o mesmo
  `quickXorHash` e tamanho da varredura. Se qualquer um mudou ou sumiu, o grupo é marcado
  "desatualizado" e nada dele é movido. Na reconciliação, a cópia idêntica que permanece
  é conferida do mesmo jeito.
- **Diário de ações**: cada ação é gravada no SQLite como *pendente* **antes** da chamada
  ao OneDrive e atualizada para *feita* ou *falhou* depois. Se o app fechar no meio de um
  lote, ao abrir de novo as pendentes são conferidas no OneDrive e o diário é acertado.
  Um 404 ao repetir uma exclusão já registrada conta como "já estava na lixeira".
- **Falha parcial no lote**: cada item tem resultado próprio; o relatório mostra o que
  foi e o que não foi movido, e por quê.

### Desfazer
- **Item que já saiu da lixeira** (prazo de 30 dias, ou antes se a lixeira encher):
  "não é mais possível restaurar; o arquivo foi removido da lixeira pelo OneDrive".
- **Pasta original apagada** ou **nome já ocupado** no local original: mostrar a mensagem
  de erro do OneDrive em linguagem simples e indicar onde conferir na lixeira pela web.

### Segurança do backend local
- O backend escuta só em `127.0.0.1`.
- Toda requisição exige um **token de sessão** gerado na inicialização e entregue apenas
  à interface aberta pelo próprio backend; requisições com `Origin` diferente são recusadas.
  Isso impede que outro site aberto no navegador chame a API local (ex.: para excluir).
- O token da Microsoft fica num arquivo local fora do repositório, com permissão só para o
  usuário (`0600`). Guardar no chaveiro do sistema fica para a versão Electron.

## 9. Testes

### Unitários
- `rules`: combinações de critérios e desempates.
- `grouping`: idênticas, prováveis cópias, classificação de pastas e normalização de
  nome-base, **com casos negativos** — nomes que *não* podem ser tratados como cópias
  (ex.: sequências legítimas terminadas em `-1`, `-2`; nomes do WhatsApp).
- Remoção de repetidos por ID do item (pastas sobrepostas).

### Trava como propriedade
- Testes baseados em propriedades (`fast-check`): para grupos, seleções e escolhas de
  reconciliação gerados aleatoriamente, **pelo menos uma cópia de cada arquivo sempre
  sobrevive** e **nenhum arquivo exclusivo é tocado**, inclusive com pastas sobrepostas.

### Provedor falso (`FakeCloudProvider`)
Em memória, sem tocar no OneDrive. Precisa simular cada erro da §8:
429/503 com `Retry-After`, perda de conexão, token expirado, paginação (`@odata.nextLink`),
arquivo sem hash, 403, falha parcial no lote e **arquivo alterado ou removido entre a
varredura e a ação — incluindo a cópia que fica**.
Com ele, testar: varredura, retomada sem duplicar arquivos, diário de ações após fechar o
app no meio de um lote, desfazer (incluindo os casos de falha) e conferência antes da ação.

### Fidelidade ao OneDrive real
- **Testes de contrato**: a mesma suíte roda contra o `FakeCloudProvider` e contra o
  OneDrive real, para garantir que o falso se comporta como o verdadeiro.
- **Respostas reais de exemplo** da Microsoft Graph (anonimizadas) para testar a leitura
  dos campos — ex.: `video.duration` vem em **milissegundos**; `photo.takenDateTime` pode faltar.

### Integração com o OneDrive real
- Opcional e manual, numa **pasta de teste combinada com a autora**.
- Em modo de teste, o provedor **recusa qualquer ação fora da pasta de teste** (trava no
  código, não só na disciplina).

### Dados reais (só local)
- Rodar o agrupamento sobre as listagens do rclone (§10) e conferir os números
  (390 e 481 idênticas) e o desempenho com ~24 mil arquivos.
- As listagens contêm nomes privados e **nunca vão para o git**.

### Interface
- Testes de componente dos cartões (rótulos, destaque de diferenças, trava) e da tela de
  confirmação (contagem, espaço liberado, lista).

## 10. Dados de referência (análise real, só leitura, 29/10/2026)

| Pasta | Arquivos | Tamanho | Idênticas (cópias sobrando) | Liberável |
|---|---|---|---|---|
| `Imagens/Imagens da Câmera` | 24.477 (21.289 fotos, 3.188 vídeos), 48 subpastas | 235 GB | 390 (318 fotos, 72 vídeos) | 6,2 GB |
| `Minhas imagens` | 6.292 fotos, 116 subpastas | 7,7 GB | 481 (fotos de 2007) | 0,02 GB |

- Nenhuma cópia idêntica **entre** as duas pastas.
- Nas duas pastas, uns 445 grupos de prováveis cópias (estimativa por nome + tamanho).
  Exemplo real: `20150206_222631_LLS.jpg` e `... 1.jpg`, com mesmas dimensões e mesma
  data em que foi tirada, mas modificados em datas diferentes (07/02 e 21/04/2015).
- `Minhas imagens` tem **pastas inteiras duplicadas** (ex.: `07-06-07/` e
  `minhas fotos/07-06-07/`), o caso de uso da reconciliação.

## 11. Pré-requisitos de implementação

- Registro de app no portal Microsoft Entra (`entra.microsoft.com`): app de cliente
  público, redirect `http://localhost:<porta>`, permissões `Files.ReadWrite` e
  `offline_access`. Com conta pessoal, pode ser necessário criar um diretório
  gratuito antes; validar isso no início da implementação.
