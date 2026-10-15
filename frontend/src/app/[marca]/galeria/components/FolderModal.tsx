import React from 'react';
import { X, Plus } from 'lucide-react';
import Button from '@/components/ui/Button';
import styles from '../brand-galeria.module.css';

interface FolderNode {
  id: string;
  name: string;
  parentId: string | null;
}

interface FolderModalProps {
  onClose: () => void;
  newFolderParentId: string | null;
  folders: FolderNode[];
  newFolderName: string;
  setNewFolderName: (name: string) => void;
  creatingFolder: boolean;
  handleCreateFolder: (e: React.FormEvent) => void;
}

export function FolderModal({
  onClose,
  newFolderParentId,
  folders,
  newFolderName,
  setNewFolderName,
  creatingFolder,
  handleCreateFolder
}: FolderModalProps) {
  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h3 className={styles.modalTitle}>
            {newFolderParentId
              ? `Nova subpasta em "${folders.find(f => f.id === newFolderParentId)?.name ?? ''}"`
              : 'Criar Pasta'}
          </h3>
          <button className={styles.closeBtn} onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleCreateFolder} className={styles.folderForm} style={{ marginBottom: 0 }}>
          <input
            type="text"
            placeholder="Ex: Conteúdo orgânico"
            value={newFolderName}
            onChange={e => setNewFolderName(e.target.value)}
            className={styles.folderInput}
            autoFocus
          />
          <Button type="submit" size="sm" disabled={!newFolderName.trim() || creatingFolder}>
            <Plus size={14} />
            {creatingFolder ? 'Criando...' : 'Criar'}
          </Button>
        </form>
      </div>
    </div>
  );
}
