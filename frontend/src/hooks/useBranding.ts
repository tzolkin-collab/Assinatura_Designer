import { useEffect } from 'react';
import { useConfig } from '@/lib/hooks';

export function useBranding(slug: string) {
  const { config, loading, error } = useConfig(slug);

  useEffect(() => {
    if (!config) return;

    // Retrieve colors and fonts from config, with safe fallbacks
    const colors = Array.isArray(config.colors) ? config.colors : [];
    const primaryColor = colors[0] || '#171717';
    const secondaryColor = colors[1] || '#ff6b35';
    const tertiaryColor = colors[2] || '#f4f4f4';

    const fonts = Array.isArray(config.primaryFonts) ? config.primaryFonts : [];
    const headingFont = fonts[0] || 'Inter';
    const bodyFont = fonts[1] || 'Inter';

    // Inject CSS variables into the document root element
    document.documentElement.style.setProperty('--brand-primary', primaryColor);
    document.documentElement.style.setProperty('--brand-secondary', secondaryColor);
    document.documentElement.style.setProperty('--brand-tertiary', tertiaryColor);
    document.documentElement.style.setProperty('--font-heading', headingFont);
    document.documentElement.style.setProperty('--font-body', bodyFont);

    // Dynamically load font files from Google Fonts
    const fontId = 'dynamic-brand-fonts';
    let linkEl = document.getElementById(fontId) as HTMLLinkElement | null;
    if (!linkEl) {
      linkEl = document.createElement('link');
      linkEl.id = fontId;
      linkEl.rel = 'stylesheet';
      document.head.appendChild(linkEl);
    }

    const families = [headingFont, bodyFont]
      .filter((f, index, self) => typeof f === 'string' && f.trim() && self.indexOf(f) === index)
      .map((f) => `family=${encodeURIComponent(f.trim())}:wght@400;500;600;700;800`)
      .join('&');

    if (families) {
      linkEl.href = `https://fonts.googleapis.com/css2?${families}&display=swap`;
    }
  }, [config]);

  return { config, loading, error };
}
