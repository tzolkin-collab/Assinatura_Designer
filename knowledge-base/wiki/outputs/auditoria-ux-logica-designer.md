---
title: "Auditoria — UX, Lógica e Necessidades do Designer"
type: output
tags:
  - auditoria
  - ux
  - logica
  - designer
  - configuracao
  - referencias
  - auth
  - segurança
  - sprint0
  - gaps
sources:
  - "designer/backend/src/routes/settings.ts"
  - "designer/backend/src/routes/ai.ts"
  - "designer/backend/src/middleware/auth.ts"
  - "designer/frontend/src/app/[marca]/editor/page.tsx"
  - "designer/frontend/src/app/[marca]/fabrica/page.tsx"
  - "designer/frontend/src/app/[marca]/configuracoes/referencias/page.tsx"
created: 2026-04-25
updated: 2026-04-25
---

# Auditoria — UX, Lógica e Necessidades do Designer

## Resumo

Auditoria completa do estado atual do Agente Designer após Sprint 0 (2026-04-25). Cobre o fluxo de configuração de marca, lógica de análise de referências, middleware de autenticação, gaps de UX e segurança, e as necessidades abertas para Sprint 1. O Sprint 0 foi concluído com todas as urgências técnicas executadas.

---

## Sprint 0 — Concluído em 2026-04-25

| Task | Arquivo(s) | Status |
|---|---|---|
| L1 — Migrar SDK `@google/generative-ai` → `@google/genai` | `backend/package.json`, `lib/nanoBanana.ts`, `routes/ai.ts`, `routes/settings.ts` | ✅ Feito |
| T1 — Migrar modelo `gemini-2.0-flash-lite` → `gemini-2.5-flash-lite` | Todos os arquivos backend | ✅ Feito |
| L2 — URL hardcoded → variável de ambiente | `frontend/src/lib/api.ts`, `.env.local` | ✅ Feito |
| T6 — Endpoint `POST /api/ai/:slug/generate-image` | `backend/src/routes/ai.ts` | ✅ Feito |
| T7 — Conectar Tool "Imagem" na Fábrica | `frontend/src/app/[marca]/fabrica/page.tsx` | ✅ Feito |
| T9 — Export PNG no Editor | `html-to-image` já instalado; `editor/page.tsx` usa `toPng()` | ✅ Já estava funcional |
| Fix — Editor passar a usar `api` wrapper com auth | `frontend/src/app/[marca]/editor/page.tsx` | ✅ Feito |

> ⚠️ **Inacurácia corrigida na wiki**: as páginas `branding/`, `agent/` e `referencias/` já chamavam o backend corretamente. A afirmação anterior de que "botões de salvar são fake" estava errada. O que faltava era somente a migração do SDK no backend.

---

## 1. Fluxo de Configuração de Marca (BrandConfig)

### Como funciona

```
PUT /api/settings/:slug/config
  body: { agentPrompt?, primaryFonts?, colors?, guidelines?, logoUrl? }
  → prisma.brandConfig.upsert({ where: { brandId }, update: {...}, create: {...} })
  ← 200 { data: BrandConfig }
```

Dois pontos de entrada independentes compartilham o mesmo endpoint:
- `configuracoes/branding/page.tsx` → envia `{ primaryFonts, colors, guidelines, logoUrl }`
- `configuracoes/agent/page.tsx` → envia `{ agentPrompt }`

### Comportamento do upsert com campos `undefined`

O Prisma ignora campos `undefined` em chamadas de `update` — portanto, salvar somente `agentPrompt` na página de Agent não apaga `colors` salvo anteriormente. **Isso funciona por comportamento implícito do Prisma, não por lógica explícita no código.**

### Risco: envio explícito de string vazia

Se a página de branding enviar `agentPrompt: ''` (string vazia, não undefined), o campo será sobrescrito para vazio. Atualmente não acontece porque a página de branding não inclui `agentPrompt` no body — mas a falta de separação explícita entre os dois schemas é uma dívida técnica.

### LogoUrl

O campo `logoUrl` é um input de texto na UI. Não existe handler de upload de arquivo. A Gabi precisaria colar uma URL externa. Para usar o logo real da marca seria necessário um endpoint de upload separado.

---

## 2. Fluxo de Referências (Análise em Background)

### Jornada completa

```
1. Gabi cria referência (nome + URL opcional)
   POST /api/settings/:slug/referencias
   → prisma.reference.create({ status: 'PENDING', insights: 0 })
   ← 201 imediatamente (não bloqueia)

2. Backend dispara análise em background (sem await)
   analyzeReferenceBackground(refId, slug, name, analysisUrl)
   → busca BrandConfig para construir brandContext
   → monta prompt com contexto da marca + URL da referência
   → chama Gemini 2.5 Flash Lite (texto)
   → conta seções Markdown no resultado (## / ###) → `insights` count
   → prisma.reference.update({ status: 'ANALYZED', insightsText, insights })
   → em caso de erro: { status: 'FAILED' }

3. Frontend faz polling a cada 5 segundos enquanto houver refs PENDING
   useEffect com setInterval(5000) — ativa quando refs.some(r => r.status === 'PENDING')
   → GET /api/settings/:slug/referencias
   → atualiza state → rerender da lista
```

### Prompt da análise

O prompt usa `brandContext` construído assim:
```
Marca: <brand.name>
Diretrizes: <config.guidelines>
Cores: <config.colors.join(', ')>
```

Se a marca não tiver config salva, usa apenas `Marca: <slug>`. Isso significa que referências analisadas antes de configurar a marca recebem análise sem contexto de brand.

### Edge cases identificados

| Situação | Comportamento |
|---|---|
| Gemini retorna erro 429 (rate limit) | `status: 'FAILED'` sem retentativa automática |
| Brand sem BrandConfig no momento da análise | Análise roda com contexto mínimo (só o nome) |
| Frontend fechado durante análise | Análise continua no backend; status é correto quando reabrir |
| Múltiplas refs PENDING simultâneas | Cada uma gera uma chamada Gemini independente em paralelo |

---

## 3. Autenticação e Autorização

### Middleware JWT (`auth.ts`)

```typescript
// Extrai e verifica Bearer token
const token = req.headers.authorization?.split(' ')[1];
jwt.verify(token, JWT_SECRET, (err, decoded) => {
  req.user = decoded;  // { id, email, role }
  next();
});
```

### Quais rotas são protegidas

| Router | Auth aplicada? |
|---|---|
| `/api/auth/*` | ❌ Público |
| `/api/brands/*` | ✅ `requireAuth` |
| `/api/posts/*` | ✅ `requireAuth` |
| `/api/settings/*` | ✅ `requireAuth` |
| `/api/ai/*` | ✅ `requireAuth` |
| `/health` | ❌ Público |

### Gap de segurança: sem ownership check

Qualquer usuário autenticado pode ler e escrever a config de qualquer marca conhecendo o slug:

```
GET /api/settings/marca-concorrente/config  ← funciona com qualquer token JWT válido
PUT /api/settings/marca-concorrente/config  ← funciona com qualquer token JWT válido
```

`settings.ts` só verifica se a marca existe (por slug), não se o usuário autenticado é dono dela. O modelo `Brand` tem `userId` — bastaria checar `brand.userId === req.user.id` antes de retornar/atualizar.

---

## 4. Gaps de UX Mapeados

### Editor — Posts de Imagem

O `editor/page.tsx` faz `content.layers || []` para carregar as camadas. Posts gerados pela tool "Imagem" têm estrutura diferente:

```json
// Post de design (Nano Banana) — editor funciona
{ "layers": [{ "type": "text", ... }, { "type": "shape", ... }] }

// Post de imagem (generate-image) — editor quebra silenciosamente
{ "type": "image", "dataUrl": "data:image/png;base64,..." }
```

Quando a Gabi abrir um post de imagem no editor, o canvas ficará vazio (sem layers, sem erro visível).

**Solução:** verificar `if (content.type === 'image')` → criar layer do tipo `image` com a `dataUrl` como `url`.

### Fábrica — Mensagens com Markdown não renderizado

O chat exibe `msg.content` dentro de `<p className={styles.messageText}>` como texto puro. Links Markdown como `[Editor](/${slug}/editor?postId=...)` aparecem literalmente como `[Editor](/marca/editor?postId=abc)` sem virar âncora clicável.

A Gabi precisa copiar e navegar manualmente. Solução: usar um renderer de Markdown (ex: `react-markdown`) para o `messageBubble`.

### Configurações — Sem Toast de Feedback

As páginas de branding e agent chamam o backend corretamente mas não têm feedback visual após o save. Gabi clica "Salvar" e a página fica estática — sem confirmação de sucesso ou erro.

### Editor — Sem Desfazer (Undo)

Movimentos e edições no CanvasEditor são irreversíveis dentro da sessão. Não há `Ctrl+Z`. Para MVP é aceitável, mas é o primeiro ponto de atrito para a Gabi ao editar.

### Galeria — Não Diferencia Posts por Tipo

A galeria exibe todos os posts como thumbnails de layers. Posts de imagem (dataUrl) precisam de tratamento diferente para renderizar o preview corretamente.

---

## 5. Necessidades Abertas (Sprint 1+)

### Críticas para fechar Sprint 1

| # | Necessidade | Motivo | Status |
|---|---|---|---|
| N1 | Editor tratar `content.type === 'image'` | Tool de imagem está conectada mas o editor não exibe o resultado | ✅ Feito |
| N2 | Verificar nome do modelo `gemini-2.5-flash-image` | A API pode rejeitar se o nome exato for diferente | Pendente |
| N3 | Markdown nos balões da Fábrica | Links para o editor não são clicáveis — UX quebrada | ✅ Feito |
| N4 | Toast de feedback nos saves de configuração | Gabi não sabe se o save funcionou | ✅ Feito |

### Importantes para Sprint 2

| # | Necessidade | Motivo | Status |
|---|---|---|---|
| N5 | Ownership check nas rotas `/settings/*` | Qualquer usuário autenticado lê/escreve qualquer marca | ✅ Feito |
| N6 | Upload de logo real | Hoje `logoUrl` só aceita URL externa — não tem upload | Pendente |
| N7 | Contexto da análise de referência atualizar após config salva | Refs analisadas antes da config ficam com contexto incompleto | Pendente |
| N8 | Retentativa automática em FAILED | Hoje não há forma de re-analisar uma ref que falhou | Pendente |
| N9 | Undo no editor | Primeiro ponto de atrito real da Gabi ao editar | Pendente |

---

## Relacionados

- [[agente-designer]] — estado atual das features
- [[designer-backend]] — rotas e middleware
- [[designer-frontend]] — páginas e componentes
- [[designer-plano-implementacao]] — sprints e critérios de aceite
- [[auditoria-libs-configs]] — L1/L2 resolvidos no Sprint 0
