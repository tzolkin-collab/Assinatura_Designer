# Baseline do Designer IA — custo e tempo por deck

> Gerado em 2026-10-06T21:19:19.478Z por `backend/scripts/baselineGenerationRuns.ts` (somente leitura).
> Amostra: **2** gerações de deck concluídas desde 2026-10-04 (feature `pipeline`, status COMPLETED). No mesmo recorte: 1 falharam e 1 ainda constam como em andamento.
> **Tudo aqui é ESTIMATIVA**, não fatura: o custo é tokens gravados × tabela de preços de `backend/src/config.ts`.

## Apresentação — 2 gerações

| Métrica | Amostra | Mediana | p90 |
|---|---:|---:|---:|
| Duração | 2 | 3min 37s | 4min |
| Custo estimado | 2 | US$ 0,4257 | US$ 0,4428 |
| Tokens (entrada + saída) | 2 | 72.190 | 73.681 |
| Slides | 2 | 7 | 7 |
| Imagens geradas | 2 | 0 | 0 |

## Preços usados (US$ por 1M de tokens)

| Modelo | Entrada | Saída |
|---|---:|---:|
| `gemini-3.1-pro-preview` | 2 | 12 |
| `gemini-2.5-pro` | 1.25 | 10 |
| `gemini-3.5-flash` | 0.3 | 2.5 |
| `gemini-2.5-flash` | 0.3 | 2.5 |
| `gemini-2.5-flash-lite` | 0.1 | 0.4 |
| `gemini-3.1-flash-image` | 0.5 | 60 |
| `gemini-3.1-flash-lite-image` | 0.25 | 30 |
| `gemini-3-pro-image` | 2 | 120 |

## Como ler (e o que este número NÃO é)

- **Estimativa, não fatura.** A fatura real é a do Google; a tabela de preços envelhece.
- **Raciocínio (thinking) só entra em gerações recentes.** O Gemini cobra esses tokens como saída, mas o rastro só passou a gravá-los depois de `feat(tracing)` — antes, o custo do artista está subestimado. Use `--since` com a data em que isso entrou no ar para um recorte mais fiel.
- **Slides = contagem atual do deck**, não a do momento da geração (o usuário pode ter apagado ou acrescentado slides depois).
- **Duração** = `finishedAt − startedAt` do run de geração; não inclui edições posteriores do deck.
- **p90** é por posto mais próximo (o valor de uma geração real da amostra); com poucas gerações ele é quase o máximo.
- O baseline cobre só a geração inicial do deck (`pipeline`). Edições por chat e por slide têm runs próprios e não entram aqui.
