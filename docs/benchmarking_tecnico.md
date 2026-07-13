# Benchmarking Técnico & UX/UI (Projeto Assinatura)

Como estamos construindo um SaaS robusto (um "Canva + IA"), a escolha das bibliotecas e padrões de arquitetura na fase de escalabilidade define se o app será fluido ou lento. Abaixo, o resultado do benchmarking e as melhores práticas de mercado para cada funcionalidade:

## 1. Histórico e Versionamento (Undo/Redo no Canvas)
Fazer Undo/Redo em um editor visual é o maior desafio técnico. Salvar o JSON inteiro do Canvas no banco de dados a cada clique vai derrubar o servidor.

* **Best Practice (Arquitetura):** Usar o padrão **CRDT** (Conflict-free Replicated Data Type) ou controle de estado local robusto.
* **Libs Recomendadas:** 
  * `yjs` + `y-webrtc`: É o padrão ouro (usado pelo Figma e Miro) para colaboração e histórico.
  * `zundo`: Um middleware para o Zustand. Como o estado do editor muda rápido, o `zundo` gerencia o Undo/Redo direto na memória do navegador. O backend só recebe o "Snapshot" final quando o usuário pausa.
* **Decisão:** Usar Zustand + `zundo` para o Undo/Redo imediato. Salvar snapshots no Prisma (`SlideVersion`) apenas a cada X minutos ou após uma ação crítica (ex: IA rodou).

## 2. Biblioteca de Mídia (Uploads e UX)
Fazer upload passando a imagem pelo Backend (Node.js) para depois ir pro S3/R2 consome muita RAM e trava a API principal.

* **Best Practice (Arquitetura):** **Presigned URLs**. O frontend pede ao backend um "ticket" e envia o arquivo *direto* do navegador para o Cloudflare R2.
* **Libs Recomendadas (Frontend):**
  * `@dnd-kit/core`: Para o Drag & Drop. É moderno, leve e 100% focado em acessibilidade (funciona com teclado e leitores de tela).
  * `react-dropzone`: Padrão de mercado para área de upload.
* **UX/A11y:** O painel de assets deve ter `aria-labels` indicando "Imagem de X". O arrastar da imagem pro Canvas deve ter feedback visual (borda azul no Canvas).

## 3. Gestão de Equipe e Permissões (RBAC)
Controlar o que um "Editor" e um "Viewer" podem fazer não deve ser espalhado por dezenas de `if`s no código.

* **Best Practice:** Role-Based Access Control (RBAC) via Middleware.
* **Libs Recomendadas:**
  * `@casl/react` e `@casl/prisma`: Permite escrever regras como `can('edit', 'Post')` e compartilhar a mesma lógica entre Frontend e Backend.
* **UX:** Se um "Viewer" tenta arrastar um elemento no Canvas, a interface não deve apenas quebrar. Os controles devem estar `disabled` e opacos (opacity-50), mostrando um Tooltip: *"Você tem permissão apenas de visualização"*.

## 4. Agendamento e Redes Sociais
Agendar tarefas em um banco relacional pode ser arriscado se o servidor cair na hora exata do envio.

* **Best Practice:** Fila de Tarefas (Message Queue).
* **Libs Recomendadas:**
  * **BullMQ** + Redis: Vi que você já usa BullMQ no backend. Excelente! O agendamento deve inserir um job no BullMQ com a opção `delay` baseada na data `scheduledFor`. 
* **UX:** Mostrar um calendário visual (pode usar `react-big-calendar` ou `fullcalendar`) para o usuário ter a visão mensal dos posts agendados pela IA.

## 5. UI Geral e Acessibilidade (Frontend)
Um estúdio de design precisa ser "invisível" para o usuário. A interface não pode brigar com o Canvas.

* **Design System (UI):** 
  * Se não estiver usando Tailwind, invista pesado em **Variáveis CSS** para temas claro/escuro.
  * Usar **Radix UI** para Menus de Contexto (botão direito), Modais e Tooltips. Eles já cuidam de 100% da acessibilidade (navegação por teclado, focus trap, aria-roles).
* **Acessibilidade Crítica:** 
  * O painel de propriedades (`IRPropertiesPanel`) deve focar automaticamente no input quando o usuário clica em uma camada.
  * Atalhos de teclado (`Ctrl+Z`, `Delete`, `Shift+Setas`) são essenciais. (Vi que tem um `shortcuts.ts`, o que é perfeito!).
