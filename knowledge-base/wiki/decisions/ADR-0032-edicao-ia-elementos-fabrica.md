---
name: ADR-0032-edicao-ia-elementos-fabrica
description: Adicionar ferramenta /edit na Fábrica para seleção e edição em lote de fotos, iframes e links via Inteligência Artificial
metadata:
  type: decision
  status: proposed
  priority: alta
  created: 2026-06-30
---

# ADR-0032 — Edição de Elementos (Fotos/Iframes/Links) via IA na Fábrica

## Contexto

Atualmente, o processo de refinar o design gerado na Fábrica depende em grande parte da interpretação automática da IA ou de edições manuais complexas no painel direito. Os designers (e os usuários em geral) têm dificuldade para indicar exatamente qual foto, vídeo (iframe) ou link desejam substituir, o que torna a experiência lenta e às vezes frustrante.

A ideia é trazer a precisão de um "DevTools Element Inspector" para a interface de chat da Fábrica, permitindo que a IA lide com edições específicas orientadas por apontamento.

## Problema

- Não há uma maneira intuitiva de o usuário "apontar" para um elemento específico do preview (que fica na aba direita) e dizer "troque esta foto" ou "coloque este link aqui".
- Edições manuais no editor completo quebram o fluxo de ideação do chat.
- A substituição de mídia muitas vezes exige upload prévio, criação de link e inserção manual.

## Decisão

Adicionar um novo comando e modo de interação na Fábrica: o **Modo Inspecionar (`/edit`)**.

1. **Ativação da Ferramenta**: Quando o usuário invocar `/edit` no chat (ou através de uma UI visual), o cursor na área de preview se transforma em uma ferramenta de seleção visual (semelhante ao inspetor do DevTools).
2. **Seleção e Referência**: Ao passar o mouse pelo preview, elementos (imagens, iframes, containers) são destacados com suas propriedades. Ao clicar, o elemento é adicionado a uma "lista de referências ativa" no chat (ex: `[Elemento #1]`).
3. **Edição em Lote Guiada por IA**: O usuário pode selecionar vários itens e enviar comandos diretos, por exemplo: `Para o [Elemento #1], use uma foto do produto em azul; no [Elemento #2], mude o link para X`.
4. **Upload Inteligente de Mídia**: A interface permitirá que o usuário suba arquivos de mídia (foto/vídeo) diretamente para a plataforma. O backend gera o link/iframe interno correspondente, e a IA injeta esse resultado diretamente no componente selecionado.

## Consequências

- **Melhoria substancial na UX**: Elimina barreiras técnicas de seleção e edição de partes específicas do layout.
- **Processo Centrado em IA**: As edições são processadas pela IA, mantendo o paradigma do chat, mas com a precisão exigida pelo usuário.
- **Esforço de Implementação Frontend**: Exigirá uma ponte de comunicação bi-direcional sólida entre o canvas de renderização (que agora deve interceptar cliques em modo inspector) e o input do chat.

## Arquivos e Componentes Afetados (Estimativa)

- `frontend/src/components/FabricaChat/index.tsx` (Manipulação de estados do inspector e exibição dos chips de seleção).
- `frontend/src/components/Fabrica/DesignRenderer.tsx` ou `HtmlSlideRenderer.tsx` (Injeção de overlays para hover/click dos elementos do DOM/Canvas).
- Integração da lógica de parser do LLM para resolver referências `[Elemento #id]` nos requests.
