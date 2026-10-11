'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Lock } from 'lucide-react';
import { useBrandPermissions } from '@/hooks/useBrandPermissions';
import { api, ApiError } from '@/lib/api';
import { asList, projectStatus, type ProjectProfileResponse } from '@/lib/projectOverview';
import {
  applyConflict,
  importSummary,
  mergeDraftIntoForm,
  SECTION_TITLES,
  type ImportConflict,
  type MergeOutcome,
  type ProfileImportResult,
} from '@/lib/profileImport';
import {
  emptyForm,
  formErrors,
  formToProfile,
  HEX_RE,
  profileToForm,
  type BrandProfile,
  type FontSource,
  type ProfileFormState,
} from '@/lib/profileForm';
import styles from './cerebro.module.css';

interface LibraryFile {
  id: string;
  name: string;
  url: string;
  fileType: string;
  source?: string | null;
}

/** As regras fixas do Designer (Cérebro de IA, §3.1). Valem para todos os projetos e não se editam aqui. */
const GLOBAL_RULES = [
  'O texto marcado como aprovado aparece literalmente. Fala, contexto e observação interna nunca viram texto na arte.',
  'Nada de nome, dado, data, preço, case, promessa ou logo inventado.',
  'Foto real é regra absoluta: só as fornecidas. Sem foto, a área fica reservada, e o sistema nunca gera pessoa.',
  'O texto não é reduzido até ficar ilegível. Excesso de conteúdo é sinalizado, não cortado em silêncio.',
  'Antes de dar uma peça como final, há revisão de texto, fonte, cor, logo, margens e imagens.',
];

const FONT_SOURCES: Array<{ value: FontSource | ''; label: string }> = [
  { value: '', label: 'Escolher...' },
  { value: 'google', label: 'Google Fonts (o sistema carrega)' },
  { value: 'reference', label: 'Só referência em imagem (fonte não instalada)' },
  { value: 'custom', label: 'Arquivo oficial enviado' },
];

function AssetPicker({
  value,
  onChange,
  files,
  kind,
  disabled,
}: {
  value: string;
  onChange: (url: string) => void;
  files: LibraryFile[];
  kind: 'image' | 'any';
  disabled: boolean;
}) {
  // Logo, manual e referência de fonte são arquivos OFICIAIS: o que o sistema gerou sozinho não entra
  // na lista (a não ser que já esteja escolhido, para a pessoa poder trocar).
  const options = files.filter(
    (f) => (kind === 'any' || f.fileType.startsWith('image/')) && (f.source !== 'ai-generated' || f.url === value),
  );
  const selected = files.find((f) => f.url === value);
  const known = Boolean(selected);
  return (
    <div className={styles.pickerWrap}>
      <select className={styles.select} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        <option value="">Escolher da biblioteca...</option>
        {value && !known && <option value={value}>(arquivo fora da biblioteca)</option>}
        {options.map((f) => (
          <option key={f.id} value={f.url}>
            {f.name}
            {f.source === 'ai-generated' ? ' (gerada por IA)' : ''}
          </option>
        ))}
      </select>
      {selected && selected.fileType.startsWith('image/') && (
        // eslint-disable-next-line @next/next/no-img-element
        <img className={styles.thumb} src={selected.url} alt={selected.name} />
      )}
      {value && !known && (
        <p className={styles.note}>Esse arquivo não está na biblioteca deste projeto. O servidor vai recusar ao salvar.</p>
      )}
    </div>
  );
}

function Section({
  id,
  title,
  hint,
  required,
  pending,
  children,
}: {
  id: string;
  title: string;
  hint: string;
  required?: boolean;
  pending: boolean;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className={styles.section}>
      <div className={styles.sectionHead}>
        <h2>{title}</h2>
        {pending ? (
          <span className={[styles.tag, required ? styles.tagRequired : ''].join(' ')}>{required ? 'Obrigatório' : 'Recomendado'}</span>
        ) : (
          <span className={[styles.tag, styles.tagDone].join(' ')}>Preenchido</span>
        )}
      </div>
      <p className={styles.hint}>{hint}</p>
      {children}
    </section>
  );
}

export default function CerebroPage() {
  const params = useParams();
  const slug = params.marca as string;
  const perms = useBrandPermissions();
  const readOnly = !perms.can('edit-settings');

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [result, setResult] = useState<ProjectProfileResponse | null>(null);
  const [files, setFiles] = useState<LibraryFile[]>([]);
  const [form, setForm] = useState<ProfileFormState>(emptyForm());
  const [baseline, setBaseline] = useState('{}');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [manualFiles, setManualFiles] = useState<File[]>([]);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const [importResult, setImportResult] = useState<ProfileImportResult | null>(null);
  const [importOutcome, setImportOutcome] = useState<MergeOutcome | null>(null);
  const [conflicts, setConflicts] = useState<ImportConflict[]>([]);

  const apply = useCallback((res: ProjectProfileResponse) => {
    const profile = res.profile as unknown as BrandProfile;
    setResult(res);
    setForm(profileToForm(profile));
    setBaseline(JSON.stringify(formToProfile(profileToForm(profile))));
  }, []);

  useEffect(() => {
    let cancelled = false;
    const id = requestAnimationFrame(async () => {
      const [p, a] = await Promise.allSettled([
        api.get<ProjectProfileResponse>(`/brands/${slug}/profile`),
        api.get<unknown>(`/brands/${slug}/assets`),
      ]);
      if (cancelled) return;
      if (p.status === 'fulfilled') apply(p.value);
      else setLoadError(p.reason instanceof Error ? p.reason.message : 'Não foi possível carregar a ficha do projeto.');
      setFiles(a.status === 'fulfilled' ? asList<LibraryFile>(a.value) : []);
      setLoading(false);
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(id);
    };
  }, [slug, apply]);

  const draft = useMemo(() => formToProfile(form), [form]);
  const dirty = JSON.stringify(draft) !== baseline;
  const errors = useMemo(() => formErrors(form), [form]);

  // Quem sai da página com alteração não salva é avisado pelo navegador.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const set = <K extends keyof ProfileFormState>(key: K, value: ProfileFormState[K]) => setForm((f) => ({ ...f, [key]: value }));
  type RowKey = 'palette' | 'typography' | 'logoFiles' | 'brandCodes';
  const patchRow = <K extends RowKey>(key: K, i: number, patch: Partial<ProfileFormState[K][number]>) =>
    setForm((f) => ({ ...f, [key]: (f[key] as Array<ProfileFormState[K][number]>).map((r, j) => (j === i ? { ...r, ...patch } : r)) }));
  const addRow = <K extends RowKey>(key: K, row: ProfileFormState[K][number]) =>
    setForm((f) => ({ ...f, [key]: [...(f[key] as Array<ProfileFormState[K][number]>), row] }));
  const removeRow = (key: RowKey, i: number) =>
    setForm((f) => ({ ...f, [key]: (f[key] as unknown[]).filter((_, j) => j !== i) }));

  const save = async () => {
    if (errors.length > 0) return;
    setSaving(true);
    setSaveError('');
    try {
      const res = await api.put<ProjectProfileResponse>(`/brands/${slug}/profile`, draft);
      apply(res);
      setSavedAt(Date.now());
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : 'Não foi possível salvar a ficha.');
    } finally {
      setSaving(false);
    }
  };

  const runImport = async () => {
    if (manualFiles.length === 0) return;
    setImporting(true);
    setImportError('');
    setImportResult(null);
    setImportOutcome(null);
    setConflicts([]);
    try {
      const body = new FormData();
      manualFiles.forEach((f) => body.append('files', f));
      const res = await api.post<ProfileImportResult, FormData>(`/brands/${slug}/profile/import`, body);
      // O rascunho entra no formulário (só em campo vazio) e NADA é salvo: quem aprova é a pessoa.
      const outcome = mergeDraftIntoForm(form, res.draft);
      setForm(outcome.form);
      setImportResult(res);
      setImportOutcome(outcome);
      setConflicts(outcome.conflicts);
    } catch (err) {
      setImportError(err instanceof ApiError ? err.message : 'Não foi possível ler o manual.');
    } finally {
      setImporting(false);
    }
  };

  const acceptConflict = (c: ImportConflict) => {
    setForm((f) => applyConflict(f, c));
    setConflicts((list) => list.filter((x) => x.section !== c.section));
  };

  if (loading) return <div className={styles.state}>Carregando a ficha do projeto...</div>;
  if (!result) {
    return (
      <div className={styles.state}>
        <p>{loadError || 'Ficha indisponível.'}</p>
        <Link href={`/${slug}`}>Voltar para a visão geral</Link>
      </div>
    );
  }

  const status = projectStatus(result.completeness);
  const pendingKeys = new Set(result.completeness.pending.map((p) => p.key));
  const disabled = readOnly || saving;
  // A seção das notas antigas existe se a ficha CARREGADA tinha notas: não some enquanto a pessoa edita.
  const hadLegacyNotes = Boolean((result.profile as unknown as BrandProfile).legacyNotes?.trim());

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1>Cérebro da IA</h1>
        <p>
          As regras fixas do Designer valem para todos os projetos. Esta ficha guarda o que é só deste projeto: como a marca pensa, escreve e aparece.
          O que ficar em branco continua pendente, e a IA não preenche por conta própria.
        </p>
      </div>

      <div className={styles.bar}>
        <div className={styles.barStatus}>
          <span className={[styles.dot, status.tone === 'pending' ? styles.dotPending : ''].join(' ')} />
          <span>{status.label} · {status.detail}</span>
        </div>
        <span className={styles.barSpacer} />
        {dirty && <span className={styles.dirty}>Alterações não salvas</span>}
        <button type="button" className={styles.btn} disabled={disabled || !dirty || errors.length > 0} onClick={save} title={readOnly ? perms.hint : undefined}>
          {saving ? 'Salvando...' : 'Salvar ficha'}
        </button>
      </div>

      {result.derived && (
        <div className={[styles.notice, styles.noticeInfo].join(' ')}>
          Esta ficha foi montada a partir dos campos que o projeto já tinha (cores, fontes, logo e textos antigos). Ela só passa a valer depois de salva.
        </div>
      )}
      {readOnly && <div className={[styles.notice, styles.noticeInfo].join(' ')}>{perms.hint || 'Você só pode visualizar esta ficha.'}</div>}
      {errors.map((e) => (
        <div key={e} className={[styles.notice, styles.noticeError].join(' ')}>{e}</div>
      ))}
      {saveError && <div className={[styles.notice, styles.noticeError].join(' ')} role="alert">{saveError}</div>}
      {savedAt && !dirty && !saveError && <div className={[styles.notice, styles.noticeOk].join(' ')}>Ficha salva.</div>}

      {!readOnly && (
        <div className={styles.importBox}>
          <h2>Importar de um manual de marca</h2>
          <p className={styles.hint}>
            Envie o manual (PDF, imagens, .md, .txt ou .html). A IA lê e propõe o rascunho da ficha, citando o trecho de onde tirou cada item. Só campos vazios são
            preenchidos e nada é salvo até você apertar &quot;Salvar ficha&quot;. Logo e manual visual não vêm do manual: escolha na biblioteca.
          </p>
          <div className={styles.importActions}>
            <input
              type="file"
              multiple
              accept=".pdf,.png,.jpg,.jpeg,.webp,.md,.txt,.html,.htm,application/pdf,image/png,image/jpeg,image/webp,text/markdown,text/plain,text/html"
              disabled={importing}
              onChange={(e) => setManualFiles(Array.from(e.target.files ?? []).slice(0, 6))}
              aria-label="Arquivos do manual"
            />
            <button type="button" className={styles.btn} disabled={importing || manualFiles.length === 0} onClick={runImport}>
              {importing ? 'Lendo o manual...' : 'Ler manual'}
            </button>
            {importing && <span className={styles.fileName}>Pode levar até 1 minuto.</span>}
          </div>
          {importError && <div className={[styles.notice, styles.noticeError].join(' ')} role="alert">{importError}</div>}
          {importResult && importOutcome && (
            <>
              <div className={[styles.notice, importResult.status === 'failed' ? styles.noticeError : styles.noticeOk].join(' ')} role="status">
                {importSummary(importResult, importOutcome)}
                {importResult.status === 'partial' && importResult.reason ? ` Parte do material falhou: ${importResult.reason}` : ''}
                {importResult.status !== 'failed' && importOutcome.applied.length > 0 ? ' Revise e salve para valer.' : ''}
              </div>
              {importResult.status !== 'failed' && !importResult.quotesChecked && (
                <div className={[styles.notice, styles.noticeInfo].join(' ')}>
                  Em PDF e imagem o sistema não consegue conferir se o trecho citado existe de verdade no manual: confira os trechos abaixo antes de salvar.
                </div>
              )}
              {importResult.warnings.map((w) => (
                <div key={w} className={[styles.notice, styles.noticeInfo].join(' ')}>{w}</div>
              ))}
              {conflicts.map((c) => (
                <div key={c.section} className={styles.conflict}>
                  <span>
                    <strong>{c.title}:</strong> o manual diz diferente do que já está na ficha. A ficha foi mantida.
                  </span>
                  <button type="button" className={[styles.btn, styles.btnGhost, styles.btnSmall].join(' ')} onClick={() => acceptConflict(c)}>
                    Usar sugestão do manual
                  </button>
                </div>
              ))}
              {importResult.notFound.length > 0 && (
                <p className={styles.hint}>
                  O manual não traz: {importResult.notFound.map((k) => SECTION_TITLES[k] ?? k).join(', ')}. Continuam pendentes.
                </p>
              )}
              {Object.keys(importResult.evidence).length > 0 && (
                <details>
                  <summary>De onde veio cada coisa</summary>
                  {Object.entries(importResult.evidence).map(([key, items]) => (
                    <div key={key}>
                      <p className={styles.hint} style={{ marginTop: 10 }}><strong>{SECTION_TITLES[key] ?? key}</strong></p>
                      <ul className={styles.evidenceList}>
                        {items.map((ev, i) => (
                          <li key={i}>
                            {ev.label ? <strong>{ev.label}: </strong> : null}
                            <q>{ev.quote}</q>
                            {ev.page ? ` (p. ${ev.page})` : ''}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </details>
              )}
            </>
          )}
        </div>
      )}

      <div className={styles.globalBox}>
        <h2><Lock size={14} /> Regras globais do Designer</h2>
        <span className={styles.lock}>Fixas e iguais para todos os projetos. Só a equipe técnica altera.</span>
        <ul>
          {GLOBAL_RULES.map((r) => <li key={r}>{r}</li>)}
        </ul>
      </div>

      <Section id="essence" title="Essência e posicionamento" required pending={pendingKeys.has('essence')}
        hint="Quem é a marca, o que pensa, fala e defende; personalidade; a sensação que a peça deve transmitir.">
        <textarea className={styles.textarea} value={form.essence} disabled={disabled} onChange={(e) => set('essence', e.target.value)} />
      </Section>

      <Section id="writingDirection" title="Tom e direção de escrita" pending={pendingKeys.has('writingDirection')}
        hint="Vocabulário, nível de formalidade, ritmo e o que evitar.">
        <textarea className={styles.textarea} value={form.writingDirection} disabled={disabled} onChange={(e) => set('writingDirection', e.target.value)} />
      </Section>

      <Section id="palette" title="Paleta" required pending={pendingKeys.has('palette')}
        hint="As cores oficiais e a função de cada uma (principal, destaque, fundo claro...).">
        <div className={styles.rows}>
          {form.palette.map((c, i) => (
            <div key={i} className={[styles.row, styles.rowPalette].join(' ')}>
              <input
                type="color"
                className={styles.swatch}
                aria-label="Escolher cor"
                value={HEX_RE.test(c.hex.trim()) ? c.hex.trim() : '#000000'}
                disabled={disabled}
                onChange={(e) => patchRow('palette', i, { hex: e.target.value.toUpperCase() })}
              />
              <input className={styles.input} placeholder="#RRGGBB" value={c.hex} disabled={disabled} onChange={(e) => patchRow('palette', i, { hex: e.target.value })} />
              <input className={styles.input} placeholder="Nome (opcional)" value={c.name} disabled={disabled} onChange={(e) => patchRow('palette', i, { name: e.target.value })} />
              <input className={styles.input} placeholder="Função (ex.: principal, fundo claro)" value={c.role} disabled={disabled} onChange={(e) => patchRow('palette', i, { role: e.target.value })} />
              <button type="button" className={styles.remove} disabled={disabled} onClick={() => removeRow('palette', i)}>Remover</button>
            </div>
          ))}
        </div>
        <div><button type="button" className={[styles.btn, styles.btnGhost, styles.btnSmall].join(' ')} disabled={disabled} onClick={() => addRow('palette', { hex: '', name: '', role: '' })}>+ Adicionar cor</button></div>
      </Section>

      <Section id="typography" title="Tipografia" required pending={pendingKeys.has('typography')}
        hint="As fontes oficiais e a função de cada uma. Se a fonte não está instalada, envie uma imagem de referência: o sistema avisa quando usar uma substituta.">
        <div className={styles.rows}>
          {form.typography.map((t, i) => (
            <div key={i} className={[styles.row, styles.rowType].join(' ')}>
              <input className={styles.input} placeholder="Família (ex.: Queens)" value={t.family} disabled={disabled} onChange={(e) => patchRow('typography', i, { family: e.target.value })} />
              <input className={styles.input} placeholder="Função (ex.: títulos e capas)" value={t.role} disabled={disabled} onChange={(e) => patchRow('typography', i, { role: e.target.value })} />
              <select className={styles.select} value={t.source} disabled={disabled} onChange={(e) => patchRow('typography', i, { source: e.target.value as FontSource | '' })}>
                {FONT_SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
              <button type="button" className={styles.remove} disabled={disabled} onClick={() => removeRow('typography', i)}>Remover</button>
              {t.source === 'reference' && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <AssetPicker value={t.referenceImageUrl} files={files} kind="image" disabled={disabled} onChange={(url) => patchRow('typography', i, { referenceImageUrl: url })} />
                </div>
              )}
              {t.source === 'custom' && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <AssetPicker value={t.fileUrl} files={files} kind="any" disabled={disabled} onChange={(url) => patchRow('typography', i, { fileUrl: url })} />
                </div>
              )}
            </div>
          ))}
        </div>
        <div><button type="button" className={[styles.btn, styles.btnGhost, styles.btnSmall].join(' ')} disabled={disabled} onClick={() => addRow('typography', { family: '', role: '', source: '', fileUrl: '', referenceImageUrl: '' })}>+ Adicionar fonte</button></div>
      </Section>

      <Section id="logo" title="Logo e assinatura" pending={pendingKeys.has('logo')}
        hint="Os arquivos do logo, que precisam estar na biblioteca do projeto, e as regras de uso.">
        <div className={styles.rows}>
          {form.logoFiles.map((l, i) => (
            <div key={i} className={[styles.row, styles.rowLogo].join(' ')}>
              <AssetPicker value={l.url} files={files} kind="image" disabled={disabled} onChange={(url) => patchRow('logoFiles', i, { url })} />
              <input className={styles.input} placeholder="Descrição (ex.: wordmark sobre fundo escuro)" value={l.label} disabled={disabled} onChange={(e) => patchRow('logoFiles', i, { label: e.target.value })} />
              <button type="button" className={styles.remove} disabled={disabled} onClick={() => removeRow('logoFiles', i)}>Remover</button>
            </div>
          ))}
        </div>
        <div><button type="button" className={[styles.btn, styles.btnGhost, styles.btnSmall].join(' ')} disabled={disabled} onClick={() => addRow('logoFiles', { url: '', label: '' })}>+ Adicionar arquivo de logo</button></div>
        <textarea className={styles.textarea} placeholder="Regras de uso do logo" value={form.logoRules} disabled={disabled} onChange={(e) => set('logoRules', e.target.value)} />
        {files.length === 0 && (
          <p className={styles.note}>
            A biblioteca está vazia. Envie os arquivos em <Link href={`/${slug}/configuracoes/midia`}>Fotos e arquivos</Link> e volte aqui.
          </p>
        )}
      </Section>

      <Section id="visualManual" title="Manual visual" required pending={pendingKeys.has('visualManual')}
        hint="O manual condensado em UMA imagem: a referência visual principal do projeto.">
        <AssetPicker value={form.manualImageUrl} files={files} kind="image" disabled={disabled} onChange={(url) => set('manualImageUrl', url)} />
        <textarea className={styles.textarea} placeholder="Notas sobre o manual (opcional)" value={form.manualNotes} disabled={disabled} onChange={(e) => set('manualNotes', e.target.value)} />
      </Section>

      <Section id="artDirection" title="Direção de arte" required pending={pendingKeys.has('artDirection')}
        hint="Composição, grid, respiro, escala, intensidade e referências.">
        <textarea className={styles.textarea} value={form.artDirection} disabled={disabled} onChange={(e) => set('artDirection', e.target.value)} />
      </Section>

      <Section id="realPhoto" title="Fotografia real" pending={pendingKeys.has('realPhoto')}
        hint="O tipo de foto aprovada, o tratamento permitido e os recortes. As fotos em si ficam em Fotos e arquivos.">
        <textarea className={styles.textarea} value={form.realPhoto} disabled={disabled} onChange={(e) => set('realPhoto', e.target.value)} />
      </Section>

      <Section id="graphicElements" title="Elementos gráficos" pending={pendingKeys.has('graphicElements')}
        hint="Linhas, formas, ícones, monograma e texturas.">
        <textarea className={styles.textarea} value={form.graphicElements} disabled={disabled} onChange={(e) => set('graphicElements', e.target.value)} />
      </Section>

      <Section id="neverDo" title="O que nunca fazer" required pending={pendingKeys.has('neverDo')}
        hint="As proibições específicas do projeto. Uma por linha.">
        <textarea className={styles.textarea} value={form.neverDo} disabled={disabled} onChange={(e) => set('neverDo', e.target.value)} />
      </Section>

      <Section id="approvalCriterion" title="Critério de aprovação" required pending={pendingKeys.has('approvalCriterion')}
        hint="Como saber se a peça pertence à marca.">
        <textarea className={styles.textarea} value={form.approvalCriterion} disabled={disabled} onChange={(e) => set('approvalCriterion', e.target.value)} />
      </Section>

      <Section id="brandCodes" title="Códigos que não podem sumir" pending={pendingKeys.has('brandCodes')}
        hint="O que identifica a marca em qualquer peça, por categoria (ex.: Personalidade, Tom, Conteúdo, Acabamento). Itens separados por vírgula.">
        <div className={styles.rows}>
          {form.brandCodes.map((c, i) => (
            <div key={i} className={[styles.row, styles.rowCode].join(' ')}>
              <input className={styles.input} placeholder="Categoria" value={c.category} disabled={disabled} onChange={(e) => patchRow('brandCodes', i, { category: e.target.value })} />
              <input className={styles.input} placeholder="Item 1, Item 2, Item 3" value={c.items} disabled={disabled} onChange={(e) => patchRow('brandCodes', i, { items: e.target.value })} />
              <button type="button" className={styles.remove} disabled={disabled} onClick={() => removeRow('brandCodes', i)}>Remover</button>
            </div>
          ))}
        </div>
        <div><button type="button" className={[styles.btn, styles.btnGhost, styles.btnSmall].join(' ')} disabled={disabled} onClick={() => addRow('brandCodes', { category: '', items: '' })}>+ Adicionar categoria</button></div>
      </Section>

      <Section id="variation" title="O que pode variar e o que precisa ficar" pending={pendingKeys.has('variation')}
        hint="O que muda de uma peça para outra sem a marca deixar de ser ela, e o que fica em toda peça. Um item por linha.">
        <label className={styles.hint}>Pode variar</label>
        <textarea className={styles.textarea} value={form.mayVary} disabled={disabled} onChange={(e) => set('mayVary', e.target.value)} />
        <label className={styles.hint}>Precisa ficar</label>
        <textarea className={styles.textarea} value={form.mustKeep} disabled={disabled} onChange={(e) => set('mustKeep', e.target.value)} />
      </Section>

      <Section id="collabRules" title="Regras de collab" pending={pendingKeys.has('collabRules')}
        hint="O que vale quando a marca faz collab: quem lidera a narrativa, a hierarquia dos logos e o que manter.">
        <textarea className={styles.textarea} value={form.collabRules} disabled={disabled} onChange={(e) => set('collabRules', e.target.value)} />
      </Section>

      {hadLegacyNotes && (
        <Section id="legacyNotes" title="Notas de antes da ficha" pending={false}
          hint="Diretrizes e instruções do agente que o projeto tinha antes. Ficam aqui até alguém reorganizá-las nos campos acima.">
          <textarea className={styles.textarea} value={form.legacyNotes} disabled={disabled} onChange={(e) => set('legacyNotes', e.target.value)} />
        </Section>
      )}
    </div>
  );
}
