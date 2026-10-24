# P16: Integrar o MCP (deploy e teste com agente real)

**Contrato e decisão do Gustavo (19/10): "agregar o MCP".** Antes de tudo, leia `docs/aceite/README.md`. **Tarefa no Core:** "[Designer] Deploy do backend e teste do conector MCP (checklist)" (27 a 28/10), que tem o checklist completo: **este prompt é o roteiro de execução dela.**

## O que "integrar" significa (e o que não é)
O MCP **já está construído** e em `main`: **20 ferramentas**, lotes 1A a 1C, mais a trava de rascunho no export (#118). **Não construir lotes 2 a 4** (32 ferramentas): estão fora do escopo. O que falta é **provar** que o conector funciona com um agente real.

> O manual do projeto diz que o MCP **nunca foi testado contra Claude ou ChatGPT reais**: só com o cliente oficial do SDK e testes automáticos. O primeiro teste real pode revelar ajuste de redirect ou de escopo.

## Estado da produção (dos logs de 16 a 19/10; registro "Logs de produção" no Core)
- Roda o build de **16/10** com o **MCP já ligado** ("MCP: conector montado"). Um cliente já conectou e chamou `list_brands`, `get_brand_kit`, `get_design` e `list_designs`.
- **19 migrations aplicadas**, sem pendência (inclui `add_brand_collab` e `add_brand_profile`).
- O banco está em `easypanel.landcriativa.com`; 🟡 onde o container da API roda **não está confirmado**.
- **Nenhum restart desde 16/10:** os PRs #109 a #119 (incluindo as ferramentas 1A a 1C e a trava de rascunho) **não estão em produção**. Ou seja, **o MCP em produção ainda não tem o que está em `main`.**

## Bloqueios
- **Chave Gemini nova** (a antiga foi revogada em 19/10). O MCP em si não chama o Gemini, mas o deploy leva o backend inteiro e a geração do app falha sem a chave.
- **Merge dos PRs** que forem entrar (P09). **Não levar o #124 sem o teste com decks reais.**
- **Autorização do Gustavo** para o deploy: **este prompt prepara e verifica; quem executa o deploy é o Gustavo** (credenciais e produção).

## Passos
1. **Preparar** (leitura): conferir `docs/MCP-DESIGNER.md`, `backend/.env.example` e o `Dockerfile` contra o checklist do Core. Corrigir no `.env.example` a referência a `docs/MCP-CHATGPT.md` (não existe; o certo é `docs/MCP-DESIGNER.md`) e listar `MCP_CLIENT_PRESETS` e `MCP_ALLOW_ANY_HTTPS_REDIRECT`.
2. **Antes de subir:** backup do banco; `pnpm db:status` (esperado: nenhuma pendente; o container roda `prisma migrate deploy` ao iniciar); Redis **2.6.12 ou maior** (o MCP usa `MULTI` GET+DEL, não `GETDEL`; `backend/src/mcp/store.ts`); senhas das contas do seed trocadas (pendência de 16/10; 🟡 não sei se foi feita).
3. **Variáveis:** `MCP_ENABLED=true`, `PUBLIC_BASE_URL` (https, sem caminho), `FRONTEND_URL` e `CORS_ORIGIN`, `MCP_CLIENT_PRESETS=chatgpt,claude`, **`MCP_ALLOW_LOCALHOST_REDIRECT=false`** e **`MCP_ALLOW_ANY_HTTPS_REDIRECT=false`**, `R2_*` e `CANVA_*`.
4. **Depois de subir:** `GET /.well-known/oauth-protected-resource` e `/.well-known/oauth-authorization-server` respondem; `POST /mcp` sem token dá **401 com `WWW-Authenticate`**; `/mcp/consent` abre; sem aviso de loopback no log.
5. **Conectar** (Gustavo): Claude (Configurações > Conectores > personalizado > `<PUBLIC_BASE_URL>/mcp`) ou ChatGPT (modo desenvolvedor > Conectores > Criar). **Marca de teste, não a da Gabi**; escopo mínimo primeiro, escrita depois, exportar só no segundo teste.
6. **Roteiro** (dados de teste): `list_brands`, `get_brand_kit`, `get_designer_brief` (só marcas autorizadas) → `save_presentation` com 2 slides e `approvedText` (a conferência acusa divergência) → `update_slide` e `restore_version` → `upload_asset` + `set_slide_photo` → `export_file` (PDF) + `get_export_status` → `export_to_canva` (com Canva conectado) → peça com texto "em revisão": `export_file` **recusa** → sem escopo de escrita, `save_presentation` é recusado.

## Aceite
- [ ] Backend em produção com os PRs decididos, sem erro no log.
- [ ] Um agente real (Claude ou ChatGPT) conectou e completou o roteiro; **registrado no Core com o que falhou e o ajuste feito**.
- [ ] Rollback conhecido: `MCP_ENABLED=false` e reiniciar (rotas somem, 404); revogar conexão: `DELETE /api/mcp/connections/:id`.
- [ ] A Gabi **avisada de que o MCP existe como extensão fora do contrato** (pergunta na tarefa de FUP).

## Não fazer
Não construir ferramentas novas. Não ligar `MCP_ALLOW_*_REDIRECT`. Não conectar na marca da Gabi. Não rodar deploy sem o Gustavo.
