---
title: "ADR-004 — Fábrica v3: Wizard (atual) vs No-Wizard + Supabase (Trae)"
type: decision
tags:
  - "fabrica"
  - "arquitetura"
  - "adr"
  - "supabase"
  - "wizard"
  - "pendente"
sources:
  - "features/fabrica-v2.md"
  - "features/fabrica-redesign.md"
created: 2026-05-04
updated: 2026-05-13
status: PENDENTE_ADIADA
---

# ADR-004 — Fábrica v3: Wizard vs No-Wizard + Supabase

## Status
**⏳ PENDENTE / ADIADA** — por decisão operacional de 2026-05-13, a escolha Wizard vs No-Wizard fica por último. A Fábrica v2/Wizard permanece como base operacional até validação real com Gabi, correções críticas e limpeza pós-ADR-006.

## Contexto
Existem duas direções arquiteturais para a próxima versão da Fábrica:

| | Opção A (atual — fabrica-v2) | Opção B (Trae — fabrica-redesign) |
|---|---|---|
| UX | Wizard 3 steps | Tela única por tipo (sem wizard) |
| Backend | Express + Prisma + PostgreSQL | Supabase Edge Functions |
| DB | PostgreSQL próprio (EasyPanel) | Supabase PostgreSQL |
| Storage | Cloudflare R2 | Supabase Storage |
| Auth | Middleware próprio | Supabase Auth |
| Status | ✅ Implementado | 📋 Proposta (não implementada) |

## Opção A — Manter Wizard + Express (status quo)
**Prós:**
- Já implementado e funcionando
- Infraestrutura sob controle total
- Sem lock-in de SaaS
- Consistente com infra compartilhada Gabi ↔ Marcelle (ADR-003)

**Contras:**
- UX de wizard pode ser mais lenta para a Gabi
- Mais ops para manter

## Opção B — Migrar para No-Wizard + Supabase
**Prós:**
- UX mais fluida (benchmarking mostra que ferramentas top usam tela única)
- Supabase reduz ops (auth, storage, DB gerenciados)
- API mais limpa (`POST /api/generate` com tipos fortes)

**Contras:**
- Reescrita parcial do frontend e backend
- Lock-in Supabase
- Quebra a infra compartilhada com Bot Gabi e Marcelle (ADR-003)
- Custo Supabase a avaliar

## Decisão
> **Adiada para o final da sequência atual.** Não decidir agora entre Wizard e No-Wizard. Manter Fábrica v2/Wizard como caminho operacional até fechar validação real com Gabi, correções críticas do editor, auditoria de segurança/ownership e limpeza das inconsistências pós-ADR-006.

## Consequências
- Evita reescrita prematura da Fábrica enquanto ainda há pendências mais críticas no MVP.
- Preserva fluxo que já está funcional.
- Mantém a proposta No-Wizard/Supabase como alternativa futura, não como bloqueador imediato.
- A decisão só deve ser retomada após evidência de uso real da Gabi e estabilização do editor/pipeline.

## Relacionados
- [[fabrica-v2]]
- [[fabrica-redesign]]
- [[adr-001-next-express-separados]]
- [[adr-003-infra-compartilhada]]
