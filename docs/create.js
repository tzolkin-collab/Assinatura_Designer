import fs from "node:fs";
import path from "node:path";
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  ImportedXmlComponent,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";

const outputPath = process.argv[2];
if (!outputPath) {
  throw new Error("Usage: node create.js /absolute/path/output.docx");
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });

// ---------------------------------------------------------------- palette ---
// Paleta quente de baixa saturacao: terracota do produto + neutros quentes.
const palette = {
  dark: "3D2E2A", // marrom escuro quente (titulos)
  primary: "7A4A38", // terracota escurecida (subtitulos)
  accent: "D97757", // terracota do produto (destaques)
  light: "A08A7E", // neutro quente claro (notas)
  border: "E7D6CC", // borda quente suave
  fill: "F8F1EC", // zebra / bloco de destaque
  code: "9C4A2F", // codigo inline
  white: "FFFFFF",
};

const font = {
  ascii: "Georgia",
  hAnsi: "Georgia",
  cs: "Georgia",
  eastAsia: "SimSun",
};

const monoFont = {
  ascii: "Consolas",
  hAnsi: "Consolas",
  cs: "Consolas",
  eastAsia: "Consolas",
};

const run = (text, options = {}) =>
  new TextRun({ text, font, size: 22, ...options });

const para = (children, options = {}) =>
  new Paragraph({
    spacing: { after: 160, line: 300 },
    ...options,
    children: Array.isArray(children) ? children : [children],
  });

// ------------------------------------------------------- inline md parser ---
// Converte **negrito**, *italico* e `codigo` em TextRuns tipados.
const parseInline = (text, extra = {}, base = {}) => {
  const out = [];
  const italRe = /\*([^*]+)\*/g;
  let l = 0;
  const pushCode = (seg, ex) => {
    const codeRe = /`([^`]+)`/g;
    let ll = 0;
    for (const m of seg.matchAll(codeRe)) {
      if (m.index > ll) out.push(run(seg.slice(ll, m.index), { ...base, ...ex }));
      out.push(
        run(m[1], {
          ...base,
          ...ex,
          font: monoFont,
          color: palette.code,
          size: (base.size ?? 22) - 1,
        }),
      );
      ll = m.index + m[0].length;
    }
    if (ll < seg.length) out.push(run(seg.slice(ll), { ...base, ...ex }));
  };
  for (const m of text.matchAll(italRe)) {
    if (m.index > l) pushCode(text.slice(l, m.index), extra);
    pushCode(m[1], { ...extra, italics: true });
    l = m.index + m[0].length;
  }
  if (l < text.length) pushCode(text.slice(l), extra);
  return out;
};

const richRuns = (text, base = {}) => {
  const out = [];
  const boldRe = /\*\*([^*]+)\*\*/g;
  let last = 0;
  for (const m of text.matchAll(boldRe)) {
    if (m.index > last) out.push(...parseInline(text.slice(last, m.index), {}, base));
    out.push(...parseInline(m[1], { bold: true }, base));
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(...parseInline(text.slice(last), {}, base));
  return out;
};

// ------------------------------------------------------------------ blocks --
const h1 = (text, options = {}) =>
  para(run(text, { bold: true, size: 30, color: palette.dark }), {
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 400, after: 180 },
    border: {
      bottom: { style: BorderStyle.SINGLE, size: 6, color: palette.accent, space: 4 },
    },
    ...options,
  });

const h2 = (text) =>
  para(run(text, { bold: true, size: 25, color: palette.primary }), {
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 300, after: 140 },
  });

const body = (text) =>
  para(richRuns(text), { alignment: AlignmentType.JUSTIFIED });

const bullet = (text) =>
  para(richRuns(text), {
    bullet: { level: 0 },
    spacing: { after: 100, line: 300 },
  });

const numbered = (n, text) =>
  para([run(`${n}. `, { bold: true, color: palette.accent }), ...richRuns(text)], {
    spacing: { after: 100, line: 300 },
    indent: { left: 360 },
  });

// Bloco de destaque (frase-sintese, conclusoes): fundo quente + barra terracota.
const callout = (text) =>
  para(richRuns(text), {
    alignment: AlignmentType.JUSTIFIED,
    shading: { type: ShadingType.CLEAR, fill: palette.fill },
    border: {
      left: { style: BorderStyle.SINGLE, size: 18, color: palette.accent, space: 8 },
    },
    spacing: { before: 120, after: 200, line: 300 },
  });

const spacer = () => new Paragraph({ spacing: { after: 160 }, children: [] });

// ------------------------------------------------------------------ tables --
const tableBorders = {
  top: { style: BorderStyle.SINGLE, size: 4, color: palette.border },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: palette.border },
  left: { style: BorderStyle.SINGLE, size: 4, color: palette.border },
  right: { style: BorderStyle.SINGLE, size: 4, color: palette.border },
  insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: palette.border },
  insideVertical: { style: BorderStyle.SINGLE, size: 4, color: palette.border },
};

const headerCell = (text, w, align) =>
  new TableCell({
    children: [
      new Paragraph({
        children: richRuns(text, { size: 19, bold: true, color: palette.white }),
        spacing: { after: 0, line: 260 },
        alignment: align ?? AlignmentType.LEFT,
      }),
    ],
    margins: { top: 110, bottom: 110, left: 130, right: 130 },
    shading: { type: ShadingType.CLEAR, fill: palette.accent },
    width: { size: w, type: WidthType.DXA },
  });

const bodyCell = (text, w, zebra, align) =>
  new TableCell({
    children: [
      new Paragraph({
        children: richRuns(text, { size: 19 }),
        spacing: { after: 0, line: 260 },
        alignment: align ?? AlignmentType.LEFT,
      }),
    ],
    margins: { top: 100, bottom: 100, left: 130, right: 130 },
    ...(zebra ? { shading: { type: ShadingType.CLEAR, fill: palette.fill } } : {}),
    width: { size: w, type: WidthType.DXA },
  });

const makeTable = ({ widths, header, rows, aligns = [] }) =>
  new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: widths,
    borders: tableBorders,
    rows: [
      new TableRow({
        tableHeader: true,
        children: header.map((h, i) => headerCell(h, widths[i], aligns[i])),
      }),
      ...rows.map(
        (r, ri) =>
          new TableRow({
            children: r.map((c, ci) => bodyCell(c, widths[ci], ri % 2 === 1, aligns[ci])),
          }),
      ),
    ],
  });

// --------------------------------------------------------------------- TOC --
const xmlEscape = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const toc = (entries) => {
  const cached = entries
    .map(({ title, level, page }) => {
      const indent = Math.max(0, level - 1) * 360;
      return `<w:p>
        <w:pPr>
          <w:pStyle w:val="TOC${level}"/>
          <w:tabs><w:tab w:val="right" w:leader="dot" w:pos="9000"/></w:tabs>
          <w:ind w:left="${indent}"/>
        </w:pPr>
        <w:r><w:t>${xmlEscape(title)}</w:t></w:r>
        <w:r><w:tab/></w:r>
        <w:r><w:t>${xmlEscape(page)}</w:t></w:r>
      </w:p>`;
    })
    .join("");

  return ImportedXmlComponent.fromXmlString(`<w:sdt xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
    <w:sdtPr><w:alias w:val="Sumário"/></w:sdtPr>
    <w:sdtContent>
      <w:p>
        <w:r>
          <w:fldChar w:fldCharType="begin" w:dirty="true"/>
          <w:instrText xml:space="preserve"> TOC \\o &quot;1-2&quot; \\h \\z \\u </w:instrText>
          <w:fldChar w:fldCharType="separate"/>
        </w:r>
      </w:p>
      ${cached}
      <w:p><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>
    </w:sdtContent>
  </w:sdt>`).root[0];
};

const tocEntries = [
  { title: "1. Sumário Executivo", level: 1, page: 3 },
  { title: "2. Revisão de Qualidade do Backend (nota 5,5)", level: 1, page: 3 },
  { title: "2.1 Notas por módulo", level: 2, page: 3 },
  { title: "2.2 Os 5 problemas mais graves", level: 2, page: 4 },
  { title: "2.3 Pontos fortes", level: 2, page: 4 },
  { title: "3. Arqueologia Git (12 problemas rastreados)", level: 1, page: 5 },
  { title: "4. Refatoração UI/UX do Chat da Fábrica", level: 1, page: 6 },
  { title: "4.1 Correções no chat real", level: 2, page: 6 },
  { title: "5. Implementação: review:decline cirúrgico (Passe 3.1)", level: 1, page: 7 },
  { title: "6. Revisão de Arquitetura (nota 4,6)", level: 1, page: 7 },
  { title: "6.1 Convergências (citadas por múltiplos arquitetos)", level: 2, page: 8 },
  { title: "6.2 Alavanca nº 1 (2 arquitetos chegaram nela sozinhos)", level: 2, page: 8 },
  { title: "7. Roadmap Recomendado (ordem de ataque)", level: 1, page: 8 },
  { title: "8. Artefatos produzidos nesta sessão", level: 1, page: 9 },
];

// ------------------------------------------------------------------ content -
const children = [];

// Capa
children.push(
  para(run("Relatório Técnico Consolidado", { bold: true, size: 44, color: palette.dark }), {
    heading: HeadingLevel.TITLE,
    alignment: AlignmentType.CENTER,
    spacing: { before: 4800, after: 200 },
  }),
  para(run("Projeto Assinatura (Designer IA)", { size: 28, color: palette.accent, bold: true }), {
    alignment: AlignmentType.CENTER,
    spacing: { after: 480 },
    border: {
      bottom: { style: BorderStyle.SINGLE, size: 8, color: palette.accent, space: 12 },
    },
  }),
  para(richRuns("**Data:** 18/07/2026 · **Branch:** `feat/html-pptx-canva` · **Escopo:** backend, frontend, arquitetura e histórico git"), {
    alignment: AlignmentType.CENTER,
    spacing: { before: 480, after: 0 },
  }),
);

// Sumario
children.push(
  para(run("Sumário", { bold: true, size: 30, color: palette.dark }), {
    pageBreakBefore: true,
    spacing: { before: 240, after: 120 },
    border: {
      bottom: { style: BorderStyle.SINGLE, size: 6, color: palette.accent, space: 4 },
    },
  }),
  para(
    run('Clique com o botão direito sobre o sumário e escolha "Atualizar Campo" para recalcular os números de página.', {
      italics: true,
      size: 18,
      color: palette.light,
    }),
    { spacing: { after: 240 } },
  ),
  toc(tocEntries),
);

// 1. Sumario Executivo -------------------------------------------------------
children.push(
  h1("1. Sumário Executivo", { pageBreakBefore: true }),
  makeTable({
    widths: [2700, 1300, 5026],
    header: ["Frente", "Nota", "Leitura"],
    aligns: [AlignmentType.LEFT, AlignmentType.CENTER, AlignmentType.LEFT],
    rows: [
      ["Qualidade de código do backend", "**5,5 / 10**", "Fundação sólida (infra, auth, testes de infra ~7+), coração do produto frágil (pipeline de IA ~4,5)"],
      ["Estrutura & Arquitetura (sistema inteiro)", "**4,6 / 10**", "Código localmente decente, forma global fragmentada — cada mudança paga pedágio"],
    ],
  }),
  spacer(),
  callout("**Frase-síntese:** o produto funciona e tem engenharia de infraestrutura acima da média (retry, throttle, sessão Redis, RBAC), mas o pipeline de geração — exatamente o que o cliente paga — é a parte com menos rede de segurança, e a arquitetura acumula 4 stacks paralelas de geração que tornam toda feature nova 3× mais cara."),
);

// 2. Qualidade do Backend ----------------------------------------------------
children.push(
  h1("2. Revisão de Qualidade do Backend (nota 5,5)"),
  body("Seis revisores especializados leram integralmente os 17,3 mil line-items de código + 2 mil de testes."),
  h2("2.1 Notas por módulo"),
  makeTable({
    widths: [2900, 900, 5226],
    header: ["Módulo", "Nota", "Síntese"],
    aligns: [AlignmentType.LEFT, AlignmentType.CENTER, AlignmentType.LEFT],
    rows: [
      ["Infra Core (redis, queue, geminiRetry, throttle, middleware)", "7,2", "Taxonomia de falhas do Gemini com políticas distintas, circuit breaker, sessão O(1) via Lua"],
      ["Testes (113 testes verdes, tsc strict limpo)", "6,3", "Excelente no que cobre; cobre < 20% dos arquivos-fonte"],
      ["Rotas API (posts, brands, auth, team, folders…)", "6,2", "RBAC consistente, comentários exemplares; falta validação de schema"],
      ["Agentes (brain, pipeline, reviewer, planner)", "4,8", "~23% de código morto; handlers WS privilegiados sem verificação de posse"],
      ["Pipeline de Design (designDocument, designFixer, SVG/HTML)", "4,7", 'Validação teatral, falhas de IA virando "sucesso silencioso", duplicação ×3'],
      ["`routes/ai.ts` (2.439 linhas)", "4,0", "13 endpoints + job store + prompts num arquivo só; handlers de 240 linhas"],
    ],
  }),
  spacer(),
  h2("2.2 Os 5 problemas mais graves"),
  numbered(1, "**XSS/injeção server-side** — sanitização de HTML por regex bypassável (`htmlDesign.ts:45`) antes do Chromium; o comentário prometia DOMPurify inexistente"),
  numbered(2, "**Regex `[EDIT]` quebrada** — edição cirúrgica inalcançável (`brain/index.ts`) — **CORRIGIDA nesta sessão** (ver §5)"),
  numbered(3, "**Callback OAuth do Canva → 401** — mount público é código morto (`app.ts:63-65`), reproduzido no Express 5.1"),
  numbered(4, "**DoS de cota/custo** — `slideCount`/`width`/`height` sem teto em `ai.ts`"),
  numbered(5, "**Autenticação nunca testada de verdade** — JWT mockado para sucesso em 100% dos testes HTTP; nenhum teste de 401, upload ou rate limit"),
  h2("2.3 Pontos fortes"),
  bullet("`geminiRetry` + 438 linhas de testes citando incidentes reais"),
  bullet("RBAC multi-tenant centralizado com testes de side-effect"),
  bullet("`designIR/aiPatch`: única fronteira LLM→estado tratada como fronteira de segurança"),
  bullet('Comentários de "porquê" = memória institucional'),
);

// 3. Arqueologia Git ---------------------------------------------------------
children.push(
  h1("3. Arqueologia Git (12 problemas rastreados)"),
  body('Repositório com 26→47 commits (14/05 a 18/07). Veredito central: **10 dos 12 problemas nasceram com o código**, importados no commit `5ec1f26` (02/07 — *"inline backend/frontend into monorepo"*), que converteu o backend de submódulo em arquivos normais, já com os defeitos de fábrica.'),
  makeTable({
    widths: [2700, 1700, 4626],
    header: ["Problema", "Origem", "Veredito"],
    rows: [
      ["Regex `[EDIT]`", "`5ec1f26`", "Nasceu quebrada, byte-idêntica até a correção desta sessão"],
      ["Callback Canva 401", "`5ec1f26`", "Nasceu quebrado, nunca tocado"],
      ["Sanitização regex + DOMPurify fantasma", "`5ec1f26`", "Nasceram juntos; DOMPurify nunca existiu"],
      ["Inputs sem teto", "`5ec1f26`", "Nasceu sem clamp; nunca corrigido"],
      ["`progressRow` padding 100px", "`5ec1f26` + `7bfe622`", "100px nasceu com o arquivo; duplicação criada em 12/07 por commit aditivo que não removeu a versão antiga — **corrigido na refatoração do chat**"],
      ["Catch silencioso do designFixer", "`5ec1f26`", "Nasceu silencioso"],
      ["`fill` sem escape no SVG", "`5ec1f26`", "Descuido: `esc()` existia no mesmo arquivo/commit"],
      ["Helpers duplicados (×3)", "`5ec1f26`", "Nasceram duplicados na importação"],
      ["Job store `Map` em memória", "`5ec1f26`", "Órfão arquitetural: nasceu 10 dias antes da fila BullMQ"],
      ["~23% código morto em agents", "`5ec1f26`→`7bfe622`", "Nasceu legado; substituto chegou 12/07"],
      ["JWT mockado nos testes", "`d4bab65` (13/07)", "Nasceu com a suíte; teste de 401 nunca existiu"],
      ["`ai.ts` com 2.439 linhas", "`5ec1f26`", "Nasceu inchado (2.420 linhas de uma vez)"],
    ],
  }),
  spacer(),
  callout("**Conclusão:** nenhum bug foi regressão — são dívida original da era pré-monorepo. Não há commit para reverter; a correção é cirúrgica."),
);

// 4. Refatoracao UI/UX -------------------------------------------------------
children.push(
  h1("4. Refatoração UI/UX do Chat da Fábrica"),
  body("Executada em duas ondas (a primeira atingiu o componente errado — `FabricaChat` da rota `/designer`; a segunda acertou o alvo real: a página `/[marca]/fabrica`)."),
  h2("4.1 Correções no chat real"),
  bullet("**Bug crítico eliminado:** classes `progress*` duplicadas no CSS, com `padding: 100px` quebrando o cartão de progresso"),
  bullet("**No-cut:** `100dvh`, `min-height: 0` nos flex, input sempre no fluxo, `word-break`/`overflow-wrap` nos balões"),
  bullet("**Hierarquia:** usuário à direita (fundo escuro, contraste 16:1), IA à esquerda (glass neutro)"),
  bullet('**A11y:** conteúdo ≥ 14px, contraste ≥ 4,5:1, `:focus-visible` em todos os interativos, ARIA completo (`role="log"`, `progressbar`, `listbox`), `prefers-reduced-motion`'),
  bullet("**Responsivo:** de zero media queries para chat fluido (340–460px) + coluna única ≤900px"),
  bullet("**Validação:** `tsc` limpo, 113/113 classes conferidas, 16/16 funcionalidades preservadas"),
);

// 5. review:decline ----------------------------------------------------------
children.push(
  h1("5. Implementação: review:decline cirúrgico (Passe 3.1)"),
  body("**Antes:** recusar um review regenerava o deck inteiro — 2 slides ruins destruíam 13 bons."),
  body("**Depois:**"),
  bullet("Novo `lib/tagExtract.ts` — extrator de tags `[EDIT]`/`[QUESTION]` com varredura balanceada (mata o bug de nascença da regex lazy)"),
  bullet("Pipeline grava `pendingReview` (deviations estruturadas) na sessão Redis"),
  bullet("Decline mapeia deviations (`slideIndex` + `fix`) + reason → edição só dos slides ruins via `applySlideEdits` (snapshot de versão + preview ao vivo); fallback honesto para regeneração total"),
  bullet("Ownership check adicionado ao handler (falha de segurança da revisão)"),
  callout("**Validação:** 26/26 testes novos · suíte inteira 153/153 · `tsc` zero erros."),
);

// 6. Arquitetura -------------------------------------------------------------
children.push(
  h1("6. Revisão de Arquitetura (nota 4,6)"),
  body("Seis arquitetos avaliaram o sistema na branch atual."),
  makeTable({
    widths: [2100, 900, 6026],
    header: ["Dimensão", "Nota", "Diagnóstico"],
    aligns: [AlignmentType.LEFT, AlignmentType.CENTER, AlignmentType.LEFT],
    rows: [
      ["Dados (Prisma, Redis, R2)", "5,6", "Melhor dimensão; blob↔relacional espalhado em 4 arquivos, índices faltantes"],
      ["Operação & Escala", "4,8", "Worker separado **perde silenciosamente o feedback WS** (sem pub/sub)"],
      ["Pipelines de IA", "4,6", "4 stacks coexistindo com fallbacks cruzados; helpers em 3 cópias"],
      ["Frontend (Next.js)", "4,5", "App Router usado como SPA (55/58 client components); formatos zumbis"],
      ["Comunicação front↔back", "4,2", "3 taxonomias de eventos, 3 envelopes REST, zero versionamento de contrato"],
      ["Camadas (backend)", "4,0", "Sem camada de serviço: 12/14 routers chamam Prisma direto; god-file de 2.481 linhas"],
    ],
  }),
  spacer(),
  h2("6.1 Convergências (citadas por múltiplos arquitetos)"),
  numbered(1, "`routes/ai.ts` é o epicentro do risco estrutural (4 de 6 arquitetos)"),
  numbered(2, "Statefulness escondido (WS Map + 3 job stores in-memory) inviabiliza a 2ª réplica"),
  numbered(3, "Formatos/pipelines zumbis tornam cada feature 3× mais cara"),
  h2("6.2 Alavanca nº 1 (2 arquitetos chegaram nela sozinhos)"),
  callout("**EventBus único sobre Redis pub/sub** — destrava multi-réplica, worker separado com progresso real, morte dos job stores in-memory e o ponto único para versionar o contrato de eventos."),
);

// 7. Roadmap -----------------------------------------------------------------
children.push(
  h1("7. Roadmap Recomendado (ordem de ataque)"),
  makeTable({
    widths: [600, 4100, 2700, 1626],
    header: ["#", "Ação", "Origem", "Esforço estimado"],
    aligns: [AlignmentType.CENTER, AlignmentType.LEFT, AlignmentType.LEFT, AlignmentType.CENTER],
    rows: [
      ["1", "EventBus Redis pub/sub (WS + job stores)", "Arquitetura §6.2", "1–2 dias"],
      ["2", "Extrair `routes/ai.ts` para módulo de feature com services", "Arquitetura §6 (Camadas)", "2–3 dias"],
      ["3", "Deletar formatos/pipelines zumbis (front e back)", "Arquitetura §6.1", "1–2 dias"],
      ["4", "Escrita de post transacional única + `sessionId` como coluna indexada", "Arquitetura (Dados)", "1 dia"],
      ["5", "DOMPurify real no pipeline HTML (server + front)", "Qualidade §2.2.1", "½ dia"],
      ["6", "Corrigir mount do callback Canva", "Qualidade §2.2.3", "½ dia"],
      ["7", "Clampar inputs de geração (slideCount, dimensões, base64)", "Qualidade §2.2.4", "½ dia"],
      ["8", "Testes de 401/JWT real + upload + rate limit", "Qualidade §2.2.5", "1 dia"],
      ["9", "Passe 3 restante: validador de imagens HTML, teste de escala 30–50 slides, billing Redis→Postgres, fontes Canva-safe", "Handoff Passe 3", "2–3 dias"],
    ],
  }),
  spacer(),
);

// 8. Artefatos ---------------------------------------------------------------
children.push(
  h1("8. Artefatos produzidos nesta sessão"),
  makeTable({
    widths: [3300, 5726],
    header: ["Artefato", "Caminho"],
    rows: [
      ["Refatoração chat (componente)", "`frontend/src/components/FabricaChat/*`"],
      ["Refatoração chat real (página)", "`frontend/src/app/[marca]/fabrica/page.tsx` + `fabrica.module.css`"],
      ["Arquitetura de informação (ambos os chats)", "`docs/refatoracao-chat/`"],
      ["Edição cirúrgica no decline", "`backend/src/lib/tagExtract.ts`, `backend/src/agents/brain/index.ts`, `backend/src/lib/redis.ts`, `backend/src/agents/pipeline.ts`"],
      ["Testes novos", "`backend/src/__tests__/reviewEdits.test.ts` (26 testes)"],
      ["Planos de trabalho", "`docs/passe3-decline-edit/plan.md`, `docs/refatoracao-chat/plan.md`"],
    ],
  }),
  spacer(),
  para(
    run("Relatório gerado a partir das revisões executadas por 6 revisores de qualidade, 12 investigadores de git e 6 arquitetos, com validação por gates de typecheck e suíte de testes (153/153 verdes).", {
      italics: true,
      size: 18,
      color: palette.light,
    }),
    {
      spacing: { before: 360 },
      border: {
        top: { style: BorderStyle.SINGLE, size: 4, color: palette.border, space: 8 },
      },
    },
  ),
);

// ----------------------------------------------------------------- document -
const doc = new Document({
  features: { updateFields: true },
  sections: [
    {
      properties: {
        page: {
          size: { width: 11906, height: 16838 }, // A4
          margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 },
        },
      },
      headers: {
        default: new Header({
          children: [
            para(
              run("Relatório Técnico Consolidado — Projeto Assinatura (Designer IA)", {
                size: 16,
                color: palette.light,
              }),
              {
                alignment: AlignmentType.CENTER,
                spacing: { after: 0 },
                border: {
                  bottom: { style: BorderStyle.SINGLE, size: 4, color: palette.border, space: 4 },
                },
              },
            ),
          ],
        }),
      },
      footers: {
        default: new Footer({
          children: [
            para(new TextRun({ children: [PageNumber.CURRENT], font, size: 16, color: palette.light }), {
              alignment: AlignmentType.CENTER,
              spacing: { after: 0 },
            }),
          ],
        }),
      },
      children,
    },
  ],
});

const buffer = await Packer.toBuffer(doc);
fs.writeFileSync(outputPath, buffer);
