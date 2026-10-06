# Designer IA como conector MCP do ChatGPT

> **Status:** fundação (servidor OAuth 2.1 + transporte MCP + autenticação/autorização + 2 ferramentas de leitura).
> **Não verificado contra o ChatGPT real** — tudo foi provado com o cliente oficial do SDK do MCP e com testes
> automatizados (ver [Verificação](#verificação)). A tela de consentimento do frontend e as demais ferramentas são
> a próxima etapa.

O ChatGPT (na assinatura do usuário) vira o "cérebro" da conversa; o Designer expõe **ferramentas** por MCP
(Model Context Protocol), autenticadas por OAuth. O código vive em `backend/src/mcp/` e só é montado com
`MCP_ENABLED=true`.

## Como conectar no ChatGPT

1. Suba a API com o módulo ligado (veja [Variáveis de ambiente](#variáveis-de-ambiente)); ela precisa estar
   acessível por **HTTPS público** — o ChatGPT chama de servidor para servidor.
2. No ChatGPT: ative o **modo desenvolvedor** → **Conectores** → **Criar**. (Os nomes dos menus mudam conforme o plano
   e a versão do ChatGPT; confira a documentação atual da OpenAI.)
3. **URL do servidor MCP:** `https://<PUBLIC_BASE_URL>/mcp` (ex.: `https://api.exemplo.com/mcp`). É essa URL, byte a byte,
   que o ChatGPT envia como `resource` no OAuth — e é ela que vira a audiência dos tokens.
4. **Autenticação:** OAuth. O ChatGPT descobre o resto sozinho (metadados `.well-known`), registra-se por DCR e abre o
   navegador na tela de consentimento do Designer (`FRONTEND_URL/mcp/consent?request=…`). O usuário faz login no app,
   escolhe as marcas e aprova.
5. Depois de conectado, o modelo enxerga `list_brands` e `get_brand_kit`.

> Enquanto a tela `/mcp/consent` do frontend não existir (próxima etapa), o consentimento pode ser feito direto pela API —
> veja o passo a passo do Inspector abaixo.

## Variáveis de ambiente

| Variável | Padrão | O que faz |
|---|---|---|
| `MCP_ENABLED` | `false` | Liga o módulo. Qualquer valor diferente de `true` deixa **todas** as rotas do conector inexistentes (404). |
| `PUBLIC_BASE_URL` | — (em dev: `http://localhost:<PORT>`) | Origem pública da API, **https e sem path** (`http` só em localhost). `issuer` = esta origem; `resource` = `<origem>/mcp`. **Nunca** derivados do header `Host`. Em produção, se faltar (ou for inválida) o módulo **não monta** e loga o motivo. |
| `FRONTEND_URL` | primeiro valor de `CORS_ORIGIN` | Origem do frontend. O `/authorize` redireciona o navegador para `<FRONTEND_URL>/mcp/consent?request=<id>`. |
| `MCP_ALLOWED_REDIRECT_URIS` | os 2 do ChatGPT (abaixo) | `redirect_uri`s aceitas **no registro** (DCR), separadas por vírgula. Match exato; o único curinga é o segmento `{id}`. Definir **substitui** o padrão. |
| `MCP_ALLOW_LOCALHOST_REDIRECT` | `false` | Aceita redirect `http://localhost|127.0.0.1|[::1]:<porta>/…` e Origin de loopback. **Só para testar com o Inspector.** Loga aviso se ligado em produção. |
| `MCP_ALLOWED_ORIGINS` | `PUBLIC_BASE_URL` + `FRONTEND_URL` | Origens (`https://host[:porta]`) aceitas no header `Origin` de `/mcp`. |
| `MCP_MAX_CLIENTS` | `500` | Teto de clientes DCR ativos ao mesmo tempo. |

Padrão de `MCP_ALLOWED_REDIRECT_URIS`:

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
| `POST /api/mcp/consent/:requestId` | A decisão. Corpo: `{ decision: "approve"\|"deny", brandSlugs?: string[], scopes?: string[] }`. Devolve `{ data: { redirectUrl } }` para o frontend redirecionar o navegador. |
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

Regras do `POST` (aprovar): ao menos uma marca; o usuário só pode **reduzir** os escopos pedidos, nunca ampliar;
leitura exige ser **membro** (qualquer papel) de cada marca escolhida; escrita (`designer.write`) exige papel
**EDITOR, ADMIN ou OWNER** em cada uma. Falha de validação (`403`/`400`) **não** consome o pedido — o usuário pode
corrigir e tentar de novo. A decisão que passa consome o pedido (uso único, atômico). `deny` devolve
`redirectUrl` com `error=access_denied`.

## Escopos

| Escopo | Dá direito a | Papel mínimo na marca |
|---|---|---|
| `designer.read` | listar e ler | qualquer membro (VIEWER+) |
| `designer.write` | criar/editar/pausar (e **inclui** leitura) | EDITOR+ |

Sem `scope` no `/authorize`, o pedido nasce só com `designer.read` (menor privilégio). A regra de papel é a mesma de
`middleware/brandAccess.ts` (`ANY_MEMBER` / `EDITORS`) — o conector nunca concede mais do que o app web.

## Ferramentas

Todas em `backend/src/mcp/tools/`, descrições em pt-BR, nomes em inglês `snake_case`. Cada uma declara `annotations`
(`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) e `securitySchemes` (`oauth2` + escopo) — no
topo do descritor **e** em `_meta.securitySchemes`, como pede o Apps SDK.

| Ferramenta | Escopo | Estado | O que faz |
|---|---|---|---|
| `list_brands` | `designer.read` | **implementada** | Marcas que a conexão pode acessar (slug, nome, papel) = marcas aprovadas no token ∩ associação atual. |
| `get_brand_kit(brandSlug)` | `designer.read` | **implementada** | Cores, fontes, logo, diretrizes (até 4.000 caracteres, com aviso de corte) e preferências visuais. Não devolve o prompt interno do agente. |
| `list_designs` / `get_design` | `designer.read` | planejada | Listar e ler designs/decks da marca. |
| `create_design` / `edit_design` | `designer.write` | planejada | Disparar geração e editar. |
| `pause_generation` | `designer.write` | planejada | Pausar uma geração em curso. |
| leitura dos **Registros** | `designer.read` | planejada | API sobre os eventos de chamada já gravados (abaixo). |

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
| **Por chamada (registro central)** | Escopo da ferramenta ⇒ marcas = **token ∩ associação atual** (`BrandMember` consultado agora, com o papel que o escopo exige) ⇒ marca fora disso é recusada com mensagem idêntica à de "não existe". Remover/rebaixar o usuário vale **na chamada seguinte**, sem esperar o token expirar. |
| **Erros** | Erro esperado vira mensagem ao modelo; erro inesperado vira mensagem genérica (detalhe só no log). Sem stack para o ChatGPT. |
| **Rate limit** | `middleware/rateLimit.ts` (Redis, vale entre instâncias, fail-open): `/register` 20/h/IP; `/token` 100/15 min/IP; `/authorize` 60/15 min/IP; `/revoke` 60/15 min/IP; `/mcp` 600/min/IP antes da auth e 240/min/**usuário** depois; consentimento 60/10 min/usuário. Justificativas em `mcp/limits.ts`. |
| **Revogação** | `POST /revoke` (RFC 7009) e `DELETE /api/mcp/connections/:id`; revogar derruba access **e** refresh da conexão. |

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
├── routes.ts         roteador de protocolo (raiz) + tratamento de erro no formato OAuth/MCP
├── server.ts         McpServer por requisição + POST /mcp (Origin, bearer, limites, pré-check de escopo)
├── store.ts          McpOAuthStore (interface), RedisMcpStore, McpCallLog
├── memoryRedis.ts    emulação em memória dos comandos usados (testes/fumaça)
├── limits.ts         rate limits e a justificativa de cada número
├── auth/             provider (OAuth), clientsStore (DCR), consent (API do usuário), router (metadados + SDK),
│                     origin, redirectUris, crypto, constants
└── tools/            types, registry (escopo + marca + erro + registro), authorization, list_brands, get_brand_kit
```
