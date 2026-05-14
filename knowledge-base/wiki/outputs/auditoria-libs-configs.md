---
title: Auditoria — Gerenciamento de Bibliotecas e Configurações
type: output
tags:
  - "auditoria"
  - "libs"
  - "config"
  - "designer"
  - "bot-gabi"
  - "gemini"
  - "sdk"
  - "duplicação"
  - "refactor"
sources: []
created: 2026-04-24
updated: 2026-04-25
---

# Auditoria — Gerenciamento de Bibliotecas e Configurações

## Resumo

Mapeamento dos problemas de dependências, variáveis de ambiente e configurações em ambos os projetos (Designer e Bot Gabi). O cenário atual tem SDKs duplicados, ferramentas redundantes resolvendo o mesmo problema, configurações hardcoded e ausência de contrato compartilhado entre frontend e backend. Cada problema está classificado por severidade e acompanha a resolução recomendada.

---

## Visão Geral dos Problemas

| # | Problema | Projeto | Severidade | Categoria |
|---|---|---|---|---|
| L1 | SDK Gemini antigo (`@google/generative-ai`) vs SDK novo (`@google/genai`) | Designer Backend | ✅ Resolvido (Sprint 0) | SDK duplicado |
| L2 | URL do backend hardcoded `localhost:4000` no frontend | Designer Frontend | ✅ Resolvido (Sprint 0) | Config inoperante |
| L3 | Dois API keys para o mesmo provider/modelo Gemini sem diferença real | Designer Backend | 🟡 Médio | Config confusa |
| L4 | Gemini + OpenAI fazendo tarefas sobrepostas no Bot Gabi | Bot Gabi | 🟡 Médio | Ferramenta duplicada |
| L5 | `ffmpegVideo.ts` — dependência morta no bundle do frontend | Designer Frontend | 🟡 Médio | Dependência inerte |
| L6 | Nenhum tipo compartilhado entre frontend e backend (`DesignState`, `Layer`) | Designer | 🟡 Médio | Contrato ausente |
| L7 | Versão não-canônica do Next.js (aviso no AGENTS.md) | Designer Frontend | 🟡 Médio | Risco de incompatibilidade |
| L8 | Zero padronização de env vars entre Designer e Bot Gabi | Ambos | 🟢 Baixo | Config inconsistente |
| L9 | Prisma definido mas possibilidade de queries diretas em paralelo | Designer Backend | 🟢 Baixo | Risco de inconsistência |

---

## Detalhamento por Problema

---

### L1 — SDK Gemini Antigo vs Novo ✅ RESOLVIDO em 2026-04-25

**O que está acontecendo:**

O Designer Backend usa `@google/generative-ai` (SDK legado). Para suportar geração de imagens (Gemini 2.5 Flash Image — planejada para o Sprint 1), o SDK **necessário** é `@google/genai` (SDK novo, v1). Os dois pacotes têm APIs completamente diferentes e **não são intercambiáveis**.

```typescript
// SDK antigo (atual — @google/generative-ai)
import { GoogleGenerativeAI } from '@google/generative-ai';
const genAI = new GoogleGenerativeAI(apiKey);
const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-lite' });

// SDK novo (necessário — @google/genai)
import { GoogleGenAI } from '@google/genai';
const ai = new GoogleGenAI({ apiKey });
const response = await ai.models.generateImages({ model: 'gemini-2.5-flash-image', ... });
```

**Por que é crítico:**

1. Gemini 2.0 Flash Lite **depreciado em 01/06/2026** — a migração do modelo é obrigatória.
2. A geração de imagens (MVP 3) só está disponível no SDK novo.
3. Manter os dois SDKs instalados simultaneamente é possível, mas cria dois client patterns distintos no mesmo codebase.

**Resolução:**

Migrar completamente para `@google/genai` em uma operação única no Sprint 0. Arquivos afetados:
- `designer/backend/src/lib/nanoBanana.ts`
- `designer/backend/src/routes/ai.ts` (todos os handlers)
- `designer/backend/package.json` (`npm uninstall @google/generative-ai && npm install @google/genai`)

---

### L2 — URL Hardcoded `localhost:4000` no Frontend ✅ RESOLVIDO em 2026-04-25

**O que está acontecendo:**

O frontend chama o backend em `localhost:4000` diretamente via `src/lib/api.ts`. Não há variável de ambiente controlando o endpoint base.

**Por que é crítico:**

Em qualquer ambiente além do dev local (staging, EasyPanel, testes de Gabi), a URL muda. Hoje o app é inoperante fora do dev local sem alteração manual no código.

**Resolução:**

```typescript
// src/lib/api.ts — antes
const BASE_URL = 'http://localhost:4000';

// depois
const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
```

Adicionar ao `.env.local` (dev) e à config do EasyPanel (produção):
```
NEXT_PUBLIC_API_URL=https://designer-api.seudominio.com
```

---

### L3 — Dois API Keys para o Mesmo Provider/Modelo (Médio)

**O que está acontecendo:**

O backend tem dois API keys Gemini com papéis diferentes:

| Variável | Usa em | Modelo |
|---|---|---|
| `GEMINI_API_KEY` | chat, analyze-benchmark, generate-briefing | gemini-2.0-flash-lite |
| `NANO_BANANA_API_KEY` | generate-design (Nano Banana) | gemini-2.0-flash-lite |

**O problema:** é o mesmo provider, o mesmo modelo, a mesma API. A separação existe **apenas** para controle de cota/rate limit independente — intenção válida, mas não documentada no código.

**Consequências:**

- Desenvolvedor novo não sabe qual key usar em features novas (ex: generate-image).
- Ao adicionar geração de imagem, haverá dúvida: cria uma terceira key `IMAGE_API_KEY`? Usa `GEMINI_API_KEY`? Usa `NANO_BANANA_API_KEY`?
- O nome `NANO_BANANA_API_KEY` é opaco — é uma key Gemini, não uma key de um serviço chamado "Nano Banana".

**Resolução:**

Renomear e documentar explicitamente a intenção:

```env
# .env — nomes claros com propósito
GEMINI_API_KEY_CHAT=...         # rate limit pool: chat + briefing + analyze + image
GEMINI_API_KEY_DESIGN=...       # rate limit pool: design JSON generation (Nano Banana)
```

Ou, mais simples para MVP: consolidar em uma única key e monitorar cota antes de separar novamente quando necessário.

---

### L4 — Gemini e OpenAI Fazendo Tarefas Sobrepostas no Bot Gabi (Médio)

**O que está acontecendo:**

O Bot Gabi usa dois LLMs para trabalhos que parcialmente se sobrepõem:

| LLM | Tarefas atuais |
|---|---|
| **Gemini** | Extração de dados Asana, atas de reunião, transcrição de mídia |
| **OpenAI GPT-4o** | Chat geral + classificação de intenção (intent) |

A divisão surgiu organicamente: o bot começou só com OpenAI e Gemini foi adicionado depois (commit `c4635c2`, 10/04) especificamente para substituir OpenAI na extração estruturada de dados (por problemas de cota no Free Tier). O OpenAI permaneceu para as tarefas restantes.

**O problema:** classificação de intenção (`classify_intent`) usa GPT-4o mas poderia usar Gemini. Chat geral usa GPT-4o com histórico do PostgreSQL. Hoje o sistema tem **duas faturas de LLM, dois SDKs Python, dois contextos de API key** para o mesmo bot.

**Resolução (curto prazo):** documentar explicitamente qual LLM faz o quê e por quê — evitar que a próxima feature adicione um terceiro sem razão.

**Resolução (longo prazo):** consolidar em um único provider. Gemini cobre todas as tarefas atuais (extração, chat, intent) e tem Free Tier mais generoso. Migrar intent classification e chat geral para Gemini eliminaria a dependência de OpenAI.

> ⚠️ Não bloqueia nenhuma entrega atual — é refactor de redução de complexidade.

---

### L5 — `ffmpegVideo.ts` Morto no Bundle do Frontend (Médio)

**O que está acontecendo:**

O arquivo `designer/frontend/src/lib/ffmpegVideo.ts` existe e importa a biblioteca `ffmpeg.wasm` (ou similar), mas a feature de Animação é um stub que nunca chama esse código.

**O problema:** `ffmpeg.wasm` é uma biblioteca pesada (~30MB em alguns casos). Se importada no bundle, aumenta significativamente o tempo de carregamento do app — mesmo que o código nunca execute.

**Resolução:**

Remover a importação de `ffmpegVideo.ts` de qualquer arquivo que a importe. Manter o arquivo isolado como rascunho (sem import), até que a feature de Animação seja implementada com lazy loading:

```typescript
// Quando implementar — usar import dinâmico para não carregar no bundle inicial
const { exportVideo } = await import('../lib/ffmpegVideo');
```

---

### L6 — Tipos Não Compartilhados Entre Frontend e Backend (Médio)

**O que está acontecendo:**

Os tipos `DesignState`, `Layer` e outros contratos de dados são definidos no backend (`nanoBanana.ts`) e presumivelmente **duplicados ou recriados** no frontend para que o CanvasEditor funcione.

**O problema:**

Quando o schema de layers mudar (ex: adicionar campo `opacity` ou `borderRadius`), a mudança precisa ser feita em dois lugares. Sem sincronização, o frontend renderiza incorretamente.

**Resolução (MVP):** exportar os tipos do backend em um arquivo `src/types/design.ts` dedicado e documentar que o frontend os replica manualmente — pelo menos torna explícito onde atualizar.

**Resolução (ideal):** criar um pacote compartilhado `@designer/types` em estrutura de monorepo, mas isso é overhead para o tamanho atual do projeto.

---

### L7 — Versão Não-Canônica do Next.js (Médio)

**O que está acontecendo:**

O `AGENTS.md` do frontend contém o aviso: *"This is NOT the Next.js you know — breaking changes may apply. Read `node_modules/next/dist/docs/` before writing code."*

Isso indica uma versão canary, RC, ou com patches customizados. A versão exata não foi verificada (código em submódulo não inicializado).

**O problema:** documentação oficial do Next.js pode não corresponder ao comportamento real. APIs de router, cache e server actions podem ter comportamento diferente do esperado.

**Resolução imediata:** verificar `designer/frontend/package.json` → campo `"next"` e documentar a versão exata na wiki. Se for canary/RC com bugs conhecidos, avaliar downgrade para a versão estável mais recente antes de novas features.

---

### L8 — Env Vars Sem Padronização Entre Projetos (Baixo)

**O que está acontecendo:**

| Projeto | Padrão de env var |
|---|---|
| Designer Backend | `GEMINI_API_KEY`, `NANO_BANANA_API_KEY`, `DATABASE_URL`, `JWT_SECRET` |
| Bot Gabi | `OPENAI_API_KEY`, `GEMINI_API_KEY`, `POSTGRES_URL`, `REDIS_URL`, `EVOLUTION_API_URL` |

Inconsistências:
- `DATABASE_URL` vs `POSTGRES_URL` — mesma coisa, nomes diferentes
- Nenhum prefixo por projeto (ex: `DESIGNER_` ou `BOTGABI_`) para quando coexistirem no mesmo servidor

**Resolução:** adotar convenção `<PROJETO>_<SERVIÇO>_<DETALHE>` ao adicionar novas vars. Não vale renomear as atuais (breaking change desnecessário), mas documentar o padrão para as próximas.

---

### L9 — Risco de Queries Diretas Paralelas ao Prisma (Baixo)

**O que está acontecendo:**

Prisma é o ORM declarado, mas não há garantia (sem ver o código) de que nenhum handler usa `pg` ou queries SQL raw para casos específicos. Se houver, o schema Prisma e as queries manuais podem divergir.

**Resolução:** ao inicializar o submódulo, fazer grep por `import pg` ou `require('pg')` no backend. Se encontrado, ou encapsular em Prisma ou documentar como exceção justificada.

---

## Prioridade de Resolução

| Sprint | Tasks de libs/config a incluir |
|---|---|
| **Sprint 0** ✅ Concluído 25/04 | L1 ✅ L2 ✅ / L3 pendente (baixa prioridade) |
| **Sprint 1** (MVP 3) | L5 (remover import ffmpegVideo do bundle) |
| **Sprint 2** (MVP 4) | L6 (tipos compartilhados), L7 (verificar versão Next.js), L4 (consolidar LLMs se viável) |
| **Backlog** | L8 (padronização env vars), L9 (verificar queries raw) |

---

## Relacionados

- [[designer-plano-implementacao]] — sprints onde as correções se encaixam
- [[designer-auditoria-jornada]] — contexto do produto
- [[designer-backend]] — origem dos problemas L1, L2, L3
- [[designer-frontend]] — origem dos problemas L2, L5, L6, L7
- [[bot-gabi]] — origem do problema L4
- [[pesquisa-geracao-imagens-pdf-designer]] — contexto da migração SDK (L1)
