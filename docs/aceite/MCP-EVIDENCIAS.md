# MCP: kit de execução e evidências do teste real

> Kit do Gustavo para executar, numa sessão, o roteiro de [TESTE-MCP-REAL.md](TESTE-MCP-REAL.md) (decisão de 24/10/2026: opção **(a)**, `main` inteiro com o #124, sem teste de geração). Origem: [prompts/P16-integrar-mcp.md](prompts/P16-integrar-mcp.md). Referência técnica: [../MCP-DESIGNER.md](../MCP-DESIGNER.md).
> **Preencha este arquivo durante o teste.** Nunca cole senha, token, JWT, chave ou conteúdo de `.env` aqui nem no chat do agente. Onde o documento e o código divergem, vale o código.
> Fora do teste: ferramentas novas (lotes 2 a 4), geração de imagem ou vídeo, a marca da Gabi.

Legenda: ✅ ok · ❌ falhou · ➖ não verificável (diga o motivo). Marque 🟡 HIPÓTESE no que não conseguir confirmar.

## 0. Antes de começar (5 minutos, sem decidir nada no caminho)

1. **Escolha a marca de teste** (seção 1) e anote o slug na linha abaixo.
2. Tenha à mão: o endereço da API (`PUBLIC_BASE_URL`), o endereço do front (`FRONTEND_URL`) e o acesso ao painel onde ficam as variáveis do deploy.
3. Faça as seções 2 e 3 **antes** de conectar o agente. Se um item falhar, pare e anote na seção 9.

| Dado | Valor (preencher) |
| --- | --- |
| Data e hora do teste | |
| Commit que subiu (`git log -1 --oneline`) | |
| `PUBLIC_BASE_URL` | |
| `FRONTEND_URL` | |
| Slug da marca de teste | |
| Agente usado (Claude ou ChatGPT) e versão do app | |

## 1. Dados de teste (nada é criado antes: você só escolhe e copia)

### 1.1 Como escolher a marca de teste
Abra o Designer e olhe a lista de marcas. A marca de teste precisa de **três** coisas:
1. **Não ser de cliente.** Nunca a da Gabi (`amanda-coelho` e qualquer outra dela). Serve uma marca interna da Tzolkin ou uma marca de teste que você já tenha.
2. **Você ter papel de Editor, Administrador ou Dono** nela (sem isso a escrita é recusada).
3. De preferência, **ter ficha e biblioteca de arquivos** (o MCP depende da ficha; marca sem ficha não é exercitada, ver seção 6 do checklist).

O slug é o final do endereço da marca no app (a parte que aparece na URL). Se você **não tiver nenhuma marca assim, pare**: criar marca não faz parte deste kit; é decisão sua fora do teste.
Esta é a única marca que você marca na tela de consentimento. Assim o passo 13 prova que as outras ficam de fora.

> O teste **grava peças de verdade** na marca de teste (passos 4 a 8). É esperado. Ao final, apague essas peças pelo próprio app.

### 1.2 Textos aprovados (copie exatamente)
Use dois slides. O "texto aprovado" é o que o agente deve receber do usuário e conferir contra a arte.

| Slide | Texto aprovado (o que vai em `approvedText`) |
| --- | --- |
| 1 | `Teste de conexão` e, na linha de baixo, `O Designer respondeu ao agente.` |
| 2 | `Evento de teste`, depois `Sábado, 10h`, depois `Entrada gratuita` (uma linha cada) |

- **Passo 4 (texto divergente de propósito):** a arte do slide 2 deve sair com `Sábado, 11h` no lugar de `Sábado, 10h`. O slide 1 sai correto. Esperado: o Designer acusa divergência no slide 2 e a peça fica rascunho (`DRAFT`).
- **Passo 5 (texto correto):** o agente corrige a arte do slide 2 para `Sábado, 10h` e salva de novo **na mesma peça**. Esperado: sem divergência e peça pronta (`READY`).
- Foto: o slide 2 precisa ter **um espaço de foto vazio**, como manda o contrato do `get_designer_brief`. Nenhuma foto é gerada.

## 2. Antes de subir

Tudo em PowerShell (sem `&&`). Rode na raiz do repositório `designer`.

| # | Item | Comando ou ação | Esperado | Resultado |
| --- | --- | --- | --- | --- |
| 2.1 | Árvore limpa e commit anotado | `git status --short; git log -1 --oneline` | só o que você espera; anote o commit na tabela da seção 0 | |
| 2.2 | Backup do banco | no painel do banco | backup feito (anote data e hora) | |
| 2.3 | Suíte do conector verde | `cd backend; node node_modules/typescript/bin/tsc --noEmit; node node_modules/vitest/vitest.mjs run src/__tests__/mcp` | tsc sem erro; testes todos passando (anote passou/falhou) | tsc sem erro; vitest `src/__tests__/mcp` + `mcpOwnership`: 19 arquivos, 422 testes, todos passando (25/10/2026, frontend do PR #127 não afeta). ✅ |
| 2.4 | Migrations | `cd backend; pnpm db:status` (consulta o banco do `.env` da sua máquina; só lê) | nenhuma pendente (o container roda `prisma migrate deploy` ao iniciar) | |
| 2.5 | Versão do Redis | `redis-cli -u $env:REDIS_URL INFO server \| Select-String redis_version` (ou veja no painel) | qualquer versão atual; o MCP **não** usa `GETDEL` (só `MULTI GET+DEL`) | |
| 2.6 | Senhas do seed trocadas | conferir no app | 🟡 pendência de 16/10, não se sabe se foi feita | |
| 2.7 | Variáveis no painel | ver tabela abaixo | todas conferidas | |

Variáveis (nomes conferidos em `backend/src/mcp/config.ts` e `backend/src/config.ts`):

| Variável | Valor | Conferido |
| --- | --- | --- |
| `MCP_ENABLED` | `true` | |
| `PUBLIC_BASE_URL` | `https://`, só a origem, sem caminho | |
| `FRONTEND_URL` e `CORS_ORIGIN` | origem do front | |
| `MCP_CLIENT_PRESETS` | `chatgpt,claude` (é o padrão) | |
| `MCP_ALLOW_LOCALHOST_REDIRECT` | `false` | |
| `MCP_ALLOW_ANY_HTTPS_REDIRECT` | `false` | |
| `DESIGNER_BRAIN_GLOBAL` | **sem definir** (o padrão é ligado). O mesmo valor na API e no worker. Saída de emergência: `off` nos dois e reiniciar | |
| `R2_*` e `CANVA_*` | já existentes | |

Se o módulo estiver mal configurado, ele **não monta** e o log diz o motivo (falha fechada). Não use `MCP_ALLOW_*_REDIRECT`.

## 3. Depois de subir (sem agente): 4 chamadas, sem credencial

Defina os endereços uma vez (troque pelos seus):

```powershell
$base  = "https://API-AQUI"
$front = "https://FRONT-AQUI"
```

Use `curl.exe` (no PowerShell, `curl` sozinho é outro comando).

| # | Chamada | Comando | Esperado | Resultado |
| --- | --- | --- | --- | --- |
| 3.0 | Log de inicialização | no painel | linha "MCP: conector montado"; sem erro; sem aviso de loopback | |
| 3.1 | Recurso protegido | `curl.exe -s -i "$base/.well-known/oauth-protected-resource"` | `200` e um JSON com `resource` terminando em `/mcp` | |
| 3.2 | Servidor de autorização | `curl.exe -s -i "$base/.well-known/oauth-authorization-server"` | `200`; JSON com `issuer` igual a `PUBLIC_BASE_URL`, `S256` e `registration_endpoint` | |
| 3.3 | `/mcp` sem token | veja abaixo | `401` e o cabeçalho `WWW-Authenticate: Bearer resource_metadata=...` | |
| 3.4 | Tela de consentimento | `curl.exe -s -o NUL -w '%{http_code}' "$front/mcp/consent"` | `200` (a página abre; o conteúdo sem pedido na URL não foi conferido, 🟡) | |

Comando do 3.3 (envia um JSON mínimo por pipe, sem senha nem token):

```powershell
'{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | curl.exe -s -i -X POST "$base/mcp" -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" --data-binary "@-"
```

Se 3.1 a 3.3 derem `404`, o módulo não montou: leia o log (seção 3.0) e volte à seção 2.7. Se 3.3 der `200`, **pare**: o conector está aceitando chamada sem token.

## 4. Conectar o agente (você, no app do agente)

Três conexões, uma por fase. **Escopo mínimo primeiro** (a tela de consentimento já começa em "só ver"; o quadro "Permitir exportar peças" começa desmarcado).

| Fase | Passos | Escopos a liberar na tela de consentimento |
| --- | --- | --- |
| A | 1, 2, 3, 14, 13, 12 | só leitura |
| B | 4 a 8 | leitura e escrita |
| C | 9 a 11 | exportar (marque o quadro "Permitir exportar peças"); leitura junto |

- **Claude:** Configurações, Conectores, personalizado, endereço `<PUBLIC_BASE_URL>/mcp` (exemplo: `https://api.exemplo.com/mcp`, sem `https://` repetido).
- **ChatGPT:** modo desenvolvedor, Conectores, Criar, mesmo endereço.
- Na tela de consentimento confira: **quem pede** (nome do cliente e host de retorno: `claude.ai` ou `chatgpt.com`) e **o que será liberado**. Marque **somente a marca de teste**. Anote o que aparecer.
- Para trocar de fase, **remova o conector no app do agente e adicione de novo** (🟡 não se sabe se o agente deixa ampliar escopo sem refazer a conexão; se ele permitir, anote). Remover o conector no agente não revoga no servidor: ao fim do teste revogue pela seção 8.
- O que falhar na conexão (redirect, escopo, registro do cliente) é evidência: copie a mensagem exata na seção 9. O manual admite que nunca houve teste contra agente real.

## 5. Prompt pronto para colar no agente

Troque os campos entre `{{ }}` e cole **uma fase por vez** (uma conversa nova por fase). Não apague nenhuma regra.

````text
Você vai executar um roteiro de teste do conector MCP "Designer IA". Este é um TESTE de conexão, não um trabalho de design. Siga EXATAMENTE as regras abaixo.

REGRAS (valem sempre)
1. Marca de teste: use SOMENTE a marca com slug "{{SLUG_DA_MARCA_DE_TESTE}}". Nunca use outra marca. Se list_brands mostrar uma marca de cliente ou o slug amanda-coelho, NÃO a use e me avise. Nunca trabalhe na marca da Gabi.
2. Senha: NUNCA digite, peça nem aceite senha, token ou chave. Se algum link do Designer pedir login, PARE e me diga; eu faço o login. Não tente abrir o editor para "ver".
3. Imagem: NÃO gere imagem, foto, pessoa nem vídeo (nada de Nano Banana, DALL-E ou editor de vídeo). Use só arquivos reais que o próprio Designer devolver. Onde faltar foto, deixe o espaço de foto vazio.
4. Use SOMENTE as ferramentas do conector Designer IA. Não invente ferramenta nem passo. Não passe confirmarRascunho como verdadeiro.
5. Texto aprovado vale literalmente. A ÚNICA exceção é o passo 4, onde eu mando divergir de propósito.
6. UM passo de cada vez. Depois de cada passo, escreva uma linha: "Passo N | ferramenta | OK ou FALHOU | resumo da resposta". Depois siga para o próximo passo.
7. SE QUALQUER CHAMADA FALHAR (erro, recusa fora do esperado, resposta vazia, link que não abre): PARE na hora. Copie a mensagem de erro EXATAMENTE como veio, sem resumir nem traduzir, diga qual ferramenta e com qual entrada, e não tente corrigir sozinho nem repetir mais de uma vez. Espere minha resposta.
8. Quando uma recusa for o resultado ESPERADO do passo (passos 11, 12 e 13), isso é OK: copie a mensagem exata da recusa.
9. Não cole no relatório token, URL de login nem o conteúdo do HTML dos slides; resuma.

DADOS DE TESTE
- Slide 1, texto aprovado: "Teste de conexão" / "O Designer respondeu ao agente."
- Slide 2, texto aprovado: "Evento de teste" / "Sábado, 10h" / "Entrada gratuita"
- O slide 2 deve ter um espaço de foto vazio, conforme o contrato do get_designer_brief.

FASE A (conexão só de leitura)
1. list_brands. Esperado: só a marca de teste (e nenhuma outra).
2. get_brand_kit com o slug. Esperado: cores, fontes, logo.
3. get_designer_brief com o slug (format "presentation"). Esperado: regras, canvas, contrato do HTML, fontes, paleta e arquivos reais.
14. get_integrations_status. Esperado: sim ou não para Canva, Drive e Asana, sem nenhum token.
13. get_design com brandSlug "marca-que-nao-existe" e um postId qualquer no formato uuid (por exemplo 00000000-0000-4000-8000-000000000000). Esperado: RECUSA "Marca indisponível para esta conexão".
12. save_presentation na marca de teste com UM slide mínimo (um título curto). Esperado: RECUSA por falta de escopo de escrita (erro 403 insufficient_scope). Se a peça for criada, PARE e me avise: é falha de segurança.

FASE B (conexão com escrita)
4. Desenhe 2 slides em HTML/CSS seguindo o contrato do get_designer_brief e chame save_presentation com approvedText de cada slide. DIVERGÊNCIA DE PROPÓSITO (única exceção à regra 5): no slide 2, escreva na arte "Sábado, 11h" no lugar de "Sábado, 10h"; o slide 1 sai correto. Esperado: issues apontando o slide 2, status DRAFT, created true. Anote o postId.
5. Corrija o slide 2 para "Sábado, 10h" e chame save_presentation de novo COM o postId do passo 4. Esperado: sem issues, status READY, created false, versionId preenchido.
6. update_slide no slide 1 trocando só a cor de fundo (texto intacto, com approvedText). Esperado: slide muda e a resposta traz versionNote. Depois list_versions e anote o versionId mais antigo (o de antes do passo 6).
7. restore_version com esse versionId. Esperado: a peça volta ao estado de antes (confira com get_design) e restoredVersionId igual ao pedido.
8. list_assets (imagesOnly) e anote um arquivo real; get_photo_slots do slide 2; set_slide_photo com esse arquivo no espaço vazio. Esperado: foto no slide 2. Se a marca não tiver arquivo real, diga isso e NÃO suba imagem gerada: nesse caso, para testar upload_asset, envie um SVG simples e seu (um retângulo de uma cor), anote o resultado e siga.

FASE C (conexão com exportar)
9. export_file da peça de teste, formato pdf; depois get_export_status até "done" (no máximo 6 consultas, uma a cada 15 segundos). Esperado: downloadUrl. Não repita o pedido enquanto estiver em andamento.
10. Só se o passo 14 mostrou Canva conectado: export_to_canva (mode "pptx") e get_canva_export_status. Esperado: link do design. Se o Canva não estiver conectado, escreva "não verificável: Canva não conectado" e siga.
11. export_file de uma peça com texto em revisão (eu lhe passo o postId: {{POSTID_COM_TEXTO_EM_REVISAO_OU_NENHUM}}). Esperado: RECUSA com o motivo do rascunho. Se eu não passei postId, escreva "não verificável" e siga.

AO FINAL
Entregue uma tabela com as colunas: passo | ferramenta | entrada usada (resumida) | resposta obtida (resumida; mensagens de erro e de recusa EXATAS) | OK ou FALHOU. Depois liste todas as falhas, com a mensagem exata. Não mande nada além disso.

Execute somente a FASE {{A, B ou C}}. Comece pelo passo 1 da fase.
````

Notas para você (não vão no prompt):
- Na Fase B, o passo 8 só prova `upload_asset` se a marca não tiver arquivos reais; se tiver, `upload_asset` fica ➖ não verificado (o roteiro original junta os dois; registre o que ocorreu).
- O passo 11 precisa de um deck **já existente** com texto "em revisão" (gerado pelo app). Peça salva pelo MCP nunca carrega essa trava (o `save_presentation` não grava `content.finalGate`). Sem esse deck, o passo 11 é ➖; a prova que existe é só o teste automático `lote1cTools.test.ts`. Não use para isso a peça do passo 4 e não a atualize por `save_presentation` depois (apagaria a trava).
- Se o agente se recusar a divergir no passo 4, é o comportamento correto de sempre; insista uma vez, citando que é o teste autorizado. Se ele continuar recusando, anote e use ➖.

## 6. Tabela de evidências (14 passos)

Preencha "Resposta obtida" com a mensagem exata (cole o texto, sem token). "Ajuste feito" é o que você mudou para destravar (variável, escopo, outro comando).

| # | Ferramenta | Entrada usada (dado de teste) | Resposta esperada | Resposta obtida | ok? | Ajuste feito |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `list_brands` | sem argumentos; conexão com só a marca de teste | só a marca de teste, com slug, nome e papel | Devolveu 5 marcas com slug, nome e papel: amanda-coelho (EDITOR), assinatura (OWNER), farmacia-indiana (EDITOR), fernanda-coelho (EDITOR), tzolkin (EDITOR). | ⚠️ funciona, mas o esperado era só a marca de teste | A conexão libera **amanda-coelho** (marca da Gabi): ver seção 9. |
| 2 | `get_brand_kit` | `brandSlug` = marca de teste | cores, fontes, logo, diretrizes | `brandSlug: tzolkin`: 5 cores (`#000000`, `#FFFFFF`, `#CCCCCC`, `#333333`, `#EEEEEE`), fontes Montserrat e Inter, `logoUrl`, diretrizes (JSON), visual (vibe, paleta aprovada, fotos, ousadia). | ✅ | |
| 3 | `get_designer_brief` | `brandSlug`, `format`: `presentation` | regras da marca e do estúdio, canvas, contrato do HTML, fontes, paleta, arquivos reais | `brandSlug: tzolkin`, `pageCount: 2`: `rules`, canvas 1920×1080 (16:9), `htmlContract`, `textRule`, `photoSlotRule`, `checklist`, paleta, fontes (Montserrat/Inter), logo e 1 asset. `brainActive: true`, `pending: []`. | ⚠️ funciona, mas `rules` traz instruções que contradizem o resto do brief: seção 9 | |
| 4 | `save_presentation` | 2 slides com `approvedText` da seção 1.2; slide 2 com `Sábado, 11h` de propósito | `created: true`, `issues` no slide 2, `status: DRAFT`, `postId` e `editorUrl` | Marca `tzolkin`, 2 slides com `approvedText`; slide 2 com "Sábado, 11h". Resposta: `created: true`, `ok: false`, `status: DRAFT`, `versionId: null`, `postId` 7cf38589-4bee-4902-8be1-dd5d3674bcb7, `issues` no slide 2: crítica "faltam \"10h\"" e maior "texto fora do aprovado: \"11h\"". | ✅ | |
| 5 | `save_presentation` | `postId` do passo 4; slide 2 corrigido para `Sábado, 10h` | `created: false`, sem `issues`, `status: READY`, `versionId` preenchido | Mesmo `postId`, slide 2 com "Sábado, 10h": `created: false`, `ok: true`, `issues: []`, `status: READY`, `versionId: ace45a18-e752-416e-99f1-48826de36764`. | ✅ | |
| 6 | `update_slide` + `list_versions` | `postId`, `slide: 1`, só a cor de fundo, `approvedText` do slide 1 | slide muda; `versionNote`; nova versão em `list_versions` | Slide 1, só o fundo (`#0a0a0a` para `#333333`), `approvedText` do slide 1: `ok: true`, `issues: []`, `versionNote` ("A versão anterior ficou guardada..."), sem `versionId`. `list_versions` mostrou a versão nova `f4fc7cf2-2415-4c40-b6b0-28eb48bec793` ("Antes da atualização do slide 1 pelo agente"). | ✅ | |
| 7 | `restore_version` | `postId` e o `versionId` de antes do passo 6 | `restoredVersionId` igual ao pedido; peça volta ao estado anterior (conferir com `get_design`) | `versionId` f4fc7cf2-…: `restoredVersionId` igual ao pedido. `get_design` com `includeSource` confirmou o fundo do slide 1 de volta a `#0a0a0a`. | ✅ | |
| 8 | `upload_asset` + `get_photo_slots` + `set_slide_photo` | arquivo real de `list_assets` (ou SVG simples seu); `slide: 2` | foto no espaço do slide 2 | `list_assets` devolveu 1 arquivo real (captura de tela PNG). `get_photo_slots` slide 2: espaço "1" vazio. `set_slide_photo` com a URL exata: `hasPhoto: true`, `framing: {mode: "auto", faceVisible: null}`. `upload_asset` **não** foi exercitado (a marca tinha arquivo real). | ✅ parcial (➖ upload_asset) | |
| 9 | `export_file` (PDF) + `get_export_status` | `postId`, `format: pdf` | `jobId`; depois `done` com `downloadUrl` que abre | `pdf`: job `35` `queued`; ao consultar, `done` 2/2 com `downloadUrl`. O link abriu: HTTP 200, `application/pdf`, 40.766 bytes. | ✅ | |
| 10 | `export_to_canva` + `get_canva_export_status` | `postId`, `mode: pptx` (Canva conectado) | design criado e link; ou ➖ se Canva desconectado | `mode: pptx`: job `6` `queued`; ao consultar, `failed` 2/2, `designUrl: null`. Mensagem exata: "A exportação falhou no servidor. Tente de novo; se repetir, avise o usuário." Não repeti (cada tentativa pode criar design no Canva). | ❌ | Provável causa: acesso do Canva vencido (`expiresAt` 2026-07-22), 🟡 HIPÓTESE não confirmada: a mensagem não diz o motivo. |
| 11 | `export_file` | `postId` de deck **existente** com texto em revisão | recusa com o motivo (`draft_not_final`); ou ➖ se não houver esse deck | Varredura só de leitura nos 24 posts mais recentes de cada marca: nenhum deck com `content.finalGate.blocking`. | ➖ | Só se prova com um deck gerado pelo app com texto em revisão; coberto pelo teste automático `lote1cTools.test.ts`. |
| 12 | `save_presentation` | conexão **só leitura**, 1 slide mínimo | recusa HTTP 403 `insufficient_scope`; nenhuma peça criada | Não executado: exige uma conexão só de leitura, e esta conexão tem escrita. | ➖ | Refazer a conexão (Fase A) só com leitura. |
| 13 | `get_design` | `brandSlug` fora da conexão (`marca-que-nao-existe`), `postId` uuid qualquer | "Marca indisponível para esta conexão..."; nada vazado | Com `marca-que-nao-existe` e postId `00000000-0000-4000-8000-000000000000`: "Marca indisponível para esta conexão. Use list_brands para ver as marcas liberadas." | ✅ parcial | Só marca inexistente. Marca **existente fora da conexão** não é testável: esta conexão libera todas as 5. |
| 14 | `get_integrations_status` | sem argumentos | sim/não por integração; **nenhum token** na resposta | `{"canva":{"connected":true,"expiresAt":"2026-07-22T15:27:32.452Z"},"google":{"connected":true},"asana":{"connected":true}}`. Nenhum token na resposta. | ✅ (sem token) ⚠️ Canva | `expiresAt` já passou (hoje é 25/10/2026): ver seção 9. |

Resultado geral (25/10/2026, agente Claude, marca `tzolkin`, sem tocar em outra marca): 6 ok sem ressalva (2, 4, 5, 6, 7, 9) · 5 ok com ressalva (1, 3, 8 parcial, 13 parcial, 14) · 1 falhou (10, Canva) · 2 não verificáveis (11, 12). Esta conexão tinha escrita e exportação nas 5 marcas; por isso 12 e 13 (marca existente fora da conexão) ficam abertos até refazer a conexão.

## 7. O que este teste NÃO prova (diga no relatório)
- Não mede a qualidade visual da arte, nem compara com o lote 1 da Gabi.
- Não exercita marca sem ficha, nem a geração do app (Fábrica). A geração do app continua dependendo da chave Gemini nova.
- O cérebro global (#124) sobe sem teste de geração: a saída de emergência é `DESIGNER_BRAIN_GLOBAL=off` na API e no worker.
- Passos marcados ➖ continuam abertos e vão para o Core como pendência.

## 8. Rollback e revogação
- **Desligar o conector:** `MCP_ENABLED=false` no painel e reiniciar. As rotas somem (404). Confira:

```powershell
curl.exe -s -o NUL -w '%{http_code}' "$base/.well-known/oauth-authorization-server"
```

Esperado: `404`. Para religar, `MCP_ENABLED=true` e reiniciar.

- **Reverter o cérebro global:** `DESIGNER_BRAIN_GLOBAL=off` **na API e no worker** e reiniciar os dois.
- **Revogar uma conexão no servidor:** `DELETE /api/mcp/connections/:id` com o JWT do seu login no app (é o valor de `auth_token` do navegador; guarde numa variável só na sua sessão, **não cole em lugar nenhum**):

```powershell
$env:DESIGNER_JWT = Read-Host "Cole o token (fica só nesta sessão do PowerShell)"
curl.exe -s "$base/api/mcp/connections" -H "Authorization: Bearer $env:DESIGNER_JWT"
curl.exe -s -X DELETE "$base/api/mcp/connections/ID-DA-CONEXAO" -H "Authorization: Bearer $env:DESIGNER_JWT"
Remove-Item Env:\DESIGNER_JWT
```

O primeiro comando lista as conexões (cada uma com seu `id`); o segundo revoga a escolhida. Esperado: a lista sem a conexão revogada e o agente passando a receber erro de autenticação.
- Remova também o conector nos aplicativos do agente.
- **Limpeza:** apague, pelo app, as peças de teste criadas na marca de teste.

| Item | Feito em | Evidência |
| --- | --- | --- |
| Conexões revogadas | | |
| Peças de teste apagadas | | |
| `MCP_ENABLED` voltou ao valor desejado | | |

## 9. Falhas e ajustes (uma linha por falha)

| Fase e passo | Ferramenta | Mensagem exata | Ajuste feito | Resolvido? |
| --- | --- | --- | --- | --- |
| Fase A, passo 1 | `list_brands` | (sem erro) a conexão devolve 5 marcas, incluindo `amanda-coelho` (EDITOR) | Não alterado. Refazer a conexão marcando **só a marca de teste**; sem isso o passo 13 de marca existente e a regra "nunca a da Gabi" não se cumprem. | ❌ aberto |
| Fase A, passo 14 | `get_integrations_status` | `canva.connected: true` com `expiresAt: 2026-07-22T15:27:32.452Z` (data já vencida) | Não alterado. Reconectar o Canva em Configurações > Integrações antes do passo 10; o "conectado" não prova token válido. 🟡 HIPÓTESE: o passo 10 falha até a reconexão (não testado). | ❌ aberto |
| Fase A, passo 3 | `get_designer_brief` | (sem erro) `rules` da marca tzolkin mistura instruções antigas com as globais: manda usar **fotos do Unsplash** (regra 4) e **Space Grotesk** (regra 7) e cores `#0A0E1A`/`#7C5CFF`, enquanto `htmlContract` e `photoSlotRule` proíbem banco de imagem e o kit/fontes/paleta da marca são Montserrat, Inter e preto e branco | Não alterado. O texto parece vir das diretrizes antigas da marca (`guidelines`/instruções do agente) e deve ser revisto na marca ou no brief. | ❌ aberto |
| Fase A, passo 12 | `save_presentation` | não executado | Exige conexão só de leitura; a conexão atual não foi feita para isso. | ➖ não verificável |
| Fase C, passo 10 | `export_to_canva` / `get_canva_export_status` | "A exportação falhou no servidor. Tente de novo; se repetir, avise o usuário." | Não alterado. A mensagem é genérica e não diz que o Canva precisa ser reconectado: melhorar o texto do erro quando o token do Canva está vencido. | ❌ aberto |
| Limpeza | (app) | peça de teste `7cf38589-4bee-4902-8be1-dd5d3674bcb7` ("[TESTE MCP] Roteiro 25/10 (apagar)", marca `tzolkin`) criada nos passos 4 a 9 | Apagar pelo app (o MCP não tem ferramenta de apagar). | ⏳ pendente |

## 10. Fechar no Core
Registre no Core (tenant "Assinatura Marca Própria", contratação "Designer", tarefa "[Designer] Deploy do backend e teste do conector MCP (checklist)"): data e commit, o resultado geral da seção 6, as falhas da seção 9 com o ajuste, e os passos ➖ com o motivo. O Core cria o registro como "planejado": para registrar o que já ocorreu, faça uma segunda chamada com `status: done` e `ends_at`.
Depois marque `[x]` em [TESTE-MCP-REAL.md](TESTE-MCP-REAL.md) **só** com a evidência desta página.
