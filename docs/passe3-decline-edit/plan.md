# Passe 3.1 — review:decline vira [EDIT] cirúrgico

## Problema
Recusar um review regenera o deck inteiro (`enqueuePipeline` com brief=reason em `brain/index.ts:310-324`), destruindo N slides bons por causa de poucos ruins. O reviewer já entrega `deviations` com `slideIndex` + `fix` (`reviewer/index.ts:23-32`), mas elas viram texto no chat e se perdem (`pipeline.ts:375-383`).

## Pré-requisito encontrado na auditoria
A regex `[EDIT]` (`brain/index.ts:608` e strip em `:101`) nasceu quebrada (commit 5ec1f26): lazy quantifier trunca o JSON no primeiro `}` seguido de `]` — o payload documentado sempre falha. Precisa de extrator balanceado antes de qualquer fluxo depender de [EDIT].

## Design
1. **Novo lib puro `backend/src/lib/tagExtract.ts`** (testável isoladamente):
   - `extractBracketedJson(text, tag)` — acha `[TAG:` (case-insensitive) e varre com contagem balanceada de `{}` respeitando strings/escapes; retorna `{ json, start, end }` ou null.
   - `stripBracketedJson(text, tag)` — remove TODAS as ocorrências sem deixar resíduo.
   - `mapDeviationsToEdits(deviations, reason, totalSlides)` — dedupe por slideIndex, clamp [0,total), instruction = fix ?? description (+ reason como contexto), ordena critical>major>minor, teto de 8.
2. **`brain/index.ts`**: usar o extrator no `detectAndDispatch` e no strip; reescrever o handler `review:decline`:
   - ownership check (session.userId vs userId — falha de segurança apontada na revisão);
   - com arte + deviations → payload cirúrgico via `applySlideEdits` (já snapshot, emite progresso, persiste e atualiza o preview ao vivo);
   - falhou → mensagem honesta + fallback para regeneração total;
   - sem deviations → comportamento legado (regeneração com brief=reason).
3. **`redis.ts`**: sessão ganha `pendingReview?: { score, feedback, deviations } | null`.
4. **`pipeline.ts`**: gravar `pendingReview` após o review (aprovado ou não); limpar no approve/decline.
5. **Testes** `backend/src/__tests__/reviewEdits.test.ts`: extrator (payload documentado, aninhamento, `]` dentro de string, múltiplas tags, strip sem resíduo) + mapDeviationsToEdits (dedupe, clamp, ordenação, reason, vazio).

## Workers
- `Impl_DeclineEdit` (coder): itens 1–4.
- `QA_DeclineEdit` (coder): item 5, contra o contrato acima, em arquivo de teste exclusivo.
- Validador (sequencial): tsc + vitest + revisão do diff.
