# Assinatura — Knowledge Base Schema

> Este arquivo é o **contrato** que o Claude (Code ou Cowork) lê ao operar esta wiki.
> Padrão: **Karpathy LLM-Wiki + Obsidian Vault**.
> Status: wiki viva, append-only log, consolidação semanal correlacionada com GitHub.

---

## 📁 Estrutura

```
knowledge-base/
├── CLAUDE.md              ← este arquivo (schema + regras)
├── git/
│   └── config.json        ← repo remoto para consolidate (gerado no 1º uso)
└── wiki/
    ├── index.md           ← catálogo master (TOC de todas as páginas)
    ├── log.md             ← append-only timeline (data + ação + link)
    ├── overview.md        ← síntese dinâmica do estado atual
    ├── tracking.canvas    ← Obsidian Canvas (timeline visual)
    ├── architecture/      ← C4, padrões, system design
    ├── features/          ← features implementadas
    ├── integrations/      ← third-parties (APIs, serviços externos)
    ├── security/          ← certificados, OAuth, keys, auth flows
    ├── workflows/         ← fluxos de negócio
    ├── decisions/         ← ADRs (Architecture Decision Records)
    ├── stakeholders/      ← pessoas e organizações (perfil, papel, dores)
    ├── migrations/        ← relatórios semanais (consolidate)
    └── outputs/           ← queries arquivadas
```

---

## 🏷️ Types of Pages

| Type           | Pasta           | Quando criar                                              |
| -------------- | --------------- | --------------------------------------------------------- |
| `architecture` | `architecture/` | Padrão de design, C4, diagrama de sistema                 |
| `feature`      | `features/`     | Feature implementada com suas decisões                    |
| `decision`     | `decisions/`    | ADR — por que foi escolhido X em vez de Y                 |
| `integration`  | `integrations/` | Contrato com serviço externo (Serpro, Caixa, Calima, etc) |
| `security`     | `security/`     | Certs, API keys, OAuth, superfícies de ataque             |
| `workflow`     | `workflows/`    | Fluxo ponta-a-ponta (usuário → backend → saída)           |
| `migration`    | `migrations/`   | Relatório de consolidação semanal (gerado, não editar)    |
| `output`       | `outputs/`      | Resposta arquivada de `/memory-query`                     |
| `stakeholder`  | `stakeholders/` | Pessoa ou organização — perfil, papel, dores, contexto    |

---

## 📄 Template de Página

Toda página nova DEVE começar com este frontmatter:

```yaml
---
title: Título humano da página
type: feature | decision | integration | security | workflow | architecture | migration | output
tags: [tag1, tag2]
sources: [caminho/ao/arquivo-origem.md, commit-sha, url]
created: YYYY-MM-DD
updated: YYYY-MM-DD
---

# Título humano da página

## Resumo
2–4 frases. O que esta página cobre e por que existe.

## Detalhes
Conteúdo estruturado. Seções livres conforme o tipo.

## Decisões Tomadas
Trade-offs explícitos. O que foi rejeitado e por quê.

## Learnings
Bugs, patterns, pegadinhas, dívidas técnicas descobertas.

## Relacionados
- [Outro Título](../pasta/outra-pagina.md) — relação
```

---

## 📜 Rules (invioláveis)

1. ✅ **Links relativos sempre** — `[Title](architecture/frontend.md)`, nunca URL absoluta do vault.
2. ✅ **Frontmatter YAML obrigatório** em toda página `.md` dentro de `wiki/`.
3. ✅ **Atualizar `index.md` + `log.md` + `tracking.canvas`** a cada operação que cria/altera página.
4. ✅ **Nunca editar `migrations/`** manualmente — é output gerado por `/memory-consolidate`.
5. ✅ **Flag contradições explicitamente** — se duas páginas discordam, criar bloco `> ⚠️ CONFLITO: ...` na mais antiga.
6. ✅ **`log.md` é append-only** — nunca reescrever linhas passadas, apenas adicionar novas.
7. ✅ **Canvas refs** (`type: "file"`) usam caminhos relativos à raiz do vault começando com `knowledge-base/wiki/...`.
8. ✅ **Nunca editar `raw/`** — se existir, é read-only (fontes originais preservadas).
9. ✅ **Sync com GitHub semanal** via `/memory-consolidate`.

---

## 🛠️ As 4 Operações

As operações são expostas como **slash commands** em `.claude/commands/` (para Claude Code) e documentadas no **skill** em `.claude/skills/memory/SKILL.md` (para Cowork).

### 1. `/memory-ingest <arquivo>`
Lê arquivo bruto → cria página na pasta correta de `wiki/` → atualiza `index.md` + `log.md` + `tracking.canvas`.

### 2. `/memory-query <pergunta>`
Lê `index.md` → seleciona páginas relevantes → sintetiza resposta → oferece arquivar em `outputs/`.

### 3. `/memory-lint`
Auditoria de saúde: links quebrados, páginas órfãs, contradições, claims desatualizados, conceitos sem página.

### 4. `/memory-consolidate`
Correlaciona `git log` com `log.md` → gera `migrations/YYYY-MM-DD.md` → atualiza `overview.md`.

---

## 🎨 Obsidian Canvas (`wiki/tracking.canvas`)

Formato JSON nativo do Obsidian. Dois tipos de nó:

- `"type": "text"` — marcos cronológicos (datas, milestones, epics).
- `"type": "file"`, `"file": "knowledge-base/wiki/..."` — nó que embeda uma página da wiki.

Edges (setas) conectam a evolução cronológica. Sempre que uma feature fecha um epic ou uma decisão muda a direção, adicionar nó + edge.

---

## 🔗 GitHub Correlation

`knowledge-base/git/config.json` guarda o remote alvo:

```json
{ "remote": "https://github.com/<user>/<repo>", "branch": "main" }
```

Gerado na primeira execução de `/memory-consolidate`. O comando pergunta ao usuário se o arquivo não existir.

---

## ✅ Fluxo típico (exemplo)

```
Segunda 10h — /memory-query "Estado atual da integração Serpro?"
Quarta 14h — termina feature → /memory-ingest docs/feature-multi-empresa.md
Sexta 16h — bug descoberto → cria security/cert-expiracao.md → /memory-ingest <arquivo>
Segunda 9h (auto) — /memory-consolidate → migrations/2026-04-27.md
```

---

**Versão:** 1.0
**Data:** 2026-04-22
**Mantenedor:** Claude (Code + Cowork)
