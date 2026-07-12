'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Layers,
  Image as ImageIcon,
  LayoutGrid,
  ChevronLeft,
  ChevronRight,
  FileJson,
  Save,
  Check,
  SlidersHorizontal,
  Keyboard,
  Type,
  Square,
  Circle,
  Triangle,
  Pentagon,
  Minus,
  Plus,
  Wand2
} from 'lucide-react';
import DesignRenderer, { type DesignPage, type Layer } from '@/components/Fabrica/DesignRenderer';
import CanvasEditor, { type CanvasEditorHandle } from '@/components/Editor/CanvasEditor';
import { extractEditablePages, isFabricaDesignContent, withUpdatedFabricaPages, type HybridDesignPostContent, type HtmlDesignPostContent, type IRDesignPostContent } from '@/lib/designContent';
import HtmlSlideRenderer from '@/components/DesignDocument/HtmlSlideRenderer';
import IRCanvasEditor, { type IRCanvasEditorHandle } from '@/components/Editor/IRCanvasEditor';
import AIEditBar from '@/components/Editor/AIEditBar';
import IRPropertiesPanel from '@/components/Editor/IRPropertiesPanel';
import { type DesignIR, type IRPatch } from '@/lib/designIR/types';
import { applyPatch } from '@/lib/designIR/patcher';
import LayerPropertiesPanel from '@/components/Editor/LayerPropertiesPanel';
import BackgroundPanel from '@/components/Editor/panels/BackgroundPanel';
import MultiSelectPanel from '@/components/Editor/panels/MultiSelectPanel';
import ShortcutsPanel from '@/components/Editor/ShortcutsPanel';
import AIFixPanel from '@/components/Editor/AIFixPanel';
import SlideThumbnailPanel from '@/components/Editor/SlideThumbnailPanel';
import LayerListPanel from '@/components/Editor/LayerListPanel';
import { useShortcutHandler } from '@/hooks/useShortcutHandler';
import { useDesignFixer } from '@/hooks/useDesignFixer';
import { copyLayers, pasteLayers, getClipboardCount } from '@/lib/clipboardStore';
import { api } from '@/lib/api';
import { useBrandPosts, type Post } from '@/lib/hooks';
import Button from '@/components/ui/Button';
import styles from './editor.module.css';

type SidebarTab = 'designs' | 'layers' | 'assets' | 'props';

function formatPostType(type: string) {
  switch (type) {
    case 'CAROUSEL': return 'Carrossel';
    case 'ANIMATION': return 'Animação';
    case 'SINGLE_IMAGE': return 'Post Único';
    default: return type;
  }
}

function LayerThumbnail({ layer }: { layer: Layer }) {
  if (layer.type === 'text') {
    return (
      <div className={styles.layerIcon}>
        <span className={styles.layerIconText}>{layer.content ? layer.content.charAt(0).toUpperCase() : 'T'}</span>
      </div>
    );
  }
  if (layer.type === 'image' && layer.url) {
    return (
      <div className={styles.layerIcon}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={layer.url} alt="" className={styles.layerIconImage} />
      </div>
    );
  }
  return (
    <div className={styles.layerIcon}>
      <div
        className={styles.layerIconShape}
        style={{
          backgroundColor: layer.color || 'transparent',
          borderColor: layer.borderColor || 'currentColor',
          borderRadius: layer.borderRadius || 0
        }}
      />
    </div>
  );
}

export default function DesignEditorPage() {
  const params = useParams();
  const router = useRouter();
  const slug = params.marca as string;
  const postId = params.postId as string;

  const [activeSlide, setActiveSlide] = useState(0);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('layers');
  const [pages, setPages] = useState<DesignPage[]>([]);
  const [postType, setPostType] = useState('');
  const [canvasW, setCanvasW] = useState(1080);
  const [canvasH, setCanvasH] = useState(1080);
  const [loading, setLoading] = useState(true);
  const [loadState, setLoadState] = useState<'ready' | 'hybrid-uncompiled' | 'html' | 'ir' | 'invalid'>('ready');
  const [htmlPostContent, setHtmlPostContent] = useState<HtmlDesignPostContent | null>(null);
  const [irPostContent, setIrPostContent] = useState<IRDesignPostContent | null>(null);
  const [editInstruction, setEditInstruction] = useState('');
  const [editingSlide, setEditingSlide] = useState(false);
  const [editLog, setEditLog] = useState<string[]>([]);
  const [compileWarnings, setCompileWarnings] = useState<string[]>([]);
  const [selectedLayerIds, setSelectedLayerIds] = useState<string[]>([]);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [isExportingCanva, setIsExportingCanva] = useState(false);
  const [canvaProgress, setCanvaProgress] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<'single' | 'grid'>('single');
  const [snapEnabled, setSnapEnabled] = useState(true);

  const [insertMenuOpen, setInsertMenuOpen] = useState(false);
  const [insertCategory, setInsertCategory] = useState<'shapes' | 'text'>('shapes');
  const insertMenuRef = useRef<HTMLDivElement>(null);

  const [showFixPanel, setShowFixPanel] = useState(false);
  const fixer = useDesignFixer();

  const [previewLayerId, setPreviewLayerId] = useState<string | null>(null);
  const [previewKey, setPreviewKey] = useState(0);

  const canvasEditorRef = useRef<CanvasEditorHandle>(null);
  const irCanvasEditorRef = useRef<IRCanvasEditorHandle>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (insertMenuRef.current && !insertMenuRef.current.contains(e.target as Node)) {
        setInsertMenuOpen(false);
      }
    }
    if (insertMenuOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [insertMenuOpen]);

  // History
  const undoStack = useRef<DesignPage[][]>([]);
  const redoStack = useRef<DesignPage[][]>([]);

  // Always-fresh refs for use inside stable callbacks
  const pagesRef = useRef(pages);
  const originalHybridContentRef = useRef<HybridDesignPostContent | null>(null);
  pagesRef.current = pages;
  const activeSlideRef = useRef(activeSlide);
  activeSlideRef.current = activeSlide;
  const selectedLayerIdsRef = useRef(selectedLayerIds);
  selectedLayerIdsRef.current = selectedLayerIds;
  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;
  const isSavingRef = useRef(isSaving);
  isSavingRef.current = isSaving;
  const postIdRef = useRef(postId);
  postIdRef.current = postId;

  // ── Core mutation ────────────────────────────────────────────────────────────

  const applyChange = useCallback((updater: (prev: DesignPage[]) => DesignPage[]) => {
    setPages((prev) => {
      undoStack.current.push(prev);
      if (undoStack.current.length > 60) undoStack.current.shift();
      redoStack.current = [];
      return updater(prev);
    });
    setIsDirty(true);
  }, []);

  // ── Layer mutations ──────────────────────────────────────────────────────────

  const addLayer = useCallback((type: 'text' | 'shape' | 'image', url?: string, overrides?: Partial<Layer>) => {
    const newId = `layer-${Date.now()}`;
    const newZ = (pages[activeSlide]?.layers?.length ?? 0) + 1;
    let base: Layer = { id: newId, type, x: 100, y: 100, width: 200, height: 200, zIndex: newZ };

    if (type === 'text') {
      base.content = 'Novo Texto';
      base.fontSize = 48;
      base.height = 60;
    }
    if (type === 'shape') {
      base.color = '#cccccc';
    }
    if (type === 'image' && url) {
      base.url = url;
    }

    if (overrides) {
      base = { ...base, ...overrides };
    }

    applyChange(prev => prev.map((page, i) => i === activeSlide ? { ...page, layers: [...(page.layers ?? []), base] } : page));
    setSelectedLayerIds([newId]);
  }, [pages, activeSlide, applyChange]);

  const undo = useCallback(() => {
    const snapshot = undoStack.current.pop();
    if (!snapshot) return;
    redoStack.current.push(pagesRef.current);
    setPages(snapshot);
    setIsDirty(true);
  }, []);

  const redo = useCallback(() => {
    const snapshot = redoStack.current.pop();
    if (!snapshot) return;
    undoStack.current.push(pagesRef.current);
    setPages(snapshot);
    setIsDirty(true);
  }, []);

  // ── Slide mutations ────────────────────────────────────────────────────────

  const handleAddBlankSlide = useCallback(() => {
    if (pagesRef.current.length >= 20) return;
    applyChange(prev => [
      ...prev,
      { layers: [], backgroundColor: '#ffffff', width: canvasW, height: canvasH }
    ]);
    // Use functional updater — applyChange is async, pagesRef still has old length
    setActiveSlide(() => pagesRef.current.length);
  }, [applyChange, canvasW, canvasH]);

  const handleDuplicateSlide = useCallback((index: number) => {
    if (pagesRef.current.length >= 20) return;
    applyChange(prev => {
      const slideToCopy = prev[index];
      if (!slideToCopy) return prev;
      
      const newSlide: DesignPage = {
        ...slideToCopy,
        layers: (slideToCopy.layers ?? []).map(layer => ({
          ...layer,
          id: crypto.randomUUID()
        }))
      };
      
      const newPages = [...prev];
      newPages.splice(index + 1, 0, newSlide);
      return newPages;
    });
    setActiveSlide(index + 1);
  }, [applyChange]);

  const handleDeleteSlide = useCallback((index: number) => {
    if (pagesRef.current.length <= 1) return;
    if (!window.confirm(`Deletar slide ${index + 1}? Esta ação pode ser desfeita com Ctrl+Z.`)) return;
    
    applyChange(prev => {
      const newPages = [...prev];
      newPages.splice(index, 1);
      return newPages;
    });
    
    setActiveSlide(current => {
      if (current === index) {
        return Math.max(0, index - 1);
      }
      if (current > index) {
        return current - 1;
      }
      return current;
    });
  }, [applyChange]);

  const handleReorderSlide = useCallback((from: number, to: number) => {
    if (to < 0 || to >= pagesRef.current.length) return;
    
    applyChange(prev => {
      const newPages = [...prev];
      const [moved] = newPages.splice(from, 1);
      newPages.splice(to, 0, moved);
      return newPages;
    });
    
    setActiveSlide(current => {
      if (current === from) return to;
      if (current >= to && current < from) return current + 1;
      if (current <= to && current > from) return current - 1;
      return current;
    });
  }, [applyChange]);

  // ── Data loading ─────────────────────────────────────────────────────────────

  const { posts } = useBrandPosts(slug);

  useEffect(() => {
    if (!postId) return;
    setLoading(true);
    setActiveSlide(0);
    setSelectedLayerIds([]);
    setIsDirty(false);
    setLoadState('ready');
    setCompileWarnings([]);
    undoStack.current = [];
    redoStack.current = [];
    originalHybridContentRef.current = null;
    setHtmlPostContent(null);
    setIrPostContent(null);
    api.get<Post>(`/posts/${postId}`)
      .then((post) => {
        if (!post) return;
        const editable = extractEditablePages(post.content);
        if (post.content && typeof post.content === 'object' && !Array.isArray(post.content) && (post.content as { kind?: unknown }).kind === 'hybrid-design') {
          originalHybridContentRef.current = post.content as HybridDesignPostContent;
        }
        if (editable.status === 'ir') {
          setIrPostContent(editable.content);
          setPages([]);
          setLoadState('ir');
          setPostType(post.type);
          const irContent = editable.content.ir;
          if (typeof irContent.width === 'number') setCanvasW(irContent.width);
          if (typeof irContent.height === 'number') setCanvasH(irContent.height);
          return;
        }
        if (editable.status === 'html') {
          setHtmlPostContent(editable.content);
          setPages([]);
          setLoadState('html');
          setPostType(post.type);
          if (typeof editable.content.width === 'number') setCanvasW(editable.content.width);
          if (typeof editable.content.height === 'number') setCanvasH(editable.content.height);
          return;
        }
        if (editable.status === 'editable') {
          setPages(editable.pages);
          setCompileWarnings(editable.warnings ?? []);
          setLoadState('ready');
          const first = editable.pages[0];
          if (typeof first?.width === 'number') setCanvasW(first.width);
          if (typeof first?.height === 'number') setCanvasH(first.height);
          setPostType(post.type);
          return;
        }
        
        setPages([]);
        setLoadState(editable.status === 'hybrid-uncompiled' ? 'hybrid-uncompiled' : 'invalid');
        setPostType(post.type);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [postId]);

  useEffect(() => {
    setSelectedLayerIds([]);
    setSidebarTab((prev) => (prev === 'props' ? 'layers' : prev));
  }, [activeSlide]);

  useEffect(() => {
    if (selectedLayerIds.length > 0) {
      setSidebarTab('props');
      return;
    }
    setSidebarTab((prev) => (prev === 'props' ? 'layers' : prev));
  }, [selectedLayerIds.length]);

  // ── Handlers ─────────────────────────────────────────────────────────────────

  // Edição via chat (html-design): aplica a instrução só ao slide ativo.
  const handleEditSlide = useCallback(async () => {
    const instruction = editInstruction.trim();
    if (!instruction || !htmlPostContent || editingSlide) return;
    setEditingSlide(true);
    try {
      const resp = await api.post<
        { slideIndex: number; slide: { html: string; css?: string } },
        { slideIndex: number; instruction: string }
      >(`/posts/${postId}/edit-slide`, { slideIndex: activeSlide, instruction });
      setHtmlPostContent((prev) => {
        if (!prev) return prev;
        const slides = prev.slides.slice();
        slides[resp.slideIndex] = resp.slide;
        return { ...prev, slides };
      });
      setEditLog((prev) => [...prev, instruction]);
      setEditInstruction('');
    } catch (e) {
      console.error('[edit-slide]', e);
    } finally {
      setEditingSlide(false);
    }
  }, [editInstruction, htmlPostContent, editingSlide, postId, activeSlide]);

  const handleIRPatch = useCallback((patch: IRPatch) => {
    setIrPostContent((prev) => {
      if (!prev || !prev.ir) return prev;
      const newIr = applyPatch(prev.ir as DesignIR, patch);
      return { ...prev, ir: newIr };
    });
    setIsDirty(true);
  }, []);

  const handleLayersChange = useCallback(
    (newLayers: Layer[]) =>
      applyChange((prev) =>
        prev.map((page, i) => (i === activeSlide ? { ...page, layers: newLayers } : page))
      ),
    [activeSlide, applyChange]
  );

  const handleBackgroundChange = useCallback(
    (color: string) =>
      applyChange((prev) =>
        prev.map((page, i) => (i === activeSlide ? { ...page, backgroundColor: color } : page))
      ),
    [activeSlide, applyChange]
  );

  const handleBackgroundImageChange = useCallback(
    (url: string | undefined) =>
      applyChange((prev) =>
        prev.map((page, i) => (i === activeSlide ? { ...page, backgroundImage: url } : page))
      ),
    [activeSlide, applyChange]
  );

  const handleLayerPropertyChange = useCallback(
    (overrides: Partial<Layer>) => {
      const lid = selectedLayerIdsRef.current[0];
      if (!lid) return;
      applyChange((prev) =>
        prev.map((page, i) => {
          if (i !== activeSlide) return page;
          return {
            ...page,
            layers: (page.layers ?? []).map((l) =>
              l.id === lid ? { ...l, ...overrides } : l
            ),
          };
        })
      );
    },
    [activeSlide, applyChange]
  );

  const updateSpecificLayer = useCallback((id: string, overrides: Partial<Layer>) => {
    applyChange((prev) =>
      prev.map((page, i) => {
        if (i !== activeSlide) return page;
        return {
          ...page,
          layers: (page.layers ?? []).map((l) =>
            l.id === id ? { ...l, ...overrides } : l
          ),
        };
      })
    );
  }, [activeSlide, applyChange]);

  const handleMultiSelectChange = useCallback(
    (updates: Map<string, Partial<Layer>>) => {
      applyChange((prev) =>
        prev.map((page, i) => {
          if (i !== activeSlide) return page;
          return {
            ...page,
            layers: (page.layers ?? []).map((l) => {
              const ov = updates.get(l.id);
              return ov ? { ...l, ...ov } : l;
            }),
          };
        })
      );
    },
    [activeSlide, applyChange]
  );

  const handleMarqueeSelect = useCallback((ids: string[]) => {
    setSelectedLayerIds(ids);
  }, []);

  const handlePreviewAnimation = useCallback(() => {
    const lid = selectedLayerIdsRef.current[0];
    if (!lid) return;
    setPreviewLayerId(lid);
    setPreviewKey(k => k + 1);
    // Clear after animation can finish (max duration 3s + max delay 5s + buffer)
    setTimeout(() => setPreviewLayerId(null), 8500);
  }, []);

  const handleSave = useCallback(async () => {
    if (!isDirtyRef.current || isSavingRef.current) return;
    setIsSaving(true);
    try {
      let contentToSave: any;
      if (irPostContent) {
        contentToSave = irPostContent;
      } else {
        const hybrid = originalHybridContentRef.current;
        const currentContent = posts.find((post) => post.id === postIdRef.current)?.content;
        contentToSave = hybrid
          ? { ...hybrid, pages: pagesRef.current }
          : isFabricaDesignContent(currentContent)
            ? withUpdatedFabricaPages(currentContent, pagesRef.current)
            : pagesRef.current;
        if (hybrid) originalHybridContentRef.current = contentToSave as HybridDesignPostContent;
      }
      await api.put(`/posts/${postIdRef.current}`, { content: contentToSave });
      setIsDirty(false);
      setSavedAt(new Date());
    } catch (err) {
      console.error('Failed to save:', err);
    } finally {
      setIsSaving(false);
    }
  }, []);

  // ── Shortcut action builders (read state from refs → no stale closures) ──────

  const nudge = useCallback((dx: number, dy: number) => {
    const layerIds = selectedLayerIdsRef.current;
    const slide = activeSlideRef.current;
    if (layerIds.length === 0) return;
    setPages((prev) => {
      undoStack.current.push(prev);
      redoStack.current = [];
      return prev.map((page, i) =>
        i !== slide
          ? page
          : {
              ...page,
              layers: (page.layers ?? []).map((l) =>
                layerIds.includes(l.id) ? { ...l, x: l.x + dx, y: l.y + dy } : l
              ),
            }
      );
    });
    setIsDirty(true);
  }, []);

  const shiftZIndex = useCallback((delta: number) => {
    const layerIds = selectedLayerIdsRef.current;
    const slide = activeSlideRef.current;
    if (layerIds.length === 0) return;
    setPages((prev) => {
      undoStack.current.push(prev);
      redoStack.current = [];
      return prev.map((page, i) =>
        i !== slide
          ? page
          : {
              ...page,
              layers: (page.layers ?? []).map((l) =>
                layerIds.includes(l.id) ? { ...l, zIndex: (l.zIndex ?? 0) + delta } : l
              ),
            }
      );
    });
    setIsDirty(true);
  }, []);

  const deleteSelected = useCallback(() => {
    const layerIds = selectedLayerIdsRef.current;
    const slide = activeSlideRef.current;
    if (layerIds.length === 0) return;
    setPages((prev) => {
      undoStack.current.push(prev);
      redoStack.current = [];
      return prev.map((page, i) =>
        i !== slide
          ? page
          : { ...page, layers: (page.layers ?? []).filter((l) => !layerIds.includes(l.id)) }
      );
    });
    setIsDirty(true);
    setSelectedLayerIds([]);
  }, []);

  const duplicateSelected = useCallback(() => {
    const layerIds = selectedLayerIdsRef.current;
    const slide = activeSlideRef.current;
    if (layerIds.length === 0) return;
    const toDup = pagesRef.current[slide]?.layers?.filter(l => layerIds.includes(l.id)) ?? [];
    if (toDup.length === 0) return;
    const newIds: string[] = [];
    const copies: Layer[] = toDup.map((layer, i) => {
      const newId = `${layer.id}-copy-${Date.now()}-${i}`;
      newIds.push(newId);
      return { ...layer, id: newId, x: layer.x + 20, y: layer.y + 20 };
    });
    setPages((prev) => {
      undoStack.current.push(prev);
      redoStack.current = [];
      return prev.map((page, i) =>
        i !== slide ? page : { ...page, layers: [...(page.layers ?? []), ...copies] }
      );
    });
    setIsDirty(true);
    setSelectedLayerIds(newIds);
  }, []);

  const handleCopySelected = useCallback(() => {
    const layerIds = selectedLayerIdsRef.current;
    const slide = activeSlideRef.current;
    if (layerIds.length === 0) return;
    const toCopy = pagesRef.current[slide]?.layers?.filter(l => layerIds.includes(l.id)) ?? [];
    copyLayers(toCopy);
  }, []);

  const handlePasteLayers = useCallback(() => {
    if (getClipboardCount() === 0) return;
    const slide = activeSlideRef.current;
    
    // For simplicity, we just use the default +20px offset from the store function,
    // but if we were pasting on a different slide we might want to center it.
    // ADR-0003 specifies +20px for same slide, center for different slide.
    // To know if it's the same slide, we would need to store the source slide index in clipboardStore,
    // but since we only have one simple pasteLayers method, let's just use the default offset for now.
    const copies = pasteLayers(20, 20);
    const newIds = copies.map(l => l.id);

    setPages((prev) => {
      undoStack.current.push(prev);
      redoStack.current = [];
      return prev.map((page, i) =>
        i !== slide ? page : { ...page, layers: [...(page.layers ?? []), ...copies] }
      );
    });
    setIsDirty(true);
    setSelectedLayerIds(newIds);
  }, []);

  const handleCutSelected = useCallback(() => {
    handleCopySelected();
    deleteSelected();
  }, [handleCopySelected, deleteSelected]);

  const handleCenterH = useCallback(() => {
    const layerIds = selectedLayerIdsRef.current;
    if (layerIds.length === 0) return;
    const slide = activeSlideRef.current;
    setPages((prev) => {
      undoStack.current.push(prev);
      redoStack.current = [];
      return prev.map((page, i) =>
        i !== slide ? page : {
          ...page,
          layers: (page.layers ?? []).map((l) =>
            layerIds.includes(l.id) ? { ...l, x: canvasW / 2 - l.width / 2 } : l
          ),
        }
      );
    });
    setIsDirty(true);
  }, [canvasW]);

  const handleCenterV = useCallback(() => {
    const layerIds = selectedLayerIdsRef.current;
    if (layerIds.length === 0) return;
    const slide = activeSlideRef.current;
    setPages((prev) => {
      undoStack.current.push(prev);
      redoStack.current = [];
      return prev.map((page, i) =>
        i !== slide ? page : {
          ...page,
          layers: (page.layers ?? []).map((l) =>
            layerIds.includes(l.id) ? { ...l, y: canvasH / 2 - l.height / 2 } : l
          ),
        }
      );
    });
    setIsDirty(true);
  }, [canvasH]);

  const handleSelectAll = useCallback(() => {
    const slide = activeSlideRef.current;
    const page = pagesRef.current[slide];
    if (page && page.layers) {
      setSelectedLayerIds(page.layers.map(l => l.id));
    }
  }, []);

  const handleZIndexFront = useCallback(() => {
    const layerIds = selectedLayerIdsRef.current;
    if (layerIds.length === 0) return;
    const slide = activeSlideRef.current;
    const page = pagesRef.current[slide];
    if (!page || !page.layers) return;
    const maxZ = Math.max(...page.layers.map(l => l.zIndex ?? 0));
    applyChange(prev => prev.map((p, i) =>
      i !== slide ? p : {
        ...p,
        layers: (p.layers ?? []).map(l =>
          layerIds.includes(l.id) ? { ...l, zIndex: maxZ + 1 } : l
        ),
      }
    ));
  }, [applyChange]);

  const handleZIndexBackAll = useCallback(() => {
    const layerIds = selectedLayerIdsRef.current;
    if (layerIds.length === 0) return;
    const slide = activeSlideRef.current;
    const page = pagesRef.current[slide];
    if (!page || !page.layers) return;
    const minZ = Math.min(...page.layers.map(l => l.zIndex ?? 0));
    applyChange(prev => prev.map((p, i) =>
      i !== slide ? p : {
        ...p,
        layers: (p.layers ?? []).map(l =>
          layerIds.includes(l.id) ? { ...l, zIndex: minZ - 1 } : l
        ),
      }
    ));
  }, [applyChange]);

  const handleToggleVisibility = useCallback(() => {
    const layerIds = selectedLayerIdsRef.current;
    if (layerIds.length === 0) return;
    const slide = activeSlideRef.current;
    const page = pagesRef.current[slide];
    if (!page || !page.layers) return;
    const selectedLayers = page.layers.filter(l => layerIds.includes(l.id));
    const newVisible = selectedLayers.some(l => l.visible === false);
    applyChange(prev => prev.map((p, i) =>
      i !== slide ? p : {
        ...p,
        layers: (p.layers ?? []).map(l =>
          layerIds.includes(l.id) ? { ...l, visible: newVisible } : l
        ),
      }
    ));
  }, [applyChange]);

  const handleToggleLock = useCallback(() => {
    const layerIds = selectedLayerIdsRef.current;
    if (layerIds.length === 0) return;
    const slide = activeSlideRef.current;
    const page = pagesRef.current[slide];
    if (!page || !page.layers) return;
    const selectedLayers = page.layers.filter(l => layerIds.includes(l.id));
    const newLocked = selectedLayers.some(l => !l.locked);
    applyChange(prev => prev.map((p, i) =>
      i !== slide ? p : {
        ...p,
        layers: (p.layers ?? []).map(l =>
          layerIds.includes(l.id) ? { ...l, locked: newLocked } : l
        ),
      }
    ));
  }, [applyChange]);

  const handleTextFormatting = useCallback((field: 'fontWeight' | 'italic' | 'textDecoration') => {
    const layerIds = selectedLayerIdsRef.current;
    if (layerIds.length === 0) return;
    const slide = activeSlideRef.current;
    const page = pagesRef.current[slide];
    if (!page || !page.layers) return;
    const textLayers = page.layers.filter(l => layerIds.includes(l.id) && l.type === 'text');
    if (textLayers.length === 0) return;
    const first = textLayers[0];
    let targetVal: any;
    if (field === 'fontWeight') {
      targetVal = (first.fontWeight === 'bold') ? 'normal' : 'bold';
    } else if (field === 'italic') {
      targetVal = !first.italic;
    } else if (field === 'textDecoration') {
      targetVal = (first.textDecoration === 'underline') ? 'none' : 'underline';
    }
    applyChange(prev => prev.map((p, i) =>
      i !== slide ? p : {
        ...p,
        layers: (p.layers ?? []).map(l =>
          (layerIds.includes(l.id) && l.type === 'text') ? { ...l, [field]: targetVal } : l
        ),
      }
    ));
  }, [applyChange]);

  // ── Keyboard shortcut registration ───────────────────────────────────────────

  const { shortcuts, updateShortcut, resetAll } = useShortcutHandler({
    save: handleSave,
    undo,
    redo,
    shortcuts: () => setShowShortcuts((v) => !v),
    deselect: () => { setSelectedLayerIds([]); setShowShortcuts(false); },
    delete: deleteSelected,
    duplicate: duplicateSelected,
    copy: handleCopySelected,
    paste: handlePasteLayers,
    cut: handleCutSelected,
    'center-h': handleCenterH,
    'center-v': handleCenterV,
    'select-all': handleSelectAll,
    'zindex-forward': () => shiftZIndex(+1),
    'zindex-back': () => shiftZIndex(-1),
    'zindex-front': handleZIndexFront,
    'zindex-back-all': handleZIndexBackAll,
    'toggle-visibility': handleToggleVisibility,
    'toggle-lock': handleToggleLock,
    'text-bold': () => handleTextFormatting('fontWeight'),
    'text-italic': () => handleTextFormatting('italic'),
    'text-underline': () => handleTextFormatting('textDecoration'),
    'zoom-in':     () => canvasEditorRef.current?.zoomIn(),
    'zoom-out':    () => canvasEditorRef.current?.zoomOut(),
    'zoom-fit':    () => canvasEditorRef.current?.zoomFit(),
    'zoom-actual': () => canvasEditorRef.current?.zoomActual(),
    'move-left':    () => nudge(-1, 0),
    'move-right':   () => nudge(+1, 0),
    'move-up':      () => nudge(0, -1),
    'move-down':    () => nudge(0, +1),
    'move-left-10': () => nudge(-10, 0),
    'move-right-10':() => nudge(+10, 0),
    'move-up-10':   () => nudge(0, -10),
    'move-down-10': () => nudge(0, +10),
  });

  // ── Export ───────────────────────────────────────────────────────────────────

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(pages, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `design-${postId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportCanva = useCallback(async () => {
    try {
      const status = await api.get<{ connected: boolean }>(`/canva/${slug}/status`);
      if (!status.connected) {
        const { authUrl } = await api.get<{ authUrl: string }>(`/canva/${slug}/auth-url`);
        // Open OAuth in a centered popup window
        const width = 600;
        const height = 700;
        const left = window.screen.width / 2 - width / 2;
        const top = window.screen.height / 2 - height / 2;
        const popup = window.open(
          authUrl,
          'Conectar Canva',
          `width=${width},height=${height},left=${left},top=${top}`
        );

        const interval = setInterval(async () => {
          if (popup?.closed) {
            clearInterval(interval);
            const check = await api.get<{ connected: boolean }>(`/canva/${slug}/status`);
            if (check.connected) {
              alert('Canva conectado com sucesso! Clique em Exportar novamente.');
            }
          }
        }, 1000);
        return;
      }

      setIsExportingCanva(true);
      setCanvaProgress(0);

      const total = htmlPostContent?.slides?.length ?? pages.length ?? 0;
      if (total === 0) {
        alert('Nenhum slide disponível para exportar.');
        return;
      }

      for (let i = 0; i < total; i++) {
        await api.post(`/posts/${postId}/export-canva`, { slideIndex: i });
        setCanvaProgress(Math.round(((i + 1) / total) * 100));
      }

      alert('Design exportado para o Canva com sucesso! Verifique a aba de uploads no Canva.');
    } catch (err) {
      console.error('[Canva Export Error]', err);
      alert('Erro ao exportar para o Canva. Verifique as configurações e tente novamente.');
    } finally {
      setIsExportingCanva(false);
      setCanvaProgress(null);
    }
  }, [slug, postId, htmlPostContent, pages]);

  // ── Derived state ────────────────────────────────────────────────────────────

  const currentPage = pages[activeSlide];
  const currentLayers = [...(currentPage?.layers ?? [])]
    .filter(Boolean)
    .sort((a, b) => (b.zIndex ?? 0) - (a.zIndex ?? 0));
  const selectedLayer = selectedLayerIds.length === 1
    ? currentPage?.layers?.find((l) => l.id === selectedLayerIds[0]) ?? null
    : null;
  const selectedLayersForPanel = (currentPage?.layers ?? []).filter(l => selectedLayerIds.includes(l.id));
  const designPosts = posts.filter((p) => {
    const status = extractEditablePages(p.content).status;
    return status === 'editable' || status === 'html';
  });
  const allImageLayers = pages.flatMap((page, slideIdx) =>
    [...(page.layers ?? [])].filter(Boolean).filter((l) => l.type === 'image' && l.url).map((l) => ({ ...l, slideIdx }))
  );
  const canvasAr = canvasW / canvasH;

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className={styles.editor}>
      {isExportingCanva && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.6)', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', zIndex: 9999, color: '#fff'
        }}>
          <div style={{ background: '#fff', color: '#333', padding: 24, borderRadius: 16, width: 340, textAlign: 'center', boxShadow: '0 10px 25px rgba(0,0,0,0.2)' }}>
            <h3 style={{ marginBottom: 12, fontSize: 16, fontWeight: 600 }}>Exportando para o Canva</h3>
            <div style={{ height: 10, background: '#f0f0f0', borderRadius: 999, overflow: 'hidden', marginBottom: 12 }}>
              <div style={{ width: `${canvaProgress ?? 0}%`, height: '100%', background: '#7c3aed', transition: 'width 0.4s ease', borderRadius: 999 }}></div>
            </div>
            <p style={{ fontSize: 14, color: '#555', fontWeight: 500 }}>{canvaProgress ?? 0}% Concluído</p>
            <p style={{ fontSize: 11, color: '#999', marginTop: 6 }}>Processando e enviando as páginas para sua biblioteca Canva...</p>
          </div>
        </div>
      )}
      {showShortcuts && (
        <ShortcutsPanel
          shortcuts={shortcuts}
          onClose={() => setShowShortcuts(false)}
          onUpdate={updateShortcut}
          onResetAll={resetAll}
        />
      )}

      {showFixPanel && (
        <AIFixPanel
          phase={fixer.phase}
          issues={fixer.issues}
          fixList={fixer.fixList}
          selectedFixIds={fixer.selectedFixIds}
          remainingIssues={fixer.remainingIssues}
          correctedPages={fixer.correctedPages}
          iteration={fixer.iteration}
          errorMessage={fixer.errorMessage}
          toggleFix={fixer.toggleFix}
          selectAll={fixer.selectAll}
          selectNone={fixer.selectNone}
          onApplySelected={() => fixer.applySelected(pages, slug)}
          onAutoFix={() => fixer.startFix(pages, slug)}
          onApply={(corrected) => {
            applyChange(() => corrected);
            setShowFixPanel(false);
            fixer.reset();
          }}
          onClose={() => {
            fixer.abort();
            fixer.reset();
            setShowFixPanel(false);
          }}
        />
      )}

      {/* Header */}
      <header className={styles.header}>
        <Link href={`/${slug}/galeria`} className={styles.backBtn}>
          <ArrowLeft size={15} />
          Galeria
        </Link>
        <div className={styles.headerInfo}>
          {postType && <span className={styles.headerTitle}>{formatPostType(postType)}</span>}
          {pages.length > 0 && (
            <span className={styles.headerMeta}>
              {pages.length} slide{pages.length !== 1 ? 's' : ''} · {canvasW}×{canvasH}px
            </span>
          )}
        </div>

        {viewMode === 'single' && (
          <div className={styles.insertWrapper} ref={insertMenuRef}>
            <button
              className={`${styles.toolbarBtn} ${insertMenuOpen ? styles.toolbarBtnActive : ''}`}
              onClick={() => setInsertMenuOpen(!insertMenuOpen)}
            >
              <Plus size={14} /> Inserir
            </button>

            {insertMenuOpen && (
              <div className={styles.insertPopover}>
                <div className={styles.insertSidebar}>
                  <button
                    className={`${styles.insertTab} ${insertCategory === 'shapes' ? styles.insertTabActive : ''}`}
                    onClick={() => setInsertCategory('shapes')}
                  >
                    Formas
                  </button>
                  <button
                    className={`${styles.insertTab} ${insertCategory === 'text' ? styles.insertTabActive : ''}`}
                    onClick={() => setInsertCategory('text')}
                  >
                    Texto
                  </button>
                </div>
                <div className={styles.insertContent}>
                  {insertCategory === 'shapes' && (
                    <>
                      <button key="insert-rect" className={styles.insertOption} onClick={() => { addLayer('shape'); setInsertMenuOpen(false); }}>
                        <Square size={24} strokeWidth={1.5} />
                        <span>Retângulo</span>
                      </button>
                      <button key="insert-circle" className={styles.insertOption} onClick={() => { addLayer('shape', undefined, { borderRadius: 999 }); setInsertMenuOpen(false); }}>
                        <Circle size={24} strokeWidth={1.5} />
                        <span>Círculo</span>
                      </button>
                      <button key="insert-tri" className={styles.insertOption} onClick={() => { addLayer('shape', undefined, { shapeType: 'triangle' }); setInsertMenuOpen(false); }}>
                        <Triangle size={24} strokeWidth={1.5} />
                        <span>Triângulo</span>
                      </button>
                      <button key="insert-poly" className={styles.insertOption} onClick={() => { addLayer('shape', undefined, { shapeType: 'polygon' }); setInsertMenuOpen(false); }}>
                        <Pentagon size={24} strokeWidth={1.5} />
                        <span>Polígono</span>
                      </button>
                      <button key="insert-line" className={styles.insertOption} onClick={() => { addLayer('shape', undefined, { shapeType: 'line', height: 4 }); setInsertMenuOpen(false); }}>
                        <Minus size={24} strokeWidth={1.5} />
                        <span>Linha</span>
                      </button>
                    </>
                  )}
                  {insertCategory === 'text' && (
                    <>
                      <button key="insert-text" className={styles.insertOption} onClick={() => { addLayer('text'); setInsertMenuOpen(false); }}>
                        <Type size={24} strokeWidth={1.5} />
                        <span>Título</span>
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        <div className={styles.headerActions}>
          {pages.length > 0 && (
            <button
              className={styles.toolbarBtn}
              style={{ color: 'var(--color-accent)' }}
              onClick={() => {
                setShowFixPanel(true);
                fixer.startPlanOnly(pages, slug);
              }}
              title="Corrigir design com IA — selecione as correções antes de aplicar"
            >
              <Wand2 size={13} />
              Corrigir IA
            </button>
          )}
          <button
            className={styles.exportBtn}
            onClick={() => setViewMode(v => v === 'single' ? 'grid' : 'single')}
            title={viewMode === 'single' ? "Visão Geral (Todos os Slides)" : "Modo de Edição"}
          >
            <LayoutGrid size={13} />
            {viewMode === 'single' ? 'Grade' : 'Editar'}
          </button>
          <button
            className={styles.exportBtn}
            onClick={() => setSnapEnabled((v) => !v)}
            title={`Snap (Ímã): ${snapEnabled ? 'Ligado' : 'Desligado'}`}
            style={{ opacity: snapEnabled ? 1 : 0.5 }}
          >
            Snap
          </button>
          <button
            className={styles.exportBtn}
            onClick={() => setShowShortcuts((v) => !v)}
            title="Atalhos de teclado (?)"
          >
            <Keyboard size={13} />
          </button>
          {savedAt && !isDirty && (
            <span className={styles.saveStatus}>
              <Check size={11} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 3 }} />
              Salvo
            </span>
          )}
          <Button size="sm" variant={isDirty ? 'primary' : 'secondary'} onClick={handleSave} disabled={!isDirty || isSaving}>
            <Save size={13} />
            {isSaving ? 'Salvando...' : 'Salvar'}
          </Button>
          <button
            className={styles.exportBtn}
            onClick={handleExportCanva}
            title="Exportar para o Canva"
            style={{
              backgroundColor: '#7c3aed',
              color: '#fff',
              border: 'none',
              padding: '0 12px',
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              height: 32,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginLeft: 4
            }}
          >
            Canva
          </button>
          <button className={styles.exportBtn} onClick={exportJson} title="Exportar JSON">
            <FileJson size={14} />
            JSON
          </button>
        </div>
      </header>

      {/* Body */}
      <div className={styles.body}>
        <aside className={styles.sidebar}>
          <div className={styles.tabs}>
            {([
              { id: 'designs', icon: <LayoutGrid size={13} />, label: 'Designs' },
              { id: 'layers',  icon: <Layers size={13} />,     label: 'Camadas' },
              { id: 'assets',  icon: <ImageIcon size={13} />,  label: 'Assets' },
              { id: 'props',   icon: <SlidersHorizontal size={13} />, label: 'Propriedades' },
            ] as const).map(({ id, icon, label }) => (
              <button
                key={id}
                className={`${styles.tab} ${sidebarTab === id ? styles.tabActive : ''}`}
                onClick={() => setSidebarTab(id)}
                title={label}
                style={{ position: 'relative' }}
              >
                {icon}
                {id === 'props' && selectedLayerIds.length > 0 && (
                  <span style={{
                    position: 'absolute', top: 6, right: 6,
                    width: 5, height: 5, borderRadius: '50%',
                    background: 'var(--color-accent)',
                  }} />
                )}
              </button>
            ))}
          </div>

          <div className={styles.tabContent}>
            {/* Designs — kept mounted to preserve scroll position */}
            <div style={{ display: sidebarTab === 'designs' ? 'block' : 'none' }} className={styles.designList}>
              {designPosts.length === 0 ? (
                <p className={styles.emptyList}>Nenhum design encontrado.</p>
              ) : (
                designPosts.map((p) => {
                  const editable = extractEditablePages(p.content);
                  const isHtml = editable.status === 'html';
                  const dp = editable.status === 'editable' ? editable.pages : [];
                  const slideCount = isHtml ? editable.content.slides.length : dp.length;
                  const first = dp[0];
                  return (
                    <button key={p.id} className={`${styles.designItem} ${p.id === postId ? styles.designItemActive : ''}`} onClick={() => router.push(`/${slug}/editor/${p.id}`)}>
                      <div className={styles.designThumb} style={{ backgroundColor: isHtml ? '#1a1a1a' : (first?.backgroundColor ?? '#111') }}>
                        {isHtml && p.previewUrl ? (
                          <img src={p.previewUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        ) : first ? (
                          <DesignRenderer pages={[first]} canvasWidth={first.width ?? 1080} canvasHeight={first.height ?? 1080} hideNav mode="cover" />
                        ) : (
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#666', fontSize: 10 }}>Sem Preview</div>
                        )}
                      </div>
                      <div className={styles.designMeta}>
                        <span className={styles.designType}>{formatPostType(p.type)}</span>
                        <span className={styles.designSlides}>{slideCount} slides</span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>

            {/* Layers — kept mounted to preserve state */}
            <div style={{ display: sidebarTab === 'layers' ? 'block' : 'none' }} className={styles.layerList}>
              <p className={styles.layerSlideLabel}>Slide {activeSlide + 1}</p>
              <LayerListPanel
                layers={currentLayers}
                selectedLayerIds={selectedLayerIds}
                onSelect={(id, multi) => {
                  if (multi) {
                    setSelectedLayerIds((prev) => prev.includes(id) ? prev.filter((pid) => pid !== id) : [...prev, id]);
                  } else {
                    setSelectedLayerIds((prev) => (prev.length === 1 && prev[0] === id ? [] : [id]));
                  }
                }}
                onChange={updateSpecificLayer}
                onReorder={(fromIndex, toIndex) => {
                  // Reorder is handled inside the panel by mutating zIndex
                }}
              />
            </div>

            {/* Properties — kept mounted so uncommitted inputs survive tab switches */}
            <div style={{ display: sidebarTab === 'props' ? 'block' : 'none' }}>
              {selectedLayerIds.length > 1 ? (
                <MultiSelectPanel
                  selectedLayers={selectedLayersForPanel}
                  canvasWidth={canvasW}
                  canvasHeight={canvasH}
                  onChange={handleMultiSelectChange}
                />
              ) : selectedLayer ? (
                <LayerPropertiesPanel
                  layer={selectedLayer}
                  canvasWidth={canvasW}
                  canvasHeight={canvasH}
                  onChange={handleLayerPropertyChange}
                  onPreviewAnimation={handlePreviewAnimation}
                />
              ) : (
                <BackgroundPanel
                  color={currentPage?.backgroundColor ?? '#ffffff'}
                  backgroundImage={currentPage?.backgroundImage}
                  onChange={handleBackgroundChange}
                  onBgImageChange={handleBackgroundImageChange}
                />
              )}
            </div>

            {/* Assets — kept mounted */}
            <div style={{ display: sidebarTab === 'assets' ? 'block' : 'none' }} className={styles.assetList}>
              <div style={{ padding: '0 var(--space-2) var(--space-3)' }}>
                <label style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  padding: '12px', border: '1px dashed rgba(0,0,0,0.1)', borderRadius: 8,
                  cursor: 'pointer', fontSize: 12, color: 'var(--color-text-secondary)',
                  backgroundColor: 'var(--color-surface)', transition: 'all 0.15s ease'
                }}>
                  <ImageIcon size={14} />
                  <span>Upload de Imagem</span>
                  <input
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        const url = URL.createObjectURL(file);
                        addLayer('image', url);
                      }
                    }}
                  />
                </label>
              </div>
              {allImageLayers.length === 0 ? (
                <p className={styles.emptyList}>Nenhum asset de imagem nos slides.</p>
              ) : (
                allImageLayers.map((l, i) => (
                  <div key={`${l.id}-${i}`} className={styles.assetItem}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={l.url} alt="" className={styles.assetThumb} />
                    <div className={styles.assetInfo}>
                      <span className={styles.assetSlide}>Slide {l.slideIdx + 1}</span>
                      <span className={styles.assetId}>Imagem</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </aside>

        {viewMode === 'single' && postType !== 'SINGLE_IMAGE' && (
          <SlideThumbnailPanel
            pages={pages}
            activeSlide={activeSlide}
            canvasW={canvasW}
            canvasH={canvasH}
            onSelectSlide={setActiveSlide}
            onAddSlide={handleAddBlankSlide}
            onDuplicateSlide={handleDuplicateSlide}
            onDeleteSlide={handleDeleteSlide}
            onReorderSlide={handleReorderSlide}
          />
        )}

        {/* Canvas */}
        <main className={`${styles.canvas} ${viewMode === 'grid' ? styles.canvasGridMode : ''}`}>
          {!loading && compileWarnings.length > 0 && (
            <div style={{ marginBottom: 12, padding: '10px 12px', border: '1px solid rgba(245, 158, 11, 0.35)', borderRadius: 10, background: 'rgba(245, 158, 11, 0.08)', color: '#92400e', fontSize: 12 }}>
              {compileWarnings.slice(0, 3).join(' • ')}
            </div>
          )}
          {loading ? (
            <span className={styles.canvasMsg}>Carregando design...</span>
          ) : loadState === 'ir' && irPostContent && irPostContent.ir ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, width: '100%', maxWidth: 900, margin: '0 auto', height: '100%' }}>
              {irPostContent.ir.slides.length > 1 && (
                <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 8 }}>
                  {irPostContent.ir.slides.map((s: any, idx: number) => (
                    <button
                      key={s.id}
                      onClick={() => {
                        setActiveSlide(idx);
                        setSelectedLayerIds([]);
                      }}
                      style={{
                        padding: '4px 12px',
                        borderRadius: 20,
                        background: activeSlide === idx ? '#4f46e5' : '#f3f4f6',
                        color: activeSlide === idx ? '#fff' : '#4b5563',
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: 12,
                        fontWeight: 500,
                        flexShrink: 0
                      }}
                    >
                      Slide {idx + 1}
                    </button>
                  ))}
                </div>
              )}
              
              <div style={{ display: 'flex', gap: 16, flex: 1, minHeight: 0 }}>
                {/* Visual Canvas (Center) */}
                <div style={{ flex: 1, position: 'relative', borderRadius: 12, overflow: 'hidden', border: '1px solid var(--color-border)' }}>
                  <IRCanvasEditor
                    ref={irCanvasEditorRef}
                    ir={irPostContent.ir}
                    activeSlideIndex={activeSlide}
                    selectedElementIds={selectedLayerIds}
                    onSelect={(id, multi) => {
                      if (!id) {
                        setSelectedLayerIds([]);
                      } else if (multi) {
                        setSelectedLayerIds(prev => prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]);
                      } else {
                        setSelectedLayerIds([id]);
                      }
                    }}
                    onPatch={handleIRPatch}
                  />
                  
                  {/* AI Edit Bar directly on canvas */}
                  <AIEditBar
                    ir={irPostContent.ir}
                    activeSlide={irPostContent.ir.slides[activeSlide]}
                    slideIndex={activeSlide}
                    selectedElementIds={selectedLayerIds}
                    slug={slug}
                    postId={postId}
                    onPatch={handleIRPatch}
                  />
                </div>

                {/* Right Panel: Contextual Properties */}
                <div style={{ width: 280, flexShrink: 0, background: '#fff', border: '1px solid var(--color-border)', borderRadius: 12, overflowY: 'auto' }}>
                  <IRPropertiesPanel
                    slide={irPostContent.ir.slides[activeSlide]}
                    selectedElements={
                      selectedLayerIds
                        .map(id => irPostContent.ir?.slides[activeSlide]?.elements?.find((e: any) => e.id === id))
                        .filter(Boolean)
                    }
                    onPatch={handleIRPatch}
                  />
                </div>
              </div>
            </div>
          ) : loadState === 'html' && htmlPostContent ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, width: '100%', maxWidth: 900, margin: '0 auto' }}>
              <div className={styles.rendererWrapper} style={{ aspectRatio: `${canvasW} / ${canvasH}` }}>
                <HtmlSlideRenderer
                  content={htmlPostContent}
                  activeSlide={activeSlide}
                  onSlideChange={setActiveSlide}
                />
              </div>
              <div style={{ border: '1px solid var(--color-border, rgba(0,0,0,0.12))', borderRadius: 12, padding: 14, background: 'var(--color-bg-secondary, #fff)' }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Editar com IA — slide {activeSlide + 1}</div>
                {editLog.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
                    {editLog.slice(-4).map((m, i) => (
                      <div key={i} style={{ fontSize: 12, color: 'var(--color-text-secondary, #666)' }}>✓ {m}</div>
                    ))}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    value={editInstruction}
                    onChange={(e) => setEditInstruction(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleEditSlide(); } }}
                    placeholder='Ex: "deixe o título maior", "troque a cor de destaque", "mude a foto"'
                    disabled={editingSlide}
                    style={{ flex: 1, padding: '10px 12px', borderRadius: 8, border: '1px solid var(--color-border, rgba(0,0,0,0.15))', fontSize: 13 }}
                  />
                  <Button onClick={handleEditSlide} disabled={editingSlide || !editInstruction.trim()}>
                    {editingSlide ? 'Editando…' : 'Aplicar'}
                  </Button>
                </div>
                <div style={{ fontSize: 11, color: 'var(--color-text-tertiary, #999)', marginTop: 6 }}>
                  A IA ajusta só este slide, preservando o resto. Enter envia.
                </div>
              </div>
            </div>
          ) : pages.length === 0 ? (
            <div className={styles.canvasEmptyState}>
              <strong>
                {loadState === 'hybrid-uncompiled'
                  ? 'Preview por código ainda não compilado para edição.'
                  : 'Este post não possui dados de design editáveis.'}
              </strong>
              <span>
                {loadState === 'hybrid-uncompiled'
                  ? 'O DesignDocument foi preservado, mas ainda precisa gerar pages compatíveis com o editor visual.'
                  : 'O conteúdo foi mantido em segurança e não será aberto como canvas vazio.'}
              </span>
            </div>
          ) : viewMode === 'grid' ? (
            <div className={styles.slidesGrid}>
              {pages.map((page, idx) => (
                <div key={idx} className={styles.gridSlideWrapper}>
                  <span className={styles.gridSlideLabel}>Slide {idx + 1}</span>
                  <div
                    className={`${styles.gridSlideCanvas} ${idx === activeSlide ? styles.gridSlideCanvasActive : ''}`}
                    style={{ aspectRatio: `${canvasW} / ${canvasH}` }}
                    onClick={() => {
                      setActiveSlide(idx);
                      setViewMode('single');
                    }}
                  >
                    <DesignRenderer
                      pages={[page]}
                      canvasWidth={canvasW}
                      canvasHeight={canvasH}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : currentPage ? (
            <div
              className={styles.rendererWrapper}
              style={{
                aspectRatio: `${canvasW} / ${canvasH}`,
                ['--canvas-ar' as string]: canvasAr,
              }}
            >
              <CanvasEditor
                key={`${canvasW}x${canvasH}`}
                ref={canvasEditorRef}
                layers={currentPage.layers ?? []}
                backgroundColor={currentPage.backgroundColor}
                backgroundImage={currentPage.backgroundImage}
                canvasWidth={canvasW}
                canvasHeight={canvasH}
                selectedLayerIds={selectedLayerIds}
                onLayerSelect={(layer, e) => {
                  if (!layer) {
                    setSelectedLayerIds([]);
                    return;
                  }
                  if (e?.ctrlKey || e?.metaKey) {
                    setSelectedLayerIds(prev =>
                      prev.includes(layer.id)
                        ? prev.filter(id => id !== layer.id)
                        : [...prev, layer.id]
                    );
                    return;
                  }
                  
                  setSelectedLayerIds([layer.id]);
                }}
                onLayersChange={handleLayersChange}
                onMarqueeSelect={handleMarqueeSelect}
                previewLayerId={previewLayerId}
                previewKey={previewKey}
                snapEnabled={snapEnabled}
              />
            </div>
          ) : null}
        </main>
      </div>
    </div>
  );
}
