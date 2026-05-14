---
title: Bot Gabi — Secretária A.I. (implementação)
type: feature
tags:
  - "bot"
  - "gabi"
  - "whatsapp"
  - "fastapi"
  - "python"
  - "asana"
  - "gemini"
  - "openai"
  - "redis"
  - "postgresql"
  - "evolution-api"
  - "ata"
  - "auto-reply"
  - "fernanda"
sources:
  - "Bot_Gabi/Assinatura/main.py"
  - "Bot_Gabi/Assinatura/routes/webhook.py"
  - "Bot_Gabi/Assinatura/bot/handlers/"
  - "Bot_Gabi/Assinatura/system/handlers/meeting_notify.py"
  - "Bot_Gabi/Assinatura/core/config.py"
created: 2026-04-22
updated: 2026-05-13
---

# Bot Gabi — Secretária A.I. (implementação)

## Resumo

Bot WhatsApp em Python (FastAPI) que atua como "Fernanda", a secretária executiva da Gabriela. Recebe webhooks da Evolution API, aplica debounce de 4s para agrupar mensagens, e roteia para handlers de ata, tarefas Asana ou chat geral. O MVP 1 (auto-reply em reuniões) e o MVP 2 (atas no Asana) já estão implementados e no git. Deployado via Docker + EasyPanel.

## Detalhes

### Stack

| Camada | Tecnologia |
|---|---|
| Runtime | Python 3.12 |
| Framework | FastAPI + Uvicorn |
| WhatsApp | Evolution API v2 (webhook `POST /webhook/evolution`) |
| LLM principal | Gemini (extração de dados, transcrição de mídia, atas) |
| LLM chat geral | OpenAI GPT-4o (chat + classificação de intenção) |
| Estado/debounce | Redis |
| Histórico/atas | PostgreSQL |
| Task management | Asana API |
| Deploy | Docker Compose + EasyPanel |

### Fluxo Principal (webhook → resposta)

```
1. Evolution API → POST /webhook/evolution
2. Auto-reply imediato?
   → Gabi em reunião/evento (Redis state) → envia msg automática → fim
3. É mídia (áudio/imagem)?
   → background: transcreve com Gemini → enfileira como texto no debounce
4. É texto?
   → push na fila Redis + seta debounce (4s)
   → background: aguarda 4s de silêncio → agrupa todas as msgs → roteia

Roteamento (em ordem de prioridade):
  [0] Estado pendente (Redis) → fluxo de confirmação em andamento
  [1] Keyword match → ata / concluir / deletar / atualizar / criar / buscar tarefa
  [2] Fallback LLM (GPT-4o classify_intent) → mapeia para mesmo conjunto de handlers
  [3] Chat geral com GPT-4o + histórico do PostgreSQL
```

### Handlers Implementados

| Handler          | Arquivo                             | Trigger                                      | O que faz                                                                          |
| ---------------- | ----------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------- |
| Auto-reply       | `system/handlers/meeting_notify.py` | Status Redis = `meeting` ou `event`          | Envia msg automática; não repete para o mesmo número na janela                     |
| Ata de reunião   | `bot/handlers/meeting_minutes.py`   | `/ata`, `processar ata`, `subir ata`         | Gemini estrutura → Asana (seção Reuniões Mensais) → PostgreSQL → confirma com link |
| Criar tarefa     | `bot/handlers/asana_task.py`        | Keywords + LLM intent `asana_task`           | Gemini extrai nome/prazo/projeto → cria no Asana → salva last_task no Redis        |
| Atualizar tarefa | `bot/handlers/asana_task.py`        | Keywords + LLM intent `asana_update`         | Gemini extrai nome + mudança → busca task → atualiza                               |
| Deletar tarefa   | `bot/handlers/asana_task.py`        | Keywords + LLM intent `asana_delete`         | Busca task → deleta                                                                |
| Concluir tarefa  | `bot/handlers/asana_task.py`        | Keywords + LLM intent `asana_complete`       | Busca task → marca concluída                                                       |
| Buscar tarefa    | `bot/handlers/asana_query.py`       | Keywords + LLM intent `asana_search`         | Busca tarefas por nome/filtro                                                      |
| Link da tarefa   | `webhook.py`                        | LLM intent `link_request`                    | Retorna link da última task criada (Redis)                                         |
| Mídia            | `bot/handlers/media.py`             | `audioMessage`, `pttMessage`, `imageMessage` | Gemini transcreve/descreve → enfileira texto no debounce                           |
| Chat geral       | `bot/llm/chatgpt.py`                | Fallback (nenhum intent específico)          | GPT-4o com histórico dos últimos 6 turns (PostgreSQL)                              |

### Status dos MVPs (referência: 22/04/2026)

| MVP | Escopo original | Status real no código |
|---|---|---|
| MVP 1 — Mensagens Automáticas | Auto-reply no WhatsApp durante ausências | ✅ Implementado (`meeting_notify.py`) |
| MVP 2 — Atas de Reunião | Pipeline Gemini → ChatGPT → Asana | ✅ Implementado (`meeting_minutes.py` + Gemini → Asana) |
| MVP 3 — Gerador de Imagens | Agente de imagens em testes | ✅ Adiantado — partindo para testes junto ao Designer |
| MVP 4 — Lançamento | Validação final + gerador de imagens | 🔄 Parcialmente adiantado — depende de bateria de testes e Drive |

> **O bot está adiantado**: MVP 1 e 2 já estão implementados (commits de 09–11/04). Em 2026-05-13, só falta a integração com Google Drive como pendência operacional principal antes da bateria de testes. A mídia (áudio/imagem) é bônus não previsto no escopo original.

### Configuração (`.env`)

| Variável | Uso |
|---|---|
| `EVOLUTION_API_URL/KEY/INSTANCE` | Conexão com Evolution API (WhatsApp) |
| `GABI_PHONE` | Número da Gabi para referência |
| `OPENAI_API_KEY` + `OPENAI_MODEL` | Chat geral + intent classification (default: gpt-4o) |
| `GEMINI_API_KEY` | Extração de dados de tarefas, atas, transcrição de mídia |
| `POSTGRES_URL` | Histórico de conversas e atas |
| `REDIS_URL` | Estado: meeting status, debounce, last task, pending |
| `ASANA_ACCESS_TOKEN/WORKSPACE_GID/PROJECT_GID/SECTION_GID/USER_GID` | Integração completa Asana |
| `AUTO_REPLY_MEETING_MSG` / `AUTO_REPLY_EVENT_MSG` | Texto das mensagens automáticas |

### Persona do Bot

O bot se apresenta como **"Fernanda"** — secretária executiva da Gabriela. Menu de ajuda:

> *"Olá! Sou a Fernanda, secretária executiva da Gabriela. Posso ajudar com atas de reunião no Asana, tarefas/reuniões no Asana, e apoio executivo geral."*

## Decisões Tomadas

- **Debounce de 4s no Redis** — agrupa rajadas de mensagens rápidas em uma única chamada LLM; evita múltiplos processamentos paralelos do mesmo contexto.
- **Keyword match antes do LLM** — reduz latência e custo; LLM só é chamado como fallback.
- **Gemini substituiu OpenAI para extração de dados Asana** (commit `c4635c2`, 10/04) — limites de cota do OpenAI no Free Tier. OpenAI mantido para chat geral e intent classification.
- **Dual LLM strategy** — Gemini (extração estruturada de dados, transcrição) + GPT-4o (raciocínio de intenção, chat contextual).
- **Falhas de Redis/PostgreSQL no boot não travam o serviço** — degradação graceful; bot sobe mesmo com dependências indisponíveis.
- **Estado de status (reunião/evento) no Redis** — permite ativar/desativar auto-reply sem reiniciar o serviço.

## Learnings

- Auto-reply duplicado evitado com `mark_auto_replied` por número (Redis TTL) — sem isso, cada nova mensagem durante a reunião geraria um novo auto-reply.
- Mensagens de mídia (áudio/imagem) são processadas em background e enfileiradas como texto no debounce — isso permite misturar áudio + texto e processá-los juntos em uma única chamada.
- `state pendente` no Redis é necessário para fluxos de confirmação multi-turno (ex: "achei uma task parecida, crio baseada nela?") — sem ele, a resposta "sim" seria tratada como chat geral.
- `fromMe: true` no webhook ignora mensagens do próprio bot, exceto palavras de trigger de menu — sem esse filtro, o bot responde às próprias mensagens causando loop.

## Reuso para Marcelle

A base técnica deste bot (FastAPI + Evolution API + Redis + PostgreSQL + EasyPanel) será **reaproveitada para o Agente Marcelle**, com lógica de atendimento própria (controle de projetos, status de clientes, reports). Nenhum código novo de infraestrutura será necessário — apenas os handlers e fluxos de negócio específicos da Marcelle.

## Relacionados

- [[secretaria-ai-gabi]] — planejamento original (escopo, cronograma, financeiro)
- [[automacao-notificacao-marcelle]] — próximo bot; reaproveitará esta base
- [[gabi]] — usuária do bot
- [[infraestrutura-tecnica]] — Evolution API, EasyPanel
- [[agente-designer]] — outro produto da Gabi (MVP 3–4)
