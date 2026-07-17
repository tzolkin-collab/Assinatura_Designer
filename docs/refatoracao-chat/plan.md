# Plano — Refatoração UI/UX do Chat da Fábrica (`FabricaChat`)

## Contexto
- Stack: Next.js (App Router) + React + CSS Modules. **Manter a stack** (não trocar para Tailwind etc.).
- Alvo: `frontend/src/components/FabricaChat/` — `index.tsx`, `BrainMessage.tsx`, `fabrica-chat.module.css`.
- Tokens de design em `frontend/src/app/globals.css` (`--color-*`, `--space-*`, `--radius-*`, `--text-*`).
- Montado em `frontend/src/app/[marca]/designer/page.tsx`.

## Problemas diagnosticados
1. `.root` com `height: 100vh` → cortes em mobile/browser chrome; sem `min-height` flexível.
2. Conteúdo do chat sem `max-width` → linhas esticadas em telas ultra-wide.
3. Fontes de 11–13px em conteúdo principal (mínimo exigido: 14px).
4. Contraste insuficiente: `--color-text-tertiary` (#96948f sobre #f3f2ef ≈ 2.9:1) usado em texto.
5. Nenhum `:focus-visible` estilizado (navegação por teclado invisível).
6. Sem feedback "copiado" (não existe botão de copiar mensagem).
7. Erro de conexão sem destaque/estrutura acessível (`role="alert"` ausente).
8. Estilos inline no banner do modo inspecionar e nos chips de elementos selecionados.
9. `.scrollFab` com `bottom: 90px` fixo — pode colidir com o input em telas baixas.

## Funcionalidades que NÃO podem quebrar
- Comandos `/edit` (modo inspecionar) e `/editor`; Ctrl+A abre AsanaPopup.
- Formulários inline (submitForm), chips de sugestão, auto-scroll, FAB scroll-to-bottom.
- Auto-resize do textarea (Enter envia, Shift+Enter quebra linha).
- WaitUX (mensagens rotativas de loading), errorToast, tabs Preview/Estrutura.
- Navegação de slides no preview, botões "Editar no editor" / "Ver galeria".
- Drawer mobile da sidebar e do painel direito (overlay).

## Estágios
- **Estágio 0 (orquestrador):** plan.md + contrato de classes (`contrato-classes.md`). ✅
- **Estágio 1 (paralelo, 4 workers):**
  - `UI_CSS` → reescreve `fabrica-chat.module.css` (dono exclusivo do arquivo).
  - `UX_IndexTSX` → refatora `index.tsx` (dono exclusivo).
  - `UX_BrainMessage` → refatora `BrainMessage.tsx` + botão copiar c/ feedback (dono exclusivo).
  - `Doc_IA` → escreve `arquitetura-informacao.md` (entregável 1).
- **Estágio 2 (sequencial, gate):** `Validador` → roda typecheck/build, revisa regressões, corrige o que for mecânico.
- **Estágio 3 (orquestrador):** integração e relatório final.
