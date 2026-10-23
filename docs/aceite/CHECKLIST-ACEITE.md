# Checklist de aceite do Designer

> Reescrito em 23/10/2026 a partir do **Core** (espelho; se divergir, vale o Core). Marque `[x]` só com evidência (comando, tela, link).
> Contexto e regras: [README.md](README.md). Prompts de execução: [prompts/](prompts/).
> Datas fixas: homologação **29/10**, revisão e aceite **30/10**.
> **"Passou" não é resultado.** Para qualquer item de geração, a evidência é o **slide comparado ao pedido** (paleta, fonte, composição, texto exato, foto), não a nota de teste.

## Definição de pronto (todos verdadeiros ao mesmo tempo)

- [ ] Os 8 testes do Checklist Operacional executados, com evidência, versão e ambiente (o 7, e-book A4, **adiado e dito à Gabi antes**).
- [ ] Amanda Coelho funciona como projeto-piloto.
- [ ] Cérebro global vale em todos os projetos, sem vazar `[INTERNO]` e sem pessoa gerada.
- [ ] As remoções decididas estão em produção, anotadas arquivo a arquivo.
- [ ] Deploy do backend feito e a data consta no termo de aceite (o termo de 12/10 está **desatualizado**).
- [ ] **MCP provado com um agente real** (Claude ou ChatGPT).
- [ ] A Gabriela foi avisada das divergências e respondeu.
- [ ] Manual de uso escrito a partir das telas finais e seguido do zero.

## Escopo (decisão de 19/10)
Corrigir o que existe · integrar o MCP já construído · o que a Gabi pediu e já existe. **Fora:** modo/e-book A4/formulário (adiados a 02/11), MCP lotes 2 a 4. **Descartado:** conflito de versões.

---

## Camada A: pedidos da Gabi (fecham o aceite)

### Os 8 testes do Checklist Operacional (estado de 15/10)

| # | Teste | Estado | Prompt |
| --- | --- | --- | --- |
| 1 | Slide sem foto | [x] passou (critério de teste) | |
| 2 | Slide com foto real | [ ] não rodado (a Amanda tem 0 fotos reais) | P01 |
| 3 | Contexto fora da arte | [x] passou (critério de teste) | |
| 4 | Excesso de texto | [x] texto preservado, com aviso no finalGate | P03 |
| 5 | Continuidade (lote 2) | [ ] não rodado | P06 |
| 6 | Isolamento de identidade | [x] passou (critério de teste) | |
| 7 | E-book A4 | [ ] **não existe; adiado a 02/11** | P05 |
| 8 | Collab | [ ] parcial: só testes automatizados | P06 |

### Itens

- [ ] **Resultado real do lote 1 dela:** gerar o lote e comparar slide a slide com `docs/benchmark/lote1-gabriela/brief.txt` (paleta `#410C1C`, `#8E242E`, `#D8E9F3`, `#FCF9EB`; Queens nos títulos e Aeonik no apoio; um arquétipo de composição por slide; texto exato; sem sombra, degradê, círculos, "estética de template"; foto só se anexada, senão área reservada). → P02
- [ ] **Variedade de composição:** hoje 0,05 a 0,18 contra 0,12 a 0,47 do GPT dela (métrica grosseira). → P02
- [x] **Aviso quando o texto não cabe** como nota no `finalGate`. → P03
- [ ] Fotos reais da Amanda carregadas e Teste 2 rodado. → P01
- [ ] Fontes Queens e Aeonik aplicadas, sem substituição silenciosa (a licença de uso comercial segue sem confirmação formal). → P01
- [ ] **Briefing por campos** (#119) verificado de ponta a ponta com a IA: o `[INTERNO]` não chega ao artista, com e sem ficha. → P06
- [ ] Defeitos de 15/10, **reproduzir antes de corrigir:** Auto vira Manual sozinho; "Já comecei a gerar" enquanto a regra de foto real está pendente; o planner inventa títulos de slide. → P07
- [ ] Itens "não verificados" de 17/10: privacidade por projeto, acessos por workspace, upload de SVG com `<script>`, regras globais na edição de slide, tela de consentimento do MCP. → P08

### Já feito (não refazer)
Pendências objetivas e "texto em revisão não vira final" (#117); trava de rascunho em publicar e exportar, app e MCP (#117, #118); painel "Briefing da peça" (#119); galeria leve (#111); moldura padrão e enquadramento pelo assunto (#71, #82, #83, #86).

### Perguntas à Gabi (uma mensagem, opções fechadas; **nada enviado**) → P15
- [ ] O painel de 3 campos basta, ou ela quer o formulário completo (§12) em tela separada?
- [ ] **Trocar sem regerar** (fotos, cores, fontes, logo): qual é a prioridade? Hoje só a foto troca. (P04, adiado)
- [ ] E-book A4 e imagem avulsa são desta etapa? **Têm custo adicional.**
- [ ] MCP/conector existe como extensão fora do contrato: ela quer?
- [ ] Regra de foto real vale para a Assinatura como na Amanda? Segunda passada de IA na revisão (custo)?
- [ ] Doc "regras gerais para outras IDs" (não abre pela conta brtzolkin); fotos reais oficiais; as ~5 alterações pendentes da ata de 02/10.
- [ ] Privacidade por projeto e o que ela espera da home (filtros Base/Collabs/Recentes).

---

## Camada B: ajustes do Gustavo (D1 a D17)

### Pacotes (ordem de junção D13: #121, #122, #120, #123, #124) → P09

| Pacote | Estado | Tarefa no Core |
| --- | --- | --- |
| Remover Gestão de Tenants | PR #122, aceito, **9,0** | [Worker] Remover Gestão de Tenants |
| Login `rootSystem` | PR #120, desligado por padrão | (sem tarefa própria; dentro de Acessos) |
| Referências, Fase 1 | PR #123, aceito com correções, **8,4** | [Worker] Referências: excluir concorrentes e criar Moodboard |
| Cérebro global | PR #124, **8,4; não ir a produção antes do teste com decks reais** | [Worker] Ligar o cérebro global |
| Retirar System Prompt e Preferências (D2, D3) | não iniciado | [Worker] Retirar System Prompt... (criada 23/10) → P10 |
| Moodboard (área e card) | não iniciado | dentro de Referências → P12 |
| Gastos, Perfil, Agente IA | não iniciado; **mínimo, sem feature** | 3 tarefas [Worker] → P13 |
| Consolidar configurações (D10) | não iniciado; **diverge do desenho da Gabi**; **primeira a sair se apertar, por decisão do Gustavo** | [Worker] Consolidar configurações → P11 |
| Manual de uso | bloqueado até as telas finais | Criar manual de instruções → P14 |

### Pendências antes do deploy
- [ ] **#122:** teste do redirect (não existe); linha do plano do MCP que cita a rota removida; criar projeto ponta a ponta.
- [ ] **#120:** senha errada dá 401; desligado sem `ROOT_ADMIN_PASSWORD_HASH`; 🟡 root ainda aparece em `GET /brands/:slug/members` (testar).
- [ ] **#123:** abrir o app; **medir o efeito na arte** (antes × depois, num deck da Amanda); card Moodboard; jobs antigos em `reference-sync`; `APIFY_API_TOKEN` pode sair da produção. **Fase 2 (apagar dados) só com backup conferido e aprovação por escrito.**
- [ ] **#124:** teste com decks reais (Assinatura e Rúbrica), **depende da chave**; `[INTERNO]` não chega ao planner, ao `pendingPlan` nem ao enqueue, com e sem ficha; `DESIGNER_BRAIN_GLOBAL` igual na API e no worker; **comunicar que ninguém gera deck só com briefing (D7)**.
- [ ] **Risco enquanto o #124 não entrar:** o painel Briefing (#119, em `main`) deixa `[INTERNO]` cru para o artista em projeto sem ficha (🟡 não testado). **Não faça o deploy sem o #124.**
- [ ] MCP continua dependendo de ficha: a regra global não vale nos agentes externos.

---

## Camada C: depende do Gustavo (não é de worker)

- [ ] **Chave Gemini nova**, uma por aplicação com teto próprio (a compartilhada foi revogada em 19/10). **Bloqueio nº 1.** (Core: "[Gustavo] Chave Gemini nova")
- [ ] Explicar o gasto de R$ 200 em 18-19/10 (modelo `gemini-4-argon`): nos logs de produção não há geração, origem provável é outro cliente da chave.
- [ ] Bot da Gabi imprime a chave inteira no log de erro (tarefa `[Bot Gabi] URGENTE`, fora do Designer).
- [ ] Rotacionar `OAUTH_SECRET` e `ADMIN_SESSION_SECRET` do `.env` de dev e as senhas do seed (pendência de 16/10; 🟡 não sei se foi feita).
- [ ] Autorizar, cada uma: fotos da Amanda no banco/R2, teste de variedade (1 deck), teste do #124 (2 decks), medição do #123, Teste 8.
- [ ] Aprovar os merges, PR a PR, na ordem D13.
- [ ] **Executar o deploy do backend** (ver P16) e o redeploy do que mudar.
- [ ] Ratificar: cérebro global nasce **ligado** (exceção à regra de flag desligada); D15.
- [ ] Definir a categoria do Core e atribuir **responsável** (nenhuma das tarefas tem dono).
- [ ] **Enviar o aviso à Gabriela** (P15) e comunicar a equipe (D7).
- [ ] Autorizar a limpeza dos decks de teste, **depois** da homologação (Core: "Limpeza dos decks de teste").

---

## Registro de entregas

| Tarefa | Entrega (branch/PR) | O que foi conferido | Nota | Decisão |
| --- | --- | --- | --- | --- |
| | | | | |
