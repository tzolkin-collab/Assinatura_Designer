# P04: Trocar cor, fonte e logo sem regerar (ADIADO: não executar)

**Status: adiado.** Depende da resposta da Gabi. Leia `docs/aceite/README.md`.

## Por que está parado
É **feature nova** (hoje só a troca de **foto** existe no editor), e a regra de 19/10 é "não adicionar features". O pedido vem do WhatsApp da Gabi (jul a out): gerar como no ChatGPT, colar no Canva e trocar fotos, cores, fontes e logo sem regerar.

A **pergunta já está na tarefa de FUP** do Core ("FUP Gabriela: perguntas de produto antes de construir"): *"Trocar sem regerar: qual é a prioridade?"* Se ela disser que é essencial para a homologação, **o Gustavo decide** se entra, e só então este prompt é reaberto.

## Se for reaberto (notas para quem pegar)
- O motor é `html-design`: o slide é HTML/CSS com texto literal, o que favorece trocar valores em vez de regerar. 🟡 Não sei se o HTML gerado usa variáveis CSS ou valores soltos: **abra 2 slides reais e olhe antes de projetar**.
- A ficha do Cérebro é a fonte de verdade de cores, fontes e logo (D1). Fonte própria já funciona via `@font-face` no preview, no revisor e na exportação.
- **PPTX leva só o nome da fonte** (pptxgenjs não embute). Cada arquivo de fonte embutido pesa ~0,3 a 0,7 MB por slide.
- Critério de aceite mínimo: trocar cor, fonte e logo no deck inteiro **sem chamar a IA** (custo zero, verificável no registro de uso), persistindo ao recarregar e na exportação, com o texto literal intacto.
