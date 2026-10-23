# P05: Seletor de modo, "Nova imagem" e e-book A4 (decisão antes de código)

**Camada A (Gabi).** Antes de tudo, leia `docs/aceite/README.md` e siga as regras da seção 3.
**Esta tarefa começa por decisão, não por código.** O e-book A4 é custo adicional e precisa ser comunicado à Gabi (combinado de 06/10).

## Objetivo
1. Entregar o **seletor de modo** e as ações **"Nova imagem"** e **"Novo e-book A4"** no projeto, se couber.
2. Levar ao Gustavo uma **estimativa de custo e escopo do e-book A4** antes de implementar.

## Contexto
- Teste 7 do checklist (E-book A4): **não existe**. Precisa de formato de peça, tela e renderizador novos.
- Seletor de modo: nota 3 em 10. Defeito conhecido: o **modo Auto vira Manual sozinho** e a Fábrica faz a pergunta "Qual o destino da peça?" antes de gerar (ver P07).
- Direção de produto já registrada em `docs/PLANO-CONSOLIDACAO.md`: Design e Apresentação se distinguem pelo uso/formato, não por novo formato de documento.
- `handoff.md` na raiz (06/10) propõe Design em lote; é anterior e aguarda orçamento. Não implemente por ele.
- Pergunta aberta para a Gabi: imagem avulsa e e-book A4 entram **nesta** etapa?

## Passos
1. Leia `docs/PLANO-CONSOLIDACAO.md` e o código da Fábrica que escolhe modo/destino. Liste os arquivos reais.
2. Escreva em `docs/aceite/propostas/modos-e-ebook.md`: o que existe, o que falta, esforço (em dias, com a incerteza dita), custo de API por peça e riscos. Separe **seletor/Nova imagem** (pequeno) de **e-book A4** (grande).
3. Entregue a proposta e **pare**. Só implemente o que o Gustavo aprovar.
4. Se aprovado o seletor/Nova imagem: reutilize o pipeline `html-design`, sem motor, formato ou fila novos.

## Aceite
- [ ] Proposta com custo, esforço e a pergunta objetiva para a Gabi sobre o e-book.
- [ ] (Se aprovado) seletor funciona, Auto não vira Manual, testes e tela conferidos.

## Não fazer
Não implementar e-book A4 sem aprovação de custo. Não criar segunda tela de lote.
