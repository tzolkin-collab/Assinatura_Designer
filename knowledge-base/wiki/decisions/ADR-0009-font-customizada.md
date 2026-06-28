---
name: ADR-0009-font-customizada
description: Substituir dropdown de 20 fonts por input com busca livre de qualquer Google Font
metadata:
  type: decision
  status: proposed
  priority: importante
  created: 2026-06-27
---

# ADR-0009 — Input de Font Customizada (Qualquer Google Font)

## Contexto

`TextPanel.tsx` e `MultiSelectPanel.tsx` têm um `<select>` com 20 Google Fonts hard-coded. A IA gera designs usando qualquer fonte da Google Fonts API (ex: `Bebas Neue`, `DM Sans`, `Space Grotesk`). O editor não consegue exibir nem selecionar essas fontes.

## Problema

- A IA gera com `fontFamily: "Bebas Neue"` mas o select não tem essa opção.
- Designer não pode selecionar a font da brand se não estiver na lista de 20.
- Lista hard-coded cria inconsistência entre o que a IA gera e o que o editor edita.

## Decisão

### Substituir `<select>` por combobox com busca

```
[Buscar fonte...          ▾]
  Inter         (pré-carregada)
  Montserrat    (pré-carregada)
  ─────────────
  Resultados da busca:
  Bebas Neue
  DM Sans
  Space Grotesk
```

### Implementação

1. **Lista local de top 200 Google Fonts** (JSON estático, baixado da API do Google Fonts uma vez).
2. **Input de texto filtra** a lista em memória.
3. **Ao selecionar**, injeta `<link>` no `document.head` (lógica já existe no TextPanel atual).
4. **Renderização do nome da font** no dropdown usando `font-family` da própria fonte (preview).

### Dados

```json
// public/google-fonts.json (gerado offline)
[
  { "family": "Roboto", "variants": ["100","300","regular","700","900"] },
  { "family": "Bebas Neue", "variants": ["regular"] },
  ...
]
```

Gerar via: `GET https://www.googleapis.com/webfonts/v1/webfonts?key=...&sort=popularity`

### Fontes da Brand

No topo da lista, sempre mostrar as `primaryFonts[]` da `BrandConfig` como grupo "Fontes da Marca".

## Alternativas consideradas

- **Busca online na API do Google**: adiciona latência e dependência de rede para cada keystroke.
- **Manter select com mais opções (top 100)**: melhor que 20, mas ainda não resolve o caso da IA.

## Arquivos afetados

- `frontend/src/components/Editor/panels/TextPanel.tsx`
- `frontend/src/components/Editor/panels/MultiSelectPanel.tsx`
- Novo: `frontend/src/components/Editor/FontPicker.tsx`
- Novo: `frontend/public/google-fonts.json`

**Why:** A IA pode usar qualquer Google Font. O editor deve conseguir editar todas elas, não apenas 20.
**How to apply:** Implementar como componente `FontPicker` reutilizável para usar em ambos os painéis.
