# P03: Aviso ao usuário quando o texto não cabe

**Pedido da Gabi** (§3.1 item 6, §7.1). Antes de tudo, leia `docs/aceite/README.md` e siga as regras da seção 4.
**Tarefa no Core:** "[Designer] Aviso ao usuário quando o texto não cabe". **Toca `pipeline.ts`: rode sozinho.** Depende de #124 mergeado (base) e do #117 (já em `main`).

## Escopo (reescrito em 19/10 por decisão do Gustavo)

O escopo original tinha três partes. **Só uma sobra:**
- **Conflito de versões do texto (§2): DESCARTADO.** Não construir. (A versão anterior deste prompt pedia isso: estava errada.)
- **Pendências objetivas e "peça com texto em revisão não vira final" (§13 passo 8): JÁ FEITO** no PR #117. `finalGate.ts` grava `content.finalGate` com `blocking` e `notes`; publicar e exportar (app e MCP, #118) recusam rascunho e aceitam `confirmarRascunho`; a Fábrica mostra a faixa de pendências.
- **Aviso de texto que não cabe: A ÚNICA PARTE QUE SOBRA.** É correção de comportamento, não feature.

## Objetivo
Quando o texto aprovado não cabe de forma legível, o manual manda **preservar o texto e sinalizar a necessidade de decisão editorial**. O Teste 4 (15/10) preservou o texto sem criar slide extra, mas **sem aviso visível**: hoje só o revisor visual percebe o estouro (tipo `overflow`), e isso não chega à pessoa como pendência.

## Contexto verificado no código (branch do #124)
- `backend/src/lib/designerBrain/finalGate.ts`: `computeFinalGate({ hasInReview, requestedCount, generatedCount, fontNotice, brainPending })` devolve `{ blocking, notes }`. **Avisos entram como `notes`** (não bloqueiam); só texto em revisão bloqueia.
- `backend/src/lib/designerBrain/textCheck.ts`: compara o texto aprovado com o texto visível do slide (palavras faltando ou sobrando). **Não** mede estouro visual.
- `backend/src/agents/reviewer/index.ts`: o revisor visual já tem o tipo de desvio `overflow`.
- `frontend/src/components/Fabrica/ArtifactPanel.tsx` e `frontend/src/lib/finalGate.ts`: onde a faixa é exibida.
- 🟡 Não confirmei onde o resultado do revisor chega ao `computeFinalGate`. **Descubra primeiro** e liste os arquivos reais.

## O que construir
- [ ] Quando o revisor apontar `overflow` (ou o texto ficar comprimido), entrar como **nota** no `finalGate`, reaproveitando o #117, e aparecer na faixa da Fábrica dizendo o que decidir (cortar, dividir em slide, diminuir).
- [ ] **Sem criar slide extra e sem cortar texto sozinho.**

## Aceite
- [ ] Repetir o **Teste 4** (6 blocos longos em 3 slides) e ver o aviso visível. **Pede autorização e chave Gemini nova** para a geração; sem elas, prove com teste automatizado e diga que a geração real não foi feita.
- [ ] A peça com o aviso aparece com a pendência e o texto continua intacto.
- [ ] Teste novo que **falha sem a mudança** e passa com ela; suíte e `tsc` verdes; tela conferida (API de mentira).

## Não fazer
Não implementar detector de conflito de versões. Não mudar o formato persistido sem decisão. Se precisar de migration, **pare e pergunte**.
