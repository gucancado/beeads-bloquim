# Checklist manual de smoke — Canvas do Plano de Ação

> **Propósito:** rede de segurança da **camada de render/interação** do canvas
> ReactFlow (a parte que os testes de dados em `canvasDataLayer.smoke.test.ts`
> **não** cobrem). Junto com aquele gate, forma o gate de não-regressão do
> Mapa Estratégico. **Rodar este checklist inteiro, sem desvio, antes de
> qualquer merge que toque o `CanvasBase` ou as rotas de `maps`.**
>
> Escrito para ser executável por alguém **sem contexto do código**. Cada item
> tem um critério de aprovação **visual e explícito**. Se um item falhar,
> anote no rodapé e **não** aprove o merge.

## Setup (fazer exatamente assim)

1. Subir os dois dev servers:
   - API: `pnpm --filter @workspace/api-server run dev` (porta 5000)
   - Front: `pnpm --filter @workspace/mindtask-app run dev` (porta 3000)
   - `DATABASE_URL` apontando para **dev** (project ref `dzhdnaemauvtdchbkppp`), nunca prod.
2. Abrir `http://localhost:3000`, registrar/logar com um usuário de teste.
3. Criar um workspace chamado **`SMOKE`** (você será `admin`).
4. Dentro de `SMOKE`, aba **Mapas**, criar um mapa chamado **`Canvas Smoke`**.
5. Abrir o mapa `Canvas Smoke` → você está no canvas. **Este é o ponto de partida de todos os itens abaixo.**

> Para os itens de presença (item 11) é preciso **2 abas** do mesmo browser (ou 2 browsers) logadas no mesmo usuário, ambas no mesmo mapa `Canvas Smoke`.

## Itens

Marque `[x]` em PASS, deixe `[ ]` e anote no rodapé em FAIL.

- [ ] **1. Abrir o mapa.** Recarregar a página do canvas.
  - **PASS:** o canvas carrega sem erro de console; toolbar aparece no topo; controles de zoom (canto inferior) aparecem; viewport faz auto-`fitView`.

- [ ] **2. Criar card (tarefa).** Clicar no botão de **adicionar tarefa** na toolbar (tooltip "Clique para adicionar tarefa no centro • Arraste para posicionar").
  - **PASS:** um card novo aparece no centro do canvas, com cor de status `draft` (slate); título editável.

- [ ] **3. Editar card inline (autosave).** Clicar no título do card, digitar "Card A", clicar fora.
  - **PASS:** o texto persiste sem botão Salvar; após **F5**, "Card A" continua lá.

- [ ] **4. Ligar 2 cards.** Criar um segundo card ("Card B"). Arrastar do handle **direito** do Card A até o handle **esquerdo** do Card B.
  - **PASS:** surge uma aresta conectando A→B; após F5, a aresta persiste.

- [ ] **5. Arrastar nó.** Arrastar o Card A para outra posição.
  - **PASS:** o card segue o mouse suavemente; a aresta A→B reajusta; após F5, a nova posição persiste.

- [ ] **6. Criar texto livre.** Clicar no botão de **texto** (tooltip "Clique para adicionar texto no centro • Arraste para posicionar"). Digitar "Texto Smoke".
  - **PASS:** um TextNode editável aparece; o texto persiste após F5.

- [ ] **7. Criar forma.** Clicar no botão de **forma geométrica** (tooltip "Inserir forma geométrica"), escolher um retângulo.
  - **PASS:** uma forma retangular aparece no canvas; pode ser movida e redimensionada; persiste após F5.

- [ ] **8. Inserir imagem.** Clicar no botão de **imagem** (tooltip "Inserir imagem (clique ou cole com Ctrl+V)") e enviar um PNG pequeno (ou colar com Ctrl+V).
  - **PASS:** a imagem aparece como uma forma `image` no canvas; persiste após F5.

- [ ] **9. Zoom.** Usar os botões "aproximar" e "afastar" dos controles (e scroll do mouse).
  - **PASS:** o canvas amplia/reduz centrado; nada some nem desalinha.

- [ ] **10. Pan + enquadrar.** Arrastar o fundo vazio do canvas (pan). Depois clicar em "enquadrar" (fitView).
  - **PASS:** o pan move toda a cena; "enquadrar" reposiciona para mostrar todos os nós.

- [ ] **11. Cursor de outro usuário (presença, 2 abas).** Com 2 abas no mesmo mapa, mover o mouse sobre o canvas na aba 1.
  - **PASS:** o cursor da aba 1 aparece em tempo real na aba 2 (e vice-versa), com rótulo do usuário.

- [ ] **12. Seleção múltipla.** Arrastar uma caixa de seleção (ou Shift+clique) abrangendo Card A e Card B.
  - **PASS:** ambos os cards ficam visualmente selecionados (contorno destacado).

- [ ] **13. Deletar.** Com Card B selecionado, apertar **Delete**. Confirmar no diálogo ("excluir tarefa?").
  - **PASS:** o diálogo de confirmação aparece; ao confirmar, o card some junto com a aresta A→B; após F5, continua removido.

- [ ] **14. Undo / Redo.** Após a deleção, apertar **Ctrl+Z** (desfazer) e depois **Ctrl+Y** (refazer).
  - **PASS:** Ctrl+Z restaura o card deletado; Ctrl+Y o remove de novo. *(Confirma a preservação do undo/redo — ver `canvas-extraction-seam.md` §undo/redo.)*

## Rodapé de execução (preencher a cada rodada)

| Campo | Valor |
|---|---|
| Data/hora | |
| Commit SHA (`git rev-parse --short HEAD`) | |
| Executor | |
| Browser/SO | |
| Itens em FAIL (nº + descrição do desvio) | |
| Resultado | ☐ TODOS PASS (gate verde) · ☐ HÁ FAIL (bloquear merge) |
