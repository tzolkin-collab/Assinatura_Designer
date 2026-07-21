# Sobre o Projeto Designer Assinatura: Visão, Escopo e Intenções

Este documento estabelece o manifesto de produto, as premissas de negócios e os objetivos estratégicos do **Designer Assinatura**. Ele serve como guia para compreender *o que* o sistema é, *por que* ele existe e *onde* queremos chegar com o seu desenvolvimento.

---

## 🎯 1. O que é o Designer Assinatura?

O **Designer Assinatura** é uma ferramenta interna exclusiva desenvolvida para otimizar e escalar a entrega de criativos visuais (apresentações, propostas comerciais e carrosséis de imagens) para o contrato de serviços **Assinatura**. 

O sistema utiliza orquestração inteligente de inteligência artificial (Modelos Google Gemini Pro/Flash) e um canvas interativo de edição visual para permitir que designers e estrategistas criem dezenas de peças profissionais em minutos.

---

## 🚫 2. O que o Projeto NÃO é (Premissas de Escopo)

Para manter o desenvolvimento focado e eficiente, existem fronteiras claras sobre o que o produto é e o que ele **não** é:

1. **Não é um SaaS (Software as a Service):** 
   * Não há planos de assinatura pública, fluxo de self-service, landing pages comerciais de conversão ou processamento de assinaturas para terceiros. É uma ferramenta de uso exclusivo interno.
2. **Não é um Gerenciador de Redes Sociais:**
   * O sistema **não** faz publicação automática ou agendamento direto de posts em redes sociais (recursos de agendamento que constavam em especificações antigas foram oficialmente cancelados).
3. **Não constrói designs dinâmicos element-by-element na Canva Connect API:**
   * A integração do Canva via Connect API é estritamente um **canal de entrega de artes prontas**. O sistema renderiza as imagens estáticas em alta qualidade nos nossos servidores e as injeta no Canva do usuário como criativos prontos para postar. Não geramos layouts dinâmicos editáveis dentro do Canva por meio de sua API devido a restrições de consistência tipográfica e visual da plataforma deles.

---

## 💡 3. Nossas Intenções e Objetivos de Produto

O sistema foi concebido para resolver três grandes gargalos de produção de conteúdo:

### A. Escala de Produção Visual (Decks Massivos)
Produzir apresentações ou propostas corporativas de mais de 30 slides consome horas de trabalho manual de um designer. Nossa intenção é delegar essa carga de estruturação para a inteligência artificial de forma controlada. O pipeline em duas etapas (*Manager-Worker*) permite que um esqueleto lógico seja definido de forma barata (Gemini Pro) antes do processamento e geração gráfica concorrente e massiva (Gemini Flash).

### B. Consistência de Identidade de Marca (Branding Rigoroso)
Ferramentas de IA genéricas criam slides desalinhados com a identidade visual do cliente. O Designer Assinatura possui o conceito de **Brand Book** (fontes, cores de preenchimento, logos, estilos e design tokens). A IA só trabalha sob o contexto visual unificado de cada marca, garantindo que o design nasça perfeitamente alinhado às diretrizes corporativas do cliente.

### C. Flexibilidade com Edição Híbrida (`DesignIR`)
De nada adianta a IA gerar uma apresentação de 50 slides se o usuário precisar descartar tudo porque uma única frase ou imagem está errada. Nossa intenção é a **Co-criação**:
* A IA gera o design inicial com base em linguagem natural na **Fábrica**.
* O usuário abre o post no **Editor Visual** e faz edições finas e milimétricas de forma manual (ajusta tamanho, texto, preenchimentos, cores ou arrasta elementos) sob o formato intermediário `DesignIR`.
* Caso a edição manual não seja suficiente, o usuário pode interagir com a IA no chat lateral para pedir patches cirúrgicos apenas em slides específicos (ex: *"IA, troque a cor de destaque desse slide para azul"*), preservando o restante do design intacto.

---

## 📈 4. Visão de Futuro e Roadmap

À medida que o núcleo do sistema se consolida (geração, editor, mídias e custos), as próximas frentes estratégicas do produto se concentram em:

1. **Refino de Fluidez do Canvas Editor:**
   * Tornar a manipulação de camadas, seleção múltipla de caixas e alinhamentos automáticos (snapping) tão fluida e responsiva quanto as melhores ferramentas de design de mercado (como Figma e Canva).
2. **Otimização de Custos e Faturamento de IA:**
   * Continuar aprimorando a contabilidade em tempo real de tokens consumidos de cada marca, garantindo que tenhamos transparência absoluta sobre o custo operacional de cada peça gerada para fins de faturamento corporativo.
3. **Escala de Exportação Canva:**
   * Otimizar o processamento assíncrono de filas de renderização baseadas em Puppeteer Cluster para suportar demandas massivas simultâneas de múltiplos estrategistas utilizando o sistema.
