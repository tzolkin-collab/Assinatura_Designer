'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ChevronRight, Images, Image as ImageIcon, MonitorPlay, Plus } from 'lucide-react';
import NewCollabModal from '@/components/Collab/NewCollabModal';
import { useBrandPermissions } from '@/hooks/useBrandPermissions';
import { api } from '@/lib/api';
import {
  asList,
  collabKindLabel,
  collabsOf,
  collabStatus,
  identityChecklist,
  libraryTotals,
  projectStatus,
  timeAgo,
  type LibraryAsset,
  type ProjectBrand,
  type ProjectProfileResponse,
} from '@/lib/projectOverview';
import { deferLoad } from '@/lib/deferLoad';
import styles from './project-overview.module.css';

interface RecentPost {
  id: string;
  name: string | null;
  type: string;
  status?: string;
  updatedAt?: string;
}

const LAYERS = [
  { name: 'Designer', hint: 'Regras globais, sempre ativas: fidelidade ao texto, foto real, hierarquia e revisão.' },
  { name: 'Projeto-base', hint: 'Identidade, público, produtos e contexto do projeto.' },
  { name: 'Collab / desdobramento', hint: 'Camada opcional: parceiro, contexto e nível de protagonismo.' },
  { name: 'Criação', hint: 'O briefing que você define a cada material: tipo, objetivo, tópicos e inspirações.' },
];

const POST_TYPE: Record<string, { label: string; Icon: typeof MonitorPlay }> = {
  PRESENTATION: { label: 'Apresentação', Icon: MonitorPlay },
  CAROUSEL: { label: 'Carrossel', Icon: Images },
  SINGLE_IMAGE: { label: 'Imagem', Icon: ImageIcon },
};

// Material pronto não precisa de rótulo: só o que exige atenção ou ainda está em andamento.
const POST_STATUS: Record<string, { label: string; tone: 'warn' | 'bad' | 'muted' }> = {
  FAILED: { label: 'Falhou', tone: 'bad' },
  GENERATING: { label: 'Gerando', tone: 'warn' },
  DRAFT: { label: 'Rascunho', tone: 'muted' },
};

export default function ProjectOverviewPage() {
  const params = useParams();
  const slug = params.marca as string;
  const perms = useBrandPermissions();

  const [brand, setBrand] = useState<ProjectBrand | null>(null);
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<ProjectProfileResponse | null>(null);
  const [assets, setAssets] = useState<LibraryAsset[] | null>(null);
  const [allBrands, setAllBrands] = useState<ProjectBrand[]>([]);
  const [recent, setRecent] = useState<RecentPost[]>([]);
  const [parentProfile, setParentProfile] = useState<ProjectProfileResponse | null>(null);
  const [collabOpen, setCollabOpen] = useState(false);

  const load = useCallback(async () => {
    // Cada bloco falha sozinho: um erro numa das consultas não derruba a página inteira.
    const [b, p, a, all, rec] = await Promise.allSettled([
      api.get<ProjectBrand>(`/brands/${slug}`),
      api.get<ProjectProfileResponse>(`/brands/${slug}/profile`),
      api.get<unknown>(`/brands/${slug}/assets`),
      api.get<unknown>('/brands'),
      api.get<unknown>(`/brands/${slug}/posts?recent=6`),
    ]);
    if (b.status === 'fulfilled') {
      setBrand(b.value);
      setLoadError('');
    } else {
      setLoadError(b.reason instanceof Error ? b.reason.message : 'Não foi possível carregar o projeto.');
    }
    setProfile(p.status === 'fulfilled' ? p.value : null);
    setAssets(a.status === 'fulfilled' ? asList<LibraryAsset>(a.value) : null);
    setAllBrands(all.status === 'fulfilled' ? asList<ProjectBrand>(all.value) : []);
    setRecent(rec.status === 'fulfilled' ? asList<RecentPost>(rec.value) : []);
    // Desdobramento não tem ficha própria: o estado dele é o da base de onde herda.
    const all2 = all.status === 'fulfilled' ? asList<ProjectBrand>(all.value) : [];
    const parentId = b.status === 'fulfilled' ? b.value.parentBrandId : null;
    const parentBrand = parentId ? all2.find((x) => x.id === parentId) : undefined;
    if (parentBrand) {
      try {
        setParentProfile(await api.get<ProjectProfileResponse>(`/brands/${parentBrand.slug}/profile`));
      } catch {
        setParentProfile(null);
      }
    } else {
      setParentProfile(null);
    }
    setLoading(false);
  }, [slug]);

  useEffect(() => {
    return deferLoad(() => {
      void load();
    });
  }, [load]);

  if (loading) return <div className={styles.state}>Carregando projeto...</div>;
  if (!brand) {
    return (
      <div className={styles.state}>
        <p>{loadError || 'Projeto não encontrado.'}</p>
        <Link href="/galeria">Voltar para a galeria de projetos</Link>
      </div>
    );
  }

  const kind = brand.kind ?? 'BASE';
  const isBase = kind === 'BASE';
  const parent = brand.parentBrandId ? allBrands.find((b) => b.id === brand.parentBrandId) : undefined;
  const children = isBase ? collabsOf(allBrands, brand.id) : [];
  const status = isBase
    ? profile ? projectStatus(profile.completeness, kind) : null
    : collabStatus(parent?.name, parentProfile?.completeness);
  const identity = profile ? identityChecklist(profile.profile) : [];
  const lib = assets ? libraryTotals(assets) : null;
  const pending = profile
    ? [...profile.completeness.pending].sort((x, y) => Number(y.required) - Number(x.required))
    : [];
  const currentLayer = isBase ? 1 : 2;
  const canGenerate = perms.can('generate');
  const canCreateCollab = isBase && perms.can('edit-settings');
  const percent = profile?.completeness.percent;

  return (
    <div className={styles.page}>
      <header className={styles.titleRow}>
        <div>
          <h1 className={styles.title}>{brand.name}</h1>
          {status && (
            <div className={styles.status}>
              <span className={[styles.dot, status.tone === 'pending' ? styles.dotPending : ''].join(' ')} />
              <span>{isBase ? status.label : `${status.label} · ${status.detail}`}</span>
            </div>
          )}
          {parent && (
            <div className={styles.parentNote}>
              {collabKindLabel(kind)} de <Link href={`/${parent.slug}`}>{parent.name}</Link>
            </div>
          )}
        </div>
        <div className={styles.actions}>
          {isBase && (
            <button
              type="button"
              className={styles.btnGhost}
              disabled={!canCreateCollab}
              title={canCreateCollab ? undefined : perms.hint}
              onClick={() => setCollabOpen(true)}
            >
              <Plus size={16} /> Novo collab
            </button>
          )}
          {canGenerate ? (
            <Link href={`/${slug}/fabrica`} className={styles.btnPrimary}>
              <Plus size={16} /> Nova apresentação
            </Link>
          ) : (
            <button type="button" className={styles.btnPrimary} disabled title={perms.hint}>
              <Plus size={16} /> Nova apresentação
            </button>
          )}
        </div>
      </header>

      <div className={styles.layout}>
        <div className={styles.main}>
          {/* Materiais recentes: o que a pessoa volta aqui para encontrar */}
          <section aria-labelledby="sec-recentes">
            <div className={styles.sectionHead}>
              <h2 id="sec-recentes" className={styles.sectionTitle}>Materiais recentes</h2>
              {recent.length > 0 && (
                <Link href={`/${slug}/galeria`} className={styles.sectionLink}>
                  Abrir galeria <ChevronRight size={14} />
                </Link>
              )}
            </div>
            {recent.length > 0 ? (
              <ul className={styles.recent}>
                {recent.map((p) => {
                  const type = POST_TYPE[p.type] ?? POST_TYPE.PRESENTATION;
                  const state = p.status ? POST_STATUS[p.status] : undefined;
                  return (
                    <li key={p.id}>
                      <Link href={`/${slug}/editor/${p.id}`} className={styles.recentItem}>
                        <type.Icon size={18} className={styles.recentIcon} aria-hidden="true" />
                        <span className={styles.recentText}>
                          <span className={styles.recentName}>{p.name || 'Sem nome'}</span>
                          <span className={styles.recentMeta}>
                            {type.label}
                            {p.updatedAt ? ` · ${timeAgo(p.updatedAt)}` : ''}
                          </span>
                        </span>
                        {state && (
                          <span className={[styles.postState, styles[`postState_${state.tone}`]].join(' ')}>{state.label}</span>
                        )}
                        <ChevronRight size={16} className={styles.recentChevron} aria-hidden="true" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className={styles.empty}>
                <span>Nenhum material criado neste projeto ainda.</span>
                {canGenerate && (
                  <Link href={`/${slug}/fabrica`} className={styles.btnGhost}>
                    <Plus size={16} /> Criar o primeiro
                  </Link>
                )}
              </div>
            )}
          </section>

          {/* Desdobramentos: só o projeto-base tem */}
          {isBase && (
            <section id="desdobramentos" aria-labelledby="sec-desdobramentos">
              <div className={styles.sectionHead}>
                <h2 id="sec-desdobramentos" className={styles.sectionTitle}>Desdobramentos</h2>
                <span className={styles.sectionNote}>Herdam a identidade de {brand.name} e acrescentam parceiro, contexto ou objetivo.</span>
              </div>
              {children.length > 0 ? (
                <ul className={styles.recent}>
                  {children.map((c) => (
                    <li key={c.id}>
                      <Link href={`/${c.slug}`} className={styles.recentItem}>
                        <span className={styles.recentText}>
                          <span className={styles.recentName}>{c.name}</span>
                          <span className={styles.recentMeta}>
                            {[
                              collabKindLabel(c.kind),
                              c.collab?.partner?.name ? `Parceiro: ${c.collab.partner.name}` : null,
                              typeof c.collab?.baseProtagonism === 'number' ? `Protagonismo ${c.collab.baseProtagonism}%` : null,
                              c.updatedAt ? timeAgo(c.updatedAt) : null,
                            ].filter(Boolean).join(' · ')}
                          </span>
                        </span>
                        <ChevronRight size={16} className={styles.recentChevron} aria-hidden="true" />
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className={styles.empty}>
                  <span>Nenhum desdobramento ainda.</span>
                  {canCreateCollab && (
                    <button type="button" className={styles.btnGhost} onClick={() => setCollabOpen(true)}>
                      <Plus size={16} /> Novo collab
                    </button>
                  )}
                </div>
              )}
            </section>
          )}

          {/* Como o material é montado: referência, não o centro da página */}
          <details className={styles.how}>
            <summary>Como o material é montado</summary>
            <ol className={styles.layers}>
              {LAYERS.map((layer, i) => (
                <li key={layer.name} className={i === currentLayer ? styles.layerCurrent : undefined}>
                  <strong>{layer.name}</strong>
                  {i === currentLayer && <span className={styles.layerHere}>Você está aqui</span>}
                  <span>{layer.hint}</span>
                </li>
              ))}
            </ol>
          </details>
        </div>

        <aside className={styles.aside} aria-label="Ficha e biblioteca do projeto">
          {isBase ? (
            <>
              {/* Ficha: o número que diz se a IA tem do que partir */}
              <section aria-labelledby="sec-ficha">
                <div className={styles.sectionHead}>
                  <h2 id="sec-ficha" className={styles.sectionTitle}>Ficha da marca</h2>
                </div>
                {profile ? (
                  <>
                    <div className={styles.meter}>
                      <span className={styles.meterValue}>{percent}%</span>
                      <span className={styles.meterLabel}>
                        {profile.completeness.ready ? 'Pronta para gerar' : 'Faltam dados para gerar bem'}
                      </span>
                    </div>
                    <div
                      className={styles.bar}
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={percent}
                      aria-label="Completude da ficha"
                    >
                      <span style={{ width: `${percent}%` }} />
                    </div>
                    {pending.length > 0 && (
                      <ul className={styles.pending}>
                        {pending.map((p) => (
                          <li key={p.key}>
                            <Link href={`/${slug}/cerebro`} className={styles.pendingItem}>
                              <span>{p.label}</span>
                              <span className={p.required ? styles.badgeRequired : styles.badgeOptional}>
                                {p.required ? 'Obrigatório' : 'Recomendado'}
                              </span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                    {profile.derived && (
                      <p className={styles.note}>Montada a partir dos campos atuais; ainda não foi salva.</p>
                    )}
                    <Link href={`/${slug}/cerebro`} className={styles.linkMore}>
                      Abrir Cérebro da IA <ChevronRight size={14} />
                    </Link>
                  </>
                ) : (
                  <p className={styles.note}>Ficha indisponível no momento.</p>
                )}
              </section>

              <section aria-labelledby="sec-identidade">
                <div className={styles.sectionHead}>
                  <h2 id="sec-identidade" className={styles.sectionTitle}>Identidade visual</h2>
                </div>
                <div className={styles.chips}>
                  {identity.map((item) => (
                    <span key={item.label} className={[styles.chip, item.ok ? styles.chipOk : styles.chipMissing].join(' ')}>
                      {item.ok ? 'Tem' : 'Falta'} · {item.label}
                    </span>
                  ))}
                </div>
                <Link href={`/${slug}/configuracoes/branding`} className={styles.linkMore}>
                  Editar identidade <ChevronRight size={14} />
                </Link>
              </section>

              <section aria-labelledby="sec-fotos">
                <div className={styles.sectionHead}>
                  <h2 id="sec-fotos" className={styles.sectionTitle}>Fotos e arquivos</h2>
                </div>
                {lib ? (
                  <>
                    <p className={styles.counts}>
                      <strong>{lib.images}</strong> {lib.images === 1 ? 'imagem' : 'imagens'}
                      <span aria-hidden="true"> · </span>
                      <strong>{lib.otherFiles}</strong> {lib.otherFiles === 1 ? 'arquivo' : 'arquivos'}
                    </p>
                    {lib.generated > 0 && (
                      <p className={styles.noteWarn}>
                        {lib.generated} {lib.generated === 1 ? 'imagem foi gerada' : 'imagens foram geradas'} por IA. Fotos reais têm prioridade.
                      </p>
                    )}
                  </>
                ) : (
                  <p className={styles.note}>Biblioteca indisponível no momento.</p>
                )}
                <Link href={`/${slug}/configuracoes/midia`} className={styles.linkMore}>
                  Abrir biblioteca <ChevronRight size={14} />
                </Link>
              </section>
            </>
          ) : (
            <>
              <section aria-labelledby="sec-herdado">
                <div className={styles.sectionHead}>
                  <h2 id="sec-herdado" className={styles.sectionTitle}>Herdado de {parent?.name ?? 'o projeto-base'}</h2>
                </div>
                <p className={styles.note}>Identidade, fotos e regras vêm do projeto-base. Para mudar, edite a base.</p>
                {parentProfile && (
                  <p className={styles.counts}>
                    Ficha da base: <strong>{parentProfile.completeness.percent}%</strong>
                  </p>
                )}
                <Link href={parent ? `/${parent.slug}` : '/galeria'} className={styles.linkMore}>
                  Abrir {parent?.name ?? 'o projeto-base'} <ChevronRight size={14} />
                </Link>
              </section>

              <section aria-labelledby="sec-camada">
                <div className={styles.sectionHead}>
                  <h2 id="sec-camada" className={styles.sectionTitle}>Esta camada</h2>
                </div>
                <p className={styles.note}>{collabKindLabel(kind)}: só o que muda em relação à base.</p>
                <div className={styles.chips}>
                  {brand.collab?.partner?.name && <span className={styles.chip}>Parceiro: {brand.collab.partner.name}</span>}
                  {typeof brand.collab?.baseProtagonism === 'number' && (
                    <span className={styles.chip}>Protagonismo da base {brand.collab.baseProtagonism}%</span>
                  )}
                </div>
                {brand.collab?.context && <p className={styles.note}>{brand.collab.context}</p>}
              </section>
            </>
          )}
        </aside>
      </div>

      {collabOpen && (
        <NewCollabModal
          parent={{ slug: brand.slug, name: brand.name }}
          onClose={() => setCollabOpen(false)}
          onCreated={() => {
            setCollabOpen(false);
            void load();
          }}
        />
      )}
    </div>
  );
}
