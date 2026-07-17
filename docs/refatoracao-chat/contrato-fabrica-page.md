# Contrato de Coordenação — Refatoração do chat REAL da Fábrica (`/[marca]/fabrica`)

> ATENÇÃO: este contrato substitui o escopo anterior. O chat que o usuário usa é a **página** `frontend/src/app/[marca]/fabrica/page.tsx` + `fabrica.module.css` (não o componente `FabricaChat`, já refatorado).

## Arquivos e donos
| Arquivo | Dono |
|---|---|
| `frontend/src/app/[marca]/fabrica/fabrica.module.css` | UI_CSS_Fabrica |
| `frontend/src/app/[marca]/fabrica/page.tsx` | UX_FabricaTSX |
| `docs/refatoracao-chat/arquitetura-informacao-fabrica.md` | Doc_IA_Fabrica |

Tokens de design em `frontend/src/app/globals.css` (mesmos do contrato anterior: `--color-*`, `--space-*`, `--radius-*`, `--text-*`, `--font-*`, `--transition-*`, `--shadow-*`).

## Bugs diagnosticados (corrigir obrigatoriamente)
1. **CRÍTICO — classe duplicada:** `.progressRow`, `.progressHeader`, `.progressEyebrow`, `.progressValue`, `.progressTrack`, `.progressBar` e `.progressLabel` estão definidas DUAS vezes no CSS (linhas ~270 e ~391). A segunda versão impõe `padding-top: 100px; padding-bottom: 100px` → cartão de progresso gigante/quebrado. Unificar em UMA definição por classe, sem os 100px.
2. `.root { height: 100% }` — a página não está dentro de AppShell; usar `height: 100vh; height: 100dvh;` com `overflow: hidden` (já existe) e `min-height: 0` nos filhos flex.
3. Fontes abaixo do mínimo: `.userBubble` 13.5px, `.aiText` 13.5px, `.inputField` 13px, `.inputHint` 10px, várias labels 10–12px. Conteúdo (bubbles, textarea, opções de pergunta) ≥ 14px; metadados/labels ≥ 12px.
4. Contraste: `--color-text-tertiary` (#96948f ≈ 2.9:1) usado em texto de `.emptySubtitle`, `.progressEyebrow`, `.slashDesc`, `.slideNavLabel`, `.previewEmptyTitle`, `.questionOptionDesc`, `.inputHint` etc. → migrar texto para `--color-text-secondary`; tertiary só em ícone/decorativo.
5. Nenhum `:focus-visible` → adicionar `outline: 2px solid var(--color-brand); outline-offset: 2px;` em TODOS os interativos (botões, textarea via `.inputBar:focus-within`, thumbs, slash itens, opções de pergunta).
6. Zero media queries → adicionar: `.chatPanel` fluido `width: clamp(340px, 38vw, 460px)`; em ≤900px layout vira coluna (chat embaixo, preview em cima com `max-height: 42vh`, `order: -1`), input nunca cortado.
7. Estilos inline no TSX (botão "Nova", chips de sugestão com hover via JS `onMouseEnter/Leave`, badge "Salvo/Salvando", ícone da pergunta, barra de progresso inline `width` — esta pode continuar inline pois é valor dinâmico).
8. `prefers-reduced-motion: reduce` ausente → desligar `slowDrift`, `slideUpFadeMsg`, `typingBounce`, `buildShimmer`, `buildPulse`, `sendGlow`, `blink`.

## Hierarquia visual alvo
- **Usuário:** direita, `background: var(--color-accent)` (#23221f), texto `#fff` (16:1 ✓), `border-radius: 18px 18px 4px 18px`, `max-width: min(85%, 560px)`, fonte ≥ 14px. Pills de anexo e bloco Asana continuam legíveis sobre o fundo escuro (ajustar cores dos filhos: `messageAttachmentPill`, `asanaBlock*`).
- **IA:** esquerda, avatar 32px, bubble neutro claro (`rgba(255,255,255,0.7)` glass ok), texto `--color-text` (não secondary) ≥ 14px.
- **Sistema/erro:** manter `systemRow` avermelhado, texto `#991b1b` ≥ 12px.
- **Input:** `.inputBar` com `border-radius: var(--radius-xl)` ou manter 24px (já moderno), min-height 48px; `.sendBtn` 36px; `.inputHint` 12px `--color-text-secondary`; placeholder em tertiary é aceitável (é placeholder, não conteúdo).
- Estética glassmorphism quente existente PODE ser mantida (backdrop-filter, gradientes quentes terracota). Proibido azul-roxo/frios saturados.

## Inventário de classes (manter TODAS, podem reestilizar)
`root, chatPanel, chatHeader, chatHeaderLeft, chatTitle, chatPhase, connectionBadge, connectionDot, connectionOnline, connectionOffline, connectionLabel, thread, emptyState, emptyIcon, emptyTitle, emptySubtitle, userRow, userBubble, aiRow, aiAvatar, aiBubble, aiBubbleLoading, typingDots, progressRow, progressHeader, progressEyebrow, progressValue, progressLabel, progressTrack, progressBar, thinkingBlock, thinkingHeader, thinkingBody, aiText, cursor, systemRow, inputArea, btwStrip, btwPill, btwPillText, btwTag, asanaPill, asanaPillText, asanaPillLogo, asanaBlock, asanaBlockHeader, asanaBlockBody, pillRemove, questionAccordion, questionMeta, questionPill, questionMode, questionHeader, questionHelper, questionOptions, questionOptionBtn, questionOptionLabel, questionOptionDesc, questionFreeformWrap, questionInput, questionFreeformBtn, questionSkipBtn, attachStrip, attachRemove, messageAttachments, messageAttachmentPill, inputWrap, slashMenu, slashItem, slashActive, slashLabel, slashDesc, inputBar, iconBtn, inputField, sendBtn, sendActive, inputHint, previewPanel, previewEmpty, previewEmptyGradient, previewEmptyContent, previewEmptyTitle, previewEmptyHint, previewProgressWrap, previewProgressBar, previewProgressLabel, buildView, buildStage, buildSkeleton, buildSkBlock, buildSkLine, buildFilmstrip, buildFilmCard, previewContent, previewTopBar, previewTopProgress, slideWrap, slideNav, slideNavBtn, slideNavLabel, thumbStrip, thumb, thumbActive`

## Classes NOVAS autorizadas
| Classe | Uso |
|---|---|
| `chatHeaderRight` | container do lado direito do header (substitui div inline) |
| `newConvBtn` | botão "Nova" conversa (substitui inline) |
| `suggestChips` | container dos chips de sugestão do empty state |
| `suggestChip` | chip de sugestão com hover 100% CSS (substitui onMouseEnter/Leave) |
| `saveBadge` | badge de salvamento (absolute top-right no preview) |
| `saveBadgeSaving` / `saveBadgeSaved` | variantes de cor do badge |
| `saveBadgeSpin` | animação de spin do Loader2 (substitui inline `animation: 'spin...'`; definir `@keyframes spin`) |
| `questionHeaderIcon` | ícone Sparkles da pergunta (cor brand, substitui inline) |
| `visuallyHidden` | utilitário sr-only |

## Regras para o TSX (UX_FabricaTSX)
- Substituir TODOS os inline styles acima pelas classes novas (exceto `width: ${progress}%` dinâmico).
- `ThinkingBlock`: header vira `<button type="button">` com `aria-expanded` e `aria-controls` (usar `useId`).
- `.thread`: `role="log"` `aria-live="polite"` `aria-label="Conversa com a fábrica"`.
- textarea: `aria-label="Mensagem para a fábrica"` + `aria-describedby` → id no `.inputHint`.
- sendBtn: `aria-label="Enviar mensagem"`; iconBtn anexo: `aria-label="Anexar arquivo"`; botão Nova: `aria-label="Iniciar nova conversa"`.
- `.slashMenu`: `role="listbox"`; `.slashItem`: `role="option"` `aria-selected={i === slashIdx}`.
- `.connectionBadge`: `role="status"`.
- `.progressRow`: `role="status"`; `.progressTrack`: `role="progressbar"` `aria-valuenow={progress}` `aria-valuemin={0}` `aria-valuemax={100}`.
- PRESERVAR 100% das funcionalidades: anexo (Paperclip→base64, accept image/*,.pdf), slash commands (/btw /asana /editor) com menu e navegação por setas/Enter/Escape, pills /btw e Asana removíveis, AsanaPopup, NotificationCard, AiSpendBadge, badge de conexão, nova conversa com confirm, smart scroll (isScrolledUp), auto-resize textarea, pergunta ativa (opções/freeform/pular), barra de progresso, preview (build view, ArtifactPanel, badge salvo, nav de slides, thumbnails), permissões (canGenerate/permHint), persistência de sessionId.
