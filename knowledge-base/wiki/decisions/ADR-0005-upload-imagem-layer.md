---
name: ADR-0005-upload-imagem-layer
description: Adicionar upload de arquivo de imagem no ImagePanel, além do input de URL existente
metadata:
  type: decision
  status: proposed
  priority: crítico
  created: 2026-06-27
---

# ADR-0005 — Upload de Imagem em Layer de Imagem

## Contexto

`ImagePanel.tsx` aceita apenas URL de imagem. O `BackgroundPanel.tsx` já tem upload local com `URL.createObjectURL`. A rota `/api/upload` no backend aceita uploads genéricos para S3/R2. O designer precisa poder inserir suas próprias imagens em layers.

## Problema

- Para usar uma imagem local o designer precisa: hospedar em algum lugar → copiar URL → colar no campo.
- O `BackgroundPanel` já resolveu isso para o fundo — inconsistência de UX.
- Imagens do cliente (produto, pessoa, logo) são frequentemente locais.

## Decisão

### Dois modos de entrada no ImagePanel

```
[ URL ] [ Upload ]  ← tabs ou toggle
```

**Tab URL** (atual): input de texto com URL.

**Tab Upload**: 
- `<input type="file" accept="image/*">` estilizado como drop zone.
- Ao selecionar, faz `POST /api/upload` com `FormData` contendo o arquivo.
- Backend retorna `{ url: string }` (URL pública no R2/S3).
- Atualiza `layer.url` com a URL retornada.

### Estados do upload

```
idle → uploading (spinner) → done (preview) / error (retry)
```

### Restrições

- Tamanho máximo: 10MB (checar limite atual do backend).
- Formatos: `image/jpeg`, `image/png`, `image/webp`, `image/gif`.
- Mostrar preview `<img>` da URL atual acima dos controles.

### Drag & drop direto no canvas

Bonus (se tempo permitir): arrastar um arquivo de imagem diretamente para o canvas cria uma nova layer `type: "image"` com a imagem uploadada e posicionada onde o arquivo foi solto.

## Alternativas consideradas

- **Object URL local** (como o BackgroundPanel): mais rápido mas a URL não persiste ao recarregar. Para exportação PNG via `htmlRaster` no backend, URLs de `blob:` não funcionam. Portanto upload real para S3/R2 é necessário.

## Consequências

- `ImagePanel` fica mais complexo mas autossuficiente.
- Rota `/api/upload` já existe — zero backend novo.
- Adicionar autenticação no fetch (token JWT no header).

## Arquivos afetados

- `frontend/src/components/Editor/panels/ImagePanel.tsx`
- `frontend/src/lib/api.ts` (adicionar helper `uploadFile`)

**Why:** Sem upload, o designer não consegue usar imagens locais — fluxo crítico para posts com fotos do cliente.
**How to apply:** Implementar após ADR-0001 (add layer) para que o fluxo completo seja: inserir layer → fazer upload.
