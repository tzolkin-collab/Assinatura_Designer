# Roadmap — Designer IA (Assinatura)

> Levantado em 2026-07-13, cruzando `docs/features/*`, `prop.md`, o schema, as rotas e o frontend reais.

## Premissas do produto (definidas em 2026-07-13)

Estas decisões cortam escopo e valem mais que qualquer doc anterior:

1. **Não é um SaaS.** É a ferramenta do contrato Assinatura. Sem planos, sem cobrança, sem self-service.
2. **Sem publicação em redes sociais.** Nada de Instagram/Facebook/LinkedIn.
3. **Canva é o único caminho de entrega**, e a entrega é **arte pronta pra postar** — não material editável no Canva.

Consequência direta: **as features 03 (agendamento/publicação) e 04 (assinatura/cobrança) estão canceladas.**
O `benchmarking_tecnico.md` foi escrito assumindo "SaaS robusto"; suas seções 4 (redes sociais) e as
recomendações de billing não se aplicam mais. As seções 1 (undo/redo), 2 (uploads), 3 (RBAC) e 5 (UI/a11y) seguem válidas.

### Por que "arte pronta" e não "editável no Canva"

A Canva Connect API **não constrói design elemento por elemento** — não existe endpoint para "criar caixa de
texto em x,y". O `POST /designs` aceita apenas `design_type` (preset/custom) e, opcionalmente, **um `asset_id`
de imagem**. Texto editável de verdade só existe via **Autofill sobre Brand Template**, que exigiria montar os
templates à mão dentro do Canva e, sobretudo, **trocar a IA que compõe layout livre por uma IA que preenche
campos de um catálogo fixo** — o oposto do valor do DesignIR. Decisão: exportar a arte renderizada.

---

## Onde o sistema está hoje

O núcleo (geração IA → editor IR → galeria → export) está funcional e já passou por hardening (fila BullMQ
durável, reviewer religado, anti-SSRF, rate-limit, WS autenticado).

| Feature (doc) | Estado |
|---|---|
| 01 Biblioteca de mídia | 🟡 schema `Asset` + `routes/assets.ts` + página `configuracoes/midia` existem |
| 02 Gestão de equipe | 🟡 `BrandMember`/`BrandRole` + `routes/team.ts` + página `configuracoes/equipe` existem |
| 03 Agendamento | ⚫ **CANCELADA** |
| 04 Cobrança | ⚫ **CANCELADA** |
| 05 Histórico/versionamento | ✅ `PostVersion` + histórico no editor (ver Fase 2) |
| Export Canva | 🟡 OAuth PKCE + upload OK, mas não cria design (ver Fase 1.1) |

---

## Fase 0 — Destravar o deploy (bloqueante)

### 0.1 🔴 Dívida de migration (o mais grave)

`prisma/migrations/` só tem `0_init`, que cria 7 tabelas. Mas o `schema.prisma` já declara `BrandMember`,
`Asset`, `Notification`, `AccessRequest` e o enum `BrandRole` — eles existem no banco porque alguém rodou
`db push`, **não** por migration. Confirmado com `migrate diff`: banco vivo == schema, migrations != schema.

Um `migrate deploy` num ambiente novo (staging, CI, máquina de outro dev, disaster recovery) cria um banco
**sem essas tabelas**, e equipe/mídia/notificações quebram no boot. `prisma migrate status` diz "up to date"
e não detecta isso — ele só compara migrations aplicadas contra a pasta, nunca olha o schema.

- Gerar a migration faltante via `migrate diff --from-migrations` → `--to-schema`.
- `prisma migrate resolve --applied` no banco atual (as tabelas já existem lá).
- Validar do zero: Postgres limpo → `migrate deploy` → boot.
- Regra: **proibido `db push`** fora de protótipo local.

### 0.2 🔴 Dois modelos de autorização convivendo

`Brand.userId` (legacy) coexiste com `BrandMember`. Só `team.ts` usa o guard `requireBrandRole`; `posts`, `ai`,
`upload` e `folders` ainda autorizam pelo caminho antigo. O histórico do repo já registra vazamento
cross-tenant corrigido — é exatamente este terreno.

**Isso já quebra o produto hoje**, não só em teoria: o `export-canva` (`posts.ts:485`) filtra por
`brand: { userId: req.user?.userId }`. Ou seja, **um membro da equipe que não seja o dono da marca não
consegue exportar pro Canva** — o caminho de entrega do produto.

- Extrair `requireBrandRole` para `middleware/` e aplicar em todas as rotas de marca.
- Migrar as rotas legadas para `BrandMember`; depois dropar `Brand.userId`.
- Teste por rota: membro de outra marca → 403.

### 0.3 🟠 Convite cria usuário com senha placeholder

`team.ts:72` cria o convidado com `password: 'invite-placeholder'` — conta real com senha conhecida.
Trocar por token de convite de uso único + definição de senha.

### 0.4 🟠 Higiene

- `helmet` não instalado.
- **Rotacionar a senha do Postgres** que estava hardcoded nos scripts removidos.
- Cobertura de teste: hoje só 2 (team). Cobrir auth, RBAC por rota e o pipeline de geração.
- ~47 erros de ESLint pré-existentes (majoritariamente `no-explicit-any`).

---

## Fase 1 — Fechar o caminho de entrega (Canva) e as features começadas

### 1.1 🔴 Export Canva: entregar um design, não PNGs soltos

Hoje `posts.ts:512-534` renderiza cada slide e chama só `uploadAsset` — o resultado é um monte de imagem
avulsa na biblioteca do Canva. Para "arte pronta pra postar":

- Depois do upload, chamar `createDesign({ design_type, asset_id })` (**já implementado** em
  `canvaClient.ts:185`, só não é usado) e devolver a `url` do design pro frontend.
- **Tirar o export do request HTTP.** Hoje um deck de N slides roda N render+upload sequenciais dentro da
  requisição (`for` na linha 531), com render full-res (`maxDim: 0`). Num deck grande isso estoura timeout e
  arrisca OOM. A fila BullMQ já existe e está testada — mandar o export pra lá, com progresso via WS.
- Corrigir a autorização legacy da rota (ver 0.2).

### 1.2 Biblioteca de mídia (doc 01)
- `AssetManagerModal` no editor — hoje a mídia só vive nas configurações; o valor é reusar no canvas.
- `DELETE /assets/:id` precisa apagar o objeto no R2, não só a linha do banco.
- Presigned URLs (upload direto do browser pro R2) — desejável, mas sem a pressão de escala de um SaaS.

### 1.3 Gestão de equipe (doc 02)
- RBAC nas rotas restantes (mesmo trabalho do 0.2).
- UI: `VIEWER` com controles `disabled` + tooltip em vez de deixar a ação falhar.
- Fechar o fluxo de convite (0.3).

---

## Fase 2 — Histórico e versionamento (doc 05) — ✅ FEITA

- ✅ `PostVersion` no schema + `GET/POST /posts/:id/versions` e `POST .../restore`. A versão é do **post
  inteiro** (slides re-hidratados), não de um slide solto: restaurar meio deck deixaria a arte incoerente.
- ✅ Snapshot em passo grande: **antes** de cada escrita da IA (`ai-patch`, `edit-slide`, chat do brain),
  antes de restaurar, e no salvamento do editor com janela de 5 min. Dedupe por hash de conteúdo e teto de
  20 versões por post — um deck de 200 slides passa de 2MB por versão.
- ✅ Painel de histórico no editor (marcar versão, restaurar, badge de "Antes da IA").
- ⚪ `zustand` + `zundo`: **descartado**. O editor já tem undo/redo em memória (60 passos, IR e legado); o que
  faltava era sobreviver ao reload e à IA, e isso é o histórico no banco. Trocar o que funciona seria churn.
- ⚪ `AIAcceptReject` (IA propõe, usuário aceita antes de aplicar): não feito como fluxo de proposta. A IA
  aplica e o estado anterior fica no histórico com um clique de volta. Vale revisitar se o "aplicar e
  desfazer" incomodar na prática.

---

## Fase 3 — Robustez e escala

- ✅ **Guardrails de custo de IA.** Teto diário em TOKENS (global e por marca), contado no Redis e cortado
  em `generateWithRetry` — o gargalo por onde passa toda chamada, streaming incluído. A conta é em token
  (exato, vem do provedor) e não em reais: tabela de preço envelhece calada e passaria a mentir. `USD` só
  como estimativa opcional de log. Consumo visível em `GET /brands/:slug/ai-usage`.
- ✅ **Observabilidade.** `lib/logger.ts` (JSON em produção, legível em dev) + `requestId` por requisição e
  contexto (marca/sessão/feature) propagado por `AsyncLocalStorage` — sem passar parâmetro por dez camadas.
  Caminho de geração, fila e revisor migrados de `console.*`.
- ✅ **OOM do Puppeteer.** Era `CONCURRENCY_BROWSER` com **um chromium por core de CPU**. Agora
  `CONCURRENCY_CONTEXT` (um browser, contexto isolado por tarefa), concorrência decidida pela MEMÓRIA
  (`RASTER_CONCURRENCY` manda) e timeout por página para o slot não ficar preso.
- ✅ **Reviewer visual.** A amostra deixou de ser `slice(0, 8)` (os 8 primeiros, 4% de um deck de 200, sempre
  o mesmo começo) e passou a ser espalhada pelo deck (capa + encerramento + meio distribuído), com o
  `slideIndex` das críticas remapeado para o índice real. Tamanho em `REVIEWER_SAMPLE_SIZE`.
- ✅ **Legado removido.** `agents/design`, `agents/image` e `agents/worker` deletados (ninguém importava).
  `agents/content` fica: o `fabricaLegacy` (vivo, `researchBrand` no pipeline) usa o tipo dele.
- ✅ **Modelo lotado/lento não trava mais a fila.** Conferido: o `gemini-3.5-flash` EXISTE (não foi
  descontinuado), mas tem dois modos ruins — 503 "high demand" e, pior, *responder devagar* (medido: 70s para
  dizer "oi", porque ele "pensa" por padrão; o 2.5-flash faz o mesmo em 0,8s). Sobrecarga e timeout agora têm
  UMA tentativa e caem para o próximo modelo; timeout por tentativa é 25s (flash) / 150s (pro), decidido pelo
  peso do MODELO — por feature cortaria a edição de slide, que roda no pro e legitimamente demora. Circuit
  breaker com janela de 5 min (2 falhas → 3 min de cooldown): contar falhas *consecutivas* não abria o
  circuito num modelo intermitente, porque o acerto ocasional zerava a conta. Medido de ponta a ponta:
  70s → 26s no pior caso e ~1s quando o circuito já está aberto.
- ✅ **Sessão Redis fatiada.** Era UMA key com metadados + histórico (anexos base64 juntos) + `currentDesign`
  inteiro: cada mensagem de chat fazia GET+SETEX do blob todo, **duas vezes** (o "recent" era cópia integral),
  sob lock. Agora são três keys — `:meta` (HASH), `:messages` (LIST, RPUSH O(1)) e `:design` (STRING, só
  reescrito quando o design muda) — e o `recent` virou bandeira com TTL. Medido com deck de 200 slides
  (design de 448KB): 20 mensagens custam **12KB** de escrita, contra ~18MB no desenho antigo. `appendMessage`
  é um Lua de um round-trip (checa a sessão e escreve junto: um EXISTS separado dobraria a latência e abriria
  janela para lista órfã sem TTL). Prefixo `v2` nas keys: as sessões antigas têm tipo incompatível com HASH
  e expiram sozinhas.

---

## Sequência

```
Fase 0 (bloqueante) ──► Fase 1 (entrega Canva + mídia + equipe) ──► Fase 2 (histórico) ──► Fase 3 (robustez)
```

Sem dependência externa de terceiros no caminho crítico (era o App Review da Meta, que morreu junto com a
feature 03). O caminho crítico agora é interno: migration → RBAC → export Canva.
