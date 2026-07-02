'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles, Palette, MessageSquare, CheckCircle, ArrowRight, ArrowLeft, Loader2 } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import styles from './onboarding.module.css';
import { api, ApiError } from '@/lib/api';

const STEPS = [
  { id: 'brand', label: 'Marca', icon: <Sparkles size={16} /> },
  { id: 'visual', label: 'Visual', icon: <Palette size={16} /> },
  { id: 'voice', label: 'Tom de Voz', icon: <MessageSquare size={16} /> },
  { id: 'preview', label: 'Pronto!', icon: <CheckCircle size={16} /> },
];

export default function OnboardingPage() {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [savingStep, setSavingStep] = useState('');
  const [error, setError] = useState('');

  // Step 1: Brand
  const [name, setName] = useState('');

  // Step 2: Visual
  const [primaryColor, setPrimaryColor] = useState('#171717');
  const [font, setFont] = useState('Inter');

  // Step 3: Voice — manual mode
  const [guidelines, setGuidelines] = useState('Siga um tom profissional e moderno.');

  // Step 3: Voice — AI mode
  const [useAI, setUseAI] = useState(false);
  const [industry, setIndustry] = useState('');
  const [audience, setAudience] = useState('');
  const [keywords, setKeywords] = useState('');

  const canAdvanceStep2 = currentStep !== 2 || !useAI || (industry.trim().length > 0 && audience.trim().length > 0);

  const handleNext = () => {
    if (currentStep === 0 && !name.trim()) return;
    if (!canAdvanceStep2) return;
    if (currentStep < STEPS.length - 1) {
      setCurrentStep(curr => curr + 1);
    }
  };

  const handlePrev = () => {
    if (currentStep > 0) {
      setCurrentStep(curr => curr - 1);
    }
  };

  const handleFinish = async () => {
    setSaving(true);
    setError('');

    try {
      setSavingStep('Criando marca...');
      const brand = await api.post<{ slug: string }>('/brands', { name: name.trim(), color: primaryColor });

      let configColors = [primaryColor, '#ffffff', '#666666'];
      let configGuidelines = guidelines;
      let configAgentPrompt = `Você é um assistente de design especializado para a marca ${name}. Siga rigorosamente o tom de voz e identidade visual definidos nas diretrizes.`;

      if (useAI && industry.trim() && audience.trim()) {
        setSavingStep('Gerando diretrizes com IA...');
        try {
          const briefing = await api.post<{ guidelines: string; agentPrompt: string; suggestedColors: string[] }>(
            `/ai/${brand.slug}/generate-briefing`,
            {
              industry: industry.trim(),
              audience: audience.trim(),
              keywords: keywords.split(',').map((k) => k.trim()).filter(Boolean),
            }
          );
          if (briefing.guidelines) configGuidelines = briefing.guidelines;
          if (briefing.agentPrompt) configAgentPrompt = briefing.agentPrompt;
          if (briefing.suggestedColors?.length) configColors = briefing.suggestedColors;
        } catch {
          // AI generation failed — continue with manual values
        }
      }

      setSavingStep('Salvando configurações...');
      await api.put(`/settings/${brand.slug}/config`, {
        colors: configColors,
        primaryFonts: [font],
        guidelines: configGuidelines,
        agentPrompt: configAgentPrompt,
      });

      router.push(`/${brand.slug}/galeria`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erro ao criar marca e configurações.');
      setSaving(false);
      setSavingStep('');
    }
  };

  return (
    <div className={styles.page}>
      <PageHeader
        title="Setup de Nova Marca"
        description="Configure a inteligência artificial para entender e reproduzir a sua identidade visual."
      />

      <div className={styles.stepper}>
        {STEPS.map((step, index) => (
          <div key={step.id} className={`${styles.step} ${index <= currentStep ? styles.stepActive : ''}`}>
            <div className={styles.stepIcon}>{step.icon}</div>
            <span className={styles.stepLabel}>{step.label}</span>
          </div>
        ))}
      </div>

      <Card className={styles.contentCard}>
        {error && <div className={styles.errorBox}>{error}</div>}

        {currentStep === 0 && (
          <div className={styles.stepContent}>
            <h2>Qual é o nome da sua marca?</h2>
            <p>O primeiro passo é darmos um nome para organizar seus posts.</p>
            <div style={{ marginTop: '24px' }}>
              <Input
                placeholder="Ex: Minha Empresa"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </div>
          </div>
        )}

        {currentStep === 1 && (
          <div className={styles.stepContent}>
            <h2>Identidade Visual</h2>
            <p>Escolha a cor principal e a fonte que mais combina com a sua marca.</p>
            <div style={{ marginTop: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', fontWeight: 500 }}>Cor Principal</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <input
                    type="color"
                    value={primaryColor}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                    style={{ width: '48px', height: '48px', padding: '0', border: 'none', borderRadius: '8px', cursor: 'pointer' }}
                  />
                  <span>{primaryColor}</span>
                </div>
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', fontWeight: 500 }}>Fonte Principal</label>
                <Input
                  placeholder="Ex: Inter, Roboto, Arial"
                  value={font}
                  onChange={(e) => setFont(e.target.value)}
                />
              </div>
            </div>
          </div>
        )}

        {currentStep === 2 && (
          <div className={styles.stepContent}>
            <h2>Diretrizes e Tom de Voz</h2>
            <p>Como a sua marca se comunica? Configure manualmente ou deixe a IA gerar.</p>

            <div style={{ display: 'flex', gap: '8px', marginTop: '20px', marginBottom: '20px' }}>
              <button
                onClick={() => setUseAI(false)}
                style={{
                  padding: '8px 16px',
                  borderRadius: '8px',
                  border: '1px solid var(--color-border)',
                  background: !useAI ? 'var(--color-accent)' : 'transparent',
                  color: !useAI ? '#fff' : 'var(--color-text)',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: 500,
                }}
              >
                Manual
              </button>
              <button
                onClick={() => setUseAI(true)}
                style={{
                  padding: '8px 16px',
                  borderRadius: '8px',
                  border: '1px solid var(--color-border)',
                  background: useAI ? 'var(--color-accent)' : 'transparent',
                  color: useAI ? '#fff' : 'var(--color-text)',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: 500,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <Sparkles size={14} /> Gerar com IA
              </button>
            </div>

            {!useAI ? (
              <textarea
                value={guidelines}
                onChange={(e) => setGuidelines(e.target.value)}
                rows={5}
                placeholder="Ex: Tom profissional e moderno. Foco em resultados. Evitar linguagem informal."
                style={{
                  width: '100%',
                  padding: '12px',
                  borderRadius: '8px',
                  border: '1px solid var(--color-border)',
                  backgroundColor: 'var(--color-bg)',
                  color: 'var(--color-text)',
                  fontSize: '14px',
                  resize: 'vertical',
                }}
              />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div>
                  <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', fontWeight: 500 }}>
                    Setor / Indústria <span style={{ color: 'var(--color-accent)' }}>*</span>
                  </label>
                  <Input
                    placeholder="Ex: Moda, Tecnologia, Saúde, Alimentação"
                    value={industry}
                    onChange={(e) => setIndustry(e.target.value)}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', fontWeight: 500 }}>
                    Público-Alvo <span style={{ color: 'var(--color-accent)' }}>*</span>
                  </label>
                  <Input
                    placeholder="Ex: Mulheres 25-40 anos, empreendedoras, classe B"
                    value={audience}
                    onChange={(e) => setAudience(e.target.value)}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', fontWeight: 500 }}>
                    Palavras-chave <span style={{ color: 'var(--color-text-secondary)', fontWeight: 400 }}>(opcional)</span>
                  </label>
                  <Input
                    placeholder="Ex: elegante, moderno, premium, minimalista"
                    value={keywords}
                    onChange={(e) => setKeywords(e.target.value)}
                  />
                </div>
                <p style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>
                  A IA irá gerar as diretrizes, o system prompt do agente e sugerir uma paleta de cores.
                </p>
              </div>
            )}
          </div>
        )}

        {currentStep === 3 && (
          <div className={styles.stepContent}>
            <h2>Tudo pronto!</h2>
            {useAI ? (
              <>
                <p>
                  Ao finalizar, a IA irá gerar automaticamente as diretrizes de marca para <strong>{name}</strong> com base no setor <em>{industry}</em> e no público <em>{audience}</em>.
                </p>
                <p style={{ marginTop: '12px', color: 'var(--color-text-secondary)' }}>
                  Isso pode levar alguns segundos. Você será redirecionado para a Galeria ao concluir.
                </p>
              </>
            ) : (
              <>
                <p>
                  Sua marca <strong>{name}</strong> está configurada. O Agente Designer já sabe as cores, a fonte principal e como se comunicar.
                </p>
                <p style={{ marginTop: '16px', color: 'var(--color-text-secondary)' }}>
                  Ao finalizar, você será redirecionado para a Galeria e poderá acessar a Fábrica para gerar seus primeiros criativos.
                </p>
              </>
            )}
          </div>
        )}

        <div className={styles.actions}>
          {currentStep > 0 ? (
            <Button variant="secondary" onClick={handlePrev} disabled={saving}>
              <ArrowLeft size={16} /> Voltar
            </Button>
          ) : (
            <div />
          )}

          {currentStep < STEPS.length - 1 ? (
            <Button onClick={handleNext} disabled={(currentStep === 0 && !name.trim()) || !canAdvanceStep2}>
              Próximo <ArrowRight size={16} />
            </Button>
          ) : (
            <Button onClick={handleFinish} disabled={saving}>
              {saving ? (
                <>
                  <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
                  {savingStep}
                </>
              ) : (
                <>
                  Concluir e Começar <Sparkles size={16} />
                </>
              )}
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}
