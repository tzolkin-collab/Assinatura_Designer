# Relatório Técnico Consolidado — Projeto Assinatura (Designer IA)

**Data:** 18/07/2026 · **Branch:** `feat/html-pptx-canva` · **Escopo:** backend, frontend, arquitetura e histórico git

---

## 1. Sumário Executivo

| Frente | Nota | Leitura |
|---|---|---|
| Qualidade de código do backend | **5,5 / 10** | Fundação sólida (infra, auth, testes de infra ~7+), coração do produto frágil (pipeline de IA ~4,5) |
| Estrutura & Arquitetura (sistema inteiro) | **4,6 / 10** | Código localmente decente, forma global fragmentada — cada mudança paga pedágio |

**Frase-síntese:** o produto funciona e tem engenharia de infraestrutura acima da média (retry, throttle, sessão Redis, RBAC), mas o pipeline de geração — exatamente o que o cliente paga — é a parte com menos rede de segurança, e a arquitetura acumula 4 stacks paralelas de geração que tornam toda feature nova 3× mais cara.

---

## 2. Revisão de Qualidade do Backend (nota 5,5)

Seis revisores especializados leram integralmente os 17,3 mil line-items de código + 2 mil de testes.

### 2.1 Notas por módulo

| Módulo | Nota | Síntese |
|---|---|---|
| Infra Core (redis, queue, geminiRetry, throttle, middleware) | 7,2 | Taxonomia de falhas do Gemini com políticas distintas, circuit breaker, sessão O(1) via Lua |
| Testes (113 testes verdes, tsc strict limpo) | 6,3 | Excelente no que cobre; cobre < 20% dos arquivos-fonte |
| Rotas API (posts, brands, auth, team, folders…) | 6,2 | RBAC consistente, comentários exemplares; falta validação de schema |
| Agentes (brain, pipeline, reviewer, planner) | 4,8 | ~23% de código morto; handlers WS privilegiados sem verificação de posse |
| Pipeline de Design (designDocument, designFixer, SVG/HTML) | 4,7 | Validação teatral, falhas de IA virando "sucesso silencioso", duplicação ×3 |
| routes/ai.ts (2.439 linhas) | 4,0 | 13 endpoints + job store + prompts num arquivo só; handlers de 240 linhas |

### 2.2 Os 5 problemas mais graves

1. **XSS/injeção server-side** — sanitização de HTML por regex bypassável (`htmlDesign.ts:45`) antes do Chromium; o comentário prometia DOMPurify inexistente
2. **Regex `[EDIT]` quebrada** — edição cirúrgica inalcançável (`brain/index.ts`) — **CORRIGIDA nesta sessão** (ver §5)
3. **~~Callback OAuth do Canva → 401~~ CORRIGIDO** — mount público separado em `app.ts` e fluxo OAuth PKCE funcional; tokens criptografados no banco e sessão invalidada em refresh falho.
4. **DoS de cota/custo** — `slideCount`/`width`/`height` sem teto em `ai.ts`
5. **Autenticação nunca testada de verdade** — JWT mockado para sucesso em 100% dos testes HTTP; nenhum teste de 401, upload ou rate limit

### 2.3 Pontos fortes

- `geminiRetry` + 438 linhas de testes citando incidentes reais
- RBAC multi-tenant centralizado com testes de side-effect
- `designIR/aiPatch`: única fronteira LLM→estado tratada como fronteira de segurança
- Comentários de "porquê" = memória institucional

---

## 3. Arqueologia Git (12 problemas rastreados)

Repositório com 26→47 commits (14/05 a 18/07). Veredito central: **10 dos 12 problemas nasceram com o código**, importados no commit `5ec1f26` (02/07 — *"inline backend/frontend into monorepo"*), que converteu o backend de submódulo em arquivos normais, já com os defeitos de fábrica.

| Problema | Origem | Veredito |
|---|---|---|
| Regex `[EDIT]` | `5ec1f26` | Nasceu quebrada, byte-idêntica até a correção desta sessão |
| Callback Canva 401 | `5ec1f26` | Nasceu quebrado, nunca tocado |
| Sanitização regex + DOMPurify fantasma | `5ec1f26` | Nasceram juntos; DOMPurify nunca existiu |
| Inputs sem teto | `5ec1f26` | Nasceu sem clamp; nunca corrigido |
| `progressRow` padding 100px | `5ec1f26` + `7bfe622` | 100px nasceu com o arquivo; duplicação criada em 12/07 por commit aditivo que não removeu a versão antiga — **corrigido na refatoração do chat** |
| Catch silencioso do designFixer | `5ec1f26` | Nasceu silencioso |
| `fill` sem escape no SVG | `5ec1f26` | Descuido: `esc()` existia no mesmo arquivo/commit |
| Helpers duplicados (×3) | `5ec1f26` | Nasceram duplicados na importação |
| Job store `Map` em memória | `5ec1f26` | Órfão arquitetural: nasceu 10 dias antes da fila BullMQ |
| ~23% código morto em agents | `5ec1f26`→`7bfe622` | Nasceu legado; substituto chegou 12/07 |
| JWT mockado nos testes | `d4bab65` (13/07) | Nasceu com a suíte; teste de 401 nunca existiu |
| `ai.ts` com 2.439 linhas | `5ec1f26` | Nasceu inchado (2.420 linhas de uma vez) |

**Conclusão:** nenhum bug foi regressão — são dívida original da era pré-monorepo. Não há commit para reverter; a correção é cirúrgica.

---

## 4. Refatoração UI/UX do Chat da Fábrica

Executada em duas ondas (a primeira atingiu o componente errado — `FabricaChat` da rota `/designer`; a segunda acertou o alvo real: a página `/[marca]/fabrica`).

### 4.1 Correções no chat real

- **Bug crítico eliminado:** classes `progress*` duplicadas no CSS, com `padding: 100px` quebrando o cartão de progresso
- **No-cut:** `100dvh`, `min-height: 0` nos flex, input sempre no fluxo, `word-break`/`overflow-wrap` nos balões
- **Hierarquia:** usuário à direita (fundo escuro, contraste 16:1), IA à esquerda (glass neutro)
- **A11y:** conteúdo ≥ 14px, contraste ≥ 4,5:1, `:focus-visible` em todos os interativos, ARIA completo (`role="log"`, `progressbar`, `listbox`), `prefers-reduced-motion`
- **Responsivo:** de zero media queries para chat fluido (340–460px) + coluna única ≤900px
- **Validação:** `tsc` limpo, 113/113 classes conferidas, 16/16 funcionalidades preservadas

---

## 5. Implementação: `review:decline` cirúrgico (Passe 3.1)

**Antes:** recusar um review regenerava o deck inteiro — 2 slides ruins destruíam 13 bons.

**Depois:**
- Novo `lib/tagExtract.ts` — extrator de tags `[EDIT]`/`[QUESTION]` com varredura balanceada (mata o bug de nascença da regex lazy)
- Pipeline grava `pendingReview` (deviations estruturadas) na sessão Redis
- Decline mapeia deviations (`slideIndex` + `fix`) + reason → edição só dos slides ruins via `applySlideEdits` (snapshot de versão + preview ao vivo); fallback honesto para regeneração total
- Ownership check adicionado ao handler (falha de segurança da revisão)

**Validação:** 26/26 testes novos · suíte inteira 153/153 · `tsc` zero erros.

---

## 6. Revisão de Arquitetura (nota 4,6)

Seis arquitetos avaliaram o sistema na branch atual.

| Dimensão | Nota | Diagnóstico |
|---|---|---|
| Dados (Prisma, Redis, R2) | 5,6 | Melhor dimensão; blob↔relacional espalhado em 4 arquivos, índices faltantes |
| Operação & Escala | 4,8 | Worker separado **perde silenciosamente o feedback WS** (sem pub/sub) |
| Pipelines de IA | 4,6 | 4 stacks coexistindo com fallbacks cruzados; helpers em 3 cópias |
| Frontend (Next.js) | 4,5 | App Router usado como SPA (55/58 client components); formatos zumbis |
| Comunicação front↔back | 4,2 | 3 taxonomias de eventos, 3 envelopes REST, zero versionamento de contrato |
| Camadas (backend) | 4,0 | Sem camada de serviço: 12/14 routers chamam Prisma direto; god-file de 2.481 linhas |

### 6.1 Convergências (citadas por múltiplos arquitetos)

1. `routes/ai.ts` é o epicentro do risco estrutural (4 de 6 arquitetos)
2. Statefulness escondido (WS Map + 3 job stores in-memory) inviabiliza a 2ª réplica
3. Formatos/pipelines zumbis tornam cada feature 3× mais cara

### 6.2 Alavanca nº 1 (2 arquitetos chegaram nela sozinhos)

**EventBus único sobre Redis pub/sub** — destrava multi-réplica, worker separado com progresso real, morte dos job stores in-memory e o ponto único para versionar o contrato de eventos.

---

## 7. Roadmap Recomendado (ordem de ataque)

| # | Ação | Origem | Esforço estimado |
|---|---|---|---|
| 1 | EventBus Redis pub/sub (WS + job stores) | Arquitetura §6.2 | 1–2 dias |
| 2 | Extrair `routes/ai.ts` para módulo de feature com services | Arquitetura §6 (Camadas) | 2–3 dias |
| 3 | Deletar formatos/pipelines zumbis (front e back) | Arquitetura §6.1 | 1–2 dias |
| 4 | Escrita de post transacional única + `sessionId` como coluna indexada | Arquitetura (Dados) | 1 dia |
| 5 | DOMPurify real no pipeline HTML (server + front) | Qualidade §2.2.1 | ½ dia |
| 6 | Corrigir mount do callback Canva | Qualidade §2.2.3 | ½ dia |
| 7 | Clampar inputs de geração (slideCount, dimensões, base64) | Qualidade §2.2.4 | ½ dia |
| 8 | Testes de 401/JWT real + upload + rate limit | Qualidade §2.2.5 | 1 dia |
| 9 | Passe 3 restante: validador de imagens HTML, teste de escala 30–50 slides, billing Redis→Postgres, fontes Canva-safe | Handoff Passe 3 | 2–3 dias |

---

## 8. Artefatos produzidos nesta sessão

| Artefato | Caminho |
|---|---|
| Refatoração chat (componente) | `frontend/src/components/FabricaChat/*` |
| Refatoração chat real (página) | `frontend/src/app/[marca]/fabrica/page.tsx` + `fabrica.module.css` |
| Arquitetura de informação (ambos os chats) | `docs/refatoracao-chat/` |
| Edição cirúrgica no decline | `backend/src/lib/tagExtract.ts`, `backend/src/agents/brain/index.ts`, `backend/src/lib/redis.ts`, `backend/src/agents/pipeline.ts` |
| Testes novos | `backend/src/__tests__/reviewEdits.test.ts` (26 testes) |
| Planos de trabalho | `docs/passe3-decline-edit/plan.md`, `docs/refatoracao-chat/plan.md` |

---

*Relatório gerado a partir das revisões executadas por 6 revisores de qualidade, 12 investigadores de git e 6 arquitetos, com validação por gates de typecheck e suíte de testes (153/153 verdes).*
