'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowRight, Brain, Check, Circle, Eye, Image as ImageIcon, Palette, Plus, Users } from 'lucide-react';
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

const STEPS = [
  { name: 'Designer', hint: 'Regras globais' },
  { name: 'Projeto-base', hint: 'Regras específicas' },
  { name: 'Collab / desdobramento', hint: 'Camada opcional' },
  { name: 'Criação', hint: 'Briefing do material' },
];

export default function ProjectOverviewPage() {
  const params = useParams();
  const slug = params.marca as string;
  const perms = useBrandPermissions();

  const [brand, setBrand] = useState<ProjectBrand | null>(null);
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<ProjectProfileResponse | null>(null);
  const [assets, setAssets] = useState<LibraryAsset[] | null>(null);
  const [refsCount, setRefsCount] = useState<number | null>(null);
  const [allBrands, setAllBrands] = useState<ProjectBrand[]>([]);
  const [recent, setRecent] = useState<RecentPost[]>([]);
  const [parentProfile, setParentProfile] = useState<ProjectProfileResponse | null>(null);
  const [collabOpen, setCollabOpen] = useState(false);

  const load = useCallback(async () => {
    // Cada bloco falha sozinho: um erro nas referências não derruba a página inteira.
    const [b, p, a, r, all, rec] = await Promise.allSettled([
      api.get<ProjectBrand>(`/brands/${slug}`),
      api.get<ProjectProfileResponse>(`/brands/${slug}/profile`),
      api.get<unknown>(`/brands/${slug}/assets`),
      api.get<unknown>(`/settings/${slug}/referencias`),
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
    setRefsCount(r.status === 'fulfilled' ? asList<unknown>(r.value).length : null);
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
  const requiredPending = profile?.completeness.pending.filter((p) => p.required).length ?? 0;
  const currentStep = isBase ? 1 : 2;
  const canGenerate = perms.can('generate');
  const canCreateCollab = isBase && perms.can('edit-settings');

  return (
    <div className={styles.page}>
      {/* As 4 camadas: onde este projeto está */}
      <div className={styles.stepper} aria-label="Camadas do Designer">
        {STEPS.map((step, i) => (
          <React.Fragment key={step.name}>
            <div className={[styles.step, i === currentStep ? styles.stepCurrent : ''].join(' ')}>
              <span className={styles.stepName}>{step.name}</span>
              <span className={styles.stepHint}>{step.hint}</span>
            </div>
            {i < STEPS.length - 1 && <span className={styles.stepArrow}>›</span>}
          </React.Fragment>
        ))}
      </div>

      <div className={styles.titleRow}>
        <div>
          <h1 className={styles.title}>{brand.name}</h1>
          {status && (
            <div className={styles.status}>
              <span className={[styles.dot, status.tone === 'pending' ? styles.dotPending : ''].join(' ')} />
              <span>{status.label} · {status.detail}</span>
            </div>
          )}
          {parent && (
            <div className={styles.parentNote}>
              {collabKindLabel(kind)} de <Link href={`/${parent.slug}`}>{parent.name}</Link>
            </div>
          )}
        </div>
        <div className={styles.actions}>
          {canGenerate ? (
            <Link href={`/${slug}/fabrica`} className={styles.btnPrimary}>
              <Plus size={16} /> Nova apresentação
            </Link>
          ) : (
            <button type="button" className={styles.btnPrimary} disabled title={perms.hint}>
              <Plus size={16} /> Nova apresentação
            </button>
          )}
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
        </div>
      </div>

      {/* Configuração do projeto */}
      <section>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>Configuração do projeto</h2>
        </div>
        {!isBase ? (
          <div className={styles.configGrid}>
            <Link href={parent ? `/${parent.slug}` : '/galeria'} className={styles.configCard}>
              <div className={styles.cardHead}>
                <span className={styles.cardIcon}><Brain size={20} /></span>
                <div>
                  <h3 className={styles.cardTitle}>Herdado de {parent?.name ?? 'o projeto-base'}</h3>
                  <p className={styles.cardDesc}>
                    Identidade, fotos, referências e regras vêm do projeto-base. Para mudar, edite a base.
                  </p>
                </div>
              </div>
              <div className={styles.chips}>
                {parentProfile && (
                  <span className={[styles.chip, parentProfile.completeness.ready ? styles.chipOk : styles.chipWarn].join(' ')}>
                    Ficha da base {parentProfile.completeness.percent}%
                  </span>
                )}
              </div>
              <span className={styles.linkMore}>
                Abrir {parent?.name ?? 'o projeto-base'} <ArrowRight size={13} style={{ verticalAlign: 'middle' }} />
              </span>
            </Link>
            <div className={styles.configCard}>
              <div className={styles.cardHead}>
                <span className={styles.cardIcon}><Users size={20} /></span>
                <div>
                  <h3 className={styles.cardTitle}>Esta camada</h3>
                  <p className={styles.cardDesc}>{collabKindLabel(kind)}: só o que muda em relação à base.</p>
                </div>
              </div>
              <div className={styles.chips}>
                {brand.collab?.partner?.name && <span className={styles.chip}>Parceiro: {brand.collab.partner.name}</span>}
                {typeof brand.collab?.baseProtagonism === 'number' && (
                  <span className={styles.chip}>Protagonismo da base {brand.collab.baseProtagonism}%</span>
                )}
              </div>
              {brand.collab?.context && <p className={styles.cardDesc}>{brand.collab.context}</p>}
            </div>
          </div>
        ) : (
        <div className={styles.configGrid}>
          <Link href={`/${slug}/cerebro`} className={styles.configCard}>
            <div className={styles.cardHead}>
              <span className={styles.cardIcon}><Brain size={20} /></span>
              <div>
                <h3 className={styles.cardTitle}>Cérebro da IA</h3>
                <p className={styles.cardDesc}>Regras globais + regras específicas do projeto.</p>
              </div>
            </div>
            <div className={styles.chips}>
              {profile ? (
                <>
                  <span className={[styles.chip, profile.completeness.ready ? styles.chipOk : styles.chipWarn].join(' ')}>
                    Ficha {profile.completeness.percent}%
                  </span>
                  {requiredPending > 0 && (
                    <span className={[styles.chip, styles.chipWarn].join(' ')}>
                      {requiredPending} {requiredPending === 1 ? 'pendente' : 'pendentes'}
                    </span>
                  )}
                </>
              ) : (
                <span className={styles.chip}>Ficha indisponível</span>
              )}
            </div>
            {profile?.derived && (
              <p className={styles.cardDesc}>Ficha montada a partir dos campos atuais; ainda não foi salva.</p>
            )}
          </Link>

          <Link href={`/${slug}/configuracoes/branding`} className={styles.configCard}>
            <div className={styles.cardHead}>
              <span className={styles.cardIcon}><Palette size={20} /></span>
              <div>
                <h3 className={styles.cardTitle}>Identidade visual</h3>
                <p className={styles.cardDesc}>Manual visual, paleta, tipografia, logos.</p>
              </div>
            </div>
            <div className={styles.chips}>
              {identity.map((item) => (
                <span key={item.label} className={[styles.chip, item.ok ? styles.chipOk : ''].join(' ')}>
                  {item.ok ? <Check size={13} /> : <Circle size={11} />} {item.label}
                </span>
              ))}
            </div>
          </Link>

          <Link href={`/${slug}/configuracoes/midia`} className={styles.configCard}>
            <div className={styles.cardHead}>
              <span className={styles.cardIcon}><ImageIcon size={20} /></span>
              <div>
                <h3 className={styles.cardTitle}>Fotos e arquivos</h3>
                <p className={styles.cardDesc}>Fotos reais, elementos gráficos e uploads.</p>
              </div>
            </div>
            <p className={styles.cardNote}>Fotos reais são prioridade.</p>
            <div className={styles.chips}>
              {lib ? (
                <>
                  <span className={styles.chip}>{lib.images} {lib.images === 1 ? 'imagem' : 'imagens'}</span>
                  <span className={styles.chip}>{lib.otherFiles} {lib.otherFiles === 1 ? 'arquivo' : 'arquivos'}</span>
                  {lib.generated > 0 && (
                    <span className={[styles.chip, styles.chipWarn].join(' ')} title="Imagens geradas pelo sistema não são fotos reais.">
                      {lib.generated} geradas por IA
                    </span>
                  )}
                </>
              ) : (
                <span className={styles.chip}>Biblioteca indisponível</span>
              )}
            </div>
          </Link>

          <Link href={`/${slug}/configuracoes/referencias`} className={styles.configCard}>
            <div className={styles.cardHead}>
              <span className={styles.cardIcon}><Eye size={20} /></span>
              <div>
                <h3 className={styles.cardTitle}>Referências</h3>
                <p className={styles.cardDesc}>Marcas e inspirações que o agente analisa.</p>
              </div>
            </div>
            <div className={styles.chips}>
              <span className={styles.chip}>
                {refsCount === null ? 'Indisponível' : `${refsCount} ${refsCount === 1 ? 'referência' : 'referências'}`}
              </span>
            </div>
          </Link>

          {isBase && (
            <div className={styles.configCard}>
              <div className={styles.cardHead}>
                <span className={styles.cardIcon}><Users size={20} /></span>
                <div>
                  <h3 className={styles.cardTitle}>Desdobramentos e collabs</h3>
                  <p className={styles.cardDesc}>Herdam a base e acrescentam parceiro, contexto e protagonismo.</p>
                </div>
              </div>
              {children.length > 0 ? (
                <ul className={styles.miniList}>
                  {children.slice(0, 3).map((c) => (
                    <li key={c.id}><Link href={`/${c.slug}`}>{c.name}</Link></li>
                  ))}
                </ul>
              ) : (
                <p className={styles.cardDesc}>Nenhum ainda.</p>
              )}
              <a href="#desdobramentos" className={styles.linkMore}>
                Gerenciar collabs <ArrowRight size={13} style={{ verticalAlign: 'middle' }} />
              </a>
            </div>
          )}
        </div>
        )}
      </section>

      {/* O que falta na ficha: só o projeto-base tem ficha */}
      {isBase && profile && profile.completeness.pending.length > 0 && (
        <section>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>O que falta na ficha</h2>
            <span className={styles.sectionNote}>O sistema não inventa o que não foi informado.</span>
          </div>
          <ul className={styles.pendingList}>
            {[...profile.completeness.pending]
              .sort((x, y) => Number(y.required) - Number(x.required))
              .map((p) => (
                <li key={p.key} className={styles.pendingItem}>
                  <Circle size={12} />
                  <span>{p.label}</span>
                  <span className={p.required ? styles.badgeRequired : styles.badgeOptional}>
                    {p.required ? 'Obrigatório' : 'Recomendado'}
                  </span>
                </li>
              ))}
          </ul>
        </section>
      )}

      {/* Lógica da criação */}
      <section>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>Lógica da criação</h2>
          <span className={styles.sectionNote}>
            O material combina as regras globais, as do projeto, o collab (quando houver) e o briefing.
          </span>
        </div>
        <div className={styles.logic}>
          <div className={styles.logicBox}>
            <strong>Regras globais do Designer</strong>
            <span>Fidelidade ao texto, foto real, hierarquia e revisão.</span>
            <span className={styles.logicTag}>Sempre ativas</span>
          </div>
          <div className={styles.logicBox}>
            <strong>Projeto-base {isBase ? brand.name : parent?.name ?? ''}</strong>
            <span>Identidade, público, produtos e contexto.</span>
            <span className={styles.logicTag}>Aplicadas a este projeto</span>
          </div>
          <div className={styles.logicBox}>
            <strong>Camada collab / desdobramento</strong>
            <span>Parceiro, contexto e nível de protagonismo.</span>
            <span className={styles.logicTag}>Opcional</span>
          </div>
          <div className={styles.logicBox}>
            <strong>Briefing da criação</strong>
            <span>Tipo de material, objetivo, tópicos e inspirações.</span>
            <span className={styles.logicTag}>Você define a cada criação</span>
          </div>
          <div className={[styles.logicBox, styles.logicResult].join(' ')}>
            <strong>Material gerado</strong>
            <span>A IA combina tudo e gera o material no estilo da marca.</span>
          </div>
          <div className={styles.summary}>
            <strong>Resumo prático</strong>
            <ol>
              <li>O Designer guarda as regras fixas.</li>
              <li>O projeto guarda a identidade-base.</li>
              <li>O collab define parceiro e protagonismo.</li>
              <li>A criação recebe só o briefing do material.</li>
            </ol>
          </div>
        </div>
      </section>

      {/* Desdobramentos ativos */}
      {isBase && (
        <section id="desdobramentos">
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>Desdobramentos ativos</h2>
            <span className={styles.sectionNote}>
              Herdam a identidade-base de {brand.name} e acrescentam um parceiro, contexto ou objetivo específico.
            </span>
          </div>
          {children.length > 0 ? (
            <div className={styles.cards}>
              {children.map((c) => (
                <Link key={c.id} href={`/${c.slug}`} className={styles.collabCard}>
                  <h3 className={styles.collabName}>{c.name}</h3>
                  <span className={styles.collabInherits}>Herda de {brand.name}</span>
                  <div className={styles.chips}>
                    <span className={styles.chip}>{collabKindLabel(c.kind)}</span>
                    {c.collab?.partner?.name && <span className={styles.chip}>Parceiro: {c.collab.partner.name}</span>}
                    {typeof c.collab?.baseProtagonism === 'number' && (
                      <span className={styles.chip}>Protagonismo {c.collab.baseProtagonism}%</span>
                    )}
                    {c.updatedAt && <span className={styles.chip}>Atualizado {timeAgo(c.updatedAt)}</span>}
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className={styles.empty}>
              <span>Este projeto ainda não tem desdobramentos.</span>
              {canCreateCollab && (
                <button type="button" className={styles.btnGhost} onClick={() => setCollabOpen(true)}>
                  <Plus size={16} /> Novo collab
                </button>
              )}
            </div>
          )}
        </section>
      )}

      {/* Materiais recentes */}
      <section>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>Materiais recentes</h2>
          <Link href={`/${slug}/galeria`} className={styles.sectionNote}>Ver todos</Link>
        </div>
        {recent.length > 0 ? (
          <ul className={styles.recent}>
            {recent.map((p) => (
              <li key={p.id}>
                <Link href={`/${slug}/editor/${p.id}`} className={styles.recentItem}>
                  <span>{p.name || 'Sem nome'}</span>
                  <span className={styles.recentWhen}>{timeAgo(p.updatedAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className={styles.empty}>
            <span>Nenhum material criado neste projeto ainda.</span>
          </div>
        )}
      </section>

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
