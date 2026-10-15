# Designer como MCP — o que o agente precisa poder fazer (análise e plano)

> Base: inventário das rotas do backend em `main` (16 routers, ~110 endpoints) contra as 6 ferramentas MCP de hoje.
> Hoje o agente cobre **cerca de 10%** do app: lê marca/peças e salva apresentações. Este documento lista o que falta,
> em quais escopos, com que risco, e em que ordem construir.

## 1. O que existe hoje (6 ferramentas)

`list_brands`, `get_brand_kit`, `get_designer_brief`, `list_designs`, `get_design`, `save_presentation`
(+ `designer.read`, `designer.write`, `designer.edit_all`).

## 2. Princípios (valem para toda ferramenta nova)

1. **Uma ferramenta = um arquivo** em `backend/src/mcp/tools/`; segurança (escopo, marca, papel, log) vem do registro
   central. Nada de segurança copiado entre ferramentas.
2. **O papel do usuário na marca é o teto**, conferido a cada chamada (mesmas regras de `brandAccess.ts`: `ANY_MEMBER`,
   `EDITORS`, `ADMINS`). O agente nunca faz o que o usuário não faria no app.
3. **Tudo o que gasta dinheiro** (IA, render, Canva) passa pelo mesmo teto de custo do app (`ai-usage`,
   `ignoreAiCostLimit`) e é visível no resultado (`costEstimate`/`usage`).
4. **Tudo o que sai do Designer** (link público, exportação para Canva, download) exige escopo próprio e `openWorldHint`.
5. **Tudo o que apaga** tem `destructiveHint: true`, escopo próprio e snapshot/restauração quando possível.
6. **Chamadas terminam em segundos** (limite ~60 s dos clientes): trabalho longo é `start_*` + `get_*_status`
   (job assíncrono), nunca uma chamada que espera.
7. **Segredos nunca saem**: tokens de Canva/Google/Asana, prompt interno do agente, convites e e-mails de terceiros ficam
   no servidor. Fluxos de conexão devolvem uma URL para o USUÁRIO abrir.
8. **Entrada vinda do agente é hostil**: HTML passa por `validateHtmlDesign`; URLs externas por `isPublicHttpUrl`
   (mesmo funil do #97); arquivos por tamanho/tipo e sanitização de SVG.

## 3. Escopos propostos

| Escopo | Libera | Papel mínimo | Observação |
|---|---|---|---|
| `designer.read` | leitura de marcas, peças, ativos, cérebro, uso, versões, jobs | VIEWER | já existe |
| `designer.write` | criar peças, subir ativos, editar o que a conexão criou | EDITOR | já existe |
| `designer.edit_all` | editar/sobrescrever peças de qualquer origem | EDITOR | já existe (#99) |
| `designer.brand` | alterar kit da marca, perfil/cérebro, memória, referências, brandbook | EDITOR (campos de custo: ADMIN) | muda como TODAS as peças futuras saem |
| `designer.ai` | acionar geração/edição com IA (gasta crédito) | EDITOR | separado para o usuário poder dar escrita sem gasto |
| `designer.export` | exportar PDF/PNG/Canva e baixar arquivos | VIEWER (Canva: EDITOR) | envolve conta Canva do usuário |
| `designer.publish` | publicar/despublicar link público | EDITOR | expõe conteúdo fora do app |
| `designer.delete` | apagar peças, ativos, pastas, sessões | EDITOR | destrutivo; sempre com snapshot quando der |
| `designer.team` | só LEITURA de membros e pedidos de acesso | VIEWER | convidar/alterar papel **não** vai para o agente |

O usuário continua escolhendo na tela de consentimento (começa em "só ver"); cada escopo ganha texto claro do que libera.

## 4. Catálogo de ferramentas

Legenda de prioridade: **P0** destrava o fluxo principal · **P1** completa o dia a dia · **P2** conveniência ·
**P3** só com decisão explícita.

### 4.1 Leitura e contexto (`designer.read`)

| Ferramenta | Rota de origem | Pri | Para quê |
|---|---|---|---|
| `get_brand_profile` | `GET /brands/:slug/profile` | P0 | O **cérebro** da marca (camadas: identidade, tom, regras, proibições). Hoje só vem filtrado pelo brief. |
| `get_brand_memory` | `GET /brands/:slug/memory` | P1 | Preferências aprendidas; o agente respeita antes de desenhar. |
| `list_assets` / `get_asset` | `GET /brands/:id/assets` | P0 | Fotos, logos, fontes próprias reais. Sem isto o agente não sabe o que pode usar. |
| `list_folders` | `GET /folders/:slug` | P1 | Organização das peças. |
| `list_versions` | `GET /posts/:id/versions` | P0 | Ver/restaurar o que o agente sobrescreveu (complementa #98/#99). |
| `get_design_cost` / `get_ai_usage` | `GET /posts/:id/cost`, `/brands/:slug/ai-usage` | P1 | Custo de uma peça e consumo da marca antes de gastar. |
| `list_references` | `GET /settings/:slug/referencias` | P2 | Referências visuais cadastradas. |
| `get_photo_slots` | `GET /posts/:id/slides/:i/photo-slots` | P0 | Quais áreas de foto o slide tem, para preencher. |
| `list_team` | `GET /brands/:id/members` | P2 | Só leitura (nome/papel), sem e-mail se possível. |
| `list_notifications` | `GET /notifications` | P2 | Estado de jobs e avisos. |
| `search_designs` | `GET /brands/:slug/posts` | P1 | Busca por nome/status/tipo (hoje `list_designs` só ordena por data). |

### 4.2 Peças (`designer.write` / `designer.edit_all`)

| Ferramenta | Rota | Pri | Observação |
|---|---|---|---|
| `save_presentation` | (existe) | — | |
| `update_slide` | `PUT /posts/:id/slides/:i/code` | P0 | Edição pontual de UM slide, sem reenviar o deck inteiro (hoje o agente reescreve tudo). |
| `set_slide_photo` | `PUT /posts/:id/slides/:i/photo` | P0 | Coloca um ativo real da marca numa área de foto. |
| `update_design_meta` | `PUT /posts/:id` | P1 | Nome, status, pasta. |
| `duplicate_design` | novo | P2 | Variação sem tocar no original. |
| `create_version` / `restore_version` | `POST /posts/:id/versions[/:v/restore]` | P0 | Ponto de restauração explícito; desfaz erro do agente. |

### 4.3 Ativos (`designer.write`)

| Ferramenta | Rota | Pri | Observação |
|---|---|---|---|
| `upload_asset` | `POST /brands/:id/assets/import-base64` | P0 | Base64 com teto; SVG sanitizado. Cliente MCP não faz multipart. |
| `update_asset` | `PATCH /assets/:id` | P2 | Nome/tags. |
| `import_asset_from_canva` | `POST …/import-canva/:designId` | P1 | Usa a conta Canva do usuário. |
| `import_asset_from_drive` | `GET /google/files` + `/download` | P1 | Idem para o Drive. |

### 4.4 Marca e cérebro (`designer.brand`)

| Ferramenta | Rota | Pri | Observação |
|---|---|---|---|
| `update_brand_kit` | `PUT /settings/:slug/config` | P1 | Cores, fontes, diretrizes, logo (URL pública; mesmo funil SSRF). **Campos de custo ficam fora** (só ADMIN, no app). |
| `update_brand_profile` | `PUT /brands/:slug/profile` | P1 | O cérebro: muda TODAS as gerações futuras. Exige snapshot e confirmação (`destructiveHint` falso, mas aviso forte). |
| `update_brand_memory` | `PUT /brands/:slug/memory` | P2 | Preferências. |
| `ingest_brandbook` | `POST …/brandbook/ingest` / `ingest-canva` | P2 | Longo e caro: job assíncrono + `designer.ai`. |
| `manage_references` | `POST/PATCH/DELETE /settings/:slug/referencias` | P3 | Faz o servidor buscar URLs externas; revisão SSRF antes. |

### 4.5 Fábrica / geração com IA (`designer.ai`)

A Fábrica hoje roda por WebSocket (`initBrainHandlers`). Para o agente precisa virar **job assíncrono**:

| Ferramenta | Rota | Pri | Observação |
|---|---|---|---|
| `start_generation` | `POST /fabrica/sessions` | P1 | Recebe marca, briefing, formato, pasta; devolve `sessionId`. Checa teto de custo antes. |
| `get_generation_status` | `GET /fabrica/sessions/:id` | P1 | Progresso, peça criada, custo até aqui. |
| `pause_generation` / `cancel_generation` | novo + `DELETE …/sessions/:id` | P1 | Parar gasto. |
| `edit_slide_with_ai` | `POST /posts/:id/edit-slide` | P1 | Edição por instrução natural; devolve custo e `versionId`. |
| `generate_briefing` | `POST /ai/:slug/generate-briefing` | P2 | |

> Decisão pendente: o agente (Claude/ChatGPT) **já é** uma IA que desenha. Faz sentido expor a Fábrica? Sim para quem
> quer o estilo/cérebro do estúdio e a conferência de texto; não é necessário para `save_presentation`. Por isso fica em P1
> e atrás de `designer.ai`.

### 4.6 Exportação e publicação

| Ferramenta | Rota | Escopo | Pri | Observação |
|---|---|---|---|---|
| `export_file` | `POST /posts/:id/export-file` | `export` | P0 | PDF/PNG/PPTX conforme `exportFileSchema`; devolve `jobId`. |
| `get_export_status` | `GET …/export-file/:jobId` | `export` | P0 | + URL de download assinada, curta, ou `resource_link`. |
| `export_to_canva` | `POST /posts/:id/export-canva` | `export` | P0 | Usa a conta Canva do usuário (se não conectada, devolve a URL para ele conectar). |
| `get_canva_export_status` | `GET …/export-canva/:jobId` | `export` | P0 | |
| `publish_design` | `POST /posts/:id/publish` | `publish` | P1 | Link público; devolve URL; `openWorldHint: true`. |
| `unpublish_design` | `POST /posts/:id/unpublish` | `publish` | P1 | |
| `render_preview` | `POST /posts/render-batch` | `read` | P2 | Miniaturas para o agente "ver" o resultado (precisa de imagem no retorno). |

### 4.7 Organização e exclusão

| Ferramenta | Rota | Escopo | Pri |
|---|---|---|---|
| `create_folder` / `rename_folder` / `move_design` | `POST/PATCH /folders…` | `write` | P2 |
| `delete_design` | `DELETE /posts/:id` | `delete` | P2 |
| `delete_asset` | `DELETE …/assets/:id` | `delete` | P2 |
| `delete_folder` | `DELETE /folders/:id` | `delete` | P3 |
| `delete_generation_session` | `DELETE /fabrica/sessions/:id` | `delete` | P3 |

### 4.8 Integrações do usuário (status e fontes de conteúdo)

| Ferramenta | Rota | Pri | Observação |
|---|---|---|---|
| `get_integrations_status` | `/canva/status`, `/google/status`, `/asana/status` | P0 | Evita o agente tentar exportar sem conta conectada. |
| `get_connect_url` | `/*/auth-url` | P1 | Devolve **a URL para o usuário abrir**; o token nunca passa pelo agente. |
| `list_canva_designs` | `GET /canva/designs` | P2 | Fonte para importar ativos. |
| `list_drive_files` | `GET /google/files` | P2 | |
| `asana_*` (projetos, tarefas, anexos) | `/asana/*` | P2 | Trazer briefing/anexos de tarefa para o fluxo. |

### 4.9 O que NÃO vai para o agente (decisão de produto)

- Convidar/alterar papel/remover membro, aprovar pedido de acesso (`team`, `requests/:id/approve`): é controle de acesso.
- Criar/apagar marca, login, registro, convites, perfil e cobrança do usuário (`auth`, `settings/perfil|billing`).
- Tokens de qualquer integração; prompt interno do agente; `ignoreAiCostLimit` e pesquisa automática.
- Desconectar integrações (`settings/connections/:provider`) — o usuário faz no app.

## 5. Além de ferramentas: outras primitivas MCP

| Primitiva | Uso |
|---|---|
| **Resources** | Kit da marca, brief e cérebro como recursos legíveis (`designer://brand/{slug}/kit`), com `list_changed` quando mudar. |
| **Prompts** | "Criar carrossel a partir de um texto", "Revisar texto contra o aprovado", "Variação da peça X": fluxos prontos que chamam as ferramentas na ordem certa. |
| **Resource links** | Retorno de exportações e miniaturas sem estourar o contexto. |
| **Annotations** | `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint` corretos em cada ferramenta (o cliente decide quando pedir confirmação). |

## 6. Ordem sugerida

1. **Lote 1 (P0)** — o agente passa a *trabalhar sozinho no estúdio*:
   `list_assets`, `get_brand_profile`, `get_photo_slots`, `set_slide_photo`, `update_slide`, `create_version`,
   `restore_version`, `list_versions`, `upload_asset`, `export_file` + status, `export_to_canva` + status,
   `get_integrations_status`.
2. **Lote 2 (P1)** — `search_designs`, `list_folders`, `update_design_meta`, `update_brand_kit`, `update_brand_profile`,
   `start_generation` + status/pause, `edit_slide_with_ai`, `publish/unpublish`, `get_connect_url`, `get_design_cost`,
   `get_ai_usage`, `import_asset_from_canva|drive`.
3. **Lote 3 (P2/P3)** — pastas, duplicar, exclusão, Asana/Drive/Canva como fontes, referências, brandbook.

Cada lote entra com: testes de escopo, de papel, de marca cruzada e do teto de custo (padrão de `editAll.test.ts`);
atualização de `docs/MCP-DESIGNER.md`; e texto novo no consentimento para cada escopo.

## 7. Riscos a decidir antes de construir

| Risco | Decisão |
|---|---|
| `update_brand_profile` altera o comportamento de todas as peças futuras | Snapshot do cérebro antes; escopo próprio (`designer.brand`); aviso na tela. |
| Gasto de IA fora de controle (loop do agente) | `designer.ai` separado; teto por conexão/hora; custo no retorno; respeitar `ai-usage` da marca. |
| Publicação expõe conteúdo | `designer.publish` separado; `unpublish` sempre disponível; log de quem publicou. |
| Exportar para Canva usa a conta pessoal do usuário | Só com `designer.export` e conta conectada; nunca repassar token. |
| Entrada hostil (SVG, HTML, URLs) | Mesmos funis do app; novos pontos de entrada com testes de SSRF/XSS. |
| Cliente (Claude) pede só leitura | Resolvido no #102: a tela deixa o usuário liberar o que quiser. |
