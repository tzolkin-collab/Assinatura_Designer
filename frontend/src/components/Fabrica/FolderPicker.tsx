'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Folder, FolderPlus, Check, ChevronDown, Loader2 } from 'lucide-react';
import { api, API_BASE } from '@/lib/api';

export type FolderNode = { id: string; name: string; parentId: string | null };

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('auth_token');
}

/**
 * Achata a árvore em uma lista com profundidade, para o menu poder indentar as
 * subpastas. Pai que não existe na lista (pasta órfã) é tratado como raiz — senão a
 * pasta sumiria do menu e o usuário não teria como escolhê-la.
 */
function achatarArvore(folders: FolderNode[]): Array<{ folder: FolderNode; depth: number }> {
  const ids = new Set(folders.map((f) => f.id));
  const porPai = new Map<string | null, FolderNode[]>();
  for (const f of folders) {
    const pai = f.parentId && ids.has(f.parentId) ? f.parentId : null;
    const irmaos = porPai.get(pai) ?? [];
    irmaos.push(f);
    porPai.set(pai, irmaos);
  }

  const saida: Array<{ folder: FolderNode; depth: number }> = [];
  const descer = (pai: string | null, depth: number) => {
    for (const folder of porPai.get(pai) ?? []) {
      saida.push({ folder, depth });
      descer(folder.id, depth + 1);
    }
  };
  descer(null, 0);
  return saida;
}

interface FolderPickerProps {
  marca: string;
  sessionId: string | null;
  disabled?: boolean;
}

/**
 * Escolhe a pasta em que o deck desta sessão vai nascer.
 *
 * O destino vive na SESSÃO (backend), não neste componente: o Post só é criado lá no
 * fim do pipeline, então de nada adiantaria guardar a escolha só aqui. Antes disto o
 * deck nascia solto na raiz e o usuário tinha de ir caçá-lo na galeria para arrastar
 * até a pasta — na prática, deck gerado era deck perdido.
 */
export default function FolderPicker({ marca, sessionId, disabled }: FolderPickerProps) {
  const [folders, setFolders] = useState<FolderNode[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [aberto, setAberto] = useState(false);
  const [criando, setCriando] = useState(false);
  const [nomeNovo, setNomeNovo] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  /**
   * O `sessionId` vem de um `useState` que lê o `sessionStorage` no inicializador
   * (`fabrica/page.tsx`). No servidor isso é sempre `null`; no cliente, já vem
   * preenchido quando existe sessão salva. Essa divergência é antiga, mas era invisível
   * — nada renderizava diferente por causa dela. Este botão renderiza (`disabled`,
   * `cursor`, `opacity`, `title` dependem do sessionId), então ele passou a EXPOR a
   * divergência e o React acusou erro de hidratação.
   *
   * Logo: o primeiro render do cliente tem de ser idêntico ao do servidor. Só depois de
   * montado é que o componente passa a olhar o `sessionId`.
   */
  const [montado, setMontado] = useState(false);
  useEffect(() => setMontado(true), []);
  const pronto = montado && !!sessionId;

  useEffect(() => {
    api.get<FolderNode[]>(`/folders/${marca}`)
      .then((data) => { if (data) setFolders(data); })
      .catch(() => setErro('Não consegui carregar as pastas.'));
  }, [marca]);

  useEffect(() => {
    function foraDaCaixa(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setAberto(false);
        setCriando(false);
      }
    }
    document.addEventListener('mousedown', foraDaCaixa);
    return () => document.removeEventListener('mousedown', foraDaCaixa);
  }, []);

  /** Grava o destino na sessão do backend — é ela que o pipeline lê ao criar o Post. */
  const gravarNaSessao = useCallback(async (folderId: string | null) => {
    if (!sessionId) return;
    const token = getToken();
    if (!token) return;

    setSalvando(true);
    setErro(null);
    try {
      const r = await fetch(`${API_BASE}/fabrica/sessions/${encodeURIComponent(sessionId)}/folder`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ folderId }),
      });
      if (!r.ok) throw new Error(String(r.status));
    } catch {
      setErro('Não consegui salvar a pasta de destino.');
    } finally {
      setSalvando(false);
    }
  }, [sessionId]);

  // A sessão pode ser recriada (nova conversa, reconexão) DEPOIS de o usuário escolher
  // a pasta. Sem reenviar a escolha, ela ficaria só na tela e o deck nasceria na raiz —
  // exatamente o bug silencioso que este componente existe para matar.
  useEffect(() => {
    if (sessionId && selectedId) void gravarNaSessao(selectedId);
  }, [sessionId, selectedId, gravarNaSessao]);

  const escolher = (folderId: string | null) => {
    setSelectedId(folderId);
    setAberto(false);
    void gravarNaSessao(folderId);
  };

  const criarPasta = async () => {
    const nome = nomeNovo.trim();
    if (!nome || salvando) return;
    setSalvando(true);
    setErro(null);
    try {
      const nova = await api.post<FolderNode>(`/folders/${marca}`, { name: nome });
      if (nova) {
        setFolders((prev) => [...prev, nova]);
        setNomeNovo('');
        setCriando(false);
        escolher(nova.id);
      }
    } catch {
      setErro('Não consegui criar a pasta.');
    } finally {
      setSalvando(false);
    }
  };

  const selecionada = folders.find((f) => f.id === selectedId) ?? null;
  const arvore = achatarArvore(folders);

  return (
    <div ref={boxRef} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 6, padding: '0 4px 6px', fontSize: 12 }}>
      <span style={{ color: 'var(--color-text-muted, #6b7280)' }}>Salvar em:</span>

      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        disabled={disabled || !pronto}
        title={pronto ? 'Escolher a pasta onde este design vai nascer' : 'Aguardando a sessão iniciar'}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          background: 'transparent',
          border: '1px solid var(--color-border, rgba(0,0,0,0.12))',
          borderRadius: 999, padding: '3px 10px',
          cursor: disabled || !pronto ? 'not-allowed' : 'pointer',
          opacity: disabled || !pronto ? 0.5 : 1,
          fontSize: 12, color: 'inherit',
        }}
      >
        <Folder size={13} />
        <span>{selecionada ? selecionada.name : 'Sem pasta'}</span>
        {salvando ? <Loader2 size={12} className="animate-spin" /> : <ChevronDown size={12} />}
      </button>

      {erro && <span style={{ color: '#b91c1c' }}>{erro}</span>}

      {aberto && (
        <div
          style={{
            position: 'absolute', bottom: '100%', left: 60, marginBottom: 6,
            minWidth: 220, maxHeight: 280, overflowY: 'auto',
            background: '#fff', color: '#1f2937',
            border: '1px solid rgba(0,0,0,0.08)', borderRadius: 10,
            boxShadow: '0 8px 28px rgba(0,0,0,0.12)', zIndex: 200, padding: 4,
          }}
        >
          <button
            type="button"
            onClick={() => escolher(null)}
            style={itemStyle(selectedId === null, 0)}
          >
            <span>Sem pasta (raiz)</span>
            {selectedId === null && <Check size={13} />}
          </button>

          {arvore.map(({ folder, depth }) => (
            <button
              key={folder.id}
              type="button"
              onClick={() => escolher(folder.id)}
              style={itemStyle(selectedId === folder.id, depth)}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden' }}>
                <Folder size={13} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{folder.name}</span>
              </span>
              {selectedId === folder.id && <Check size={13} />}
            </button>
          ))}

          <div style={{ borderTop: '1px solid rgba(0,0,0,0.06)', marginTop: 4, paddingTop: 4 }}>
            {criando ? (
              <div style={{ display: 'flex', gap: 4, padding: '2px 4px' }}>
                <input
                  autoFocus
                  value={nomeNovo}
                  onChange={(e) => setNomeNovo(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void criarPasta();
                    if (e.key === 'Escape') { setCriando(false); setNomeNovo(''); }
                  }}
                  placeholder="Nome da pasta"
                  style={{
                    flex: 1, minWidth: 0, fontSize: 12, padding: '4px 8px',
                    border: '1px solid rgba(0,0,0,0.12)', borderRadius: 6, outline: 'none',
                  }}
                />
                <button
                  type="button"
                  onClick={() => void criarPasta()}
                  disabled={!nomeNovo.trim() || salvando}
                  style={{
                    background: '#4f46e5', color: '#fff', border: 'none',
                    borderRadius: 6, padding: '4px 10px', fontSize: 12,
                    cursor: nomeNovo.trim() ? 'pointer' : 'not-allowed',
                  }}
                >
                  Criar
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => setCriando(true)} style={itemStyle(false, 0)}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#4f46e5' }}>
                  <FolderPlus size={13} />
                  Nova pasta
                </span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function itemStyle(ativo: boolean, depth: number): React.CSSProperties {
  return {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
    width: '100%', textAlign: 'left',
    padding: '6px 8px', paddingLeft: 8 + depth * 14,
    background: ativo ? 'rgba(79,70,229,0.08)' : 'transparent',
    border: 'none', borderRadius: 6, cursor: 'pointer',
    fontSize: 12, color: 'inherit',
  };
}
