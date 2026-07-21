# Checklist — Export PPTX Editável para Canva

> **Objetivo:** decidir se implementamos um segundo caminho de entrega para o Canva: PPTX editável (via Design Imports by URL), em paralelo ao PNG atual.
> **Descoberta-chave:** o PPTX de teste (`teste-canva-editable.pptx`) importou com sucesso no Canva e produziu design editável.
> **Estado da entrega hoje:**
> - **PNG** → exporta diretamente para o Canva via Connect API (design multipágina).
> - **PPTX / HTML** → geram arquivo local para download; o usuário pode importar manualmente no Canva se quiser.
> A implementação automatizada de PPTX/HTML para o Canva via `POST /url-imports` ainda depende do spike descrito abaixo.

---

## 🔁 Revisão do que foi descoberto

### O que já funciona (validado)

- [x] A Canva Connect API tem endpoint **Design Imports by URL**.
- [x] O endpoint aceita PPTX e converte em design **editável** no Canva.
- [x] Um PPTX simples criado com `python-pptx` importou corretamente e gerou texto editável, formas e cores preservadas.
- [x] A arquitetura do projeto já suporta exportar por URL pública via R2.
- [x] O scope necessário é apenas `design:content:write` (já está no scope atual).

### O que ainda não sabemos (bloqueios para decisão)

- [ ] Como o Canva lida com **PPTX gerados a partir de HTML/CSS livre** (posicionamento absoluto, gradientes, fontes do Google, sombras).
- [ ] Se conseguimos **automatizar** a conversão HTML/CSS → PPTX sem reescrever o layout na mão.
- [ ] Qual é a perda de fidelidade em slides reais gerados pela IA.
- [ ] Se o PPTX editável tem valor real para o usuário ou se o PNG (arte pronta) já resolve.

---

## 🔴 BLOQUEIO — não dá para decidir sem spike real

> O teste positivo com PPTX simples não prova que o HTML/CSS gerado pela IA vai importar bem. Precisamos de um spike com slides reais do produto.

### Pré-requisitos para o próximo teste

- [ ] Gerar 1-2 slides `html-design` reais usando o pipeline atual (ou usar um existente no banco).
- [ ] Converter o HTML/CSS desses slides para PPTX.
- [ ] Subir o PPTX para o R2 e chamar `POST /url-imports`.
- [ ] Comparar visualmente: texto, fontes, cores, posicionamento, imagens, efeitos.
- [ ] Decidir se a fidelidade é aceitável para o produto.

---

## ✅ Pesquisa — endpoints e limites da Canva

### Endpoint: `POST /v1/url-imports`

- **URL:** `https://api.canva.com/rest/v1/url-imports`
- **Rate limit:** 20 requisições/minuto por usuário da integração.
- **Scope:** `design:content:write`
- **Body:**
  ```json
  {
    "title": "Nome do design",
    "url": "https://URL_PUBLICA_DO_PPTX",
    "mime_type": "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  }
  ```
- **Retorno:** job assíncrono. Polling com `GET /v1/url-imports/{jobId}` até `status: success`.
- **Resultado:** `result.designs[].urls.edit_url` (válido por 30 dias, só para o usuário que fez a requisição).

Fonte: [Create URL import job - Canva Connect APIs](https://www.canva.dev/docs/connect/api-reference/design-imports/create-url-import-job/)

### Limites conhecidos da importação de PPTX no Canva

- [ ] Máximo de **1.400 elementos e imagens** por arquivo.
- [ ] Fontes podem ser substituídas se não estiverem disponíveis no Canva.
- [ ] Gradientes, sombras e efeitos avançados podem ser simplificados.
- [ ] Animações e transições são ignoradas.
- [ ] Arquivos muito grandes ou corrompidos retornam `invalid_file`.

Fonte: [Import PowerPoint presentations - Canva Help](https://www.canva.com/help/powerpoint-import/)

---

## ✅ Opções de conversão HTML/CSS → PPTX

### Opção A: pptxgenjs (recomendada para spike)

- **O que é:** biblioteca JavaScript madura para gerar PPTX programaticamente.
- **Como usaríamos:** ao gerar o slide, a IA emitiria estrutura PPTX paralela (ou parser HTML → estrutura pptxgenjs).
- **Prós:** controle total, suporta textos, formas, imagens, tabelas, gráficos, formatação.
- **Contras:** não entende HTML/CSS diretamente; precisamos ensinar a IA ou fazer parser.

### Opção B: python-pptx

- **O que é:** biblioteca Python para gerar PPTX.
- **Como usaríamos:** script/conversor no backend Python (integrado via subprocess ou microserviço).
- **Prós:** fácil de usar, madura.
- **Contras:** mesma limitação da A: não converte HTML/CSS automaticamente.

### Opção C: dom-to-pptx

- **O que é:** biblioteca JS que promete converter DOM/CSS para PPTX com alta fidelidade.
- **Prós:** converte HTML/CSS diretamente, incluindo gradientes e sombras.
- **Contras:** projeto relativamente novo, pouca adoção, pode não suportar layouts complexos dos nossos slides.

### Opção D: html-to-pptx (CLI/skill)

- **O que é:** wrapper por cima do pptxgenjs com modos `text`, `image`, `auto`.
- **Prós:** tem modo "complexo como imagem" para fallback.
- **Contras:** não é uma lib consolidada no npm; parece mais um skill/experimento.

### Veredito prévio

> **pptxgenjs** é a aposta mais segura: se o mapeamento HTML/CSS → PPTX for feito com regras claras, o resultado será confiável. Se o mapeamento falhar, `dom-to-pptx` pode ser um fallback de spike.

---

## ✅ Checklist de implementação (se o spike for positivo)

### Fase 1 — Spike de conversão (1-2 dias)

- [ ] Instalar `pptxgenjs` no backend (`npm install pptxgenjs`).
- [ ] Criar `backend/src/lib/htmlToPptx.ts` com conversor mínimo:
  - [ ] Mapear `div`/`h1`/`h2`/`p` para text boxes.
  - [ ] Mapear cores de fundo e texto.
  - [ ] Mapear posicionamento absoluto (left/top/width/height px → polegadas).
  - [ ] Mapear formas simples (retângulos, círculos via CSS border-radius).
  - [ ] Mapear imagens `<img>` para imagens do PPTX (por URL).
- [ ] Criar rota de teste `POST /api/posts/:postId/pptx-preview`.
- [ ] Gerar PPTX de um slide real e importar no Canva.
- [ ] Documentar fidelidade visual e problemas encontrados.

### Fase 2 — Integração com R2 e Canva

- [ ] Criar `backend/src/lib/canvaUrlImport.ts` para:
  - [ ] Gerar PPTX do deck.
  - [ ] Subir PPTX para o R2 (bucket temporário ou mesmo bucket de assets).
  - [ ] Chamar `POST /url-imports`.
  - [ ] Poll o job até `success`.
  - [ ] Devolver `designUrl` (edit_url) e `designId`.
- [ ] Adicionar job na fila (`BullMQ`) se o import for lento.
- [ ] Adicionar campos no banco: `pptxImportUrl`, `pptxDesignId`, `pptxImportStatus`.

### Fase 3 — Frontend

- [ ] No editor, adicionar opção de export:
  - [ ] "Exportar como imagem" (PNG atual)
  - [ ] "Exportar editável para Canva" (PPTX novo)
- [ ] Acompanhar progresso do job de importação (SSE ou polling).
- [ ] Abrir `edit_url` em nova aba quando concluir.
- [ ] Atualizar `permissions.ts` se necessário.

### Fase 4 — Robustez

- [ ] Fallback automático: se PPTX falhar no Canva, voltar para PNG.
- [ ] Limitar tamanho do PPTX (número de slides, elementos, imagens).
- [ ] Tratar erros da Canva: `invalid_file`, `fetch_failed`, `design_import_throttled`, etc.
- [ ] Cache do PPTX gerado para evitar reprocessamento.

---

## ⚠️ Riscos e decisões pendentes

| Risco | Impacto | Mitigação |
|---|---|---|
| Fontes do Google não existem no Canva | Quebra tipografia | Usar fontes seguras (Arial, Inter, Montserrat) ou avisar usuário |
| Gradientes/CSS avançados não convertem | Design fica diferente | Simplificar PPTX ou aceitar perda visual |
| Posicionamento absoluto vaza | Elementos deslocados | Mapear para coordenadas proporcionais e testar |
| Slides complexos estouram 1.400 elementos | Importação falha | Simplificar design antes de exportar |
| Conversão automática é frágil | Manutenção eterna | Manter PNG como padrão, PPTX como opt-in |
| Rate limit 20 req/min | Usuários com muitos decks em fila | Fila + throttling |

---

## ❓ Perguntas para decisão de produto

1. O PNG atual já entrega valor suficiente, ou a editabilidade no Canva é um diferencial cobrado pelo cliente?
2. Queremos PPTX como **padrão**, **opcional** ou **só para planos superiores**?
3. Aceitamos perda de fidelidade visual em troca de editabilidade? Qual é o limite aceitável?
4. Vale investir 1-2 semanas para construir o conversor, ou o foco deve ser outro (ex: estabilidade do Gemini, F2-F5)?

---

## 🎯 Próximo passo recomendado

> **Rodar o spike da Fase 1.** Sem ele, não há dados suficientes para decidir.
>
> Duração estimada: **1-2 dias**. Entregável: conversão de 1-2 slides reais + parecer de fidelidade.
>
> Se o spike for positivo, avançamos para Fase 2. Se for negativo, arquivamos o PPTX e mantemos o PNG como caminho único.
