# Planejamento de Arquitetura de Informação — FabricaChat

**Produto:** Designer IA — Chat da Fábrica
**Componente:** `frontend/src/components/FabricaChat` (Next.js + CSS Modules)
**Documento relacionado:** `docs/refatoracao-chat/contrato-classes.md` (fonte única da verdade de classes e regras visuais)
**Autor:** Doc_IA (Arquiteto de Informação / UX Writer)
**Status:** Aprovado para implementação

Este documento define a arquitetura de informação e as decisões de UX Writing da refatoração do chat da Fábrica. Ele serve como referência de produto para os workers de CSS (`UI_CSS`) e de TSX (`UX_IndexTSX`, `UX_BrainMessage`), garantindo que a interface final preserve 100% das funcionalidades existentes enquanto eleva legibilidade, acessibilidade e clareza de estados.

---

## 1. Visão geral da tela

A tela é organizada em **três colunas** sobre um contêiner raiz (`.root`) que ocupa a viewport inteira (`height: 100vh` com fallback e `height: 100dvh`). Lida de cima a baixo e da esquerda para a direita, a estrutura é:

### 1.1 Sidebar de processo (esquerda)

- **Cabeçalho da sidebar:** logotipo da Fábrica (avatar 24px), nome do produto "Designer IA" e nome da marca ativa (`brandName`).
- **Corpo:** seção "Processo" com a lista ordenada de fases do agente (`Escutando → Refinando briefing → Preparando geração → Gerando → Revisando → Corrigindo → Concluído`). Cada fase exibe um indicador circular (`.phaseDot`) e um de três estados visuais: concluída (`done`), ativa (`active`) ou pendente (neutro).

### 1.2 Coluna central de chat

De cima a baixo, sempre no fluxo (nenhum posicionamento absoluto sobre conteúdo):

1. **Header fixo** (`.chatHeader`): à esquerda, botão de menu mobile (hambúrguer), título "Agente Cérebro" e selo da fase atual (`.chatPhase`); à direita, botão de abertura do painel lateral (mobile).
2. **Thread de mensagens** (`.thread`): região com **scroll independente** (`flex: 1; overflow-y: auto`) e `role="log" aria-live="polite"`. O conteúdo interno é limitado a uma **medida máxima de 860px centrada** (`.threadInner`), garantindo linha de leitura confortável em telas largas.
3. **FAB de rolagem** (`.scrollFab`): botão flutuante "voltar ao fim" exibido quando o usuário está a mais de 120px do rodapé da thread.
4. **Banner de erro contextual** (`.errorToast` com `role="alert"`): exibido somente quando há erro de conexão/sessão, acima da área de input.
5. **Área de input fixa no rodapé** (`.inputArea`): sempre no fluxo do layout flex (`flex-shrink: 0`), nunca absoluta. Contém, em sequência: banner do Modo Inspecionar (quando ativo), chips de elementos selecionados (quando existem), a caixa de texto com botão enviar e a dica de teclado (`Enter para enviar · Shift+Enter para quebrar linha`). O conteúdo interno segue a mesma medida de 860px (`.inputInner`), alinhado com a thread.

### 1.3 Painel direito (abas Preview / Estrutura)

- **Abas** (`.rightTabs`): "Preview" e "Estrutura", com ícone + rótulo; a aba ativa recebe a modificadora `active`.
- **Corpo** (`.rightPanelBody`):
  - *Estrutura:* painel com árvore do briefing, progresso do worker e cartões de auditoria (`StructurePanel`).
  - *Preview:* estado vazio informativo até a geração; depois, canvas com o slide renderizado, navegação entre slides (`‹ n / total ›`) e ações ("Editar no editor", "Ver galeria").

### 1.4 Diagrama ASCII da estrutura

```
┌──────────────────────────────────────────────────────────────────────────┐
│ .root (100dvh, flex row)                                                 │
│ ┌─────────────┬────────────────────────────────────────┬───────────────┐ │
│ │  SIDEBAR    │  CHAT (main)                           │  PAINEL DIR.  │ │
│ │             │ ┌────────────────────────────────────┐ │ ┌───────────┐ │ │
│ │ Logo +      │ │ chatHeader (fixo)                  │ │ │ Abas:     │ │ │
│ │ "Designer   │ │ [≡] Agente Cérebro  [Fase]  [▦]    │ │ │ Preview / │ │ │
│ │  IA"        │ ├────────────────────────────────────┤ │ │ Estrutura │ │ │
│ │ Marca       │ │ thread (scroll independente)       │ │ ├───────────┤ │ │
│ │             │ │ ┌──── threadInner (max 860px) ───┐ │ │ │           │ │ │
│ │ Processo    │ │ │                                │ │ │ │ Estrutura │ │ │
│ │ ● Escutando │ │ │   emptyState + sugestões   ou  │ │ │ │  (árvore, │ │ │
│ │ ○ Refinando │ │ │   mensagens (user/brain)       │ │ │ │  progresso│ │ │
│ │ ○ ...       │ │ │   WaitUX (gerando)             │ │ │ │  auditoria│ │ │
│ │             │ │ │                                │ │ │ │     ou    │ │ │
│ │             │ │ └────────────────────────────────┘ │ │ │ Preview   │ │ │
│ │             │ │ [scrollFAB ↓]                      │ │ │ (canvas + │ │ │
│ │             │ ├────────────────────────────────────┤ │ │ navegação │ │ │
│ │             │ │ errorToast (role=alert, condicional)│ │ │ + ações)  │ │ │
│ │             │ ├────────────────────────────────────┤ │ │           │ │ │
│ │             │ │ inputArea (fixa no rodapé)         │ │ │           │ │ │
│ │             │ │ ┌──── inputInner (max 860px) ────┐ │ │ │           │ │ │
│ │             │ │ │ [banner inspecionar?]          │ │ │ │           │ │ │
│ │             │ │ │ [chips de elementos?]          │ │ │ │           │ │ │
│ │             │ │ │ [ textarea ............ ] [➤] │ │ │ │           │ │ │
│ │             │ │ │ Enter envia · Shift+Enter ↵    │ │ │ │           │ │ │
│ │             │ │ └────────────────────────────────┘ │ │ │           │ │ │
│ │             │ └────────────────────────────────────┘ │ └───────────┘ │ │
│ └─────────────┴────────────────────────────────────────┴───────────────┘ │
└──────────────────────────────────────────────────────────────────────────┘
 (Em ≤1024px: sidebar e painel viram drawers sobre um overlay — .mobileOverlay)
```

---

## 2. Hierarquia de mensagens

A thread possui dois papéis de autor — usuário e IA — com tratamento visual assimétrico e imediatamente reconhecível.

### 2.1 Balão do usuário (`.userRow` / `.userBubble`)

| Atributo | Decisão |
|---|---|
| Alinhamento | Direita |
| Cor de fundo | `var(--color-accent)` (destaque escuro) com texto `#fff` — contraste 16:1 |
| Raio de borda | `16px 16px 4px 16px` (canto inferior direito "falante") |
| Largura | `max-width: min(72%, 560px)` |
| Tipografia | ≥ 14px (`--text-base`), `word-break: break-word` + `overflow-wrap: anywhere` |

### 2.2 Mensagem da IA (`.brainRow` + `.brainMsg`)

| Atributo | Decisão |
|---|---|
| Alinhamento | Esquerda |
| Avatar | 32px, ícone de relógio/agente em SVG inline |
| Tom visual | Neutro: texto `var(--color-text)` sobre fundo da página ou `var(--color-surface)` com borda sutil |
| Largura | `max-width: min(85%, 640px)` |
| Ações | Barra de ações (`.msgActions`) visível em hover e `:focus-within`, agrupada pelo contêiner `.brainMsg` (`position: relative`) |

### 2.3 Bloco de raciocínio colapsável (`.thinking`)

- Cabeçalho "Raciocínio" é um **botão real** (teclável) com `aria-expanded` refletindo o estado e chevron que rotaciona (modificadora `open`).
- Corpo (`.thinkingBody`) renderizado apenas quando expandido; tipografia secundária em `var(--color-text-secondary)` (nunca `text-tertiary` em texto corrido).

### 2.4 Formulários inline (`.form`)

- Pergunta em destaque (`.formQuestion`) seguida de opções como **botões reais** (`.formOption`) com checkbox visual (`.formOptionCheck`), rótulo e descrição opcional.
- Ao selecionar uma opção: modificadora `selected`, demais opções desabilitadas, resposta enviada automaticamente (`submitForm`).
- Enquanto um formulário aguarda resposta, a área de input é substituída por aviso (ver seção 3).

### 2.5 Indicador de digitação / streaming

- Ponto de streaming (`.streamingDot`) ao final do texto da IA enquanto `isStreaming` é verdadeiro.
- Mensagens de espera rotativas do `WaitUX` a cada 4s ("Analisando referências...", "Pensando na melhor forma de distribuir o conteúdo...", etc.), em itálico com opacidade reduzida, acompanhadas do percentual de progresso quando disponível.
- Botão enviar exibe spinner (`.btnSpinner`) durante o streaming, e o textarea fica `disabled`.

### 2.6 Ações de mensagem — copiar

- Botão "Copiar" (`.copyBtn`) com ícone + texto, posicionado na barra de ações da mensagem da IA.
- Feedback imediato: estado local `copied` por 2 segundos exibindo o texto **"Copiado!"** (modificadora `copied`).
- `navigator.clipboard.writeText(...)` com fallback `document.execCommand('copy')`; `aria-label="Copiar mensagem"`.

---

## 3. Estados do sistema

| Estado | Gatilho | Feedback visual | Acessibilidade / notas |
|---|---|---|---|
| **Vazio** | `messages.length === 0` | Empty state centralizado na thread: ícone, título "O que você quer criar?", subtítulo explicativo e chips de sugestão clicáveis ("Carrossel para Instagram", "Apresentação comercial", "Post de lançamento", "Stories animados") que preenchem o input e focam o textarea | Chips são botões reais com `:focus-visible` |
| **Escutando** | `phase === 'listening'` | Selo de fase no header com modificadora `idle`; input habilitado; placeholder orienta: "O que você quer criar hoje? (/edit para inspecionar, /editor para abrir editor)" | Thread com `aria-live="polite"` |
| **Gerando** | `phase ∈ {ready, running, reviewing, revising}` ou `workerStatus === 'running'` | Componente WaitUX: avatar + mensagem rotativa a cada 4s + "Progresso: N% (fase)"; barra de progresso no painel Estrutura; textarea e botão enviar desabilitados; spinner no botão | Progresso textual anunciado via `aria-live` da thread |
| **Aguardando formulário** | última mensagem da IA contém `form` | Área de input **substituída** por aviso: "Selecione uma das opções acima para continuar" (`.inputAreaDisabled`); opções do formulário como botões | Substituir (não apenas desabilitar) evita entrada inválida; aviso legível ≥ 14px |
| **Erro de conexão** | `error` da sessão | Banner contextual acima da área de input (`.errorToast`) com ícone de alerta + mensagem de erro | `role="alert"` para anúncio imediato por leitores de tela |
| **Streaming** | `isStreaming === true` | Ponto de streaming no texto em progresso; spinner no botão enviar; textarea desabilitado | Conteúdo parcial anunciado pela região `role="log"` |
| **Copiado** | clique em "Copiar" | Botão alterna para "Copiado!" por 2s (modificadora `copied`) | Feedback textual (não só visual de cor) |
| **Modo inspecionar ativo** | comando `/edit` | Banner acima da caixa de texto (`.inspectorBanner`): "Modo Inspecionar Ativo: clique nos elementos do painel direito para selecioná-los." + botão "Desativar" (`.inspectorBannerClose`) | Banner e botão com contraste ≥ 4.5:1; sai de estilos inline para classes do módulo |
| **Elementos selecionados** | clique em elementos no preview (modo inspecionar) | Lista de chips (`.elementChips` / `.elementChip`) com número, tag e identificador do elemento; botão × (`.elementChipRemove`) remove individualmente; ao enviar, os elementos são referenciados no texto (`[Elemento #N - id]`) e os chips são limpos | Botões de remoção com `aria-label` descritivo |

---

## 4. Comportamento responsivo

| Breakpoint | Comportamento |
|---|---|
| **Desktop (> 1024px)** | Três colunas visíveis simultaneamente: sidebar de processo, chat central e painel direito. Botões de menu mobile ocultos. |
| **Tablet / ≤ 1024px** | Sidebar e painel direito tornam-se **drawers** laterais (modificadora `open`) sobre um **overlay** (`.mobileOverlay`) que fecha ambos ao clique. Botões de menu aparecem no header do chat (hambúrguer à esquerda, ícone de painel à direita). Apenas um drawer aberto por vez na prática (o overlay fecha os dois). |
| **Mobile / ≤ 640px** | Ajustes de densidade: paddings reduzidos na thread e na área de input, bubbles do usuário e da IA ocupam fração maior da largura, header mantém título + selo de fase com truncamento seguro. Textarea continua com auto-resize até 140px. |
| **Ultra-wide (≥ 1600px)** | O conteúdo central permanece **centrado em 860px** (`.threadInner` e `.inputInner`), evitando linhas de leitura excessivamente longas; as colunas laterais não esticam além de suas larguras de projeto. |

Em todos os breakpoints valem as regras de no-cut do contrato: `min-width: 0` em filhos flex com texto, `word-break: break-word`, proibida altura fixa em contêineres de conteúdo dinâmico.

---

## 5. Acessibilidade

Decisões consolidadas (alinhadas ao contrato de classes):

1. **Contraste:** todo texto com razão ≥ 4.5:1 (WCAG AA). `--color-text-tertiary` reservado a ícones e elementos decorativos; metadados e labels secundários usam `--color-text-secondary`.
2. **Tipografia mínima:** mensagens e textarea ≥ 14px; metadados/labels ≥ 12px.
3. **Foco visível:** todo elemento interativo com `:focus-visible { outline: 2px solid var(--color-brand); outline-offset: 2px; }`.
4. **Roles e ARIA:**
   - Thread: `role="log" aria-live="polite"` (mensagens novas anunciadas sem interromper).
   - Banner de erro: `role="alert"`.
   - Cabeçalho do bloco de raciocínio: `<button>` com `aria-expanded`.
   - Botão enviar: `aria-label="Enviar mensagem"`; botão copiar: `aria-label="Copiar mensagem"`.
   - Utilitário `.visuallyHidden` (sr-only) para textos exclusivos de leitores de tela.
5. **Teclado:**
   - `Enter` envia; `Shift+Enter` quebra linha (dica persistente abaixo do input).
   - Todos os controles são botões reais (`<button>`), incluindo opções de formulário, chips de sugestão, abas do painel, navegação de slides e remoção de chips de elementos.
   - Atalho global `Ctrl+A` / `Cmd+A` abre o popup Asana **sem** interceptar o "selecionar tudo" nativo dentro de inputs/textareas.
6. **Movimento reduzido:** transições e animações (spinner, streaming dot, chevron, drawers) respeitam `prefers-reduced-motion`, reduzindo animação a mudanças de opacidade instantâneas ou estáticas.
7. **Estrutura de altura robusta:** `100dvh` com fallback, thread com scroll próprio e input sempre no fluxo — evita sobreposição do teclado virtual em mobile e garante alvo de toque ≥ 44px em botões principais.

---

## 6. Inventário de funcionalidades preservadas

A refatoração é **estritamente visual/estrutural**: nenhuma capacidade existente pode ser removida ou renomeada. Funcionalidades garantidas:

| # | Funcionalidade | Como permanece |
|---|---|---|
| 1 | Comando `/edit` | Alterna o Modo Inspecionar a partir do input; banner dedicado substitui estilos inline |
| 2 | Comando `/editor` | Navega para `/{marca}/editor/{postId}` quando há `postId` disponível |
| 3 | Atalho `Ctrl+A` / `Cmd+A` (Asana) | Abre/fecha o `AsanaPopup`; injeção de texto no input com foco restaurado após 50ms |
| 4 | Auto-scroll da thread | Rola ao fim a cada nova mensagem ou atualização de streaming |
| 5 | FAB "voltar ao fim" | Exibido quando distância do rodapé > 120px; clique rola ao fim |
| 6 | Formulários inline | Pergunta + opções como botões; seleção única com envio automático; input substituído por aviso enquanto pendente |
| 7 | Chips de sugestão (empty state) | Preenchem o input e focam o textarea |
| 8 | Preview com navegação de slides | `‹ n / total ›` com limites, suporte a `HtmlSlideRenderer` e `DesignRenderer`; troca automática para a aba Preview quando os slides ficam prontos |
| 9 | Ações do preview | "Editar no editor" (com `postId`) e "Ver galeria" |
| 10 | Painel Estrutura | Árvore do briefing, progresso do worker, auditoria — classes preservadas intactas |
| 11 | Modo Inspecionar + elementos selecionados | Listener `ELEMENT_SELECTED` via `postMessage`, deduplicação por identificador, chips removíveis, contexto injetado no envio, limpeza após envio |
| 12 | WaitUX com progresso | Mensagens rotativas (4s) + percentual e fase durante a geração |
| 13 | Auto-resize do textarea | Altura dinâmica até 140px |
| 14 | Ação de copiar mensagem da IA | Clipboard API + fallback, feedback "Copiado!" por 2s |
| 15 | Bloco de raciocínio colapsável | Agora com botão real e `aria-expanded`, comportamento de expandir/recolher inalterado |
| 16 | Sidebar de fases do processo | Estados `done` / `active` / pendente derivados da fase atual |
| 17 | Drawers mobile com overlay | Sidebar e painel direito acessíveis via header em ≤ 1024px |

---

*Fim do documento. Dúvidas de escopo visual devem ser resolvidas contra `contrato-classes.md`; dúvidas de comportamento, contra este documento e o código-fonte atual do componente.*
