'use client';

import React, { useEffect, useRef, useState } from 'react';
import type { FabricaMessage } from '@/hooks/useFabricaWs';

interface RealtimePreviewProps {
  messages: FabricaMessage[];
  isGenerating: boolean;
  baseCss?: string;
}

/**
 * Extracts partial HTML from the JSON stream produced by htmlDesign.ts
 */
function extractPartialHtml(rawText: string): string {
  // O backend faz stream de um array JSON: {"slides": [{"html": "<div...", "css": "..."}]}
  // Precisamos extrair a string de dentro da chave "html":
  const matches = [...rawText.matchAll(/"html"\s*:\s*"((?:[^"\\]|\\.)*)/g)];
  if (matches.length > 0) {
    const latestRaw = matches[matches.length - 1][1];
    try {
      // JSON.parse para decodificar escapes (\n, \", etc)
      return JSON.parse(`"${latestRaw}"`);
    } catch {
      // Se quebrou (ex: aspas não fechadas no fim do stream), limpamos na mão
      return latestRaw
        .replace(/\\n/g, '\n')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');
    }
  }
  return '';
}

export function RealtimePreview({ messages, isGenerating, baseCss = '' }: RealtimePreviewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Injeta o HTML diretamente no iframe com requestAnimationFrame para não travar a UI (60fps)
  useEffect(() => {
    if (!isGenerating) return;
    
    // Pega a última mensagem (o stream de token atual)
    const lastMsg = messages[messages.length - 1];
    if (lastMsg?.role === 'assistant' && lastMsg.content) {
      const partialHtml = extractPartialHtml(lastMsg.content);
      if (partialHtml.trim().length > 0 && iframeRef.current) {
        requestAnimationFrame(() => {
          const doc = iframeRef.current?.contentDocument;
          if (doc) {
            // Tolerância a falhas nativa do DOM: ao injetar HTML quebrado, 
            // o navegador fecha as tags automaticamente.
            doc.body.innerHTML = partialHtml;
            
            // Garante que o CSS global / Fontes da marca estejam injetados apenas uma vez
            if (!doc.head.querySelector('#preview-styles')) {
              const style = doc.createElement('style');
              style.id = 'preview-styles';
              style.innerHTML = `
                @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Outfit:wght@400;500;600;700;800&display=swap');
                body { margin: 0; padding: 0; overflow: hidden; font-family: 'Inter', sans-serif; }
                ${baseCss}
              `;
              doc.head.appendChild(style);
            }
          }
        });
      }
    }
  }, [messages, isGenerating, baseCss]);

  if (!isGenerating) return null;

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <iframe
        ref={iframeRef}
        title="Real-time Preview"
        style={{
          flex: 1,
          border: 'none',
          backgroundColor: '#fff',
          borderRadius: '8px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.05)',
        }}
      />
    </div>
  );
}
