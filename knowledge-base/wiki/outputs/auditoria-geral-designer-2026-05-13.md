---
title: Auditoria Geral do Designer — 2026-05-13
type: output
tags:
  - "designer"
  - "auditoria"
  - "qualidade"
  - "segurança"
  - "frontend"
  - "backend"
sources:
  - "designer/frontend"
  - "designer/backend"
  - "wiki/workflows/designer-timeline-execucao.md"
  - "wiki/overview.md"
created: 2026-05-13
updated: 2026-05-13
---

# Auditoria Geral do Designer — 2026-05-13

## Resumo executivo

O Designer está funcional e adiantado para a fase atual: Fábrica v2, Galeria, Editor próprio, pipeline IA, multi-select, preview de animação e geração visual já existem. As validações principais passaram.

Correção de interpretação em 2026-05-13: “Vercel AI SDK + agente por marca” é alucinação/inferência indevida quando aplicado ao estado atual. O código não usa Vercel AI SDK; o que existe é contexto por marca via slug + BrandConfig e backend Express/Gemini/FAL. Designer e Bot devem ser tratados como quase finalizados e indo para testes, não como dependentes dessa proposta histórica.

O risco principal não é build quebrado; é fechamento de MVP: validação real com usuária, pendência de Drive no ecossistema Gabi, upload/R2 com erro claro e limpeza de decisões legadas pós-ADR-006.

## Validações executadas

| Área | Comando | Resultado |
|---|---|---|
| Frontend | `npm run lint` | ✅ Sem erros; 0 warnings após limpeza em 2026-05-13 22:42 |
| Frontend | `npm run build` | ✅ Build OK após limpeza em 2026-05-13 22:42 |
| Backend | `npm run lint` | ✅ Sem erros |
| Backend | `npm run build` | ✅ TypeScript OK |
| VS Code diagnostics | Diagnósticos gerais | ✅ Sem diagnostics |
| Canvas KB | JSON parse | ✅ `tracking.canvas` válido |

### Warnings atuais do frontend

✅ Resolvidos em 2026-05-13 22:42. O frontend agora passa `npm run lint` sem warnings e `npm run build` com sucesso.

Correções aplicadas:
- `currentDesign` não usado tratado na Fábrica.
- dependência `brandConfig` adicionada ao `useCallback` relevante.
- `<img>` do painel de imagens substituído por `next/image`.
- props `id` não usadas removidas da desestruturação dos cards.
- `runPatch` morto removido da Fábrica; fluxo de ajuste por IA permanece no Editor via `AIFixPanel`/`useDesignFixer`.

## O que já está funcionando

### Frontend

- Next.js App Router com rotas por marca (`/[marca]`).
- Middleware redireciona sem cookie `auth_token` para `/login`.
- Fábrica v2 com wizard, chat, SSE, assets e geração de design.
- Galeria com pastas, listagem, preview, exclusão e drag-and-drop.
- Editor visual próprio com CanvasEditor, propriedades, multi-select, multi-drag, atalhos e preview de animação.
- Editor agora converte posts de imagem (`content.dataUrl`/`content.url`) em página editável com layer de imagem.

### Backend

- Express com rotas protegidas via `requireAuth` para brands, settings, ai, posts, folders, upload e Canva não-callback.
- Prisma/PostgreSQL com modelos User, Brand, BrandConfig, Reference, Post, Folder e CanvaIntegration.
- IA com Gemini retry, FAL AI primário e fallback Pollinations.
- Upload para R2 com normalização de imagem.
- Settings com validação de ownership por `brand.userId`.

### KB

- Timeline do Designer criada.
- Overview atualizado para ADR-006.
- ADR-004 marcada como decisão adiada por último.
- Status Gabi/Marcelle atualizado.

## Achados críticos

### 1. Ownership insuficiente em `posts.ts`

**Risco:** alto.

`GET /api/posts/:id` usa `findUnique({ where: { id } })` e retorna o post com brand, mas não valida se `post.brand.userId === req.user.userId`.

`PUT /api/posts/:id` atualiza por id e permite alterar `content`, `status` e `folderId`, mas precisa validar ownership do post e ownership da pasta quando `folderId` for informado.

**Impacto:** usuário autenticado pode acessar ou alterar post de outra marca se souber o id.

**Correção recomendada:** buscar post com brand antes de responder/atualizar e bloquear se `brand.userId !== req.user.userId`. Para `folderId`, validar se a pasta pertence à mesma brand.

### 2. Ownership insuficiente em `folders.ts`

**Risco:** alto.

`GET/POST /api/folders/:slug` busca brand por slug sem filtrar `userId`. `DELETE /api/folders/:id` deleta por id sem validar ownership.

**Impacto:** usuário autenticado pode listar/criar/deletar folders em brand alheia se souber slug/id.

**Correção recomendada:** sempre usar `where: { slug, userId: req.user.userId }` para brand e validar folder + brand no delete.

### 3. Upload sem verificação de configuração R2

**Risco:** médio.

Upload usa R2, mas se `R2_ENDPOINT`, keys ou bucket estiverem vazios, o erro pode aparecer tarde e com mensagem ruim.

**Correção recomendada:** validar config antes do upload e retornar erro claro de setup. Adicionar limite explícito de tamanho de payload/base64 além do limite global de 25mb.

## Achados importantes

### 4. Canva ainda existe como código legado

**Risco:** médio.

ADR-006 tornou o CanvasEditor próprio o caminho principal, mas ainda existem:

- `CanvaIntegration` no Prisma.
- campos `canvaDesignId` e `canvaExportUrl` em Post.
- `src/routes/canva.ts`.
- `src/lib/canvaClient.ts`.
- config `CANVA_*`.
- rota visual `/configuracoes/canva`, hoje apontando para Penpot no texto.

**Correção recomendada:** não remover agora se não quiser migration arriscada. Marcar como stand-by experimental, esconder do fluxo principal e limpar nomenclatura da tela.

### 5. Dependências legadas de export/ffmpeg permanecem

**Risco:** médio/baixo.

No frontend ainda existem:

- `@ffmpeg/ffmpeg`
- `@ffmpeg/util`
- `html-to-image`
- `html2canvas`
- `jspdf`

A KB antiga dizia que parte delas havia sido removida, mas o `package.json` mantém todas.

**Correção recomendada:** decidir se export PNG/PDF/MP4 é escopo atual. Se não for, isolar/remover para reduzir bundle e ambiguidade.

### 6. Drive da Gabi ainda é pendência operacional

**Risco:** médio para lançamento.

O status atual indica bot da Gabi indo para testes, mas integração com Google Drive ainda pendente.

**Correção recomendada:** tratar como bloqueador operacional de teste/entrega, fora do core do Designer visual mas dentro do ecossistema de lançamento.

### 7. Warnings de lint no frontend

**Status:** resolvido em 2026-05-13 22:42.

O frontend passou a rodar `npm run lint` sem warnings e `npm run build` com sucesso. A limpeza removeu resíduos da Fábrica e preservou o fluxo ativo de ajuste por IA no Editor.

## Achados de UX/produto

### 8. Validação real com Gabi ainda falta

**Risco:** alto para produto.

Tecnicamente o Designer está adiantado, mas falta fluxo real:

1. configurar marca;
2. gerar design;
3. editar no CanvasEditor;
4. salvar;
5. conferir na Galeria;
6. usar/exportar arte.

### 9. ADR-004 da Fábrica deve ficar por último

**Status:** registrado.

A decisão Wizard vs No-Wizard foi adiada. A Fábrica v2/Wizard continua base operacional até estabilizar MVP e validar com Gabi.

## Priorização recomendada

### P0 — Segurança e integridade de dados

1. ~~Corrigir ownership em `posts.ts`.~~ ✅ Resolvido em 2026-05-13: `GET`, `PUT` e `DELETE /api/posts/:id` agora filtram o post por `brand.userId` do usuário autenticado.
2. ~~Corrigir ownership em `folders.ts`.~~ ✅ Resolvido em 2026-05-13: listagem/criação por slug e exclusão por id agora validam ownership da brand/folder.
3. ~~Validar `folderId` no update de post.~~ ✅ Resolvido em 2026-05-13: `PUT /api/posts/:id` só aceita `folderId` nulo ou pertencente à mesma brand do post.

### P1 — Fechar MVP para teste

4. Testar fluxo completo com Gabi.
5. ~~Resolver warnings de lint do frontend.~~ ✅ Resolvido em 2026-05-13 22:42.
6. Validar upload/logo/R2 com erro claro.
7. Fechar Drive no ecossistema Gabi.

### P2 — Limpeza pós-ADR-006

8. Isolar Canva como stand-by.
9. Corrigir nomenclatura da página `/configuracoes/canva`.
10. Decidir dependências legadas de export/ffmpeg.
11. Atualizar documentos antigos que ainda tratam Canva como caminho principal.

### P3 — Evolução futura

12. Export MP4/GIF.
13. Biblioteca formal de layouts.
14. Avaliar FLUX/qualidade visual com Gabi.
15. Retomar ADR-004 somente por último.

## Cruzamento com tasks e gaps já existentes na KB

### Matriz de relação

| Achado da auditoria | Já existia na KB? | Fonte relacionada | Classificação |
|---|---|---|---|
| Ownership em `posts.ts` | Parcialmente | [[auditoria-ux-logica-designer]], [[designer-plano-implementacao]], [[designer-backend]] | Gap antigo reaberto como P0 |
| Ownership em `folders.ts` | Não explicitamente | [[galeria-gestao]], [[designer-backend]] | Achado novo P0 |
| Validação de `folderId` no update de post | Não explicitamente | [[galeria-gestao]], [[designer-backend]] | Achado novo P0 |
| Posts de imagem abrirem no Editor | Sim | [[auditoria-ux-logica-designer]], [[designer-timeline-execucao]], [[agente-designer]] | Gap antigo resolvido no código atual |
| Upload/R2 com erro claro | Parcialmente | [[auditoria-libs-configs]], [[designer-backend]], [[infraestrutura-tecnica]] | Gap técnico P1 |
| Canva legado/stand-by | Sim | [[adr-006-editor-visual-alternativas-canva]], [[canva-connect-api]], [[agente-designer]], [[overview]] | Conflito documental P2 |
| Dependências antigas de export/ffmpeg | Sim | [[auditoria-libs-configs]], [[adr-006-editor-visual-alternativas-canva]] | Conflito código ↔ KB P2 |
| Warnings de lint frontend | Parcialmente | [[qualidade-lint-build]], [[designer-frontend]] | Manutenção P1/P2 |
| Drive da Gabi | Sim | [[secretaria-ai-gabi]], [[bot-gabi]], [[infraestrutura-tecnica]] | Bloqueio operacional fora do core Designer |
| Validação real com Gabi | Sim | [[designer-plano-implementacao]], [[designer-timeline-execucao]], [[overview]] | Marco de produto P1 |
| ADR-004/Wizard | Sim | [[adr-004-fabrica-arquitetura-v3]], [[fabrica-v2]], [[fabrica-redesign]] | Decisão adiada por último |

### Tasks antigas que continuam válidas

#### [[designer-plano-implementacao]]

- **T11 — Auth completo em todas as rotas protegidas:** continua válida e agora deve incluir ownership explícito em `posts.ts` e `folders.ts`.
- **T12 — Wizard onboarding:** ainda pendente como refinamento de produto, mas não bloqueia P0.
- **T13 — Toast/feedback visual em saves:** ainda válido para fechar UX antes de teste.
- **T14 — Avaliar FLUX/FAL com Gabi:** continua futuro; FAL já existe, falta validação qualitativa.
- **T15 — Animação/export MP4/GIF:** continua futuro; preview existe, export real não.

#### [[auditoria-ux-logica-designer]]

- Auth/ownership foi apontado como gap antigo. A auditoria atual confirma que settings está melhor, mas posts/folders ainda precisam correção.
- O problema de posts de imagem no editor foi apontado antes; agora está tratado no Editor com conversão para layer de imagem.
- Upload real de logo e retry/reanálise de referências seguem pendentes.

#### [[auditoria-libs-configs]]

- Divergência de libs continua: pacote ainda mantém `html-to-image`, `html2canvas`, `jspdf` e `@ffmpeg/*`.
- A KB pós-ADR-006 dizia que deps foram removidas, mas o código atual não confirma isso.

#### [[qualidade-lint-build]]

- Build/lint continuam passando.
- O status precisa ser refinado para mencionar warnings frontend atuais, não apenas sucesso absoluto.

#### [[adr-006-editor-visual-alternativas-canva]]

- Decisão principal está correta: CanvasEditor próprio é o caminho.
- Mas a seção de impacto afirma que deps NPM removidas continuam removidas; isso conflita com `package.json` atual.
- `canvaClient.ts` e rotas Canva permanecem como stand-by/código legado.

#### [[infraestrutura-tecnica]]

- Documento ainda tem status antigo de Marcelle e Designer.
- Deve ser atualizado futuramente para refletir: Designer funcional, Marcelle indo para teste, Gabi com Drive pendente.

### O que é realmente novo nesta auditoria

1. `folders.ts` sem ownership explícito.
2. `folderId` em `PUT /api/posts/:id` sem validação de pertencimento à mesma brand.
3. Necessidade de erro claro para configuração R2 no upload.
4. Warnings atuais específicos do frontend.

### O que não é novo, mas virou prioridade maior

1. Auth/ownership completo: já era task antiga, agora tem pontos concretos P0.
2. Limpeza pós-ADR-006: já era conhecida, mas agora há conflito direto entre KB e `package.json`.
3. Validação com Gabi: já estava no plano, mas virou próximo marco de produto.

### O que foi resolvido durante esta rodada

1. Editor abre posts de imagem (`content.dataUrl`/`content.url`) como página editável.
2. ADR-004 foi explicitamente marcada como decisão adiada por último.
3. Timeline e overview já refletem que a Fábrica v2/Wizard permanece base operacional.
4. P0 de ownership do Designer resolvido em `posts.ts` e `folders.ts`, incluindo validação de `folderId` por brand.

## Backlog consolidado pós-cruzamento

### P0 — Corrigir antes de teste amplo

| Task | Origem KB | Arquivo/área | Status |
|---|---|---|---|
| Validar ownership em `GET /api/posts/:id` | [[designer-plano-implementacao]], [[auditoria-ux-logica-designer]] | `backend/src/routes/posts.ts` | ✅ Resolvido 2026-05-13 |
| Validar ownership em `PUT /api/posts/:id` | [[designer-plano-implementacao]], [[auditoria-ux-logica-designer]] | `backend/src/routes/posts.ts` | ✅ Resolvido 2026-05-13 |
| Validar ownership em `DELETE /api/posts/:id` | Extensão da correção P0 | `backend/src/routes/posts.ts` | ✅ Resolvido 2026-05-13 |
| Validar `folderId` no update do post | Achado novo | `backend/src/routes/posts.ts` | ✅ Resolvido 2026-05-13 |
| Validar ownership em folders por slug/id | Achado novo | `backend/src/routes/folders.ts` | ✅ Resolvido 2026-05-13 |

### P1 — Fechar MVP de teste

| Task | Origem KB | Área |
|---|---|---|
| Testar fluxo completo com Gabi | [[designer-plano-implementacao]], [[designer-timeline-execucao]] | Produto |
| Resolver warnings frontend | [[qualidade-lint-build]] | Frontend |
| Melhorar erro de configuração R2/upload | [[auditoria-libs-configs]], [[infraestrutura-tecnica]] | Backend/infra |
| Fechar Drive da Gabi | [[secretaria-ai-gabi]], [[bot-gabi]] | Ecossistema Gabi |
| Toast/feedback visual em saves | [[designer-plano-implementacao]] | UX |

### P2 — Limpeza e consistência

| Task | Origem KB | Área |
|---|---|---|
| Isolar Canva como stand-by | [[adr-006-editor-visual-alternativas-canva]], [[canva-connect-api]] | Backend/frontend/docs |
| Corrigir docs que ainda tratam Canva como caminho principal | [[agente-designer]], [[overview]], [[canva-connect-api]] | KB |
| Decidir/remover deps antigas de export/ffmpeg | [[auditoria-libs-configs]], [[adr-006-editor-visual-alternativas-canva]] | Frontend |
| Atualizar [[infraestrutura-tecnica]] | Status real Gabi/Marcelle/Designer | KB |

### P3 — Futuro

| Task | Origem KB | Área |
|---|---|---|
| Export MP4/GIF real | [[designer-plano-implementacao]], [[agente-designer]] | Editor/export |
| Biblioteca formal de layouts | [[fabrica-biblioteca-layouts]], [[benchmarking-fabrica-ux]] | Fábrica |
| Avaliar FLUX/FAL com Gabi | [[designer-plano-implementacao]] | Qualidade visual |
| Retomar ADR-004 | [[adr-004-fabrica-arquitetura-v3]] | Arquitetura Fábrica |

## Conclusão

O sistema está em bom estado técnico: build e lint passam, o editor próprio está funcional e a Fábrica/Galeria estão maduras o suficiente para teste. Ao cruzar com a KB, a auditoria confirma que as maiores pendências não são novas features, mas fechamento de riscos já previstos: ownership completo, validação real com Gabi e limpeza pós-ADR-006. Não é recomendado mexer agora na arquitetura da Fábrica/Wizard.

## Relacionados

- [[designer-timeline-execucao]]
- [[overview]]
- [[adr-004-fabrica-arquitetura-v3]]
- [[adr-006-editor-visual-alternativas-canva]]
- [[designer-frontend]]
- [[designer-backend]]
