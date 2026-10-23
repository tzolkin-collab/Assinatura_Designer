# Checklist de aceite do Designer

> Atualizado em 23/10/2026. Marque `[x]` só com evidência (comando, tela, link). Contexto: [README.md](README.md).
> Prazos: homologação **29/10**, revisão e aceite **30/10**. Prompts de execução: [prompts/](prompts/).

## Definição de pronto (todos verdadeiros ao mesmo tempo)

- [ ] Os 8 testes do Checklist Operacional executados, com evidência, versão e ambiente.
- [ ] Amanda Coelho funciona como projeto-piloto.
- [ ] Cérebro global vale em todos os projetos, sem vazar `[INTERNO]` e sem pessoa gerada.
- [ ] As remoções decididas estão em produção, anotadas arquivo a arquivo.
- [ ] Deploy do backend feito e a data consta no termo de aceite.
- [ ] A Gabriela foi avisada das divergências e respondeu.
- [ ] Manual de uso escrito a partir das telas finais e seguido do zero.

---

## Camada A: pedidos da Gabi (fecha o aceite)

### Os 8 testes do Checklist Operacional (estado de 15/10)

| # | Teste | Estado | Tarefa |
| --- | --- | --- | --- |
| 1 | Slide sem foto | [x] passou | |
| 2 | Slide com foto real | [ ] não rodado (faltam as fotos) | P01 |
| 3 | Contexto fora da arte | [x] passou | |
| 4 | Excesso de texto | [ ] parcial: texto preservado, sem aviso de limitação | P03 |
| 5 | Continuidade (lote 2) | [ ] não rodado | P06 |
| 6 | Isolamento de identidade | [x] passou | |
| 7 | E-book A4 | [ ] **não existe** (precisa de decisão de custo) | P05 |
| 8 | Collab | [ ] parcial: só testes automatizados | P06 |

### Itens do documento da Gabi

- [ ] **Variedade de composição** (medida: 3 em 10). Teste justo com o lote 1 dela, medido com a mesma métrica. → P02
- [ ] **Conflito entre versões do texto**: marcar o conflito e impedir que seja chamado de final (§2). Não implementado. → P03
- [ ] **Critério não atendido vira "pendência objetiva"** (§13 passo 8). → P03
- [ ] **Texto que não cabe** avisa a limitação. → P03
- [ ] **Trocar cor, fonte e logo sem regerar.** Só a troca de foto existe no editor. → P04
- [ ] **Seletor de modo** e ações "Nova imagem" / "Novo e-book A4". → P05
- [ ] **Briefing por campos** (§4, §12, §15): verificar de ponta a ponta com a IA, com marcas reais. → P06
- [ ] **Fontes Queens e Aeonik** carregadas e usadas; sem substituição silenciosa. → P01
- [ ] Defeitos conhecidos de 15/10 corrigidos (Auto vira Manual; "Já comecei a gerar"; planner inventa títulos). → P07
- [ ] Itens "não verificados" de 17/10 fechados (privacidade por projeto, acessos por workspace, SVG com `<script>`, regras globais na edição de slide). → P08

### Decisões que dependem da Gabi (perguntar, não presumir)

- [ ] Regra de foto real vale para a Assinatura como na Amanda?
- [ ] HTML ou Nano Banana para a arte? (recomendação: HTML, texto literal e editável)
- [ ] Segunda passada de IA para revisão: aceita o custo?
- [ ] Briefing no chat ou em tela separada? Imagem avulsa e e-book A4 nesta etapa?
- [ ] Custo adicional do e-book A4 e dos lotes 2 a 4 do MCP.

---

## Camada B: ajustes do Gustavo (D1 a D17)

### Pacotes (ordem de junção D13: #122, #120, #123, #124)

| WP | O que é | Estado | Tarefa |
| --- | --- | --- | --- |
| 1 | Remover Gestão de Tenants | PR #122, aceito, nota 9,0 | P09 |
| 4 | Login `rootSystem` por `.env` | PR #120, aberto | P09 |
| 2 | Referências, Fase 1 (sai a pesquisa de concorrentes) | PR #123, aceito com correções, nota 8,4 | P09 |
| 3 | Cérebro global em todo projeto | PR #124, nota 8,4, **não fazer deploy antes do teste com decks reais** | P09 |
| 5 | Retirar System Prompt e Preferências e Regras | não iniciado | P10 |
| 6 | Consolidar configurações da marca (Cérebro + Visão geral) | bloqueado por WP5 | P11 |
| 7 | Área Moodboard (Assets com tag `moodboard`) | não iniciado | P12 |
| 8 | Gastos (teto R$ 200), Perfil, Agente IA | não iniciado | P13 |
| 9 | Manual de uso e documentação | bloqueado por WP6 e WP7 | P14 |

### Aceite dos pacotes já entregues (pendências antes do deploy)

- [ ] **#122:** nenhum link ou menu aponta para Tenants; endereço antigo redireciona; criar projeto continua possível (executar de ponta a ponta); linha do plano do MCP que cita a rota removida corrigida.
- [ ] **#120:** desligado sem `ROOT_ADMIN_PASSWORD_HASH`; senha errada dá 401; root fora da equipe interna; 🟡 root ainda aparece em `GET /brands/:slug/members` (testar).
- [ ] **#123:** nenhuma linha de banco apagada; sem sobra de texto de concorrentes; moodboard anexada no chat continua chegando; **efeito na arte medido** num deck da Amanda, antes e depois; app aberto na tela.
- [ ] **#124:** `[INTERNO]` não chega ao planner, ao `pendingPlan` nem ao enqueue, com e sem ficha; regenerar tudo funciona sem ficha; falha de leitura da ficha para com erro visível; `DESIGNER_BRAIN_GLOBAL=off` devolve o comportamento anterior; **teste com decks reais** (Assinatura e Rúbrica).
- [ ] Risco: painel Briefing + projeto sem ficha deixa `[INTERNO]` cru para o artista (🟡 não testado). Resolvido pelo #124 em produção.
- [ ] Redis: jobs antigos em `reference-sync` ficam sem consumidor; conferir fila. `APIFY_API_TOKEN` pode sair da produção.
- [ ] Equipe: remover membro na tela não é duradouro (`internalTeam.ts` só cria vínculos).
- [ ] MCP continua dependendo de ficha (`getDesignerBrief`, `savePresentation`, `getBrandKit`): a regra "global" não vale nos agentes externos. Decidir se entra no escopo.

---

## Camada C: depende do Gustavo (não é de worker)

- [ ] **Chave Gemini nova**, uma por aplicação, com teto próprio (a antiga, compartilhada com o bot-gabi, foi revogada em 19/10). → bloqueia P01, P02, P06
- [ ] Explicar o gasto de R$ 200 em 18-19/10 (modelo `gemini-4-argon`, que nada no código usa).
- [ ] Bot da Gabi imprime a chave inteira no log de erro (tarefa `[Bot Gabi] URGENTE` no Core).
- [ ] Rotacionar `OAUTH_SECRET` e `ADMIN_SESSION_SECRET` do `.env` de dev (valor igual a uma senha que circulou) e as senhas das contas do seed (pendência de 16/10; 🟡 não sei se foi feita).
- [ ] Autorizar: carregar as 8 fotos da Amanda (grava no banco e no R2), teste de variedade (1 deck), teste do #124 com decks reais, medição do #123 na Amanda.
- [ ] Autorizar a limpeza dos decks de teste (lista em `HANDOFF-CEREBRO-DA-IA.md` §11.3; manter o baseline `ff862294`).
- [ ] Aprovar os merges na ordem D13.
- [ ] **Deploy do backend** com `DESIGNER_BRAIN_GLOBAL` igual em API **e** worker, ambos reiniciados.
- [ ] Ratificar a exceção: cérebro global nasce **ligado**, contra a regra de flag desligada por padrão (D4).
- [ ] Confirmar D15 (com `DESIGNER_BRAIN_GLOBAL=off`, falha de leitura da ficha também para a geração).
- [ ] Decidir categoria do Core (software ou assessoria) e atribuir responsável às 56 atividades sem dono.
- [ ] **Avisar a Gabriela** (P15): D7, D8, D9, D10, perguntas abertas e teto de R$ 200. Nada foi enviado.
- [ ] Comunicar à equipe que ninguém mais gera deck só com briefing (D7).

---

## Registro de entregas

| Tarefa | Entrega (branch/PR) | O que foi conferido | Nota | Decisão |
| --- | --- | --- | --- | --- |
| | | | | |
