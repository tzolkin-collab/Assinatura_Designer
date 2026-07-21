# Status de Desenvolvimento - Designer

> **Atualizado em:** 15 de Julho de 2026

## 🗣️ Resumo Executivo para o Usuário

Nas últimas atualizações, nossa principal missão foi "arrumar a casa" e preparar o Designer para ser uma ferramenta robusta, segura e barata de operar.

**O que já foi concluído:**
- **Transparência de custos (novo — 15/07):** agora dá para ver, dentro do app, **quanto de IA cada marca consumiu** — um indicador "IA hoje" na Fábrica e na Galeria, e uma aba **"Gastos de IA"** nas Configurações com o detalhamento **por modelo**, mês a mês, separando gasto e impostos. O consumo em tokens é exato; os valores em dinheiro são estimativa.
- **Economia e Inteligência:** controle de gastos da IA — o sistema não passa do limite nem insiste em modelos lentos ou lotados.
- **Segurança Reforçada:** fechamos brechas que deixavam um usuário ver ou alterar projetos de outras marcas (vazamentos cross-tenant). O convite de equipe virou link seguro de uso único.
- **Novas Funcionalidades Entregues:** histórico de versões no editor (dá para voltar atrás se a IA errar), galeria com subpastas, e exportação que envia um design real para o Canva de forma assíncrona.

**O que estamos construindo neste exato momento:**
Estamos com a "mão na massa" no **Editor Visual** — dar ao usuário o poder de modificar ativamente os designs da IA. A suíte de painéis já está montada (seleção múltipla, transformação/tamanho/posição, texto, cor, sombra, imagem) e o foco agora é **refino e testes** de ponta a ponta, além de melhorar como as edições são salvas de forma inteligente.

> ⚠️ **Atenção — geração pausada:** a conta do provedor de IA (Google Gemini) está **sem créditos**, o que **bloqueia a geração de novos designs** no momento. O app funciona normalmente para ver, editar e exportar o que já existe, mas **criar decks novos só volta após recarregar créditos** na conta. Essa é hoje a pendência nº 1.

---

## 📅 Previsão Prática de Entrega

O foco atual são o **refino dos Painéis do Editor** (a suíte já está montada) e a **Listagem de Projetos**. Considerando a complexidade de uma edição fluida (estilo Figma/Canva):

- **Conclusão das telas e painéis do Editor:** Sexta-feira, 17 de Julho de 2026.
- **Fase de Testes Internos (garantir que a edição não quebra o design gerado pela IA):** meados da próxima semana (21-22 de Julho).

> ⚠️ **Risco de cronograma:** a fase de testes internos **depende de gerar decks** para validar, e a geração está pausada pela conta de IA sem créditos. Enquanto o crédito não for reposto, os testes de "edição × design gerado" ficam bloqueados — a data de 21-22/07 assume que o crédito volta nos próximos dias.

*Nota: estimativa focada nos arquivos manipulados ativamente hoje no repositório.*

---

## 📌 O que está em desenvolvimento agora (Foco Atual)

**Trabalho ativo (edições em andamento):**
- `frontend/src/app/projetos/page.tsx` (Listagem de projetos)
- `frontend/src/components/Editor/IRCanvasEditor.tsx` (Canvas de edição — refino)
- `frontend/src/app/[marca]/editor/[postId]/page.tsx` (Tela do editor)
- `frontend/src/lib/designIR/patcher.ts` (Sistema que aplica as mudanças do usuário no design)

**Recém-entregue (transparência de custos, 15/07):**
- `frontend/src/components/AiUsage/` — indicador "IA hoje" na Fábrica/Galeria
- `frontend/src/app/[marca]/configuracoes/billing/` — aba "Gastos de IA" (por modelo)
- `backend` — cálculo de custo por modelo e rotas de consumo/faturamento

> 🧹 Limpeza feita em 15/07: removidos scripts temporários de teste do backend
> (`capture.tmp.ts`, `seed5.tmp.ts`, `generate_*_slides.ts`, `read_session.ts`).

---

## 🕒 Últimos Commits (Histórico Recente)

Abaixo está a lista técnica das últimas alterações enviadas para o projeto, com suas respectivas datas de entrega:

> *Nota: o trabalho mais recente (transparência de custos e refino do Editor) está em integração final e ainda **não aparece** na lista de commits abaixo — será registrado no próximo envio.*

* **c42cd2a** (13/07/2026): perf(designer): sessão do Redis em três keys — uma frase não custa mais megabytes
* **f050b74** (13/07/2026): fix(designer): timeout por tentativa — modelo lento não é modelo bom
* **d0453b6** (13/07/2026): fix(designer): não insistir em modelo lotado (e lembrar que ele está lotado)
* **f56ff37** (13/07/2026): feat(designer): teto de gasto de IA, log estruturado e fim do OOM do chromium
* **44ea5cb** (13/07/2026): feat(designer): histórico de versões — a IA não sobrescreve mais sem volta
* **7b4d004** (13/07/2026): feat(designer): subpastas na galeria (e a migration que faltava)
* **de4010c** (13/07/2026): fix(designer): convite exige aceite e a marca não fica sem dono
* **78d5f39** (13/07/2026): feat(designer): biblioteca de mídia no editor (e corrige imagens salvas como blob:)
* **c4bff98** (13/07/2026): feat(designer): export do Canva vira job na fila e entrega um design de verdade
* **eb3c54d** (13/07/2026): docs(designer): roadmap e escopo do produto
* **f309262** (13/07/2026): feat(designer): RBAC na interface + telas de equipe, mídia e notificações
* **d7bc1af** (13/07/2026): chore(designer): helmet, tipagem e ESLint zerado (47 -> 0)
* **354f06b** (13/07/2026): fix(designer): convite de equipe com token de uso único
* **d4bab65** (13/07/2026): fix(designer): autorização por marca unificada (corrige vazamento cross-tenant)
* **f7f947d** (13/07/2026): fix(designer): reconstrói o histórico de migrations e elimina o drift do schema
* **de29284** (13/07/2026): chore(designer): remove scripts obsoletos e bootstrap legado do schema
* **631330a** (12/07/2026): fix(designer): rate-limit, anti-SSRF/rebinding, WS auth por subprotocolo, lock distribuído
* **5728f54** (12/07/2026): fix(designer): race de sessão, SSRF, blob inflado, auto-refresh e validações
* **28d5a06** (12/07/2026): fix(designer): vazamentos cross-tenant (Asana, referências) e hardening de login
