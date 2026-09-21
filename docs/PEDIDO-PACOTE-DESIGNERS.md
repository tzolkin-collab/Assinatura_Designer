# Pedido de material aos designers (Pedro e Matheus)

> Texto pronto para enviar. Origem: `docs/ACABAMENTOS-DESIGNER.md` §6, decisões 4, 9 e 11.
> Por que agora: a decisão de 21/09 foi editar dentro do Designer e aceitar pacotes do Illustrator e do Photoshop. Sem um pacote real, a ingestão nova é construída no escuro.

## Mensagem (WhatsApp)

> Oi, Pedro e Matheus! Estamos melhorando a parte de marca do Designer para ele usar o brandbook de vocês de verdade: cores, fontes, logos, ícones e grafismos.
>
> Para testar com material real, preciso de **um pacote de um brandbook** exatamente do jeito que vocês entregam hoje (pode ser da Assinatura ou de outro cliente que possa ser usado como teste). Idealmente uma pasta em .zip com:
>
> 1. **Os SVGs** exportados do Illustrator (logo em cada versão, ícones, grafismos), com os nomes que vocês usam.
> 2. **As fontes** (.otf, .ttf ou .woff2) que a marca usa.
> 3. **O(s) PSD(s)** do Photoshop, se houver, com as camadas como estão.
> 4. **O brandbook em PDF** (identidade visual e, se existir, a plataforma de marca).
>
> Duas perguntas rápidas:
> - As fontes da Assinatura (Aileron e Monument Extended) vocês têm em arquivo e com licença de uso em software? Se não, qual fonte parecida vocês aprovam como substituta?
> - Quando vocês falam em "braço de Criatividade" e "braço de Consultoria", cada um tem ícones, cores e estilo de imagem próprios. Quando um deck for sobre planos de serviço, o ideal é o Designer usar sozinho o visual do braço Consultoria?
>
> Se puder ser hoje ou amanhã, ajuda muito. Obrigado!

## O que fazer quando chegar

1. Guardar o `.zip` **fora do repositório** (é material do cliente).
2. Rodar o script de verificação da ingestão com esse pacote (ver `backend/scripts/testBrandbookExtraction.ts`, criado pela frente de ingestão).
3. Anotar no `docs/ACABAMENTOS-DESIGNER.md` §6: resposta sobre fontes, sobre os braços e a estrutura real do pacote (decisão 11).

## Se não houver como enviar um pacote completo

Aceitar em ordem de valor: (1) os SVGs do logo em todas as versões; (2) os arquivos de fonte; (3) o brandbook em PDF exportado do Illustrator (não do Canva). O objetivo é ter vetores e fontes de verdade, não imagens.
