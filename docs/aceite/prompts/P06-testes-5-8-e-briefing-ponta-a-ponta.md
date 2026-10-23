# P06: Testes 5 e 8, briefing de ponta a ponta e fechamento do Checklist Operacional

**Camada A (Gabi).** Antes de tudo, leia `docs/aceite/README.md` e siga as regras da seção 3.
**Bloqueios:** chave Gemini nova; **autorização** para as gerações; fotos da P01 se o teste usar foto.

## Objetivo
Rodar os testes que faltam e preencher o Checklist Operacional com evidência, versão e ambiente:
- **Teste 5, continuidade (lote 2):** o segundo lote mantém o sistema visual do primeiro.
- **Teste 8, collab:** hoje só existe cobertura automatizada; rodar em geração real.
- **Briefing por campos** (PR #119, em `main`): confirmar com a IA, em marcas reais, que cada campo vira o status certo.

## Contexto
- Os 8 testes e o estado de 15/10 estão em `docs/HANDOFF-CEREBRO-DA-IA.md` §11.4. Passaram 1, 3 e 6; parciais 4 e 8; não rodados 2 e 5; o 7 não existe.
- O template do §12 do documento dela separa `TEXTO APROVADO POR SLIDE`, `FALA / CONTEXTO NÃO VISÍVEL` e `INFORMAÇÕES INTERNAS OU PROIBIDAS`; o status vem do campo que o texto ocupa. O painel gera as mesmas marcas que o backend já lê (`copyBlocks.ts`, `textStatus.ts`).
- Só com o **#124 em produção/local** o `[INTERNO]` deixa de chegar ao artista em projeto sem ficha. Rode estes testes **com** o #124 aplicado.
- O checklist preenchido está em `docs/CHECKLIST OPERACIONAL - preenchido 2026-10-15.docx`. É rascunho; o Google Doc dela **não** foi alterado.
- `backend/scripts/aceiteCerebro.ts` é o roteiro de testes de aceite.

## Passos
1. Backend local com fila isolada. Peça autorização com o número de decks previstos.
2. Teste 5: gere o lote 1 e o lote 2 do mesmo projeto; compare paleta, tipografia e estrutura; registre divergências.
3. Teste 8: crie um desdobramento/collab e verifique herança e isolamento (a identidade do parceiro não vaza para o projeto-base e vice-versa).
4. Briefing: preencha um deck com texto em cada campo, incluindo `INFORMAÇÕES INTERNAS`; confirme no que chegou ao planner e ao enqueue que o interno **não** passou.
5. Atualize o checklist preenchido (cópia nova datada; não sobrescreva o de 15/10) com versão, ambiente, post ids e resultado.

## Aceite
- [ ] Testes 5 e 8 com evidência de geração real.
- [ ] Interno comprovadamente fora do que o artista recebe, com e sem ficha.
- [ ] Checklist preenchido, com "não verificado" explícito onde for o caso.
- [ ] Decks de teste listados para limpeza.

## Não fazer
Não alterar o Google Doc da Gabriela. Não declarar o Designer "validado": ela ainda não validou.
