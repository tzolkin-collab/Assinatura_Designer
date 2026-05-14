---
title: Timeline de Execução - Designer IA
type: workflow
tags:
  - "designer"
  - "timeline"
  - "execucao"
  - "roadmap"
  - "pendencias"
sources:
  - "wiki/log.md"
  - "wiki/features/agente-designer.md"
  - "wiki/architecture/designer-frontend.md"
  - "wiki/architecture/designer-backend.md"
  - "wiki/features/fabrica-v2.md"
  - "wiki/features/galeria-gestao.md"
  - "wiki/decisions/adr-005-canva-api-migração.md"
  - "wiki/decisions/adr-006-editor-visual-alternativas-canva.md"
created: 2026-05-13
updated: 2026-05-13
---

# Timeline de Execução - Designer IA

## Resumo

Este documento consolida a execução do **Designer IA** a partir da KB canônica local, conectando cada fase aos documentos de feature, arquitetura, decisão e auditoria correspondentes. O foco é mostrar o que já foi feito no Designer, quais documentos sustentam cada entrega e o que ainda falta executar.

## Documentos associados

### Núcleo do Designer

| Documento | Papel |
|---|---|
| [[agente-designer]] | Feature principal do Designer IA: geração de designs, Fábrica, IA e gaps funcionais |
| [[designer-frontend]] | Arquitetura frontend: Next.js, Fábrica, Editor, Galeria, rotas por marca |
| [[designer-backend]] | Arquitetura backend: Express, Prisma, rotas de IA, geração de imagem/design, retry |
| [[qualidade-lint-build]] | Workflow de qualidade: lint/build frontend e backend |

### Fábrica e Galeria

| Documento | Papel |
|---|---|
| [[fabrica-v2]] | Redesign procedural da Fábrica com wizard, preview e assets |
| [[fabrica-biblioteca-layouts]] | Especificação da biblioteca de layouts e prompts por layout |
| [[fabrica-redesign]] | Proposta alternativa Trae para Fábrica sem wizard; conflita com v2 |
| [[galeria-gestao]] | Gestão de artes, pastas, drag-and-drop e exclusão |
| [[benchmarking-fabrica-ux]] | Benchmark de Canva/Gamma/Beautiful.ai/Pitch/Slidebean para evolução da Fábrica |

### Editor e decisões arquiteturais

| Documento | Papel |
|---|---|
| [[adr-004-fabrica-arquitetura-v3]] | Decisão pendente entre manter Wizard/Express ou migrar para No-Wizard/Supabase |
| [[adr-005-canva-api-migração]] | Decisão histórica de migrar CanvasEditor para Canva Connect API |
| [[canva-connect-api]] | Planejamento da integração Canva OAuth/Assets/Autofill/Export |
| [[adr-006-editor-visual-alternativas-canva]] | Decisão aceita: Canva descartado como editor principal; CanvasEditor próprio reativado |

### Auditorias e planejamento

| Documento | Papel |
|---|---|
| [[designer-plano-implementacao]] | Plano de MVP 3 e MVP 4, sprints e critérios de aceite |
| [[auditoria-ux-logica-designer]] | Auditoria de UX, auth, configurações, referências e gaps pós-Sprint 0 |
| [[auditoria-libs-configs]] | Auditoria de libs/configurações e dívidas técnicas de SDK, env e bundle |
| [[pesquisa-geracao-imagens-pdf-designer]] | Pesquisa técnica sobre geração de imagem e export PDF/PNG |
| [[designer-auditoria-jornada]] | Canvas de auditoria da jornada da Gabi no Designer |

---

## Linha do tempo consolidada

### 2026-04-22 - Fundação e ingestão inicial do Designer

**Estado:** base documental criada e Designer ingerido na KB.

**O que aconteceu:**
- A KB foi inicializada com `index.md`, `log.md`, `overview.md` e `tracking.canvas`.
- O código do `designer/` foi ingerido como parte do onboarding do Projeto Assinatura.
- Foram criados os documentos base do Designer: [[agente-designer]], [[designer-backend]] e [[designer-frontend]].

**Resultado:** a KB passou a reconhecer o Designer como app Next.js + Express + Prisma + Gemini, com Fábrica, Editor, Configurações, Galeria e geração IA.

---

### 2026-04-24 - Pesquisa técnica e auditoria de jornada

**Estado:** diagnóstico inicial e plano de implementação.

**O que aconteceu:**
- Pesquisa sobre geração de imagens e exportação PDF/PNG.
- Auditoria da jornada da Gabi no Designer.
- Registro das decisões iniciais de produto: export prioritário em PNG, armazenamento inicial no PostgreSQL/base64 para MVP e validação de qualidade após conexões e UI mínima.
- Mapeamento de problemas de libs/configurações.

**Documentos relacionados:** [[pesquisa-geracao-imagens-pdf-designer]], [[designer-auditoria-jornada]], [[designer-plano-implementacao]], [[auditoria-libs-configs]].

**Resultado:** backlog técnico e de produto organizado em Sprint 0, Sprint 1 e Sprint 2.

---

### 2026-04-25 - Sprint 0 do Agente Designer

**Estado:** urgências técnicas concluídas.

**O que foi entregue:**
- Migração do SDK antigo para `@google/genai`.
- Migração para Gemini 2.5 nos endpoints relevantes.
- Endpoint real de geração de imagem conectado à Fábrica.
- Correção de URL backend hardcoded via `NEXT_PUBLIC_API_URL`.
- Confirmação de que Branding, Agent e Referências já salvavam no backend.
- Auth e ownership foram registrados como resolvidos nos outputs da época.
- Export PDF, onboarding wizard e referências foram registrados como entregas do commit de features/fixes.

**Documentos relacionados:** [[agente-designer]], [[designer-backend]], [[designer-frontend]], [[auditoria-ux-logica-designer]], [[designer-plano-implementacao]].

**Resultado:** Designer saiu do estado de diagnóstico para um MVP técnico navegável, com configurações, referências e geração de imagem/design conectadas.

---

### 2026-04-27 - Qualidade, Fábrica v2 e Galeria

**Estado:** estabilização e redesign de fluxo.

**O que foi entregue:**
- Lint e build limpos no frontend e backend.
- ESLint adicionado/configurado no backend.
- Correção de problemas de Next.js/ícones/manifest.
- Fábrica redesenhada como workflow procedural com Wizard de 3 etapas.
- Preview responsivo por aspect ratio.
- Gestão de assets por projeto.
- Galeria evoluída com pastas, drag-and-drop, exclusão e atualização reativa.

**Documentos relacionados:** [[qualidade-lint-build]], [[fabrica-v2]], [[galeria-gestao]], [[designer-frontend]].

**Resultado:** Fábrica e Galeria viraram áreas estáveis do produto, deixando de ser apenas telas auxiliares.

---

### 2026-05-03 - Consolidação semanal e gaps ativos

**Estado:** KB sanitizada e contexto de sprints atualizado.

**O que aconteceu:**
- Correção de contradições e desatualizações na KB.
- Registro de gaps ativos e consolidação da janela 2026-04-27 a 2026-05-03.
- ADRs estruturais adicionadas ao projeto, incluindo separação Next.js + Express e Gemini como LLM principal.

**Documentos relacionados:** [[adr-001-next-express-separados]], [[adr-002-gemini-llm-designer]], [[adr-003-infra-compartilhada]], [[2026-05-03]].

**Resultado:** decisões de arquitetura ficaram rastreáveis e a KB passou a diferenciar estado real, conflito e proposta futura.

---

### 2026-05-04 - Pesquisa e propostas para evolução da Fábrica

**Estado:** benchmarking e alternativas arquiteturais.

**O que aconteceu:**
- Migração de materiais da KB anterior sobre agente multimodelo e render layout-as-data.
- Benchmarking UX da Fábrica com ferramentas como Canva, Gamma, Beautiful.ai e Pitch.
- Proposta de Fábrica sem wizard via Trae, React e Supabase.
- Especificação da biblioteca MVP de layouts com `layoutKey`, metadados e hints para prompts.
- Criação da ADR-004 para decidir entre Fábrica v2 atual e proposta No-Wizard/Supabase.

**Documentos relacionados:** [[benchmarking-fabrica-ux]], [[fabrica-redesign]], [[fabrica-biblioteca-layouts]], [[adr-004-fabrica-arquitetura-v3]], [[agente-multimodelo]], [[render-layout-as-data]].

**Resultado:** a evolução da Fábrica ficou formalizada, mas a decisão Wizard vs No-Wizard permaneceu pendente.

---

### 2026-05-05 - ADR-005: tentativa de migração para Canva Connect API

**Estado:** mudança arquitetural aceita na época, depois superada pela ADR-006.

**O que foi decidido:**
- Substituir o CanvasEditor próprio por Canva Connect API.
- Delegar edição, assets, templates/autofill e exportação para o Canva.
- Planejar OAuth, Assets API, Autofill e Export API.

**Motivação:** ganhar qualidade visual profissional e reduzir manutenção do editor próprio.

**Documentos relacionados:** [[adr-005-canva-api-migração]], [[canva-connect-api]], [[agente-designer]], [[designer-backend]], [[designer-frontend]], [[2026-05-05]].

**Resultado:** a KB registrou a migração para Canva como decisão aceita, mas posteriormente a exigência de não sair do app invalidou esse caminho como editor principal.

---

### 2026-05-06 a 2026-05-11 - ADR-006 e retorno do CanvasEditor próprio

**Estado:** decisão arquitetural corrigida com base no requisito real da usuária.

**O que foi descoberto:**
- Canva não pode ser embutido em iframe por `X-Frame-Options: SAMEORIGIN`.
- Redirect/popup para Canva quebraria o fluxo da Gabi dentro do app.
- Penpot exigiria mais RAM do que a VPS tinha disponível.
- Fabric.js exigiria reconstrução grande do editor.

**Decisão final:**
- Reativar o CanvasEditor próprio com `react-rnd`.
- Manter edição embarcada, sem tirar a usuária do Designer.

**Implementações de 2026-05-11:**
- `geminiRetry.ts` com fallback 2.5-flash-lite -> 2.0-flash-lite -> 1.5-flash.
- `imageNormalizer.ts` para SVG/HEIC/HEIF.
- Pipeline de geração em 3 passos: brief -> text layers -> NanoBanana merge.
- `jobStore` em memória com TTL para polling.
- FAL AI como geração de imagem primária, com fallback Pollinations.
- Modelo `Folder` no Prisma e rotas `/api/folders/`.
- Rota `/api/upload/`.
- Correção de crash com `null` em arrays de layers.
- Correção do bug `fullPrompt` no fallback Pollinations.
- CanvasEditor controlado com escala dinâmica.
- `LayerPropertiesPanel` criado.
- Landing do Editor ativada e link no Sidebar liberado.

**Documentos relacionados:** [[adr-006-editor-visual-alternativas-canva]], [[designer-frontend]], [[designer-backend]], [[agente-designer]].

**Resultado:** o Designer voltou a ter editor próprio como direção oficial, com Canva mantido apenas como histórico/código em stand-by.

---

### 2026-05-12 - Editor multi-select e auditoria do pipeline da Fábrica

**Estado:** editor ganhou recursos de edição em massa; pipeline IA ficou mais robusto.

**Editor - entregas:**
- `selectedLayerIds: string[]` em vez de seleção única.
- Ctrl+clique no canvas e sidebar.
- Marquee select no canvas.
- Multi-drag com delta aplicado a todos os selecionados.
- `MultiSelectPanel` com alinhamento e distribuição.
- Atalhos Delete, Ctrl+D e setas operando sobre seleção múltipla.
- `ShortcutsPanel` com referência e configuração de atalhos.

**Fábrica - correções de qualidade:**
- `textAreasContext` deixou de ser texto plano e virou `TextZonesPerSlide` JSON estruturado.
- `validateLayers()` clampa layers ao canvas.
- `clamp()` também aplicado às text layers no merge.
- Brief prompt ficou decisivo: HEX, layout, atmosfera e decisão visual por slide.
- Text layer prompt passou a calcular altura por `fontSize × lineHeight × nLinhas`.
- NanoBanana recebeu paleta explícita e instrução de consistência entre slides.

**Documentos relacionados:** [[designer-frontend]], [[designer-backend]], [[agente-designer]].

**Resultado:** edição em massa e qualidade da geração passaram a ser parte do núcleo do Designer, reduzindo retrabalho manual.

---

### 2026-05-13 - Preview de animação, persistência de abas e limpeza de lint/build

**Estado:** polimento do editor e limpeza técnica.

**O que foi entregue:**
- `AnimationPanel` ganhou botão Play.
- Preview de animação CSS direto no canvas via `previewLayerId` e `previewKey`.
- Wrapper com key remount para reiniciar animação a cada clique.
- Abas do sidebar deixaram de desmontar inputs não commitados; agora usam montagem persistente via `display:none/block`.
- Remoção de dead code na Fábrica (`handleGenerate`, `dims useMemo`) e ajuste de import `Wand2`.
- Rodada de validação posterior corrigiu erros de lint/React Compiler sem alterar escopo de negócio.
- Evidência mais recente: backend `lint/build` OK; frontend `lint/build` OK, com warnings não bloqueantes conhecidos.

**Documentos relacionados:** [[designer-frontend]], [[designer-backend]], [[qualidade-lint-build]].

**Resultado:** o editor ficou mais seguro para uso real e a base passou nas validações principais.

---

## Estado atual do Designer

| Área | Estado | Observação |
|---|---|---|
| Fábrica v2 | ✅ Estável | Wizard 3 etapas, preview responsivo e assets por projeto |
| Pipeline IA de design | ✅ Funcional / em evolução | 3 passos com text layers + NanoBanana + validação de canvas |
| Tool Imagem | ✅ Funcional | FAL AI primário, fallback Pollinations, persistência em base64/dataUrl |
| Editor visual | ✅ Ativo | CanvasEditor próprio reativado, multi-select, propriedades, preview de animação |
| Galeria | ✅ Estável | Pastas, DND, preview, exclusão e mutate |
| Canva Connect | 🟡 Stand-by/histórico | Código ainda existe, mas não é caminho principal por ADR-006 |
| Qualidade | ✅ Build OK | Frontend/backend buildam; lint passa com warnings no frontend |
| Segurança | 🟡 Revalidar | KB tem registros conflitantes sobre ownership em settings; confirmar no código antes de marcar como fechado |

---

## O que falta fazer

### Prioridade alta - fechar estado real do MVP

| Item | Por que falta | Documento base |
|---|---|---|
| Revalidar ownership em `/settings/*` e rotas por slug | A KB contém conflito: auditoria antiga marcava como gap e outros outputs registram como feito | [[auditoria-ux-logica-designer]], [[designer-backend]] |
| Confirmar tratamento de posts `content.type === 'image'` no editor | Auditoria antiga apontava canvas vazio para posts de imagem; documentos posteriores dizem que foi feito | [[auditoria-ux-logica-designer]], [[agente-designer]], [[designer-frontend]] |
| Atualizar docs que ainda tratam Canva como futuro principal | ADR-006 substituiu a direção da ADR-005; algumas páginas ainda descrevem Canva como planejamento ativo | [[adr-005-canva-api-migração]], [[canva-connect-api]], [[agente-designer]], [[overview]] |
| Resolver divergência de dependências NPM | ADR-006/KB diz que deps foram removidas, mas `package.json` ainda pode manter libs antigas | [[adr-006-editor-visual-alternativas-canva]], [[auditoria-libs-configs]] |

### Prioridade média - produto e UX

| Item | Por que falta | Documento base |
|---|---|---|
| Decidir ADR-004: manter Wizard/Express ou migrar para No-Wizard/Supabase | A evolução da Fábrica depende dessa decisão antes de Sprint 2 | [[adr-004-fabrica-arquitetura-v3]], [[fabrica-redesign]], [[fabrica-v2]] |
| Upload real de logo | `logoUrl` por URL externa é limitado; upload melhoraria contexto visual e extração de marca | [[auditoria-ux-logica-designer]], [[designer-backend]] |
| Reanálise/retry de referências com falha | Referências `FAILED` ainda precisam de caminho operacional de retry | [[auditoria-ux-logica-designer]], [[agente-designer]] |
| Reanalisar referências depois da marca ser configurada | Referências analisadas antes de BrandConfig podem ter contexto incompleto | [[auditoria-ux-logica-designer]] |
| Remover ou isolar código Canva morto | `canvaClient.ts`, rotas e campos Prisma estão em stand-by; limpar reduz ambiguidade | [[adr-006-editor-visual-alternativas-canva]], [[designer-backend]] |
| Consolidar tipos `DesignState`/`Layer` compartilhados | Há risco de drift entre frontend e backend | [[auditoria-libs-configs]], [[designer-frontend]], [[designer-backend]] |

### Prioridade baixa / futuro

| Item | Por que falta | Documento base |
|---|---|---|
| Animação/export MP4/GIF | A tool de animação segue sem backend final; preview no editor já existe | [[agente-designer]], [[designer-frontend]], [[designer-plano-implementacao]] |
| Avaliar Penpot futuramente | Só faz sentido se houver upgrade de RAM e necessidade de editor profissional completo | [[adr-006-editor-visual-alternativas-canva]] |
| Avaliar FLUX/qualidade com Gabi | FAL AI já entrou como primário para imagem, mas ainda cabe validação qualitativa de marca | [[designer-plano-implementacao]], [[designer-backend]] |
| Evoluir biblioteca de layouts | MVP de metadados/layouts existe como especificação; pode virar contrato formal no pipeline | [[fabrica-biblioteca-layouts]], [[benchmarking-fabrica-ux]] |

---

## Próxima sequência recomendada

1. **Sanitizar a KB do Designer pós-ADR-006**
   - Atualizar páginas que ainda dizem que Canva é o caminho principal.
   - Marcar Canva Connect como histórico/stand-by.

2. **Fechar verificação de segurança e dados**
   - Confirmar ownership real por slug.
   - Confirmar comportamento do editor com posts de imagem.

3. **Validar com Gabi**
   - Testar fluxo: configurar marca -> gerar design -> editar múltiplas layers -> salvar -> visualizar na Galeria.
   - Coletar atritos reais antes de adicionar novas features grandes.

4. **Limpar dívida técnica sem mudar produto**
   - Remover imports/deps mortas.
   - Isolar código Canva morto.
   - Consolidar tipos compartilhados.

5. **Escolher evolução da Fábrica por último**
   - Manter a Fábrica v2/Wizard como base enquanto o MVP é estabilizado.
   - Resolver ADR-004 somente depois de validação com Gabi, correções críticas e limpeza pós-ADR-006.
   - Se mantiver Wizard, evoluir biblioteca de layouts e UX dentro da arquitetura atual.
   - Se migrar para No-Wizard, planejar reescrita parcial com impacto claro.

## Relacionados

- [[agente-designer]]
- [[designer-frontend]]
- [[designer-backend]]
- [[fabrica-v2]]
- [[galeria-gestao]]
- [[adr-006-editor-visual-alternativas-canva]]
