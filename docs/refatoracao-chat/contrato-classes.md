# Contrato de Coordenação — Refatoração FabricaChat

Este documento é a **fonte única da verdade** para os workers paralelos. Nenhum worker pode renomear, remover ou inventar classes fora desta lista. Cada worker é dono exclusivo do(s) seu(s) arquivo(s) — **nunca edite arquivo de outro worker**.

## Arquivos e donos
| Arquivo | Dono |
|---|---|
| `frontend/src/components/FabricaChat/fabrica-chat.module.css` | UI_CSS |
| `frontend/src/components/FabricaChat/index.tsx` | UX_IndexTSX |
| `frontend/src/components/FabricaChat/BrainMessage.tsx` | UX_BrainMessage |
| `docs/refatoracao-chat/arquitetura-informacao.md` | Doc_IA |

## Tokens disponíveis (globals.css) — usar sempre que possível
`--color-bg #f3f2ef`, `--color-bg-secondary #eae8e3`, `--color-surface #fff`, `--color-border`, `--color-border-hover`, `--color-text #1d1c1a`, `--color-text-secondary #63615c`, `--color-text-tertiary #96948f`, `--color-accent #23221f`, `--color-accent-hover #3a3834`, `--color-brand #d97757`, `--color-brand-light #fdf2ef`; `--space-1..16`; `--radius-sm/md/lg/xl/2xl/full`; `--text-xs/sm/base/lg/xl`; `--font-sans/serif/mono`; `--transition-fast/base`; `--shadow-sm/md/lg`.

## Regras visuais obrigatórias (vale para todos)
1. **Tipografia:** texto de mensagens e textarea ≥ 14px (`--text-base` ou maior). Metadados/labels secundários ≥ 12px e SEMPRE em `--color-text-secondary` (nunca `--color-text-tertiary` em texto corrido pequeno).
2. **Contraste WCAG ≥ 4.5:1** em todo texto; `--color-text-tertiary` só para ícones/decorativo.
3. **Foco visível:** todo elemento interativo com `:focus-visible { outline: 2px solid var(--color-brand); outline-offset: 2px; border-radius: ... }`.
4. **No-cut:** `box-sizing: border-box` (já global), `word-break: break-word` + `overflow-wrap: anywhere` em bubbles/textos, `min-width: 0` em filhos flex que carregam texto, proibido `height` fixa em contêineres de conteúdo dinâmico.
5. **Estrutura de altura:** `.root` usa `height: 100vh` com fallback e `height: 100dvh`; thread com `flex: 1; overflow-y: auto`; input SEMPRE no fluxo (flex column, `flex-shrink: 0`), nunca absoluto.
6. **Medida de leitura:** conteúdo central do chat limitado a `max-width: 860px` centrado (thread e input alinhados na mesma medida).
7. **Ícones:** inline SVG (padrão já usado no projeto).

## Inventário de classes do CSS Module (obrigatório manter TODAS)
Manter com o mesmo nome (podem ser reestilizadas):
`root, sidebar, sidebarHeader, sidebarLogo, sidebarBrand, sidebarMeta, sidebarBody, sidebarSection, sidebarSectionLabel, phaseList, phaseItem, phaseDot, chat, chatHeader, chatHeaderLeft, chatHeaderRight, mobileMenuBtn, chatTitle, chatPhase, thread, userRow, userBubble, brainRow, brainAvatar, brainAvatarIcon, brainContent, brainText, thinking, thinkingHeader, thinkingChevron, thinkingBody, form, formQuestion, formOptions, formOption, formOptionCheck, formOptionLabel, formOptionDesc, streamingDot, emptyState, emptyIcon, emptyTitle, emptySubtitle, suggestionChips, suggestionChip, scrollFab, errorToast, inputArea, inputAreaDisabled, inputBox, input, sendBtn, btnSpinner, inputHint, rightPanel, rightTabs, rightTab, rightTabIcon, rightPanelBody, previewEmpty, previewEmptyIcon, previewEmptyText, previewWrapper, previewCanvas, slideNav, slideNavBtn, slideNavLabel, previewActions, previewBtn, mobileOverlay`
Modificadoras globais do módulo: `active, open, done, idle, selected, primary, running, error, critical, major, minor`
Classes do painel Estrutura/Build (usadas por StructurePanel.tsx — NÃO mexer no nome): `structure, structureNode, structureRow, structureIcon, structureLabel, structureValue, structureBadge, structureChildren, structureLeaf, structureLeafKey, structureLeafValue, workerProgress, workerProgressBar, workerProgressFill, auditCard, auditHeader, auditScore, auditApproved, auditRejected, auditDeviations, auditDeviation, buildWrap, buildHeader, buildSpinner, buildHeadText, buildPhase, buildSub, buildPct, buildBar, buildBarFill, buildSlides, skSlide, skSlideDone, skSlideReview, skBadge, skBlock, skLine, buildAudit, buildAuditTitle, buildAuditItem`

## Classes NOVAS (autorizadas — UI_CSS cria; TSX workers podem usar)
| Classe | Uso |
|---|---|
| `threadInner` | wrapper interno da thread: `width:100%; max-width:860px; margin:0 auto; display:flex; flex-direction:column; gap:...` |
| `inputInner` | wrapper interno da inputArea com a mesma medida (max-width 860px centrado) |
| `brainMsg` | contêiner da mensagem da IA com `position:relative` e agrupamento p/ botão copiar (aplicado junto de `brainRow`) |
| `msgActions` | barra de ações da mensagem (hover/focus-visible) |
| `copyBtn` | botão copiar (ícone + texto); modificadora `copied` para estado "Copiado!" |
| `inspectorBanner` | banner "Modo Inspecionar Ativo" (substitui estilos inline) |
| `inspectorBannerClose` | botão "Desativar" do banner |
| `elementChips` | lista de chips de elementos selecionados (substitui inline) |
| `elementChip` | chip individual de elemento |
| `elementChipRemove` | botão × do chip |
| `visuallyHidden` | utilitário a11y (sr-only) |

## Estrutura JSX alvo do index.tsx (referência para UX_IndexTSX)
```
<div root>
  {overlay mobile}
  <aside sidebar> ... fases ... </aside>
  <main chat>
    <header chatHeader> ... </header>
    <div thread role="log" aria-live="polite">
      <div threadInner>
        {emptyState | messages | WaitUX}
      </div>
    </div>
    {scrollFab}
    {error && <div errorToast role="alert">}
    {isWaitingForForm ? inputAreaDisabled : (
      <div inputArea>
        <div inputInner>
          {inspectorBanner?} {elementChips?}
          <div inputBox> textarea + sendBtn </div>
          <div inputHint>
        </div>
      </div>
    )}
  </main>
  {AsanaPopup}
  <aside rightPanel> tabs + body </aside>
</div>
```

## BrainMessage.tsx — adições obrigatórias (UX_BrainMessage)
- Envolver `.brainRow` com a classe composta `brainMsg` (ex: `` `${s.brainRow} ${s.brainMsg}` ``).
- Botão copiar com `navigator.clipboard.writeText(message.content)` + fallback `document.execCommand('copy')`; estado local `copied` (2s) mostrando "Copiado!"; `aria-label="Copiar mensagem"`; visível em hover e `:focus-within`.
- Thinking header vira `<button>` real (teclável) com `aria-expanded`.
- Preservar 100% do comportamento do formulário inline.

## Diretrizes de hierarquia visual
- **Usuário:** direita, `background: var(--color-accent)`, texto `#fff` (contraste 16:1 ✓), `border-radius: 16px 16px 4px 16px`, `max-width: min(72%, 560px)`.
- **IA:** esquerda, avatar 32px, texto em `--color-text` sobre fundo da página ou `--color-surface` com borda sutil; largura `max-width: min(85%, 640px)`.
- **Input:** `border-radius: var(--radius-xl)` (12px), min-height 48px, botão enviar 36px com `aria-label="Enviar mensagem"`, spinner quando `isStreaming`.
- Paleta: manter tokens existentes (baixa saturação, tons quentes) — NÃO introduzir gradientes azul-roxo nem fundos saturados.
