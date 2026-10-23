# P12: WP7, área Moodboard

**Camada B (ajustes do Gustavo).** Antes de tudo, leia `docs/aceite/README.md` e siga as regras da seção 3.
**Depende de:** WP2 (#123) mergeado.

## Objetivo
Executar D8: a pesquisa de concorrentes saiu; **fica o Moodboard**, como Assets da marca com a tag `moodboard`. Entregar a área na Biblioteca de mídia e na Visão geral (o card Moodboard ficou pendente no #123, "previsto").

## Contexto
- A moodboard anexada no chat já chega à geração: o pipeline busca do R2, limitado a `brands/<slug>/chat-attachments/`, até 3 arquivos de 8 MB, só JPEG/PNG/WebP, anexados às chamadas Gemini como **referência de estilo** (nunca no slide). Nomes como moodboard/mood board/referência visual recebem papel de referência visual. Preservar isso.
- A Gabi mandou moodboards ("Moodboard para apresentações", "Moodboard Editorial da Marca") para a Amanda.
- Sem apagar dados antigos de Referências (Fase 1 não apagou nada). Apagar só com backup conferido e aprovação por escrito.
- 🟡 Não sei como a tag `moodboard` hoje se relaciona com `chat-attachments`. **Descubra** e defina uma fonte única (asset da marca com tag) sem quebrar o caminho do chat.

## Passos
1. Mapeie o modelo de Asset e a tag. Leia o trecho do pipeline que carrega moodboards.
2. Proponha o menor desenho (arquivos, API, UI). Se exigir migration, **pare e pergunte**.
3. Implemente: marcar um asset como moodboard; listar; pipeline passa a ler também os assets com a tag (respeitando os limites); card na Visão geral.
4. Teste: asset com tag chega ao artista como referência de estilo e **não** vira foto inserível; sem moodboard, nada muda.

## Aceite
- [ ] Marcar/desmarcar moodboard na Biblioteca; card na Visão geral.
- [ ] Teste prova a chegada como referência de estilo e a exclusão da lista de fotos.
- [ ] Caminho do chat continua funcionando.
- [ ] Suíte verde, `tsc` limpo, tela conferida. Efeito na arte **declarado** (medir exige autorização).

## Não fazer
Não restaurar a pesquisa de concorrentes. Não ler arquivos fora do prefixo da marca.
