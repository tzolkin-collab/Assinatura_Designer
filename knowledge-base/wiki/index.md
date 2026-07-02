# Designer — Knowledge Base Index

**Projeto:** Designer (Assinatura Marca Própria)
**Stack:** Next.js 16 + Express + Prisma + PostgreSQL + Redis + Gemini/Claude
**KB iniciada:** 2026-06-27

---

## Decisions (ADRs)

### 🔴 Crítico — Falta para uso mínimo do editor

| ADR | Título | Status |
|---|---|---|
| [ADR-0001](decisions/ADR-0001-adicionar-camada-manual.md) | Adicionar Camada Manualmente | proposed |
| [ADR-0002](decisions/ADR-0002-zoom-canvas.md) | Zoom do Canvas | proposed |
| [ADR-0003](decisions/ADR-0003-copiar-colar-camadas.md) | Copiar e Colar Camadas (Ctrl+C/V) | proposed |
| [ADR-0004](decisions/ADR-0004-navegacao-slides.md) | Navegação entre Slides (Carrossel) | proposed |
| [ADR-0005](decisions/ADR-0005-upload-imagem-layer.md) | Upload de Imagem em Layer | proposed |
| [ADR-0006](decisions/ADR-0006-lista-camadas.md) | Painel de Lista de Camadas | proposed |

### 🟡 Importante — Melhora substancial do fluxo

| ADR | Título | Status |
|---|---|---|
| [ADR-0007](decisions/ADR-0007-alinhar-ao-canvas.md) | Alinhar ao Canvas (Centralizar na Página) | proposed |
| [ADR-0008](decisions/ADR-0008-lock-proporcao.md) | Lock de Proporção (Aspect Ratio) | proposed |
| [ADR-0009](decisions/ADR-0009-font-customizada.md) | Font Customizada (Qualquer Google Font) | proposed |
| [ADR-0010](decisions/ADR-0010-atalhos-faltantes.md) | Atalhos Faltantes (Ctrl+A, Ctrl+B, Ctrl+I) | proposed |
| [ADR-0011](decisions/ADR-0011-visibilidade-lock-layer.md) | Visibilidade e Lock de Camada | proposed |
| [ADR-0012](decisions/ADR-0012-alinhamento-vertical-texto.md) | Alinhamento Vertical de Texto | proposed |
| [ADR-0013](decisions/ADR-0013-rename-camada.md) | Renomear Camadas | proposed |

### 🟠 Desejável — Paridade com tools profissionais

| ADR | Título | Status |
|---|---|---|
| [ADR-0014](decisions/ADR-0014-snap-grid.md) | Snap to Grid e Snap to Layers | proposed |
| [ADR-0015](decisions/ADR-0015-reguas-guias.md) | Réguas e Guias no Canvas | proposed |
| [ADR-0016](decisions/ADR-0016-blend-modes.md) | Blend Modes por Camada | proposed |
| [ADR-0017](decisions/ADR-0017-object-fit-imagem.md) | Object-Fit e Crop de Imagem | proposed |
| [ADR-0018](decisions/ADR-0018-cores-da-marca-no-picker.md) | Cores da Marca no Color Picker | proposed |
| [ADR-0019](decisions/ADR-0019-adicionar-deletar-slide-editor.md) | Adicionar e Deletar Slides no Editor | proposed |
| [ADR-0020](decisions/ADR-0020-gradiente-multi-stop.md) | Gradiente Multi-Stop | proposed |
| [ADR-0021](decisions/ADR-0021-group-ungroup.md) | Agrupar e Desagrupar Camadas (Ctrl+G) | proposed |
| [ADR-0022](decisions/ADR-0022-eyedropper.md) | Eyedropper (Pipeta de Cor) | proposed |

### ⚪ Nice-to-Have — Funcionalidades avançadas

| ADR | Título | Status |
|---|---|---|
| [ADR-0023](decisions/ADR-0023-filtros-imagem.md) | Filtros de Imagem (Brightness, Contrast...) | proposed |
| [ADR-0024](decisions/ADR-0024-flip-horizontal-vertical.md) | Flip Horizontal e Vertical | proposed |
| [ADR-0025](decisions/ADR-0025-clip-path-mask.md) | Clip Path e Máscara | proposed |
| [ADR-0026](decisions/ADR-0026-export-formato-dpi.md) | Exportação com Formato e Qualidade | proposed |
| [ADR-0027](decisions/ADR-0027-historico-undo.md) | Histórico Visual de Undo/Redo | proposed |
| [ADR-0028](decisions/ADR-0028-tamanho-canvas.md) | Controle de Tamanho do Canvas | proposed |
| [ADR-0029](decisions/ADR-0029-padding-interno-texto.md) | Padding Interno de Texto | proposed |
| [ADR-0030](decisions/ADR-0030-sombra-inset-multipla.md) | Shadow Inset e Múltiplas Sombras | proposed |
| [ADR-0031](decisions/ADR-0031-texto-background-gradiente.md) | Texto com Preenchimento em Gradiente | proposed |

### 🟣 Inteligência Artificial & Fábrica

| ADR | Título | Status |
|---|---|---|
| [ADR-0032](decisions/ADR-0032-edicao-ia-elementos-fabrica.md) | Edição de Elementos via IA na Fábrica | proposed |
| [ADR-0033](decisions/ADR-0033-fabrica-history-undo.md) | Versionamento e Histórico (Undo/Redo) via IA | proposed |
| [ADR-0034](decisions/ADR-0034-fabrica-brand-book-injection.md) | Injeção de Brand Book no Contexto | proposed |
| [ADR-0035](decisions/ADR-0035-fabrica-auto-resize.md) | Auto-Resize Inteligente (ex: Feed p/ Story) | proposed |
| [ADR-0036](decisions/ADR-0036-fabrica-copywriting-suggestions.md) | Refatoração e Sugestão de Copy | proposed |
| [ADR-0037](decisions/ADR-0037-fabrica-component-extraction.md) | Extração e Reuso de Componentes | proposed |

---

## Dependências entre ADRs

```
ADR-0001 (Add Layer)
  └─ ADR-0005 (Upload) depende depois
  └─ ADR-0006 (Layer List) complementar

ADR-0002 (Zoom)
  └─ ADR-0014 (Snap) depende do scale
  └─ ADR-0015 (Réguas) depende do scale

ADR-0003 (Copy/Paste)
  └─ ADR-0004 (Slide Nav) para cross-slide

ADR-0004 (Slide Nav)
  └─ ADR-0019 (Add/Delete Slide) extensão

ADR-0006 (Layer List)
  └─ ADR-0011 (Visibility/Lock) no mesmo panel
  └─ ADR-0013 (Rename) no mesmo panel
  └─ ADR-0021 (Group) usa hierarquia do panel

ADR-0018 (Brand Colors)
  └─ ADR-0022 (Eyedropper) no mesmo ColorSwatch

ADR-0020 (Multi-stop Gradient)
  └─ ADR-0031 (Text Gradient) usa mesma lógica de stops
```
