# Designer IA como servidor MCP (qualquer agente)

> **Status:** servidor OAuth 2.1 + transporte MCP + autorização por marca + **6 ferramentas** (5 de leitura, 1 de escrita),
> agnóstico de agente. **Não verificado contra nenhum agente real** (ChatGPT, Claude, Gemini Spark): tudo foi provado com o
> cliente oficial do SDK do MCP e com testes automatizados (ver [Verificação](#verificação)). A tela de consentimento do
> frontend e o "modo MCP" da Fábrica (preview sem chat) são a próxima etapa.

O agente (ChatGPT, Claude, Gemini Spark... na assinatura do próprio usuário) é o **diretor de arte e o artista**: lê o brief,
escreve cada slide em HTML/CSS e envia. O Designer entrega o contexto da marca, sanitiza, **confere o texto contra o aprovado**,
embute as fontes próprias, guarda a peça e a mostra no editor. A geração custosa roda na assinatura do usuário, não na chave
da plataforma. O código vive em `backend/src/mcp/` e só é montado com `MCP_ENABLED=true`.

## Agentes suportados

O servidor fala o OAuth 2.1 padrão do MCP (RFC 9728, 8414, 7591, PKCE S256), então qualquer cliente que o implemente conecta.
O que muda de um agente para outro é só a `redirect_uri`, que precisa estar na allowlist (o `/register` é público):

| Agente | Redirect | Como liberar |
|---|---|---|
| **ChatGPT** | `https://chatgpt.com/connector_platform_oauth_redirect` e `…/connector/oauth/{id}` | preset `chatgpt` (padrão) |
| **Claude** (claude.ai e app) | `https://claude.ai/api/mcp/auth_callback` (pode migrar para `claude.com`) | preset `claude` (padrão; os dois domínios) |
| **CLIs** (Claude Code, Codex, Gemini CLI) | loopback `http://127.0.0.1:<porta>/…` | `MCP_ALLOW_LOCALHOST_REDIRECT=true` |
| **Gemini Spark** | a documentação pública não fixa o valor; o Spark exige OAuth 2.1 com DCR e PKCE | `MCP_ALLOWED_REDIRECT_URIS` com o valor que o Spark enviar (aparece no log `mcp.register_refused`); em último caso o **modo aberto** |

**Modo aberto (`MCP_ALLOW_ANY_HTTPS_REDIRECT=true`).** Aceita qualquer redirect https (forma canônica, sem query, fora de
loopback e de IP literal). Troca a allowlist por confiança na tela de consentimento, onde o usuário vê o nome do cliente e
o host de retorno. **Risco:** quem tiver o link de consentimento pode mandá-lo a um membro da equipe (consent phishing).
Ligue só enquanto o redirect do agente é desconhecido e desligue depois de fixá-lo em `MCP_ALLOWED_REDIRECT_URIS`.
O que o modo aberto NÃO afrouxa: cliente continua público com PKCE S256, código de uso único, consentimento autenticado,
escopo reduzível e marcas escolhidas pelo usuário.

## Como conectar no ChatGPT

1. Suba a API com o módulo ligado (veja [Variáveis de ambiente](#variáveis-de-ambiente)); ela precisa estar
   acessível por **HTTPS público** — o ChatGPT chama de servidor para servidor.
2. No ChatGPT: ative o **modo desenvolvedor** → **Conectores** → **Criar**. (Os nomes dos menus mudam conforme o plano
   e a versão do ChatGPT; confira a documentação atual da OpenAI.)
3. **URL do servidor MCP:** `https://<PUBLIC_BASE_URL>/mcp` (ex.: `https://api.exemplo.com/mcp`). É essa URL que o ChatGPT deve enviar
   como `resource` no OAuth, e é ela (sempre a forma canônica `<origem>/mcp`) que vira a audiência dos tokens. Também
   aceitamos a origem do servidor sem o `/mcp` como apelido do mesmo recurso (alguns clientes a usam como identificador),
   e uma barra final; qualquer outro `resource` é recusado com `invalid_target`.
4. **Autenticação:** OAuth. O ChatGPT descobre o resto sozinho (metadados `.well-known`), registra-se por DCR e abre o
   navegador na tela de consentimento do Designer (`FRONTEND_URL/mcp/consent?request=…`). O usuário faz login no app,
   escolhe as marcas e aprova.
5. Depois de conectado, o modelo enxerga `list_brands` e `get_brand_kit`.

> Enquanto a tela `/mcp/consent` do frontend não existir (próxima etapa), o consentimento pode ser feito direto pela API —
> veja o passo a passo do Inspector abaixo.

## Como conectar no Claude, no Gemini Spark e em CLIs

**Claude (claude.ai / app).** Configurações → Conectores → adicionar conector personalizado, com a URL
`https://<PUBLIC_BASE_URL>/mcp`. O Claude faz DCR e PKCE; o redirect `claude.ai/api/mcp/auth_callback` já vem no preset.
Se o conector for removido no servidor, o `/token` devolve `invalid_client` e o Claude se registra de novo.

**Gemini Spark.** Em "Aplicativos conectados", adicionar um app personalizado com a mesma URL. O Spark exige a cadeia
OAuth 2.1 completa (descoberta, DCR, PKCE) e o transporte Streamable HTTP, que é o que este servidor expõe. Como a
`redirect_uri` do Spark não está documentada publicamente, o primeiro registro será recusado e o log `mcp.register_refused`
mostrará o **host** de retorno; use esse valor em `MCP_ALLOWED_REDIRECT_URIS`. Depende de plano e região do Gemini.

**CLIs (Claude Code, Codex, Gemini CLI).** Usam redirect de loopback: ligue `MCP_ALLOW_LOCALHOST_REDIRECT=true` no ambiente
onde o servidor roda para esse uso (em produção o aviso de log lembra que é só para desenvolvimento).

> Estas três rotas **não foram exercitadas contra o agente real**. Os passos seguem a documentação pública de cada um;
> o que está provado é o protocolo, com o cliente oficial do SDK.

## Variáveis de ambiente

| Variável | Padrão | O que faz |
|---|---|---|
| `MCP_ENABLED` | `false` | Liga o módulo. Qualquer valor diferente de `true` deixa **todas** as rotas do conector inexistentes (404). |
| `PUBLIC_BASE_URL` | — (em dev: `http://localhost:<PORT>`) | Origem pública da API, **https e sem path** (`http` só em localhost). `issuer` = esta origem; `resource` = `<origem>/mcp`. **Nunca** derivados do header `Host`. Em produção, se faltar (ou for inválida) o módulo **não monta** e loga o motivo. |
| `FRONTEND_URL` | primeiro valor de `CORS_ORIGIN` | Origem do frontend. O `/authorize` redireciona o navegador para `<FRONTEND_URL>/mcp/consent?request=<id>`. |
| `MCP_CLIENT_PRESETS` | `chatgpt,claude` | Presets de agente cujos redirects valem (ver [Agentes suportados](#agentes-suportados)). Nome desconhecido = erro de configuração (o módulo não monta). |
| `MCP_ALLOWED_REDIRECT_URIS` | — (usa os presets) | `redirect_uri`s aceitas **no registro** (DCR), separadas por vírgula. Match exato; o único curinga é o segmento `{id}`. Definir **substitui** os presets. |
| `MCP_ALLOW_ANY_HTTPS_REDIRECT` | `false` | **Modo aberto** para agentes sem redirect conhecido (ver acima). |
| `MCP_ALLOW_LOCALHOST_REDIRECT` | `false` | Aceita redirect `http://<loopback>:<porta>/…` (loopback = `localhost`, `127.0.0.1` ou `[::1]`) e Origin de loopback. **Só para testar com o Inspector.** Loga aviso se ligado em produção. |
| `MCP_ALLOWED_ORIGINS` | `PUBLIC_BASE_URL` + `FRONTEND_URL` | Origens (`https://host[:porta]`) aceitas no header `Origin` de `/mcp`. |
| `MCP_MAX_CLIENTS` | `500` | Teto de clientes DCR ativos ao mesmo tempo. |

Padrão (preset `chatgpt`; o `claude` acrescenta `https://claude.ai/api/mcp/auth_callback` e o equivalente em `claude.com`):

```
https://chatgpt.com/connector_platform_oauth_redirect     # com issuer identification (RFC 9207)
https://chatgpt.com/connector/oauth/{id}                  # legado, por callback_id
```

`{id}` casa **um** segmento `[A-Za-z0-9_-]{1,128}`. Qualquer outra diferença (porta, query, barra final, subdomínio,
`http`, `..`, `%2f`) é recusada. A URI candidata também precisa estar em forma canônica (`new URL(x).href === x`).

Requisito de infra: **Redis ≥ 6.2** (o módulo usa `GETDEL`). Reaproveita o Redis que o app já tem (`REDIS_URL`).

## Fluxo OAuth (o que acontece de fato)

```
ChatGPT                     API (/mcp, /authorize, /token…)                 Frontend            Usuário
   │ POST /mcp ─────────────────► 401 WWW-Authenticate: Bearer resource_metadata=…, scope="designer.read"
   │ GET /.well-known/oauth-protected-resource/mcp  → { resource, authorization_servers, scopes_supported }
   │ GET /.well-known/oauth-authorization-server    → { issuer, S256, iss-supported, … }
   │ POST /register (DCR) ───────► valida redirect_uri na allowlist, só cliente público
   │ navegador → GET /authorize?…&code_challenge=…(S256)&resource=… ─► guarda o pedido, 302 ──► /mcp/consent?request=ID
   │                                                                                            │ login (JWT do app)
   │                                         GET  /api/mcp/consent/ID  (JWT) ◄──────────────────┤ mostra quem pede/escopos/marcas
   │                                         POST /api/mcp/consent/ID  (JWT) {approve, brandSlugs} ◄ aprova
   │                                   ──► { redirectUrl: <redirect_uri>?code=…&state=…&iss=… }
   │ ◄── navegador redireciona para o ChatGPT com o código
   │ POST /token (code + code_verifier + resource) ► access (1h) + refresh (30d, rotativo)
   │ POST /mcp  Authorization: Bearer <access>      ► tools/list, tools/call
```

Endpoints (todos na raiz do host, como o OAuth exige):

| Endpoint | Função |
|---|---|
| `GET /.well-known/oauth-protected-resource` e `/…/mcp` | RFC 9728 — mesmo conteúdo nas duas URLs. O header do 401 aponta a segunda (RFC-correta para um recurso com path). |
| `GET /.well-known/oauth-authorization-server` | RFC 8414. `issuer` sem barra final, `code_challenge_methods_supported: ["S256"]`, `token_endpoint_auth_methods_supported: ["none"]`, `authorization_response_iss_parameter_supported: true`, `registration_endpoint`, `revocation_endpoint`, `scopes_supported`. |
| `POST /register` | DCR (RFC 7591). |
| `GET /authorize` | Valida e **estaciona** o pedido; não autentica nem emite código. |
| `POST /token` | `authorization_code` e `refresh_token` apenas. |
| `POST /revoke` | RFC 7009. Revogar qualquer token derruba a conexão inteira. |
| `POST /mcp` | Streamable HTTP, **stateless**. `GET`/`DELETE` → 405. |

API do usuário (JWT do app no header `Authorization`, como o resto da API; respostas no envelope `{ data }`):

| Endpoint | Função |
|---|---|
| `GET /api/mcp/consent/:requestId` | O que a tela mostra. `404` se o pedido expirou/não existe. |
| `POST /api/mcp/consent/:requestId` | A decisão. Corpo: `{ decision: "approve"\|"deny", brandSlugs?: string[], allBrands?: boolean, scopes?: string[] }`. Devolve `{ data: { redirectUrl } }` para o frontend redirecionar o navegador. |
| `GET /api/mcp/connections` | Conexões ativas do usuário (cliente, escopos, marcas atuais). |
| `DELETE /api/mcp/connections/:id` | Revoga a conexão. |

Contrato do `GET /consent/:id` (para a tela da próxima etapa):

```jsonc
{ "data": {
    "requestId": "…",
    "client": { "id": "…", "name": "ChatGPT", "redirectHost": "chatgpt.com" }, // name JÁ ESCAPADO p/ HTML — não escape de novo
    "scopes": ["designer.read", "designer.write"],
    "expiresInSeconds": 540,
    "brands": [{ "slug": "marca-a", "name": "Marca A", "role": "EDITOR",
                 "canRead": true, "canWrite": true, "selectable": true }]
} }
```

Regras do `POST` (aprovar): ao menos uma marca (`brandSlugs`) **ou** `allBrands: true` — nunca os dois; o usuário só
pode **reduzir** os escopos pedidos **ou liberar outro escopo suportado** que o cliente não pediu (RFC 6749 §3.3; o
token informa o que valeu — é a saída para clientes que conectam só por URL e pedem leitura); escopo desconhecido é
`400`; leitura exige ser **membro** (qualquer papel) de cada marca
escolhida; escrita (`designer.write`/`designer.edit_all`) exige papel **EDITOR, ADMIN ou OWNER** em cada uma. Em
`allBrands` não há lista a validar: o consentimento só exige que o papel do usuário sirva para o escopo em alguma marca,
e cada chamada filtra pelo papel de agora. Falha de validação (`403`/`400`) **não** consome o pedido — o usuário pode
corrigir e tentar de novo. A decisão que passa consome o pedido (uso único, atômico). `deny` devolve
`redirectUrl` com `error=access_denied`.

## Escopos

| Escopo | Dá direito a | Papel mínimo na marca |
|---|---|---|
| `designer.read` | listar e ler | qualquer membro (VIEWER+) |
| `designer.write` | criar peças e atualizar **as que a própria conexão criou** (e **inclui** leitura) | EDITOR+ |
| `designer.edit_all` | além disso, **sobrescrever qualquer apresentação ou carrossel** das marcas autorizadas (e **inclui** escrita e leitura) | EDITOR+ |

`designer.edit_all` é opcional e só existe se o cliente o pedir no `/authorize`; o usuário pode rebaixá-lo na tela para
`designer.write` ou leitura. Antes de sobrescrever uma peça que não é da conexão, `save_presentation` congela a versão
anterior (`snapshotPost`, origem `AI`), que o usuário restaura no histórico da peça. Não apaga nada, não toca em peças
que não sejam apresentação/carrossel e o papel do usuário na marca (EDITOR+, conferido **a cada chamada**) é o teto:
rebaixar o usuário a VIEWER derruba a edição na chamada seguinte.

### Modo de marcas: escolhidas × todas

O consentimento guarda no token **um modo**, não só uma lista:

| Modo | Token guarda | Conjunto de marcas a cada chamada |
|---|---|---|
| `selected` (padrão) | `brandIds` | `brandIds` ∩ associação atual |
| `all` ("todas as minhas marcas") | `brandMode: "all"` (sem lista) | toda a associação atual do usuário, filtrada pelo papel que o escopo exige |

No modo `all`, marcas em que o usuário entra depois passam a valer e as que ele perde deixam de valer, sem reconectar.
Famílias antigas, sem `brandMode`, são `selected`. Um token em `selected` nunca enxerga marca fora da sua lista.

Sem `scope` no `/authorize` (ausente, vazio ou só `offline_access`), o pedido cobre **todos** os escopos suportados (é o que a
spec MCP manda sem `scope`; o Claude, ao conectar por URL, não manda). Isso não amplia nada: o consentimento só deixa o
usuário **reduzir** e a tela começa em "só ver". `offline_access` é ignorado — sempre emitimos refresh token —, mas qualquer outro escopo desconhecido é
`invalid_scope`. O `state` aceita até 512 caracteres. A regra de papel é a mesma de
`middleware/brandAccess.ts` (`ANY_MEMBER` / `EDITORS`) — o conector nunca concede mais do que o app web.

## Ferramentas

Todas em `backend/src/mcp/tools/`, descrições em pt-BR, nomes em inglês `snake_case`. Cada uma declara `annotations`
(`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) e `securitySchemes` (`oauth2` + escopo) — no
topo do descritor **e** em `_meta.securitySchemes`, como pede o Apps SDK.

| Ferramenta | Escopo | O que faz |
|---|---|---|
| `list_brands` | `designer.read` | Marcas que a conexão pode acessar (slug, nome, papel) = marcas aprovadas no token ∩ associação atual. |
| `get_brand_kit(brandSlug)` | `designer.read` | Cores, fontes, logo, diretrizes (até 4.000 caracteres, com aviso de corte) e preferências visuais. Não devolve o prompt interno do agente. |
| `get_designer_brief(brandSlug, format?, aspectRatio?, pageCount?)` | `designer.read` | **O que o agente precisa para desenhar**: regras da marca e do estúdio (cérebro em camadas: fidelidade ao texto, foto real, identidade, proibições), canvas, contrato do HTML, fontes próprias com os pesos disponíveis, paleta, logo e a lista de arquivos reais (nunca imagens geradas por IA). |
| `list_designs(brandSlug, limit?)` | `designer.read` | Peças da marca (mais recentes primeiro) com link do editor. |
| `get_design(brandSlug, postId, includeSource?)` | `designer.read` | Texto visível por slide e, com `includeSource`, o HTML/CSS (para continuar ou ajustar). |
| `save_presentation(brandSlug, slides[], …, postId?)` | `designer.write` | Salva uma peça que o agente desenhou: sanitiza o HTML, confere o texto de cada slide contra o `approvedText`, normaliza as áreas de foto, embute as fontes próprias e cria a peça no editor. Devolve `issues` por slide. Com `postId` atualiza **só** a peça que o mesmo usuário criou por MCP — ou, com `designer.edit_all`, qualquer apresentação/carrossel da marca (congelando a versão anterior antes). |
| `get_brand_profile(brandSlug)` | `designer.read` | A ficha do Cérebro (essência, tom, paleta com função, tipografia, logos, direção de arte, foto real, o que nunca fazer) e o que falta preencher. `derived: true` quando a marca ainda não salvou ficha. |
| `list_assets(brandSlug, query?, tag?, source?, imagesOnly?, limit?)` | `designer.read` | Arquivos reais da biblioteca (e, num collab, os do projeto-base) com a URL exata. **Nunca** devolve imagem gerada por IA. |
| `list_versions(brandSlug, postId, limit?)` | `designer.read` | Histórico da peça (id, rótulo, origem, nº de slides). Sem o conteúdo da versão. |
| `update_slide(brandSlug, postId, slide, html, css?, approvedText?)` | `designer.write` | Troca o HTML/CSS de **um** slide (número a partir de 1). Sanitiza no servidor (a mesma porta do editor, `lib/slideEdit.ts`), guarda a versão anterior e, com `approvedText`, confere o texto. Mesma regra de dono do `save_presentation`: peça criada por MCP, ou qualquer apresentação/carrossel com `designer.edit_all`. |
| `create_version(brandSlug, postId, label?)` | `designer.write` | Marca um ponto de retorno. `created: false` quando nada mudou. |
| `restore_version(brandSlug, postId, versionId)` | `designer.write` | Volta a peça a uma versão (`destructiveHint: true`); o estado atual vira uma versão antes. |
| exportação (PDF/ZIP/PPTX/Canva), upload de foto, troca de foto, integrações | vários | planejadas — ver `docs/MCP-DESIGNER-PLANO-FERRAMENTAS.md` (lote 1B e 1C). |

Todas as chamadas terminam em segundos (não há geração longa do nosso lado), o que evita o limite de ~60 s que os clientes
costumam impor a uma chamada de ferramenta.

**Como acrescentar uma ferramenta:** criar `tools/<nome>.ts` exportando um `McpToolDefinition` (nome, texto, schema zod,
`scope`, `annotations`, `brandArg` se recebe marca, `handler`) e listá-lo em `tools/index.ts`. Escopo, autorização por
marca, tratamento de erro e registro de chamada são aplicados **uma vez** em `tools/registry.ts` — a ferramenta nova
não consegue esquecer de checar a marca.

## Modelo de segurança — o que cada camada garante

| Camada | Garantia |
|---|---|
| **Configuração** | Módulo desligado por padrão; `issuer`/`resource` só de `PUBLIC_BASE_URL` (imune a host-header injection); mal configurado ⇒ não monta. |
| **Registro (DCR)** | `redirect_uri` na allowlist exata (impede receber código em domínio do atacante); só clientes **públicos** com PKCE (sem `client_secret` para vazar); teto de clientes; `client_name` limpo de caracteres de controle/bidi, cortado em 100 e **sempre** devolvido escapado. |
| **/authorize** | PKCE **S256 obrigatório** (SDK rejeita `plain` e ausência; formato do challenge conferido); `resource` diferente do nosso ⇒ `invalid_target`; **não emite código** — só estaciona o pedido. |
| **Consentimento** | Único lugar onde nasce um código, e só por POST autenticado (JWT) do usuário; papel do usuário conferido por marca; pedido de uso único e atômico (duas aprovações simultâneas ⇒ um código só). CSRF não se aplica: o JWT vai em header, nunca em cookie. |
| **Código de autorização** | 256 bits, 5 min, **uso único** (GETDEL), vinculado a client_id + redirect_uri + code_challenge + resource + usuário + marcas; reapresentado ⇒ `invalid_grant` **e revoga o que foi emitido com ele**. |
| **/token** | PKCE conferido pelo SDK (verifier errado ⇒ `invalid_grant`; formato 43–128 conferido por nós); `redirect_uri` idêntica à do `/authorize`; `resource` conferido; só os 2 grants suportados. |
| **Tokens** | Opacos, 256 bits, **só o SHA-256 vai ao Redis** (nem token nem código aparecem em Redis ou logs — há teste varrendo isso). Access: 1 h. Refresh: 30 d, **rotativo de uso único**; reuso de um refresh já consumido (ou apresentado por outro cliente) ⇒ **revoga a família inteira**. |
| **/mcp (por requisição)** | `Origin` validado quando presente (sem Origin = servidor a servidor, normal); bearer do SDK com audiência (`expectedResource`) + verifier nosso (hash, expiração, família viva, audiência); `401` com `WWW-Authenticate` (`resource_metadata`, `scope`); `403 insufficient_scope` para ferramenta cujo escopo o token não cobre (inclusive dentro de lote); o token **nunca** é repassado a outro serviço nem aparece em log. |
| **Por chamada (registro central)** | Escopo da ferramenta ⇒ marcas = **token ∩ associação atual** (`BrandMember` consultado agora, com o papel que o escopo exige; no modo "todas" o token não tem lista e vale a associação atual inteira) ⇒ marca fora disso é recusada com mensagem idêntica à de "não existe". Remover/rebaixar o usuário vale **na chamada seguinte**, sem esperar o token expirar. |
| **Erros** | Erro esperado vira mensagem ao modelo; erro inesperado vira mensagem genérica (detalhe só no log). Sem stack para o ChatGPT. |
| **Rate limit** | `middleware/rateLimit.ts` (Redis, vale entre instâncias, fail-open): `/register` 20/h/IP; `/token` 100/15 min/IP; `/authorize` 60/15 min/IP; `/revoke` 60/15 min/IP; `/mcp` 600/min/IP antes da auth e 240/min/**usuário** depois; consentimento 60/10 min/usuário. Justificativas em `mcp/limits.ts`. |
| **Revogação** | `POST /revoke` (RFC 7009) e `DELETE /api/mcp/connections/:id`; revogar derruba access **e** refresh da conexão. |

### O HTML que o agente envia é entrada NÃO confiável

`save_presentation` recebe HTML/CSS escrito por um agente externo, que depois é renderizado no Chromium do servidor.
Por isso a ferramenta passa pelo MESMO funil do pipeline: `validateHtmlDesign` (DOMPurify sobre jsdom: sem script, iframe,
object, embed, link, meta, base, form; CSS sem `@import`, `expression()` nem `javascript:`), tetos de tamanho (30 slides,
60 mil caracteres de HTML e 40 mil de CSS por slide) e `maxToolInputElements`. Atualizar uma peça por `postId` exige que
ela tenha sido criada **pelo mesmo usuário por MCP** nesta marca (`content.mcp.userId`) — a menos que a conexão tenha
`designer.edit_all`, caso em que vale qualquer apresentação/carrossel da marca autorizada, sempre com a versão anterior
congelada antes. Sem `designer.edit_all`, o agente nunca sobrescreve uma peça feita no app web nem a de outro usuário. A
escrita exige `designer.write` e papel EDITOR+ na marca, conferido a cada chamada. A peça guarda a procedência (`content.mcp`: usuário, cliente e conexão).

### Decisões que merecem registro

- **SDK oficial, versão fixada em `1.32.0`.** A linha 2.x do SDK (`@modelcontextprotocol/server`, com `zod 4`) **removeu** o
  servidor de autorização (`mcpAuthRouter`, `OAuthServerProvider`); só a 1.x os tem. A 1.32.1 saiu poucas horas antes da
  implementação (05/10/2026); preferimos a 1.32.0, publicada 3 dias antes, em vez de depender de um pacote de horas (a
  proteção de supply chain do pnpm não foi contornada nem testada contra a 1.32.1). O registro de ferramentas
  lê o mapa interno `_requestHandlers` do SDK para pôr `securitySchemes` no topo do descritor (o `McpServer` só repassa
  `_meta`); por isso a versão é fixada sem `^` e há teste lendo o JSON cru de `tools/list`.
- **Só clientes públicos (`none`).** É o que o ChatGPT usa. Evita segredo de cliente — e o `authenticateClient` do SDK compara
  segredo com `!==`, sem tempo constante.
- **Stateless.** Um `McpServer` + transport por requisição, resposta em JSON. Sem sessão para perder num deploy; cada
  requisição carrega o próprio token.
- **Sem Lua no Redis.** O uso único usa só comandos atômicos por si (`GETDEL`, `SET NX`); a tombstone de reuso do código é
  gravada **antes** do `GETDEL` para não perder a detecção de reuso numa corrida.
- **Rate limit nosso, não o do SDK.** O do SDK é em memória por processo; o do app é Redis e já é usado no login.

## Armazenamento (Redis, atrás de `McpOAuthStore`)

Interface em `backend/src/mcp/store.ts` — trocar por Postgres é escrever outra classe que a implemente (o contrato —
credenciais já hasheadas, `consume*` atômico e de uso único, tombstones de reuso, expiração — está documentado lá e
coberto por `__tests__/mcp/store.test.ts`). **Nenhuma migration nesta etapa.**

| Chave | Conteúdo | TTL |
|---|---|---|
| `mcp:client:<id>` · `mcp:clients` | cliente DCR · índice (zset por validade) para o teto | 180 d (renova a cada token) |
| `mcp:req:<sha256(id)>` | pedido aguardando consentimento | 10 min |
| `mcp:code:<sha256(code)>` · `mcp:code-used:<…>` | código · tombstone → família | 5 min · 1 h |
| `mcp:fam:<id>` · `mcp:ufam:<userId>` | a conexão (usuário, cliente, escopos, marcas, resource) · índice por usuário | 30 d (renova a cada refresh) |
| `mcp:at:<sha256(token)>` | access token → família + escopos + validade | 1 h |
| `mcp:rt:<sha256(token)>` · `mcp:rt-used:<…>` | refresh · tombstone → família | 30 d |
| `mcp:calls:<brandId>` / `mcp:calls:user:<userId>` | registro de chamadas (lista, `LTRIM` a 500) | 90 d |

### Registro de chamadas (base dos "Registros")

A cada `tools/call` grava-se um evento enxuto, na lista da **marca** (ou do **usuário**, para ferramentas sem marca e para
recusas de marca): `{ ts, userId, clientId, tool, brandSlug?, ok, errorCode?, durationMs }`. **Sem argumentos nem
conteúdo.** Falha ao gravar vira aviso no log e não derruba a chamada. A API de leitura é a próxima etapa
(`McpCallLog.listCalls` já existe). Além disso, todo `tools/call` sai no logger estruturado (`mcp.tool_call`).

## Limitações conhecidas

- **CIMD (Client ID Metadata Documents) não implementado.** O ChatGPT prefere CIMD mas continua aceitando DCR
  (`registration_endpoint`), que está implementado. O SDK 1.x não tem CIMD **no servidor**, e fazer à mão traria: busca de URL
  controlada por terceiro (vetor de SSRF — exigiria allowlist `chatgpt.com`, https, sem redirect, timeout e limite de tamanho),
  e o CIMD do ChatGPT anuncia `private_key_jwt` como autenticação preferida, o que exigiria verificar assinaturas contra o
  JWKS da OpenAI. Por isso `client_id_metadata_document_supported` **não** é anunciado. Revisitar quando houver um teste real
  contra o ChatGPT.
- **Armazenamento em Redis.** Códigos, tokens, famílias e registros vivem em Redis: um flush/perda do Redis desconecta todo mundo
  (o ChatGPT reconecta pelo OAuth) e apaga o histórico de chamadas. A interface permite migrar para Postgres.
- **`RedisMcpStore` não foi exercitado contra um Redis real** (não havia Redis nem Docker no ambiente de desenvolvimento): os
  testes rodam o store real sobre uma emulação em memória (`memoryRedis.ts`) dos comandos usados (`SET EX [NX]`, `GETDEL`,
  `EXPIRE`, `SADD/SREM/SMEMBERS`, `ZADD/ZREMRANGEBYSCORE/ZCARD`, `LPUSH/LTRIM/LRANGE`).
- **Janela de corrida no reuso de refresh:** entre o `GETDEL` e a gravação da tombstone (microssegundos) um reuso
  simultâneo é tratado como "inválido" em vez de "reuso" — o segundo uso falha do mesmo jeito, só a revogação em cascata
  deixa de disparar. O mesmo vale para um reuso que chegue antes de a família do primeiro uso existir.
- **Consent phishing.** Quem tem conta no ChatGPT pode iniciar o fluxo e mandar o link de consentimento a um membro da
  equipe. A tela precisa mostrar com destaque **quem pede** (`client.name`, `client.redirectHost`) e **o que será liberado**;
  só membros logados aprovam.
- **Refresh deslizante:** cada rotação renova 30 dias; não há teto absoluto de vida da conexão (o usuário/admin revoga em
  `/api/mcp/connections`).
- **Sem validação do header `Host`** (a spec pede Origin, que fazemos); o proxy do deploy deve só encaminhar o host público.
- **Sem filtro por IP do ChatGPT** nem mTLS (o ChatGPT oferece mTLS; não usado aqui).
- **Escopos na renovação:** o `scope` do `/token` por refresh só pode **reduzir**; ampliar exige novo consentimento
  (a resposta é `invalid_scope` e o refresh não é consumido).

## Bloqueadores antes de ampliar o conector (auditoria de 15/10/2026)

Resolver **antes** de acrescentar ferramentas (render, assets, export). Verificados no código de `main`; os itens 1 a 4
foram confirmados no servidor real contra a marca `amanda-coelho`.

### Brechas (segurança e permissão)

| # | Onde | Problema | Correção |
|---|---|---|---|
| B1 ✅ | `lib/logoTransparency.ts` `fetch(logoUrl)`, chamado por `PUT /settings/:slug/config` (qualquer EDITOR) | URL do usuário buscada pelo servidor **sem** `isPublicHttpUrlResolved`, sem limite de tamanho e sem timeout: SSRF para rede interna/metadata e leitura inteira em memória. | Validar com `isPublicHttpUrlResolved`, `redirect: 'error'`, timeout e teto de bytes; só aceitar host do R2 da própria marca. |
| B2 ✅ | `PUT /settings/:slug/config` aceita `ignoreAiCostLimit`, `autoResearch*` de um EDITOR | Quem edita o branding desliga o teto de custo de IA da marca. | Exigir OWNER/ADMIN para esses três campos; ignorar o resto do corpo por EDITOR (hoje o corpo não tem schema). |
| B3 | `save_presentation` não chama `snapshotPost` | O agente sobrescreve o trabalho do usuário sem versão; `PUT /posts/:id` e o cérebro já fazem snapshot. Sem isso não há como desfazer. | `snapshotPost(postId, { source: 'AI' })` antes do `update`; devolver `versionId` na resposta. |
| B4 | `save_presentation` grava `status: 'READY'` mesmo com `issues` | Peça com texto divergente aparece como pronta na Galeria. | Gravar `DRAFT` (ou marcador `needsReview`) enquanto houver `issues`; `READY` só limpa. |
| B5 | Sem teto por usuário/marca de peças criadas por MCP | 240 chamadas/min x 30 slides x 60 KB: o banco cresce sem limite e nada alerta. | Teto diário de criações por conexão e por marca; erro `quota_exceeded` legível ao agente. |
| B6 | `content.mcp.userId` vive dentro do `content` que o editor regrava | O dono da peça é um campo de JSON editável pelo cliente web; uma regravação que o omita tira o agente da própria peça, e um EDITOR pode forjá-lo. | Coluna própria (`Post.createdVia`, `createdById` já existe) em vez de JSON; o `PUT` preserva/ignora o campo. |

### Configurações duplicadas (fonte de verdade)

| Dado | Fonte 1 | Fonte 2 | Quem lê |
|---|---|---|---|
| Cores, fontes, logo | `BrandConfig.colors/primaryFonts/logoUrl` (tela Branding) | `BrandProfile.data` palette/typography/logo (Cérebro da IA) | `get_brand_kit` lê a 1; `get_designer_brief` e o pipeline leem a 2. Em `amanda-coelho` o kit devolve `logoUrl: null` e `visual` vazio enquanto o brief tem 14 logos e regras completas. |
| Diretrizes e regras | `BrandConfig.guidelines` + `agentPrompt` (tela Agente) | ficha (essência, nunca fazer) + `/brands/:slug/memory` regras | Quatro lugares para a mesma instrução; o agente externo recebe só parte. |
| Logo como arquivo | `BrandConfig.logoUrl` (cria Asset `source=branding`) | ficha `logo.files` | Dois sincronismos diferentes (settings e brands/confirm-logo). |
| Pesquisa automática | `BrandConfig.autoResearch*` | `Reference.autoSyncEnabled/Interval` (DEPRECATED, ainda no schema) | Colunas mortas confundem quem lê o schema. |

Decisão proposta: **a ficha (`BrandProfile`) é a fonte única** de identidade. `BrandConfig` vira só operacional
(`ignoreAiCostLimit`, `autoResearch*`, `presentationConfig`), e a tela Branding passa a escrever na ficha. Enquanto isso não
acontece, `get_brand_kit` deve ser um recorte do mesmo resolvedor do brief (uma função, não duas leituras).

**B1 e B2 corrigidos** (PR `fix/seguranca-config-logo-ssrf`): download do logo só de host público, sem redirect, com timeout e teto de 8 MB; `isPublicIp` ignorava IPv6 literal (`URL.hostname` traz colchetes, então `http://[::1]/` passava) e passou a tratá-lo; custo de IA e pesquisa automática só mudam por OWNER/ADMIN.

### Ordem

1. B1, B2 (brechas que valem para o app inteiro, independem do MCP).
2. B3, B4, B6 (integridade da escrita do agente) e B5.
3. Unificar a leitura de identidade (`get_brand_kit` = brief).
4. Só então: `render_slide`, `list_assets`/`upload_asset`, leitura de qualquer peça, `export_design`/`publish_design`.

## Verificação

```bash
cd backend
pnpm exec tsc --noEmit
pnpm exec vitest run                       # suíte inteira
pnpm exec vitest run src/__tests__/mcp     # só o conector
```

Os testes (`backend/src/__tests__/mcp/`) cobrem: metadados; DCR; fluxo OAuth completo; PKCE (verifier errado, `plain`,
challenge frouxo); código reusado (revoga o emitido) e simultâneo; redirect/resource trocados; consentimento (sem login,
papel insuficiente, uso único, concorrência); refresh (rotação, reuso revoga família, outro cliente, escopo/resource sem
queimar o token); `/mcp` (401/403, expirado, revogado, audiência, escopo, Origin, CORS, corpo); **cross-tenant** (token da
marca A não lê a B); remoção/rebaixamento depois da emissão; rate limit; segredos fora do Redis e dos logs; `client_name`
escapado; e um **cliente MCP real** (`Client` + `StreamableHTTPClientTransport` do SDK) numa porta efêmera, inclusive o
**OAuth completo conduzido pelo próprio SDK** (descoberta, DCR, PKCE, consentimento, token, chamada e refresh
transparente).

## Testar com o MCP Inspector

Pré-requisitos: Redis local e a API rodando em dev. **Não** aponte para o Redis/banco de produção.

1. Suba a API com o módulo ligado e o loopback liberado:

   ```bash
   # backend/.env.local (não versionado)
   MCP_ENABLED=true
   PUBLIC_BASE_URL=http://localhost:4000
   FRONTEND_URL=http://localhost:3000
   MCP_ALLOW_LOCALHOST_REDIRECT=true
   ```

   `pnpm run dev:local` (porta 4000). Confira: `curl http://localhost:4000/.well-known/oauth-authorization-server`.

2. Abra o Inspector: `npx @modelcontextprotocol/inspector` (baixa o pacote; precisa de rede). No navegador:
   **Transport:** *Streamable HTTP* · **URL:** `http://localhost:4000/mcp` · **Connection Type:** *Via Proxy* (padrão).
   Abra **Auth Settings** e rode o **Quick OAuth Flow** (ou o guiado, passo a passo).

3. O Inspector registra o cliente (DCR com `redirect_uri` de loopback — aceita por causa de
   `MCP_ALLOW_LOCALHOST_REDIRECT`) e abre `http://localhost:4000/authorize?…`, que redireciona para
   `http://localhost:3000/mcp/consent?request=<ID>`. **Essa tela ainda não existe** no frontend. Faça o consentimento pela
   API, com o JWT de um usuário real do ambiente de **dev** (o mesmo que o app guarda em `localStorage.auth_token`):

   ```bash
   curl -s http://localhost:4000/api/mcp/consent/<ID> -H "Authorization: Bearer $JWT"
   curl -s -X POST http://localhost:4000/api/mcp/consent/<ID> \
     -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
     -d '{"decision":"approve","brandSlugs":["<slug-da-marca>"]}'
   ```

   Abra no navegador o `data.redirectUrl` devolvido: o Inspector recebe o `code` e conclui a troca por token.

4. Em **Tools**: *List Tools* mostra `list_brands` e `get_brand_kit`; rode `list_brands` e depois `get_brand_kit` com um `brandSlug`
   da lista. Peça uma marca fora da aprovada: a resposta é a recusa genérica.

> **Não verificado:** o Inspector (a versão atual no npm é a 2.x) **não foi executado** ao escrever este guia — não havia cópia local e
> rodá-lo exigiria baixar e instalar o pacote (`npx`), o que não foi forçado. O fluxo acima e os flags abaixo seguem a documentação do
> Inspector; se algum flag divergir na sua versão, consulte `npx @modelcontextprotocol/inspector --help`. O que **foi**
> provado, com o cliente oficial do SDK do MCP, é o mesmo caminho de ponta a ponta (ver [Verificação](#verificação)).

Alternativa sem navegador (CLI do Inspector), com um access token obtido como acima:

```bash
npx @modelcontextprotocol/inspector --cli http://localhost:4000/mcp \
  --transport http --header "Authorization: Bearer $ACCESS_TOKEN" --method tools/list
```

## Arquivos

```
backend/src/mcp/
├── index.ts          mountMcp(app) — o ÚNICO ponto plugado em app.ts
├── config.ts         env → McpConfig (desligado por padrão, falha fechada), escopos e papéis
├── clients.ts        presets de agente (chatgpt, claude) e seus redirects
├── routes.ts         roteador de protocolo (raiz) + tratamento de erro no formato OAuth/MCP
├── server.ts         McpServer por requisição + POST /mcp (Origin, bearer, limites, pré-check de escopo)
├── store.ts          McpOAuthStore (interface), RedisMcpStore, McpCallLog
├── memoryRedis.ts    emulação em memória dos comandos usados (testes/fumaça)
├── limits.ts         rate limits e a justificativa de cada número
├── auth/             provider (OAuth), clientsStore (DCR), consent (API do usuário), router (metadados + SDK),
│                     origin, redirectUris, crypto, constants
└── tools/            types, registry (escopo + marca + erro + registro), authorization, htmlContract, designs,
                      list_brands, get_brand_kit, get_designer_brief, list_designs, get_design, save_presentation
```
