# Brief: HTML → PPTX → Canva Editável

> Objetivo: avaliar se conseguimos entregar designs editáveis no Canva a partir dos slides HTML/CSS gerados pela IA, em vez de PNGs estáticos.

---

## 1. Situação atual

Hoje o caminho de entrega para o Canva é:

```text
HTML/CSS  ──►  renderHtmlToPng  ──►  PNG  ──►  uploadAsset  ──►  createDesign
```

- Entrega é **imagem** (arte pronta).
- No Canva, o usuário vê uma foto do slide, não consegue editar texto, mover elementos etc.
- Esse fluxo está em `backend/src/lib/canvaExport.ts`.

---

## 2. O que se quer testar

```text
HTML/CSS  ──►  Conversor PPTX  ──►  PPTX  ──►  URL pública (R2)  ──►  Canva Import by URL
```

Resultado esperado: um **design Canva editável**, onde texto, formas e imagens são elementos separados.

---

## 3. Por que o Canva aceita PPTX

A Canva Connect API tem o endpoint **Design Imports by URL**:

```text
POST https://api.canva.com/rest/v1/url-imports
```

Ele aceita arquivos PPTX, PPT, Keynote e PDF. Ao importar um PPTX, o Canva converte para objetos nativos editáveis (text boxes, shapes, images).

Documentação: https://www.canva.dev/docs/connect/api-reference/design-imports/create-url-import-job/

---

## 4. Desafio técnico central

**Converter HTML/CSS em PPTX é não-trivial.**

A Canva só editará bem o resultado se o PPTX for construído semanticamente:

- Texto deve virar `<a:p>` / `<a:r>` de verdade, não uma imagem.
- Formas devem ser shape primitives, não screenshots.
- Imagens devem ser referências embutidas no PPTX (base64 ou rel).
- Gradientes, sombras, posicionamento absoluto e fontes customizadas têm suporte limitado no PPTX.

O problema não é "fazer um PPTX"; é **preservar a intenção do design** para que o Canva reconstrua algo editável e minimamente parecido com o original.

---

## 5. Opções de implementação

### Opção A: pptxgenjs + reescrita manual do layout

Usar `pptxgenjs` (lib JS popular para gerar PPTX) e, ao gerar o HTML/CSS, **gerar em paralelo** a estrutura de slides para o pptxgenjs.

- **Prós**: controle total do PPTX gerado; lib madura e bem documentada.
- **Contras**: precisamos ensinar a IA (ou o parser) a emitir DOIS formatos: HTML/CSS para preview e estrutura PPTX para export. Ou fazer um parser HTML→PPTX, que é complexo.

### Opção B: conversor HTML/CSS → PPTX automático

Usar uma lib como `html-to-pptx` ou `reveal.js-to-pptx`.

- **Prós**: aparentemente menos trabalho.
- **Contras**: libs limitadas, raramente mantidas, suportam só HTML/CSS muito básico. Nossos slides usam posicionamento absoluto, gradientes, fontes do Google — provavelmente sai tudo quebrado.

### Opção C: exportar via PDF editável (formato alvo do Canva)

O Canva também aceita PDF. Mas PDF editável no Canva é ainda menos confiável que PPTX para conversão de elementos.

- **Veredito**: PPTX é melhor para editabilidade.

---

## 6. Spike recomendado (MVP de 1 slide)

Para validar se vale a pena, sugiro um spike limitado:

1. Pegar um slide `html-design` simples (título, subtítulo, fundo sólido, uma imagem).
2. Criar manualmente o equivalente em PPTX usando `pptxgenjs`.
3. Subir para o R2.
4. Chamar `POST /url-imports` e inspecionar o resultado no Canva.
5. Medir fidelidade: texto editável? Fontes preservadas? Cores corretas? Imagens no lugar?

**Tempo estimado**: 1-2 dias para um spike com 2-3 layouts diferentes.

---

## 7. O que muda na arquitetura

| Hoje | Proposto |
|---|---|
| `renderHtmlToPng` | `renderHtmlToPptx` (ou gerador PPTX paralelo) |
| `uploadAssetAndWait` + `createDesign` | `createUrlImportJob` + polling do job |
| Entrega síncrona por slide | Mesma coisa, mas o arquivo é PPTX em vez de PNG |
| Merge de designs (`createDesignMerge`) | Importação individual de slides ou PPTX multi-slide |

Pontos de atenção:

- O PPTX precisa de uma **URL pública acessível pela Canva**. O R2 já serve isso.
- A importação é assíncrona: `POST /url-imports` devolve um job; precisamos poll até `success`.
- O resultado é um design Canva por slide; o merge de vários slides em um design só pode ser feito com `createDesignMerge` (já usamos hoje) ou gerando um PPTX multi-slide.

---

## 8. Riscos e limites conhecidos

| Risco | Impacto |
|---|---|
| Fontes do Google Fonts não instaladas no Canva | Substituição de fonte, quebra a tipografia |
| Gradientes/CSS avançados | PPTX suporta pouco; Canva pode simplificar |
| Posicionamento absoluto livre | PPTX é mais rígido; pode deslocar elementos |
| Slides complexos com muitos elementos | PPTX fica pesado e importação pode falhar |
| Não conseguimos mapear fielmente HTML→PPTX | Saída no Canva fica "genérica", perde o valor da IA |

---

## 9. Perguntas para decidir se seguimos

1. O produto realmente precisa de designs **editáveis** no Canva, ou a entrega de **arte pronta** já resolve o problema do cliente?
2. Quanto esforço vale investir para manter a fidelidade visual? (se o Canva desfigurar o slide, o valor cai muito)
3. Queremos suportar PPTX como **formato intermediário** para todos os designs, ou como um **modo de export alternativo** (PNG padrão, PPTX opcional)?
4. O PPTX gerado pode ser um **arquivo multi-slide** (um PPTX por deck) ou um **PPTX por slide** (mais fácil de mergear)?

---

## 10. Próximo passo sugerido

Rodar o spike da Opção A: gerar manualmente 1-2 PPTX com `pptxgenjs` e importar no Canva para ver o resultado real. Só com dados concretos dá para decidir se compensa implementar o conversor automático.

**Responsável**: backend/AI engineer.  
**Duração**: 1-2 dias.  
**Entregável**: 2-3 PPTX importados no Canva + parecer de fidelidade e viabilidade.
