import type { DesignDocument } from '@/lib/designDocument';

export const designDocumentFixture: DesignDocument = {
  version: 1,
  format: 'carousel',
  width: 1080,
  height: 1080,
  tokens: {
    colors: {
      background: '#f4eadf',
      surface: '#fff8ef',
      text: '#211914',
      muted: '#6d5e54',
      accent: '#bb5a3b',
      accent2: '#2e4736',
    },
    typography: {
      display: 'Newsreader, Georgia, serif',
      heading: 'Newsreader, Georgia, serif',
      body: 'Inter, Segoe UI, sans-serif',
    },
    spacing: {
      page: 84,
      section: 48,
      gap: 28,
    },
    radius: {
      sm: 18,
      md: 32,
      lg: 54,
    },
    effects: {
      shadow: 'premium',
      grain: true,
      glass: true,
      gradient: true,
    },
  },
  pages: [
    {
      id: 'page-hero',
      type: 'page',
      name: 'Hero editorial',
      background: 'linear-gradient(135deg, #f7ede1 0%, #e7cbb5 48%, #b95e3d 100%)',
      children: [
        {
          id: 'hero-shell',
          type: 'container',
          role: 'hero',
          layout: {
            position: 'absolute',
            x: 68,
            y: 68,
            width: 944,
            height: 944,
            display: 'grid',
            columns: ['1fr', '0.78fr'],
            gap: 34,
            padding: 46,
            alignItems: 'stretch',
          },
          style: {
            background: 'surface',
            borderRadius: 58,
            shadow: 'premium',
            opacity: 0.96,
          },
          children: [
            {
              id: 'hero-copy',
              type: 'container',
              role: 'content',
              layout: {
                display: 'flex',
                direction: 'column',
                justifyContent: 'space-between',
                gap: 38,
                padding: { top: 18, right: 8, bottom: 18, left: 18 },
                height: '100%',
              },
              children: [
                {
                  id: 'eyebrow',
                  type: 'text',
                  role: 'eyebrow',
                  content: 'Método Amanda',
                  style: {
                    color: 'accent2',
                    fontSize: 20,
                  },
                },
                {
                  id: 'headline',
                  type: 'text',
                  role: 'headline',
                  content: 'Sua marca\nprópria com\nritual de luxo',
                  style: {
                    color: 'text',
                    fontFamily: 'display',
                    letterSpacing: -3,
                  },
                  behaviors: [
                    { type: 'auto-fit-text', min: 70, max: 116 },
                    { type: 'balance-lines', maxLines: 4 },
                  ],
                },
                {
                  id: 'support',
                  type: 'text',
                  role: 'body',
                  content: 'Um posicionamento premium para transformar presença digital em percepção de valor, autoridade e desejo.',
                  style: {
                    color: 'muted',
                    fontSize: 29,
                    lineHeight: 1.18,
                  },
                  layout: {
                    width: 500,
                  },
                  behaviors: [{ type: 'balance-lines', maxLines: 3 }],
                },
              ],
            },
            {
              id: 'image-stack',
              type: 'container',
              role: 'imageGroup',
              layout: {
                position: 'relative',
                height: '100%',
              },
              children: [
                {
                  id: 'accent-orb',
                  type: 'shape',
                  layout: {
                    position: 'absolute',
                    x: -22,
                    y: 30,
                    width: 166,
                    height: 166,
                  },
                  style: {
                    shape: 'circle',
                    background: 'accent',
                    opacity: 0.24,
                  },
                },
                {
                  id: 'main-photo',
                  type: 'image',
                  src: 'https://coreva-normal.trae.ai/api/ide/v1/text_to_image?prompt=luxury%20Brazilian%20beauty%20brand%20editorial%20flatlay%2C%20warm%20ceramic%20cream%20jars%2C%20botanical%20shadows%2C%20premium%20natural%20skincare%2C%20terracotta%20and%20ivory%20palette%2C%20magazine%20photography&image_size=portrait_4_3',
                  alt: 'Composição editorial de produtos premium de beleza',
                  layout: {
                    width: '100%',
                    height: '100%',
                  },
                  style: {
                    borderRadius: 44,
                    shadow: 'dramatic',
                    objectFit: 'cover',
                  },
                  behaviors: [{ type: 'image-focal-point', x: 46, y: 44 }],
                },
                {
                  id: 'badge',
                  type: 'container',
                  role: 'card',
                  layout: {
                    position: 'absolute',
                    x: -34,
                    y: 642,
                    width: 250,
                    display: 'flex',
                    direction: 'column',
                    gap: 8,
                    padding: { top: 22, right: 24, bottom: 22, left: 24 },
                  },
                  style: {
                    background: '#2e4736',
                    borderRadius: 30,
                    shadow: 'premium',
                  },
                  children: [
                    {
                      id: 'badge-title',
                      type: 'text',
                      role: 'subtitle',
                      content: '4x',
                      style: {
                        color: '#fff8ef',
                        fontFamily: 'display',
                        fontSize: 58,
                      },
                    },
                    {
                      id: 'badge-copy',
                      type: 'text',
                      role: 'caption',
                      content: 'mais clareza na oferta e na comunicação',
                      style: {
                        color: '#d9eadb',
                        fontSize: 17,
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    {
      id: 'page-malicious-safety',
      type: 'page',
      name: 'Fixture de segurança',
      background: '#211914',
      children: [
        {
          id: 'safe-card',
          type: 'container',
          role: 'card',
          layout: {
            position: 'absolute',
            x: 120,
            y: 150,
            width: 840,
            height: 780,
            display: 'flex',
            direction: 'column',
            gap: 28,
            padding: 64,
            justifyContent: 'center',
          },
          style: {
            background: 'surface',
            borderRadius: 48,
            shadow: 'dramatic',
          },
          children: [
            {
              id: 'safe-title',
              type: 'text',
              role: 'headline',
              content: 'Renderer seguro por contrato',
              style: {
                color: 'text',
                fontFamily: 'display',
                fontSize: 86,
                lineHeight: 0.94,
              },
              behaviors: [{ type: 'balance-lines', maxLines: 2 }],
            },
            {
              id: 'safe-body',
              type: 'text',
              role: 'body',
              content: 'CSS, HTML e JavaScript arbitrários não são interpretados. URLs inseguras viram placeholder controlado.',
              style: {
                color: 'muted',
                fontSize: 31,
                lineHeight: 1.22,
              },
            },
            {
              id: 'blocked-image',
              type: 'image',
              src: 'javascript:alert(1)',
              layout: {
                width: '100%',
                height: 180,
              },
              style: {
                borderRadius: 26,
                background: '#f0dfd2',
              },
            },
          ],
        },
      ],
    },
  ],
};
