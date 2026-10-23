# P08: Verificações pendentes (somente leitura e testes)

**Camada A (Gabi).** Antes de tudo, leia `docs/aceite/README.md` e siga as regras da seção 3.
**Sem escrita em banco, sem deploy, sem geração paga.** Entrega é um relatório com achados; correções viram tarefas.

## Objetivo
Fechar a lista "não verificado" de `docs/HANDOFF-DESIGNER-2026-10-17.md` §7, dizendo **funciona / não funciona / não consegui verificar**, com evidência.

## Itens
1. **Privacidade por projeto** ("privados por padrão" no documento dela): a página `/projetos` diz que todos têm acesso a todos os projetos da equipe. Ler a regra no código e testar com dois usuários de papéis diferentes.
2. **Acessos por workspace e perfil admin** (Saulo master financeiro; erro de acesso da Gabriela em 02/10). Tarefa vencida em 16/10 no Core. Verificar o que o código faz hoje.
3. **Upload de SVG com `<script>`**: a memória do projeto registra XSS por SVG como verificado em `main` e não corrigido (gravidade menor do que parece). Reconfirme o estado atual e diga se algo mudou desde então.
4. **Regras globais na edição de slide e nas ferramentas do chat**: podem ainda usar o contexto antigo (só a geração usa o cérebro). Rastrear quais caminhos montam contexto sem passar pelo cérebro.
5. **Tela de consentimento do MCP (#114)** no navegador e **botão do #115 em desktop** com envio real das marcas à IA (só o parser foi testado).
6. **Briefing/ingestão de brandbook, orientações no meio do deck e chip de custo** em ambiente vivo.

## Passos
Para cada item: onde está no código (arquivo:linha), como foi testado, resultado, gravidade e a menor correção sugerida. Use a API de mentira ou backend local isolado; **leitura** no banco real.

## Aceite
- [ ] Os 6 itens com veredito e evidência; nenhum "deve funcionar".
- [ ] Achados de segurança destacados e ordenados por gravidade.
- [ ] Lista de tarefas de correção propostas (não implementadas).
