# P09: Junção dos PRs #122, #120, #123 e #124

**Camada B (ajustes do Gustavo).** Antes de tudo, leia `docs/aceite/README.md` e siga as regras da seção 3.
**Merge só com autorização explícita do Gustavo**, PR a PR, depois de revisar o diff. Nada de push de branch sem pedido.

## Objetivo
Levar os cinco PRs abertos para `main` na ordem decidida (D13), resolvendo o conflito conhecido, sem regressão.

## Contexto
- Ordem: **#122** (remove Tenants, nota 9,0), **#120** (login `rootSystem`, desligado por padrão), **#123** (remove pesquisa de concorrentes, nota 8,4), **#124** (cérebro global, nota 8,4). #121 (slug da documentação, trivial) pode entrar a qualquer momento.
- Todos estavam `MERGEABLE` em 23/10. **Os únicos checks do GitHub são do Vercel (preview): não existe CI que rode os testes.** O "verde" dos testes vem das suítes que o PO rodou localmente em 19/10 (o corpo do #122 diz "relato do worker"; o registro do PO diz que ele rodou). **Rode `tsc` e a suíte você mesmo antes de cada merge.** Cada merge muda a base do próximo; reconfira antes de cada um.
- **Tarefa no Core:** "[Designer] Junção dos PRs #121, #122, #120, #123 e #124 em main (ordem D13)". Atualize os pacotes ao mergear.
- **Conflito esperado:** #123 × #124 em `backend/src/__tests__/pipelineAdviceInterrupt.test.ts` (`pipeline.ts` e `.env.example` mesclam sozinhos).
- Branch atual do repositório local: `feat/root-system-login`, em sincronia com o remoto. Alterações locais não commitadas (`.claude/launch.json`, `hashRootAdminPassword.ts`, `docsContent.ts`, `.claude/workflows/`, `docs/po/`, `docs/handoffs/`, `handoff.md`, `docs/aceite/`) **não** devem entrar nos PRs por acidente.
- A alteração local em `docsContent.ts` parece ser a mesma correção do #121: confira antes de commitar para não duplicar.
- **O #124 não vai para produção antes do teste com decks reais** (Assinatura e Rúbrica). Mergear em `main` não é deploy, mas **não faça deploy**.
- Testes de `svgSanitize` podem dar timeout de 5 s sob carga.

## Passos (para cada PR, em ordem)
1. `gh pr view` (estado, checks), `git fetch`, diff contra `main`.
2. Se houver conflito, resolva na branch do PR (merge de `main` nela, nunca `--force`), rode `tsc` e a suíte dos dois lados, e mostre o diff da resolução.
3. Peça autorização. Com ela, mergeie; confirme `main` verde.
4. Ao final: os critérios de aceite do #122, #120 e #123 do `CHECKLIST-ACEITE.md` (Camada B) marcados com evidência; app aberto nas telas afetadas.

## Aceite
- [ ] Cada PR mergeado com autorização, na ordem, `main` verde depois de cada um.
- [ ] Conflito do teste resolvido sem apagar cobertura de nenhum dos dois lados.
- [ ] #124: comportamento `DESIGNER_BRAIN_GLOBAL=off` coberto por teste, e aviso de D15 no `.env.example`.
- [ ] Lista, arquivo a arquivo, do que foi removido (exigência da definição de pronto).

## Não fazer
Não fazer deploy, migration ou escrita em banco. Não usar `git add -A`. Não mergear em lote sem autorização por PR.
