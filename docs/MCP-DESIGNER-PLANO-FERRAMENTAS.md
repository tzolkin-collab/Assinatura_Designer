# Designer como MCP — escopo completo (análise e plano)

> Base: inventário completo do `main` — 16 routers (~110 endpoints), 11 mensagens de WebSocket da Fábrica, 5 filas
> (pipeline, export de deck, export Canva, captura de ativos, sync de referências), 36 páginas do frontend e o modelo de
> dados (`Post`, `Slide`, `PostVersion`, `Asset`, `Folder`, `Brand`, `BrandConfig`, `BrandProfile`, `Reference`,
> `GenerationRun/Step`, `Notification`, `Invite`, `AccessRequest`).
>
> Hoje o MCP tem 6 ferramentas e cobre ~10% do app. Este documento mapeia **tudo** o que o app faz para uma de três
> respostas: *vira ferramenta*, *vira ferramenta com escopo próprio*, ou *fica de fora de propósito*.

## 1. O que existe hoje

`list_brands`, `get_brand_kit`, `get_designer_brief`, `list_designs`, `get_design`, `save_presentation`
e os escopos `designer.read`, `designer.write`, `designer.edit_all`.

## 2. Princípios (valem para toda ferramenta nova)

1. **Uma ferramenta = um arquivo** em `backend/src/mcp/tools/`; segurança (escopo, marca, papel, log) vem do registro
   central.
2. **O papel do usuário na marca é o teto**, conferido a cada chamada (`ANY_MEMBER`, `EDITORS`, `ADMINS` de
   `brandAccess.ts`). O agente nunca faz o que o usuário não faria no app.
3. **Dinheiro**: tudo que gasta IA/render passa pelo teto de custo do app e devolve `usage`/`costEstimate`.
4. **Saída do Designer** (link público, Canva, download): escopo próprio e `openWorldHint: true`.
5. **Destrutivo**: `destructiveHint: true`, escopo próprio, snapshot/restauração quando houver.
6. **Chamadas curtas** (~60 s): trabalho longo é `start_*` + `get_*_status`, nunca espera.
7. **Segredos nunca saem**: tokens de Canva/Google/Asana, prompt interno do agente, e-mails de terceiros. Fluxos de
   conexão devolvem uma URL para o USUÁRIO abrir.
8. **Entrada do agente é hostil**: HTML por `validateHtmlDesign`; URLs por `isPublicHttpUrl` (funil do #97); arquivos com
   teto de tamanho/tipo; SVG sanitizado.
9. **`tools/list` filtrado pelo escopo do token**: quem só leu vê ~25 ferramentas, não ~67. Clientes degradam com
   catálogo grande; a tela de consentimento já controla o que cada conexão enxerga.
10. **Ferramentas por ação** quando a família é grande (`manage_folder`, `manage_reference`, `factory_respond`): menos
    nomes, mesma segurança por ação (cada ação declara o escopo/papel exigido).

## 3. Escopos

| Escopo | Libera | Papel mínimo | Estado |
|---|---|---|---|
| `designer.read` | ler marcas, peças, ativos, cérebro, uso, versões, jobs, integrações (status) | VIEWER | existe |
| `designer.write` | criar peças, subir ativos, editar o que a conexão criou, pastas, versões manuais | EDITOR | existe |
| `designer.edit_all` | editar/sobrescrever peças de qualquer origem | EDITOR | existe (#99) |
| `designer.brand` | kit da marca, perfil/cérebro, memória, referências, brandbook | EDITOR (campos de custo: ADMIN) | novo |
| `designer.ai` | acionar Fábrica e edição com IA (gasta crédito) | EDITOR | novo |
| `designer.export` | exportar PDF/ZIP/PPTX/HTML e Canva; sincronizar com Canva; baixar | VIEWER (Canva: EDITOR) | novo |
| `designer.publish` | publicar/despublicar link público e ligar o chat da apresentação | EDITOR | novo |
| `designer.delete` | apagar peças, ativos, pastas e sessões | EDITOR | novo |
| `designer.integrations` | ler fontes do usuário: Drive, Canva (designs), Asana | VIEWER | novo |
| `designer.team` | só **leitura** de membros e pedidos de acesso | VIEWER | novo |

`designer.edit_all` > `write` > `read` (cada um inclui o anterior). Os demais são independentes. A tela de consentimento
começa em "só ver" e cada escopo ganha texto claro do que libera.

## 4. Cobertura completa: toda rota → ferramenta ou exclusão

Legenda: **P0** destrava o fluxo principal · **P1** dia a dia · **P2** conveniência · **P3** só com decisão ·
**✗** fora de propósito (motivo).

### 4.1 `posts` — peças

| Rota | Ferramenta | Escopo | Pri |
|---|---|---|---|
| `GET /posts/:id` | `get_design` (existe) | read | — |
| `GET /brands/:slug/posts` | `list_designs` (existe) + `search_designs` (nome/status/tipo/pasta) | read | P1 |
| `PUT /posts/:id` | `update_design_meta` (nome, status, pasta) | write / edit_all | P1 |
| `PUT /posts/:id/slides/:i/code` | `update_slide` (HTML/CSS de UM slide) | write / edit_all | P0 |
| `GET …/slides/:i/photo-slots` | `get_photo_slots` | read | P0 |
| `PUT …/slides/:i/photo` | `set_slide_photo` (ativo real da marca) | write / edit_all | P0 |
| `POST /posts/:id/edit-slide` | `edit_slide_with_ai` | ai | P1 |
| `GET /posts/:id/cost` | `get_design_cost` | read | P1 |
| `GET /posts/:id/versions` | `list_versions` | read | P0 |
| `POST /posts/:id/versions` | `create_version` | write | P0 |
| `POST …/versions/:v/restore` | `restore_version` | write / edit_all | P0 |
| `POST /posts/render-batch` | `render_preview` (miniaturas) | read | P2 |
| `GET /posts/:id/export` | `export_design_json` (conteúdo cru) | export | P2 |
| `POST /posts/:id/export-file` | `export_file` (pdf, zip, pptx, html) | export | P0 |
| `GET …/export-file/:jobId` | `get_export_status` (+ link assinado de download) | export | P0 |
| `GET …/export-file/:jobId/download` | coberto pelo link assinado (não proxiar binário pelo MCP) | export | P0 |
| `POST /posts/:id/export-canva` | `export_to_canva` (png/pptx) | export | P0 |
| `GET …/export-canva/:jobId` | `get_canva_export_status` | export | P0 |
| `POST /posts/:id/publish` | `publish_design` | publish | P1 |
| `POST /posts/:id/unpublish` | `unpublish_design` | publish | P1 |
| `POST /posts/:id/chat/toggle` | `set_presentation_chat` | publish | P2 |
| `DELETE /posts/:id` | `delete_design` | delete | P2 |
| — (novo) | `duplicate_design` | write | P2 |

### 4.2 `brands` / `settings` — marca, cérebro, mídia

| Rota | Ferramenta | Escopo | Pri |
|---|---|---|---|
| `GET /brands`, `/brands/:slug` | `list_brands` (existe) | read | — |
| `GET /settings/:slug/config` | `get_brand_kit` (existe) | read | — |
| `PUT /settings/:slug/config` | `update_brand_kit` (cores, fontes, diretrizes, logo por URL pública, `presentationConfig`). **Sem** `ignoreAiCostLimit`/pesquisa automática (só ADMIN, no app). | brand | P1 |
| `GET /brands/:slug/profile` | `get_brand_profile` (cérebro) | read | P0 |
| `PUT /brands/:slug/profile` | `update_brand_profile` (snapshot antes) | brand | P1 |
| `POST …/profile/import` | `import_brand_profile` (texto/arquivos → perfil) | brand + ai | P2 |
| `GET/PUT /brands/:slug/memory` | `get_brand_memory` / `update_brand_memory` | read / brand | P1 / P2 |
| `POST …/brandbook/ingest`, `ingest-canva` | `ingest_brandbook` (job assíncrono) | brand + ai | P2 |
| `POST …/brandbook/confirm-logo` | `confirm_brand_logo` | brand | P2 |
| `GET /settings/:slug/referencias` | `manage_reference` ação `list/get` | read | P2 |
| `POST/PATCH/DELETE …/referencias[/:id]`, `…/sync` | `manage_reference` ações `create/update/delete/sync` (servidor busca URL externa: revisão SSRF) | brand | P3 |
| `GET /brands/:slug/ai-usage`, `…/billing` | `get_ai_usage` | read | P1 |
| `POST /brands/:slug/collabs` | `create_collab_brand` | brand (ADMIN) | P3 |
| `POST /ai/:slug/generate-briefing` | `generate_briefing` | ai | P2 |
| `POST /ai/:slug/extract-from-logo` | `extract_brand_from_logo` (cores/fontes a partir do logo) | ai | P2 |
| `GET /brands/discover` | — | ✗ descoberta de marcas alheias; o agente só vê o que o usuário liberou |
| `POST /brands`, `PUT/DELETE /brands/:slug` | — | ✗ criar/renomear/apagar marca é decisão humana |
| `POST …/request-access`, `…/requests/:id/approve` | — | ✗ controle de acesso |
| `GET /brands/:slug/logo-asset` | coberto por `get_brand_kit` (logoUrl) | read | — |

### 4.3 `assets` e `upload` — mídia

| Rota | Ferramenta | Escopo | Pri |
|---|---|---|---|
| `GET /brands/:id/assets` | `list_assets` (filtro por fonte, tag, pasta) / `get_asset` | read | P0 |
| `POST …/assets` (multipart) | `upload_asset` (base64 + teto; SVG sanitizado) | write | P0 |
| `POST …/assets/import-base64` | idem (mesma ferramenta) | write | P0 |
| `POST …/assets/import-canva/:designId` | `import_asset` fonte `canva` | write + integrations | P1 |
| (Drive) `GET /google/files/:id/download` | `import_asset` fonte `drive` | write + integrations | P1 |
| (Asana) `GET /asana/tasks/:gid/attachments` | `import_asset` fonte `asana` | write + integrations | P2 |
| `PATCH …/assets/:id` | `update_asset` (nome, tags, pasta) | write | P2 |
| `DELETE …/assets/:id` | `delete_asset` | delete | P2 |
| `POST …/assets/:id/export-canva` | `export_asset_to_canva` | export | P3 |
| `POST /upload`, `/upload/logo` | cobertos por `upload_asset` / `update_brand_kit` | — | — |
| `GET /public/fonts/:assetId` | — | ✗ endpoint público de fonte, sem uso para o agente |

### 4.4 `folders`

| Rota | Ferramenta | Escopo | Pri |
|---|---|---|---|
| `GET /folders/:slug` | `list_folders` | read | P1 |
| `POST/PATCH /folders…` | `manage_folder` ações `create/rename/move` | write | P2 |
| `DELETE /folders/:id` | `manage_folder` ação `delete` | delete | P3 |

### 4.5 `fabrica` + WebSocket — geração com IA (interativa)

A Fábrica é uma conversa em tempo real (WebSocket). O MCP não tem push; precisa de **sessão assíncrona com log de eventos
consultável** (o servidor já mantém a sessão no Redis).

| Origem | Ferramenta | Escopo | Pri |
|---|---|---|---|
| `POST /fabrica/sessions` | `start_generation` (marca, briefing, formato, pasta; checa teto de custo) | ai | P1 |
| `GET /fabrica/sessions/:id` | `get_generation_status` (+ `get_generation_events` desde um cursor) | ai | P1 |
| WS `message` | `factory_respond` ação `message` (instrução/anexos) | ai | P1 |
| WS `question:answer` | `factory_respond` ação `answer` | ai | P1 |
| WS `review:approve` / `review:decline` | `factory_respond` ações `approve` / `decline` | ai | P1 |
| WS `mode:set` | `factory_respond` ação `set_mode` | ai | P2 |
| WS `generation:cancel`, `message:interrupt` | `cancel_generation` (para o gasto) | ai | P1 |
| WS `advice:send/update/remove/dismiss` | `manage_advice` | ai | P3 |
| `PATCH …/sessions/:id/folder` | `start_generation`/`factory_respond` (campo `folderId`) | ai | P2 |
| `DELETE …/sessions/:id` | `delete_generation_session` | delete | P3 |
| Notificações de job (`job:done`, `job:error`, `needs_review`) | entram em `get_generation_events` | ai | P1 |

### 4.6 `notifications`, `settings` do usuário, integrações

| Rota | Ferramenta | Escopo | Pri |
|---|---|---|---|
| `GET /notifications` | `list_notifications` | read | P2 |
| `PATCH …/:id/read`, `POST …/read-all` | `mark_notifications_read` | write | P3 |
| `GET /canva/status`, `/google/status`, `/asana/status` | `get_integrations_status` | read | P0 |
| `GET /*/auth-url` | `get_connect_url` (URL para o USUÁRIO abrir; nunca token) | read | P1 |
| `GET /canva/designs` | `list_integration_files` fonte `canva` | integrations | P2 |
| `GET /google/files` | `list_integration_files` fonte `drive` | integrations | P2 |
| `GET /asana/projects`, `/projects/:id/tasks`, `/tasks/:gid/attachments` | `list_integration_files` fonte `asana` | integrations | P2 |
| `POST /canva/sync/:postId/fetch`, `/toggle` | `canva_sync` ações `fetch` / `toggle` | export | P3 |
| `GET /settings/tenants` | `list_workspaces` | read | P2 |
| `GET /settings/billing` | `get_billing_summary` (só leitura) | read (ADMIN) | P3 |
| `GET/PUT /settings/perfil`, `/settings/agent` | — | ✗ dados pessoais e prompt do agente do usuário |
| `DELETE /settings/connections/:provider` | — | ✗ desconectar integração é no app |

### 4.7 Equipe e acesso

| Rota | Ferramenta | Escopo | Pri |
|---|---|---|---|
| `GET /brands/:id/members` | `list_team` (nome e papel; sem e-mail se possível) | team | P2 |
| `POST …/invite`, `PATCH/DELETE …/:userId` | — | ✗ convidar, mudar papel ou remover é controle de acesso |
| `auth/*` (login, registro, convite, Google) | — | ✗ identidade |
| `data_deletion_requests`, diagnósticos, onboarding | — | ✗ LGPD e fluxos do usuário |

### 4.8 Observabilidade (`GenerationRun` / `GenerationStep`)

| Dado | Ferramenta | Escopo | Pri |
|---|---|---|---|
| Execuções da marca (status, tokens, erro) | `list_generation_runs` | read (ADMIN: prompts) | P2 |
| Passos de uma execução (modelo, latência, erro) | `get_generation_run` (prompt/resposta só ADMIN) | read | P3 |
| Uso e custo | `get_ai_usage`, `get_design_cost` | read | P1 |

### 4.9 Apresentação pública

| Rota | Ferramenta | Escopo | Pri |
|---|---|---|---|
| `GET /public/presentations/:slug` | — (é público; `get_design` cobre o conteúdo) | — | — |
| `GET/POST …/:slug/chat`, `GET …/events` | `get_presentation_activity` (mensagens do chat e visualizações) | read | P3 |

## 5. Catálogo consolidado

| Grupo | Ferramentas | Total |
|---|---|---|
| Leitura/contexto | `list_brands`✓ `get_brand_kit`✓ `get_designer_brief`✓ `get_brand_profile` `get_brand_memory` `list_assets` `get_asset` `list_folders` `list_versions` `get_photo_slots` `get_design_cost` `get_ai_usage` `search_designs` `list_team` `list_notifications` `list_workspaces` `get_integrations_status` `get_connect_url` `list_designs`✓ `get_design`✓ | 20 |
| Peças | `save_presentation`✓ `update_slide` `set_slide_photo` `update_design_meta` `duplicate_design` `create_version` `restore_version` `render_preview` | 8 |
| Mídia | `upload_asset` `import_asset` `update_asset` | 3 |
| Marca | `update_brand_kit` `update_brand_profile` `update_brand_memory` `import_brand_profile` `ingest_brandbook` `confirm_brand_logo` `manage_reference` `create_collab_brand` | 8 |
| IA / Fábrica | `start_generation` `get_generation_status` `get_generation_events` `factory_respond` `cancel_generation` `edit_slide_with_ai` `generate_briefing` `extract_brand_from_logo` `manage_advice` | 9 |
| Exportar/publicar | `export_file` `get_export_status` `export_to_canva` `get_canva_export_status` `canva_sync` `publish_design` `unpublish_design` `set_presentation_chat` `export_design_json` | 9 |
| Organização | `manage_folder` `delete_design` `delete_asset` `delete_generation_session` `mark_notifications_read` | 5 |
| Integrações | `list_integration_files` | 1 |
| Observabilidade | `list_generation_runs` `get_generation_run` `get_presentation_activity` `get_billing_summary` | 4 |
| **Total** | (✓ = já existe) | **67, das quais 6 existem** |

Com `tools/list` filtrado por escopo, um token só de leitura vê ~25; um com tudo, 67.

## 6. Outras primitivas MCP

| Primitiva | Uso |
|---|---|
| **Resources** | Kit, brief e cérebro como recursos (`designer://brand/{slug}/kit`), com `list_changed` ao mudar. Peça como recurso (`designer://brand/{slug}/design/{id}`). |
| **Resource links** | Retorno de exportações e miniaturas sem estourar o contexto. |
| **Prompts** | "Carrossel a partir de um texto", "Revisar texto contra o aprovado", "Variação da peça X", "Aplicar nova identidade a um deck". |
| **Annotations** | `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint` corretos em cada ferramenta. |
| **Elicitation** | Confirmação humana antes de `publish`, `delete_*` e `update_brand_profile` (quando o cliente suportar). |
| **Progress** | Notificação de progresso em `export_*` e `ingest_brandbook`. |

## 7. Ordem de construção

1. **Lote 1 (P0) — o agente trabalha sozinho no estúdio**: `get_brand_profile`, `list_assets`, `get_photo_slots`,
   `set_slide_photo`, `update_slide`, `list_versions`, `create_version`, `restore_version`, `upload_asset`, `export_file` +
   status, `export_to_canva` + status, `get_integrations_status`. Escopos novos: `export`.
2. **Lote 2 (P1) — dia a dia e Fábrica**: `search_designs`, `list_folders`, `update_design_meta`, `update_brand_kit`,
   `update_brand_profile`, `get_brand_memory`, `get_ai_usage`, `get_design_cost`, `start_generation` +
   `get_generation_status/events`, `factory_respond`, `cancel_generation`, `edit_slide_with_ai`, `publish/unpublish`,
   `import_asset`, `get_connect_url`. Escopos: `brand`, `ai`, `publish`, `integrations`.
3. **Lote 3 (P2)**: pastas, duplicar, atualizar ativo, memória, brandbook, referências (leitura), observabilidade,
   notificações, workspaces, equipe (leitura).
4. **Lote 4 (P3)**: exclusões, referências (escrita), coleção de marcas, conselhos, sync com Canva, atividade pública,
   cobrança.

Cada lote entra com: testes de escopo, papel, marca cruzada e teto de custo (padrão de `editAll.test.ts`);
`docs/MCP-DESIGNER.md` atualizado; texto novo no consentimento por escopo; e limite de taxa por categoria (leitura
×escrita×IA×exportação).

## 8. Riscos a decidir antes de construir

| Risco | Decisão proposta |
|---|---|
| `update_brand_profile` muda todas as peças futuras | Snapshot do cérebro antes; escopo próprio `brand`; elicitation; restauração. |
| Gasto de IA fora de controle (loop do agente) | `designer.ai` separado; teto por conexão/hora; custo no retorno; respeita `ai-usage` e `ignoreAiCostLimit` (que o agente não altera). |
| Publicação expõe conteúdo | `designer.publish` separado; `unpublish` sempre disponível; log de quem publicou. |
| Exportar para Canva usa a conta pessoal | Só com `designer.export` e conta conectada; token nunca passa pelo agente. |
| Entrada hostil (SVG, HTML, URLs de referência) | Mesmos funis do app; novos pontos de entrada com testes de SSRF/XSS. |
| Catálogo grande degrada o cliente | `tools/list` por escopo + ferramentas por ação. |
| Fábrica é WebSocket | Sessão assíncrona com log de eventos e cursor; reaproveita o Redis da sessão. |
| Cliente (Claude) pede só leitura | Resolvido no #102: a tela deixa o usuário liberar o que quiser. |

## 9. Decisões de produto que ficam com o dono

1. A Fábrica entra no MCP, ou o agente externo desenha sozinho com `save_presentation`?
2. `designer.publish` e `designer.delete` entram agora?
3. `update_brand_profile` pode ser feito por agente, ou só leitura do cérebro?
4. `list_team` entra (só leitura) ou o agente nem vê membros?
5. Limites de custo por conexão: valor padrão por hora/dia.
