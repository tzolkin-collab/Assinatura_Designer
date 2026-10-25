# Teste real do MCP (checklist de execução)

> Decisão de 24/10/2026: o único teste real do aceite é o do **MCP com um agente real** (Claude ou ChatGPT). Pelo MCP o agente desenha sozinho, então **nenhuma chamada passa pelo Gemini do servidor**: a chave Gemini nova não bloqueia este teste.
> Roteiro de origem: [prompts/P16-integrar-mcp.md](prompts/P16-integrar-mcp.md). Referência técnica: [../MCP-DESIGNER.md](../MCP-DESIGNER.md). Marque `[x]` só com evidência (comando, resposta, print).
> **Quem executa o deploy e conecta o agente é o Gustavo.** Marca de teste, **nunca a da Gabi**. Não construir ferramentas novas (lotes 2 a 4 estão fora; a sessão de navegador, item 9, já está implementada: ver 5.1).

## 0. Decisão antes de subir

A produção roda o build de 16/10. O `main` inclui o MCP completo (22 ferramentas, trava de rascunho, sessão de navegador somente leitura) **e** os PRs #120 a #124, entre eles o **cérebro global (#124), que não foi testado com decks reais**.

- [ ] Escolher: **(a)** subir o `main` inteiro, aceitando o #124 sem teste de geração; ou **(b)** subir um corte só com o MCP. Registrar a escolha.
- [ ] Se (a): `DESIGNER_BRAIN_GLOBAL` com o mesmo valor na API **e** no worker, ambos reiniciados. Saída de emergência: `DESIGNER_BRAIN_GLOBAL=off`.
- [ ] Sem a chave Gemini nova, **a geração do app (Fábrica) continua falhando** em produção. Não afeta o MCP.

## 1. Antes de subir

- [ ] Backup do banco.
- [ ] `pnpm db:status`: nenhuma migration pendente (o container roda `prisma migrate deploy` ao iniciar).
- [ ] Redis **6.2 ou maior** (o MCP usa `GETDEL`). 🟡 não confirmado.
- [ ] `RedisMcpStore` nunca foi exercitado contra Redis real (só emulação em memória): este é o primeiro contato.
- [ ] Senhas das contas do seed trocadas (pendência de 16/10, 🟡 não sei se foi feita).
- [ ] Suíte do conector verde no commit que vai subir:

```powershell
cd backend; node node_modules/typescript/bin/tsc --noEmit; node node_modules/vitest/vitest.mjs run src/__tests__/mcp
```

## 2. Variáveis de produção

| Variável | Valor |
| --- | --- |
| `MCP_ENABLED` | `true` |
| `PUBLIC_BASE_URL` | https, sem caminho (ex.: `https://api.exemplo.com`) |
| `FRONTEND_URL` e `CORS_ORIGIN` | origem do frontend |
| `MCP_CLIENT_PRESETS` | `chatgpt,claude` |
| `MCP_ALLOW_LOCALHOST_REDIRECT` | `false` |
| `MCP_ALLOW_ANY_HTTPS_REDIRECT` | `false` |
| `R2_*` e `CANVA_*` | já existentes (necessárias para `upload_asset` e `export_to_canva`) |

- [ ] Variáveis conferidas. Sem aviso de loopback no log de inicialização.

## 3. Depois de subir (sem agente)

- [ ] Log: "MCP: conector montado", sem erro.
- [ ] `GET <PUBLIC_BASE_URL>/.well-known/oauth-protected-resource` responde.
- [ ] `GET <PUBLIC_BASE_URL>/.well-known/oauth-authorization-server` responde.
- [ ] `POST <PUBLIC_BASE_URL>/mcp` sem token dá **401 com `WWW-Authenticate`**.
- [ ] `<FRONTEND_URL>/mcp/consent` abre.

## 4. Conectar o agente

- Claude: Configurações > Conectores > personalizado > `https://<PUBLIC_BASE_URL>/mcp`.
- ChatGPT: modo desenvolvedor > Conectores > Criar.
- [ ] Tela de consentimento mostra **quem pede** (`client.name`, host do redirect) e **o que será liberado**.
- [ ] 1º teste com escopo mínimo (`designer.read`); escrita no 2º; exportar só depois.
- [ ] O que falhar na conexão (redirect, escopo, DCR) fica registrado: o manual admite que nunca houve teste contra cliente real.

## 5. Roteiro (dados de teste, marca de teste)

| # | Passo | Esperado | Resultado |
| --- | --- | --- | --- |
| 1 | `list_brands` | só as marcas autorizadas na conexão | [ ] |
| 2 | `get_brand_kit` | kit da marca de teste | [ ] |
| 3 | `get_designer_brief` | brief com texto aprovado | [ ] |
| 4 | `save_presentation`, 2 slides, com `approvedText` e um texto divergente | `issues` acusa a divergência; peça fica `DRAFT` | [ ] |
| 5 | `save_presentation` corrigido | `READY`, devolve `versionId` | [ ] |
| 6 | `update_slide` | slide muda; versão criada | [ ] |
| 7 | `restore_version` | volta ao estado anterior | [ ] |
| 8 | `upload_asset` + `get_photo_slots` + `set_slide_photo` | foto no slide | [ ] |
| 9 | `export_file` (PDF) + `get_export_status` | link de download | [ ] |
| 10 | `export_to_canva` + `get_canva_export_status` (com Canva conectado) | design criado | [ ] |
| 11 | Peça com texto "em revisão": `export_file` | **recusado** | [ ] |
| 12 | Conexão sem escopo de escrita: `save_presentation` | **recusado** | [ ] |
| 13 | Marca fora da conexão: `get_design` de outra marca | **recusado** | [ ] |
| 14 | `get_integrations_status` | status sem token | [ ] |

Para cada falha: a ferramenta, a mensagem exata, o ajuste feito.

### 5.1 Item 9: sessão de navegador somente leitura (IMPLEMENTADO, ainda não testado com agente real)

Total de ferramentas: **22** (`start_frontend_session`, `end_frontend_session` são as novas; escopo `designer.preview`, desligado por padrão).
Na tela de consentimento marque "Navegador (somente leitura)". Sem variável nova.

| # | Passo | Esperado | Resultado |
| --- | --- | --- | --- |
| 15 | Conexão SEM o quadro marcado: `start_frontend_session` | recusado (`insufficient_scope`) | [ ] |
| 16 | Conexão com o quadro: `start_frontend_session` | URL `.../mcp/entrar#code=...`, validade 2 h, marcas da conexão | [ ] |
| 17 | Abrir a URL em até 60 s num navegador | cai na galeria; editor abre em modo leitura (sem botões de edição) | [ ] |
| 18 | Abrir a mesma URL de novo | "link incompleto ou já foi aberto" | [ ] |
| 19 | Tentar salvar/apagar/exportar na tela | 403, nada muda | [ ] |
| 20 | Marca fora da conexão pelo endereço | não encontrada | [ ] |
| 21 | `end_frontend_session`, recarregar a tela | volta ao login | [ ] |
| 22 | Revogar a conexão em Integrações com sessão aberta | a tela cai para o login | [ ] |

## 6. Limites do teste (dizer no relatório)

- Prova que o conector funciona e respeita escopo, marca e trava de rascunho. **Não mede a qualidade visual** da arte, nem compara com o lote 1 da Gabi.
- O MCP depende de ficha (`getDesignerBrief`, `savePresentation`, `getBrandKit`): **projeto sem ficha não é exercitado**. A regra "cérebro global em todos" não vale nos agentes externos.
- `docs/MCP-DESIGNER.md`, seção "Bloqueadores": a tabela ainda lista B3 e B4 como abertos, mas `save_presentation` já chama `snapshotPost` e grava `DRAFT` quando há `issues`. **B5** (teto diário de criações por MCP) e **B6** (dono da peça dentro do JSON `content.mcp.userId`) não foram verificados.

## 7. Aceite e rollback

- [ ] Backend em produção com os PRs decididos, sem erro no log.
- [ ] Um agente real completou o roteiro; **registrado no Core** com o que falhou e o ajuste feito.
- [ ] Rollback conhecido: `MCP_ENABLED=false` e reiniciar (as rotas somem, 404). Revogar uma conexão: `DELETE /api/mcp/connections/:id`.
- [ ] A Gabi avisada de que o MCP existe como extensão fora do contrato (depende do envio do aviso, P15; fora deste teste).
