# P01: Fotos reais da Amanda e Teste 2

**Camada A (Gabi).** Antes de tudo, leia `docs/aceite/README.md` e siga as regras da seção 3.
**Bloqueios:** chave Gemini nova (Camada C) e **autorização do Gustavo** para gravar no banco/R2 e gerar 1 deck (~US$ 0,40).

## Objetivo
Fechar o **Teste 2 do Checklist Operacional (slide com foto real)** na Amanda Coelho e confirmar que as fontes Queens e Aeonik são usadas sem substituição silenciosa.

## Contexto
- A Amanda tem **0 fotos reais** no banco. Os 8 JPEG do álbum de 05/10 estão em `WhatsApp Image 2026-10-05 at 19.03.*.jpeg`, na pasta do projeto (`projeto-assinatura`). Os `Gemini_Generated_Image_*.jpg` de Downloads são imagens de IA e **não entram como foto**.
- Fontes da Amanda: 16 arquivos na biblioteca (Queens Regular e Var; Aeonik, 14 arquivos), ficha com `source: 'custom'`. Os binários são comerciais e ficam em `insumos-amanda/` (fora do git).
- Scripts prontos: `backend/scripts/loadAmandaPhotos.ts` (simula por padrão, grava com `--apply`) e `backend/scripts/teste2FotoReal.ts`. Há também `aceiteCerebro.ts`.
- Regra de foto real: o artista só usa foto real fornecida; sem foto, reserva a área. Cartão "Confirmar regra de foto real" precisa ser respondido.

## Passos
1. Abra **cada** JPEG antes de subir. Descarte o que não for foto real adequada (pessoa identificável sem autorização, baixa qualidade). Liste as aprovadas.
2. Rode `loadAmandaPhotos.ts` **sem** `--apply` e mostre o que seria gravado. Peça autorização ao Gustavo.
3. Com autorização, rode com `--apply` e confirme as fotos na biblioteca (leitura).
4. Rode o Teste 2 com `teste2FotoReal.ts` (1 deck, backend local com fila isolada).
5. Confira no resultado: a foto real aparece onde deveria; nenhuma pessoa gerada por IA; texto literal; fonte da marca aplicada (Queens/Aeonik) e sem fallback Playfair/Manrope.
6. Registre o resultado no checklist preenchido (`CHECKLIST OPERACIONAL`), com versão, ambiente e post id.

## Aceite
- [ ] Fotos aprovadas listadas, uma a uma, com motivo das descartadas.
- [ ] Teste 2 executado em geração real, com post id e evidência visual.
- [ ] Fonte da marca confirmada no HTML renderizado (não só na ficha).
- [ ] Decks de teste criados estão listados para limpeza posterior (**não apagar sem autorização**).

## Não fazer
Não subir fotos sem abrir. Não gerar mais de 1 deck sem pedir. Não commitar fontes nem fotos. Não repetir a geração do mesmo texto esperando resultado diferente: só vale com insumo novo.
