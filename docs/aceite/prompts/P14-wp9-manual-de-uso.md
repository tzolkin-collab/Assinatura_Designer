# P14: WP9, manual de uso e documentação

**Camada A e B.** O manual é item da definição de pronto. Antes de tudo, leia `docs/aceite/README.md` e siga as regras da seção 3.
**Depende de:** WP6 (P11) e WP7 (P12), porque o manual é escrito **a partir das telas finais**. Arquivo: `frontend/src/app/extras/docs/docsContent.ts`.

## Objetivo
Escrever o manual de uso do Designer para a equipe e para a Gabriela, e **seguí-lo do zero** para provar que funciona.

## Contexto
- O conteúdo da documentação vive em `docsContent.ts` (lista de seções com `slug`, `emoji`, `title`, `description`, `markdown`). O #121 corrige o slug duplicado `documentacao-tecnica` (vira `documentacao-tecnica-completa`); mantenha slugs únicos.
- Deve cobrir o que mudou: Cérebro global (com ou sem ficha), **ninguém gera deck só com briefing** (D7), briefing por campos (aprovado, fala/contexto, interno), moodboard, onde ficaram Gastos, Equipe, Branding e Mídia (D10), sem Tenants nem pesquisa de concorrentes.
- Linguagem: Gabriela e a equipe não são técnicas. Frases curtas, passos numerados, o que fazer quando algo falha.
- Marque 🟡 em qualquer coisa que você **não** viu funcionar na tela; não descreva comportamento imaginado.
- Documentação técnica (`docs/*.md`) que ainda diz o que é falso: `CHECKLIST-CEREBRO-DESIGNER.md` e `aceiteCerebro.ts` foram corrigidos na 3ª rodada do #124; confirme.

## Passos
1. Percorra cada tela final no app, anotando o que existe de fato (nomes de botões, ordem).
2. Escreva as seções por tarefa do usuário: criar projeto, preencher a ficha, escrever o briefing, gerar, revisar, trocar foto, exportar.
3. **Teste do zero:** aplique o manual do início ao fim num projeto de teste (backend local isolado; geração paga só com autorização) e registre onde travou.
4. Corrija o manual até o passo a passo fechar sem ajuda.

## Aceite
- [ ] Cada passo corresponde a uma tela/botão real, conferido.
- [ ] Teste do zero feito e registrado (o que travou e o que foi corrigido).
- [ ] Slugs únicos; build do frontend passa.
- [ ] Nenhuma promessa de funcionalidade que não existe (e-book A4, por exemplo).
