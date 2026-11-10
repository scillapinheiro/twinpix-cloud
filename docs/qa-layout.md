# QA do novo layout (v1.1) — roteiro e resultado

Roteiro para repetir o pente fino. Tudo usa o **modo demonstração** (arquivos fictícios; nada toca o OneDrive).

## Como subir o ambiente

```bash
npm run build
# Demo com os cenários extras (análise lenta, pasta sem permissão, arquivo que não vai para a lixeira)
PORT=4400 TWINPIX_DATA_DIR=/tmp/twinpix-qa TWINPIX_DEMO_DELAY_MS=400 node apps/api/dist/main.js --demo
# Tela "Conectar": app real sem conta (o demo já nasce conectado). O client id é só um valor falso.
PORT=4401 TWINPIX_DATA_DIR=/tmp/twinpix-qa2 TWINPIX_CLIENT_ID=00000000-0000-0000-0000-000000000000 node apps/api/dist/main.js
```

- `TWINPIX_DEMO_DELAY_MS=0` deixa o demo instantâneo; `TWINPIX_DEMO_SCENARIOS=0` desliga os cenários extras (os testes e2e usam isso).
- O app usa `HashRouter`: abra a raiz com `#token=…` (impresso no terminal) e depois troque só o `#/rota`. Ao rebuildar, recarregue de verdade (Ctrl+Shift+R ou `?v=N` na URL), porque a troca de hash não recarrega o JS.
- Rotas: `#/`, `#/pastas`, `#/varredura/1`, `#/revisao/1`, `#/revisao/1?tipo=provaveis`, `#/lote/1`, `#/lote/1?tipo=provaveis`, `#/pastas-repetidas/1`, `#/historico`, `#/regras`.
- A janela do Chrome controlada por automação não muda o tamanho da área da página. Para testar larguras, injete um `<iframe>` do mesmo endereço com a largura desejada (1448×808 = notebook; 390 = celular) e meça `contentDocument.documentElement.scrollWidth/scrollHeight`.

## Roteiro por tela e estado

| # | Tela / estado | Como chegar |
|---|---|---|
| 1 | Conectar | porta 4401 |
| 2 | Início sem análise / com análise (cartões lima, rosa, azul) | `#/` |
| 3 | Escolher pastas: vazio, 2 escolhidas, link inválido (faixa rosa) | `#/pastas` |
| 4 | Análise em andamento (barra, Pausar, Cancelar) | iniciar análise com `TWINPIX_DEMO_DELAY_MS=400` |
| 5 | Análise concluída, "ver lista" dos não analisados, pastas puladas (`/Imagens/Backup protegido`) | `#/varredura/1` |
| 6 | Revisão um por um (topo, fim da página), modal Confirmar, modal Resultado com falha | `#/revisao/1` |
| 7 | Prováveis cópias e lote das prováveis | `?tipo=provaveis` |
| 8 | Lote: prévia, lista aberta, modal Confirmar lote, andamento, concluído com 1 falha, "Desfazer este lote" | `#/lote/1` |
| 9 | Pastas repetidas: conjunto, modal, sem conjuntos | `#/pastas-repetidas/1` |
| 10 | Histórico: vazio, com lote e itens, confirmar desfazer | `#/historico` |
| 11 | Regras: lista, adicionar regra, mensagens | `#/regras` |

Estados que o demo **ainda não gera**: "Conectar de novo" (sessão expirada) e pausa por falta de internet.

## Auditoria automática (rodar em cada rota)

Script no console da página que mede: estouro horizontal, fontes carregadas (Unbounded e Figtree), contraste de texto (4,5:1; 3:1 para texto grande), botões/links/campos sem nome acessível, alvos de toque menores que 32 px, imagens sem `alt`, elementos cortados e quantidade de `<h1>`. Mais: `read_console_messages` (erros) e `read_network_requests` (status ≥ 400 e requisições para fora do próprio endereço — não deve haver nenhuma).

## Resultado desta passada

Sem erros de console; todas as requisições 200/304; fontes servidas pelo próprio app; contraste sem falhas; sem imagem sem `alt`.

Corrigido nesta passada:
- Espaço vertical entre texto, listas e botões dentro dos cartões (regra única em `.card`), no Histórico (blocos de lote) e nos modais.
- Marcador de lista ao lado de faixas de aviso/erro (modal Resultado, análise, lote): removido em qualquer `li.alert`/`li.notice`.
- Início e Conectar cabem na altura de 808 px sem rolagem; cartões rosa e azul com a mesma altura e conteúdo (chips de grupos e barra de progresso da revisão).
- "71,8 MB" quebrando em duas linhas: a unidade ficou menor.
- Título do Conectar quebrava ao lado da ilustração: coluna de texto limitada.
- Revisão sem `<h1>`: ganhou um título só para leitor de tela.
- Alvos de toque pequenos (links do menu, "ver lista", "abrir ›", "Abrir no OneDrive"): área clicável maior; botões de opção (rádio) refeitos com 24 px.
- Moldura tracejada ao redor das fotos (era de placeholder): removida.
- Celular (390 px): barra de navegação sem estourar, tabela do Histórico com rolagem própria.
- Listas de números sem marcadores soltos (Análise, Lote).

## Em aberto / para olhar com calma

- Celular: a barra de ações da revisão ocupa bastante altura (três linhas). O app é pensado para computador, então ficou como está.
- Cantos arredondados grandes (64 px) em telas pequenas foram só reduzidos, não redesenhados.
- Não testado: leitor de tela real, navegação só por teclado em todas as telas (o foco visível está definido, mas não percorri tudo), modo escuro, zoom do navegador a 200%.
- Estados sem demo: "Conectar de novo" e pausa por falta de internet.
