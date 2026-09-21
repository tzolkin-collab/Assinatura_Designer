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

### Depois de rodar

Revise o arquivo gerado e commite `docs/benchmark/BASELINE-DESIGNER.md`. Ele é um retrato de uma
data: reexecute o script quando quiser comparar (por exemplo, depois de trocar o modelo do artista).
