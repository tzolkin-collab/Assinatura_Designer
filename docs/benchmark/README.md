# Benchmark do Designer IA

Esta pasta guarda as medições de custo e tempo do Designer. Hoje tem um item.

## Baseline de geração (`BASELINE-DESIGNER.md`)

Responde, com dado real de produção, "quanto custa e quanto demora um deck?" — mediana e p90 de
duração, custo estimado, tokens, número de slides e de imagens, separados por formato
(apresentação e carrossel). É a base para provar (ou não) que o custo por deck é menor que a
assinatura de um concorrente.

> **O script é SOMENTE LEITURA.** Ele abre a conexão em `BEGIN READ ONLY` + `SET TRANSACTION READ ONLY`
> (o Postgres recusa qualquer escrita), só emite `SELECT` e termina sempre em `ROLLBACK`, nunca em
> `COMMIT`. Não cria tabela, não altera linha, não roda migration. Se as tabelas de rastro não
> existirem no banco, ele avisa e sai sem escrever nada. Cada instrução ainda passa por uma trava
> em código (`assertReadOnlySql`) que recusa qualquer coisa que não seja leitura.

### Como rodar

A partir da pasta `backend/`, com o `DATABASE_URL` do banco que você quer medir no ambiente.

PowerShell:

```powershell
cd backend
$env:DATABASE_URL = "<a URL do Postgres>"
pnpm exec tsx scripts/baselineGenerationRuns.ts
```

Bash:

```bash
cd backend
DATABASE_URL="<a URL do Postgres>" pnpm exec tsx scripts/baselineGenerationRuns.ts
```

O script não lê `.env` por conta própria, mas importa `src/config.ts`, que (como no app) carrega
`backend/.env` se ele existir — isso também traz `AI_MODEL_PRICES`, então o custo usa os mesmos
preços do app. Se você exportou `DATABASE_URL` na sessão, ele tem precedência sobre o arquivo.

Ao começar, o script imprime o host/base onde está conectando (sem usuário nem senha) para você
conferir que é o banco certo.

Opções:

| Opção | Efeito |
|---|---|
| `--since AAAA-MM-DD` | Só gerações iniciadas a partir da data. Recomendado usar a data em que o rastro de tokens de raciocínio entrou no ar: antes disso o custo do modelo "artista" está subestimado (ver abaixo). |
| `--out caminho.md` | Escreve em outro arquivo em vez de `docs/benchmark/BASELINE-DESIGNER.md`. |

Códigos de saída: `0` escreveu o arquivo; `1` erro (sem `DATABASE_URL`, `--since` inválido, falha de
conexão); `2` as tabelas `GenerationRun`/`GenerationStep` não existem nesse banco (a migration
`20260802081926_add_generation_tracing` não foi aplicada); `3` as tabelas existem mas não há
gerações concluídas no recorte. Nos códigos 1, 2 e 3 nenhum arquivo é escrito, então um baseline
anterior nunca é sobrescrito por um vazio.

### O que entra na conta

- **Universo:** runs com `feature = 'pipeline'` (geração inicial do deck) e `status = COMPLETED`.
  Edições por chat e por slide têm runs próprios e ficam de fora.
- **Custo:** tokens gravados em `GenerationStep` × tabela de preços de `backend/src/config.ts`
  (mesma função que alimenta o chip "Custo estimado" do editor: `backend/src/lib/generationCost.ts`).
  Modelo sem preço na tabela marca a run como **parcial** em vez de virar zero.
- **Slides:** contagem atual da tabela `slides` do post (a tabela não guarda a do momento da geração).
- **Duração:** `finishedAt − startedAt` do run.

### Limites (leia antes de citar o número)

- É **estimativa**, não fatura. A fatura real é a do Google.
- Os tokens de raciocínio (thinking), que o Gemini cobra como saída, só são gravados no rastro a
  partir do commit `feat(tracing): grava os tokens de raciocinio no step`. Gerações anteriores
  têm o custo do artista subestimado.
- Com poucas gerações, o p90 é quase o máximo (usa posto mais próximo, sem interpolar).
- **Um run `pipeline` vira `COMPLETED` mesmo em pausas** — amostra de estilo (`generateStyleProofOnly`),
  revisão pendente (`pendingReview`) ou bundle de imagens ambíguas (`pendingImageCandidates`). O
  pipeline fecha o run (`closeRun`) sempre que `runPipelineInner` retorna, inclusive nesses pontos de
  pausa: não é uma falha, é o desenho atual de "gera → para → espera decisão no chat". Quando o
  usuário retoma (aprova a amostra, decide o bundle), a retomada abre **outro** run `pipeline` para o
  **mesmo post** — logo um post pode ter vários runs `COMPLETED` que são, na prática, pedaços de uma
  única geração. Isto significa que mediana e p90 deste baseline podem misturar execuções parciais
  (só a capa, por exemplo) com execuções completas, sem diferenciar as duas. Não corrigido aqui —
  fica registrado como limitação conhecida para quem for interpretar os números.

### Depois de rodar

Revise o arquivo gerado e commite `docs/benchmark/BASELINE-DESIGNER.md`. Ele é um retrato de uma
data: reexecute o script quando quiser comparar (por exemplo, depois de trocar o modelo do artista).

## Variedade de composição (`backend/scripts/medirVariedade.cjs`)

Mede o quanto os slides de um deck diferem entre si: mapa de ocupação 16×9 de cada slide e distância média entre
pares (0 = slides iguais, 1 = totalmente diferentes). **É uma métrica grosseira**: vê onde há conteúdo contra o fundo,
não tipografia, cor nem ilustração, e um deck com direção de arte por slide pode marcar baixo mesmo variando à vista.
Use para comparar versões do Designer entre si; para decidir qualidade, mostre à Gabriela.

```bash
node scripts/medirVariedade.cjs <pasta com *-slide1.png, *-slide2.png ...>
```

Medição de 15/10/2026: lotes do GPT dela 0,12 a 0,47; decks da Amanda no Designer 0,05 a 0,18.

## Insumo do teste justo (`lote1-gabriela/`)

`brief.txt` e `copy.txt` são o lote 1 do prompt da Gabriela (direção de arte por slide e o texto exato), no formato que
`backend/scripts/aceiteCerebro.ts gpt1` consome. Originais em `chatgpt.com/share/6ac41d50-5488-83e9-84b7-1bc6dd2878ec`.

## Teste de aceite do cérebro (`backend/scripts/aceiteCerebro.ts`)

Roda os cenários t1, t3, t4, t4b, t6 e gpt1 direto no pipeline. Grava um deck de verdade e custa cerca de US$ 0,40. O cérebro é global (padrão); para o cenário sem cérebro passe `sem-cerebro` como 2º argumento (define `DESIGNER_BRAIN_GLOBAL=off`). Apagar `DESIGNER_BRAIN_BRANDS` não desliga mais nada.

