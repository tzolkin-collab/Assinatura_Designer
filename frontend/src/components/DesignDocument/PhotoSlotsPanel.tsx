'use client';

// Painel "Fotos" do editor: coloca, troca, enquadra e remove a foto de cada espaço do slide.
//
// O artista reserva a área da foto como <div data-photo-slot="N"> (backend: lib/photoSlot.ts).
// Aqui a PESSOA escolhe a foto, olhando para ela — a IA não participa e nenhuma imagem é
// gerada: só entram fotos da biblioteca da marca. Cada troca vira uma versão no histórico.

import { useCallback, useEffect, useState } from 'react';
import { Check, ImagePlus, Loader2, Trash2, Upload } from 'lucide-react';
import { api, getApiErrorMessage } from '@/lib/api';
import { useBrandAssets, type BrandAsset } from '@/hooks/useBrandAssets';
import type { SlideCode } from './SlideCodeEditor';

export interface PhotoSlot {
  slot: string;
  hasPhoto: boolean;
  src?: string;
  position: { x: number; y: number };
  fit: 'cover' | 'contain';
}

interface PhotoSlotsPanelProps {
  postId: string;
  /** Slug da marca (biblioteca de onde saem as fotos). */
  marca: string;
  slideIndex: number;
  /** HTML atual do slide: muda quando a IA, o código ou uma restauração alteram o slide. */
  slideHtml: string;
  /** Chamado com o slide SANITIZADO devolvido pelo servidor. */
  onApplied: (slideIndex: number, slide: SlideCode) => void;
  /** Slide sem espaço de foto: leva a pessoa ao pedido de IA já escrito (cria um espaço vazio). */
  onPedirEspaco?: () => void;
}

const muted = 'var(--color-text-muted, #6b7280)';
const border = '1px solid var(--color-border, rgba(0,0,0,0.12))';

const isPhoto = (a: BrandAsset) => a.fileType.startsWith('image/');

// Origens que costumam ser foto de verdade (enviada ou importada); identidade e brandbook (paleta, fontes,
// moodboard) vêm depois na lista. Imagem gerada por IA não entra: a regra do painel é foto real.
const ORIGEM_FOTO = new Set(['upload', 'drive', 'canva', 'asana']);
const ordemOrigem = (a: BrandAsset) => (ORIGEM_FOTO.has(a.source ?? '') ? 0 : 1);

interface Framing { mode: 'manual' | 'kept' | 'auto' | 'center'; faceVisible?: number | null }

/** O que dizer à pessoa sobre o enquadramento que o servidor escolheu. `null` = nada a dizer. */
export function framingNotice(f: Framing | undefined): string | null {
  if (!f) return null;
  if (f.mode === 'auto') {
    return f.faceVisible != null && f.faceVisible < 0.98
      ? 'Enquadrei pelo rosto, mas este espaço é estreito demais para mostrá-lo inteiro. Ajuste o enquadramento ou use outra foto.'
      : 'Enquadrei a foto pelo assunto principal. Se preferir outro corte, ajuste o enquadramento abaixo.';
  }
  if (f.mode === 'center') return 'Não consegui identificar o assunto da foto, então ela ficou centralizada. Confira o corte e ajuste abaixo se precisar.';
  return null;
}

export default function PhotoSlotsPanel({ postId, marca, slideIndex, slideHtml, onApplied, onPedirEspaco }: PhotoSlotsPanelProps) {
  const { assets, loading: carregandoBiblioteca, uploading, error: erroBiblioteca, upload } = useBrandAssets(marca);
  const [slots, setSlots] = useState<PhotoSlot[] | null>(null);
  const [escolhendo, setEscolhendo] = useState<string | null>(null); // slot com o seletor aberto
  const [ocupado, setOcupado] = useState<string | null>(null); // slot em gravação
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  // Enquadramento em edição: só vai ao servidor quando a pessoa solta o controle.
  const [rascunho, setRascunho] = useState<Record<string, { x: number; y: number }>>({});

  // Relê a lista quando o HTML muda por fora (IA, código, restauração). Ao trocar de slide o
  // pai remonta o painel (`key`), então estado de um slide nunca vaza para outro.
  useEffect(() => {
    let vivo = true;
    api.get<{ slots: PhotoSlot[] }>(`/posts/${postId}/slides/${slideIndex}/photo-slots`)
      .then((r) => { if (vivo) { setSlots(r.slots); setErro(null); } })
      .catch((e) => { if (vivo) setErro(getApiErrorMessage(e, 'Não consegui ler os espaços de foto deste slide.')); });
    return () => { vivo = false; };
  }, [postId, slideIndex, slideHtml]);

  const aplicar = useCallback(async (slot: string, body: Record<string, unknown>) => {
    setOcupado(slot);
    setErro(null);
    setAviso(null);
    try {
      const r = await api.put<{ slideIndex: number; slide: SlideCode; slots: PhotoSlot[]; framing?: Framing }>(
        `/posts/${postId}/slides/${slideIndex}/photo`,
        { slot, ...body },
      );
      setSlots(r.slots);
      setAviso(framingNotice(r.framing));
      setEscolhendo(null);
      setRascunho((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => k !== slot)));
      onApplied(r.slideIndex, r.slide);
    } catch (e) {
      setErro(getApiErrorMessage(e, 'Não consegui aplicar a foto — o slide continua como estava.'));
    } finally {
      setOcupado(null);
    }
  }, [postId, slideIndex, onApplied]);

  const enviarFoto = useCallback(async (slot: string, file: File | undefined) => {
    if (!file) return;
    const asset = await upload(file);
    if (asset) await aplicar(slot, { assetUrl: asset.url });
  }, [upload, aplicar]);

  if (slots === null && !erro) {
    return <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: muted }}><Loader2 size={13} className="animate-spin" /> Lendo o slide…</div>;
  }

  const emUso = new Set((slots ?? []).map((s) => s.src).filter(Boolean));
  const fotos = assets
    .filter((a) => isPhoto(a) && (a.source !== 'ai-generated' || emUso.has(a.url)))
    .sort((a, b) => ordemOrigem(a) - ordemOrigem(b));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 600 }}>Fotos do slide {slideIndex + 1}</div>
      <p style={{ fontSize: 12, color: muted, margin: 0 }}>
        Só entram fotos reais da biblioteca da marca. Nada é gerado por IA, e cada troca cria uma versão que dá para restaurar.
      </p>

      {ocupado && (
        <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, background: 'var(--color-brand-light, #fff4ed)', borderRadius: 8, padding: '8px 10px' }}>
          <Loader2 size={14} className="animate-spin" />
          <span>Aplicando a foto no slide… o enquadramento é calculado pelo assunto, pode levar alguns segundos.</span>
        </div>
      )}
      {erro && <div style={{ fontSize: 12, color: '#b91c1c', background: '#fef2f2', borderRadius: 8, padding: '6px 10px' }}>{erro}</div>}
      {aviso && <div role="status" style={{ fontSize: 12, background: 'var(--color-bg-secondary, #f3f4f6)', borderRadius: 8, padding: '6px 10px' }}>{aviso}</div>}

      {slots && slots.length === 0 && (
        <p style={{ fontSize: 12.5, color: muted, margin: 0 }}>
          Este slide não tem espaço reservado para foto.
        </p>
      )}
      {slots && slots.length === 0 && onPedirEspaco && (
        <div>
          <button type="button" onClick={onPedirEspaco}
            style={{ fontSize: 12.5, padding: '6px 12px', borderRadius: 8, border, background: 'transparent', cursor: 'pointer' }}>
            Pedir à IA um espaço de foto
          </button>
        </div>
      )}

      {slots?.map((s) => {
        const pos = rascunho[s.slot] ?? s.position;
        const busy = ocupado === s.slot;
        return (
          <div key={s.slot} style={{ border, borderRadius: 10, padding: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 64, height: 64, flexShrink: 0, borderRadius: 8, overflow: 'hidden', border,
                background: 'var(--color-bg-secondary, #f3f4f6)', display: 'grid', placeItems: 'center', color: muted,
              }}>
                {s.hasPhoto && s.src
                  // eslint-disable-next-line @next/next/no-img-element -- miniatura de URL externa do R2, sem otimização
                  ? <img src={s.src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <ImagePlus size={20} />}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>Foto {s.slot}</div>
                <div style={{ fontSize: 11.5, color: muted }}>{s.hasPhoto ? 'Com foto' : 'Vazio, esperando uma foto'}</div>
              </div>
              {busy && <Loader2 size={14} className="animate-spin" />}
            </div>

            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button type="button" disabled={busy} onClick={() => setEscolhendo(escolhendo === s.slot ? null : s.slot)}
                style={{ fontSize: 12, padding: '5px 10px', borderRadius: 8, border, background: 'transparent', cursor: 'pointer' }}>
                {s.hasPhoto ? 'Trocar foto' : 'Escolher foto'}
              </button>
              {s.hasPhoto && (
                <button type="button" disabled={busy} onClick={() => void aplicar(s.slot, { assetUrl: null })}
                  style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, padding: '5px 10px', borderRadius: 8, border, background: 'transparent', cursor: 'pointer' }}>
                  <Trash2 size={12} /> Remover
                </button>
              )}
            </div>

            {escolhendo === s.slot && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: uploading ? 'wait' : 'pointer', color: 'var(--color-brand, #FF6B35)' }}>
                  {uploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />} Enviar uma foto nova
                  <input type="file" accept="image/*" hidden disabled={uploading || busy}
                    onChange={(e) => { void enviarFoto(s.slot, e.target.files?.[0]); e.target.value = ''; }} />
                </label>
                {erroBiblioteca && <div style={{ fontSize: 11.5, color: '#b91c1c' }}>{erroBiblioteca}</div>}
                {carregandoBiblioteca && <div style={{ fontSize: 12, color: muted }}>Carregando a biblioteca…</div>}
                {!carregandoBiblioteca && fotos.length === 0 && (
                  <div style={{ fontSize: 12, color: muted }}>A biblioteca da marca ainda não tem fotos. Envie uma acima.</div>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))', gap: 6, maxHeight: 220, overflowY: 'auto', opacity: busy ? 0.5 : 1, transition: 'opacity 120ms' }} aria-busy={busy}>
                  {fotos.map((a) => {
                    const atual = a.url === s.src;
                    return (
                      <button key={a.id} type="button" title={a.name} disabled={busy}
                        onClick={() => void aplicar(s.slot, { assetUrl: a.url })}
                        style={{
                          position: 'relative', aspectRatio: '1 / 1', padding: 0, borderRadius: 8, overflow: 'hidden', cursor: 'pointer',
                          border: atual ? '2px solid var(--color-brand, #FF6B35)' : border, background: 'transparent',
                        }}>
                        {/* eslint-disable-next-line @next/next/no-img-element -- miniatura de URL externa do R2 */}
                        <img src={a.url} alt={a.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                        {atual && <Check size={14} style={{ position: 'absolute', top: 4, right: 4, color: '#fff', background: 'var(--color-brand, #FF6B35)', borderRadius: 999, padding: 2 }} />}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {s.hasPhoto && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontSize: 11.5, color: muted }}>Enquadramento: arraste para mostrar outra parte da foto</div>
                {(['x', 'y'] as const).map((eixo) => (
                  <label key={eixo} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                    <span style={{ width: 62, color: muted }}>{eixo === 'x' ? 'Horizontal' : 'Vertical'}</span>
                    <input type="range" min={0} max={100} step={1} value={pos[eixo]} disabled={busy} style={{ flex: 1 }}
                      onChange={(e) => setRascunho((prev) => ({ ...prev, [s.slot]: { ...pos, [eixo]: Number(e.target.value) } }))}
                      onPointerUp={() => rascunho[s.slot] && void aplicar(s.slot, { position: rascunho[s.slot] })}
                      onKeyUp={() => rascunho[s.slot] && void aplicar(s.slot, { position: rascunho[s.slot] })} />
                    <span style={{ width: 30, textAlign: 'right', color: muted }}>{Math.round(pos[eixo])}%</span>
                  </label>
                ))}
                <div style={{ display: 'flex', gap: 6 }}>
                  {(['cover', 'contain'] as const).map((f) => (
                    <button key={f} type="button" disabled={busy || s.fit === f} onClick={() => void aplicar(s.slot, { fit: f })}
                      style={{
                        fontSize: 11.5, padding: '4px 10px', borderRadius: 999, cursor: s.fit === f ? 'default' : 'pointer',
                        border: s.fit === f ? '1px solid var(--color-brand, #FF6B35)' : border,
                        background: s.fit === f ? 'rgba(255,107,53,0.08)' : 'transparent',
                      }}>
                      {f === 'cover' ? 'Preencher' : 'Mostrar inteira'}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
