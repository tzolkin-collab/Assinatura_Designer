# P04: Trocar cor, fonte e logo sem regerar

**Camada A (Gabi).** Antes de tudo, leia `docs/aceite/README.md` e siga as regras da seção 3.

## Objetivo
Permitir que a Gabi, depois de gerar um deck, **troque cores, fontes e logo sem regerar a arte**. Hoje só a troca de foto existe no editor.

## Contexto
- Pedido dela (WhatsApp): gerar como faz no ChatGPT, colar no Canva e trocar fotos, cores, fontes e logo sem regerar.
- O motor é `html-design`: o slide é HTML/CSS com texto literal, o que favorece trocar tokens em vez de regerar.
- A ficha do Cérebro é a fonte de verdade de cores, fontes e logo (D1). Fonte própria da marca já funciona via `@font-face` no preview, revisor e exportação (PR #87 e `feat/fontes-varios-pesos`).
- PPTX leva só o **nome** da fonte (pptxgenjs não embute). Exportar para Canva ou imagem.
- Cada fonte embutida pesa ~0,3 a 0,7 MB por slide; considerar embutir só os pesos usados.
- 🟡 Não sei se o HTML gerado usa variáveis CSS para cor/fonte/logo ou valores soltos. **Descubra primeiro**: abra um slide renderizado e olhe o HTML.

## Passos
1. Leia o HTML de 2 slides reais já salvos (leitura). Diga se há tokens (variáveis) ou valores soltos e o que isso implica.
2. Proponha o menor desenho: (a) tokens no HTML gerado + troca no editor, ou (b) pós-processamento que reescreve os valores. Compare risco e custo.
3. Implemente só o escolhido, começando por cor e fonte; logo por último (depende de como o asset é referenciado).
4. Testes: trocar cor muda todos os slides do deck; trocar fonte não quebra o layout além do aviso de overflow; logo trocado persiste na exportação.

## Aceite
- [ ] Troca de cor, de fonte e de logo aplicada ao deck inteiro sem chamar a IA (custo zero, verificável nos logs de uso).
- [ ] Persiste após recarregar e na exportação (imagem; PPTX com a ressalva do nome da fonte).
- [ ] Texto literal intacto.
- [ ] Testes novos, suíte verde, tela conferida.

## Não fazer
Não regerar para trocar. Não criar segundo editor nem novo formato persistido sem decisão do Gustavo. Se exigir migration, **pare e pergunte**.
