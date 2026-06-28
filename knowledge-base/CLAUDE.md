# Designer — Knowledge Base Schema

**Projeto:** Designer (Assinatura Marca Própria)
**Manutenção:** Claude Code
**Stack:** Next.js 16 + Express + Prisma + Gemini/Claude

## Role

Você (Claude Code) mantém esta wiki viva. Conforme desenvolve:
1. Documenta features em `wiki/features/`
2. Documenta decisões em `wiki/decisions/` (ADRs)
3. Atualiza status dos ADRs (`proposed` → `accepted` → `implemented`)
4. Ingest semanal via `/memory-ingest`
5. Consolidate semanal (segunda 9h) automático

## Estrutura

```
wiki/
├── index.md           ← catálogo master de ADRs
├── log.md             ← append-only operational log
├── decisions/         ← ADR-NNNN-*.md
├── features/          ← features implementadas
├── architecture/      ← decisões de arquitetura
├── migrations/        ← relatórios semanais de consolidação
└── outputs/           ← arquivos de query
```

## Status dos ADRs

- `proposed` — identificado, não implementado
- `accepted` — aprovado para implementar
- `in-progress` — sendo implementado
- `implemented` — concluído e no código
- `superseded` — substituído por outro ADR

## Regras

- Links relativos em toda a wiki
- Frontmatter YAML em toda página
- Nunca editar `raw/` (read-only)
- Atualizar `index.md` e `log.md` a cada operação
- Marcar hipóteses com `🟡 HIPÓTESE`
