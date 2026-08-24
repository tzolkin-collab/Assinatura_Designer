import React from 'react';
import { X, Sparkles } from 'lucide-react';
import styles from '../brand-galeria.module.css';

interface FolderNode {
  id: string;
  name: string;
  parentId: string | null;
}

interface AiReportModalProps {
  onClose: () => void;
  isGeneratingReport: boolean;
  activeFolder: string | null;
  folders: FolderNode[];
}

export function AiReportModal({
  onClose,
  isGeneratingReport,
  activeFolder,
  folders
}: AiReportModalProps) {
  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.aiReportModal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <div className={styles.aiReportHeader}>
            <h3 className={styles.aiReportTitle}>
              <Sparkles size={24} style={{ color: 'var(--color-brand)' }} />
              Relatório de Direção de Arte
            </h3>
            <span className={styles.aiReportSubtitle}>
              Análise da pasta <strong>{activeFolder ? folders.find(f => f.id === activeFolder)?.name : 'Todas as Artes'}</strong> gerada por Inteligência Artificial
            </span>
          </div>
          <button className={styles.closeBtn} onClick={onClose} style={{ alignSelf: 'flex-start' }}>
            <X size={20} />
          </button>
        </div>

        <div className={styles.aiReportContent}>
          {isGeneratingReport ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-4)', padding: 'var(--space-8) 0', color: 'var(--color-text-secondary)' }}>
              <Sparkles size={32} className={styles.sparkleIcon} style={{ color: 'var(--color-brand)' }} />
              <p>A Inteligência Artificial está analisando os criativos e os passos de decisão...</p>
            </div>
          ) : (
            <>
              <div className={styles.aiReportSection}>
                <h4>Contexto e Tom de Voz</h4>
                <p>Esta coleção demonstra uma abordagem visual voltada para a autoridade e clareza. Os criativos utilizam predominantemente layouts de alto contraste (Texto | Imagem) que favorecem a leitura rápida e a retenção da mensagem. A paleta de cores sugere um posicionamento premium e direto.</p>
              </div>

              <div className={styles.aiReportSection}>
                <h4>Padrões Identificados</h4>
                <ul>
                  <li><strong>Estrutura de Carrossel:</strong> A maioria das apresentações segue a estrutura &ldquo;Problema → Solução → Call to Action&rdquo;, mantendo o usuário engajado até o último slide.</li>
                  <li><strong>Densidade de Texto:</strong> Os slides estão configurados com densidade &ldquo;Breve&rdquo;, o que é ideal para o Instagram e LinkedIn, garantindo que o visual não fique sobrecarregado.</li>
                  <li><strong>Uso de Imagens:</strong> Imagens de referência são frequentemente usadas no lado direito, criando uma âncora visual enquanto o texto à esquerda conduz a narrativa.</li>
                </ul>
              </div>

              <div className={styles.aiReportSection}>
                <h4>Sugestões da IA para os Próximos Passos</h4>
                <ul>
                  <li>Experimente alternar para o layout &ldquo;Citação&rdquo; no meio dos carrosséis para quebrar o ritmo e dar destaque a uma frase de efeito.</li>
                  <li>Para os posts únicos (Single Image), teste abordagens com a densidade &ldquo;Média&rdquo; caso precise explicar conceitos um pouco mais complexos na mesma imagem.</li>
                  <li>Considere criar uma pasta separada apenas para &ldquo;Templates Testados&rdquo; para manter os melhores desempenhos isolados para reutilização futura.</li>
                </ul>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
