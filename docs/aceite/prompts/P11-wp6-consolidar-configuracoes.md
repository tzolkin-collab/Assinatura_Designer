# P11: WP6, consolidar as configurações da marca (Cérebro + Visão geral)

**Camada B (ajustes do Gustavo).** Antes de tudo, leia `docs/aceite/README.md` e siga as regras da seção 3.
**Depende de:** WP2 (#123), WP5 (P10) e do mapeamento de configurações (WP0). **Diverge do desenho da Gabi** (D10): ela ainda não sabe. Não mergear antes do aviso (P15) ser decidido.

## Objetivo
Executar D10: mover **Gastos** para o Cérebro, **Equipe** para a Visão geral e **Branding** e **Biblioteca de mídia** para dentro do Cérebro, sem blocos separados.

## Contexto
- Arquivos apontados pelo PO: `navigation.ts`, `[marca]/page.tsx`, `cerebro/page.tsx`, `configuracoes/*`.
- O mapeamento (skill `po-mapeamento-configuracoes`, `wf_d763bfff-cd3`) descreve o que cada tela faz e quem depende dela. **Releia antes de mover**: muitas conclusões são inferência.
- Equipe: remover membro na tela não é duradouro (`internalTeam.ts` só cria vínculos). O root aparece em `GET /brands/:slug/members` (🟡 não testado). Não piorar.
- Rotas antigas devem **redirecionar**, não quebrar links existentes.
- Design: siga o sistema do redesign (#88: preto e branco, Source Sans 3). Para telas novas, use a skill `design-craft`.

## Passos
1. Inventário das rotas e componentes das telas a mover, com quem as referencia (`git grep`).
2. Mova uma tela por vez, em commits pequenos, com redirect da rota antiga e teste do redirect.
3. Confira cada tela aberta no app (desktop e mobile), incluindo permissões por papel.

## Aceite
- [ ] Cada item do D10 no destino certo, sem duplicata na origem.
- [ ] Rotas antigas redirecionam; nenhum link interno quebrado.
- [ ] Permissões por papel iguais às de antes (testar OWNER e um papel menor).
- [ ] Suíte verde, `tsc` limpo, prints das telas.

## Não fazer
Não alterar regra de negócio ao mover. Não remover funcionalidade que o mapeamento marcou como usada por outra tela sem listar.
