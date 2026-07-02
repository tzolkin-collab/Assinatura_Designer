'use client';

import React, { useState, useEffect } from 'react';
import PageHeader from '@/components/ui/PageHeader';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import { X, HardDrive, CheckSquare, Settings2, UserPlus, Link2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth, User } from '@/lib/hooks';
import styles from './equipe.module.css';

export default function EquipePage() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  
  // Fake other users if we only have the current one for now (or later build a real /api/users endpoint)
  useEffect(() => {
    if (currentUser) {
      setUsers([currentUser]);
    }
  }, [currentUser]);

  const [showAddModal, setShowAddModal] = useState(false);
  const [showConnModal, setShowConnModal] = useState<string | null>(null); // userId

  const [asanaTokenInput, setAsanaTokenInput] = useState('');
  const [savingAsana, setSavingAsana] = useState(false);

  // Form states
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState('Designer');

  const handleAddUser = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName || !newEmail) return;

    const newUser: User = {
      id: `u${Date.now()}`,
      name: newName,
      email: newEmail,
      role: newRole,
      connections: { asana: false, drive: false },
    };

    setUsers([...users, newUser]);
    setShowAddModal(false);
    setNewName('');
    setNewEmail('');
    setNewRole('Designer');
  };

  const toggleAsanaConnection = async (userId: string) => {
    const u = users.find(x => x.id === userId);
    if (!u) return;
    
    if (u.connections?.asana) {
      // Desconectar
      try {
        await api.delete('/auth/connections/asana');
        setUsers(users.map(x => x.id === userId ? { ...x, connections: { ...x.connections, asana: false, drive: x.connections?.drive ?? false } } : x));
      } catch (err) {
        console.error(err);
      }
      return;
    }
    
    // O input do PAT deve estar preenchido
    if (!asanaTokenInput) return;
    setSavingAsana(true);
    try {
      await api.post('/auth/connections/asana', { token: asanaTokenInput });
      setUsers(users.map(x => x.id === userId ? { ...x, connections: { ...x.connections, asana: true, drive: x.connections?.drive ?? false } } : x));
      setAsanaTokenInput('');
    } catch (err) {
      console.error(err);
    } finally {
      setSavingAsana(false);
    }
  };

  const selectedUser = users.find(u => u.id === showConnModal);

  return (
    <div className={styles.page}>
      <div className={styles.headerActions}>
        <PageHeader
          title="Equipe & Conexões"
          description="Gerencie os usuários do sistema e suas integrações (Asana e Google Drive) para fluxos de IA e exportação."
        />
        <Button onClick={() => setShowAddModal(true)}>
          <UserPlus size={16} />
          Adicionar Usuário
        </Button>
      </div>

      <div className={styles.grid}>
        {users.map(user => (
          <Card key={user.id} hover className={styles.userCard}>
            <div className={styles.userInfo}>
              <div className={styles.avatar}>
                {user.name.charAt(0).toUpperCase()}
              </div>
              <div className={styles.userDetails}>
                <span className={styles.userName}>{user.name}</span>
                <span className={styles.userEmail}>{user.email}</span>
                <div>
                  <span className={styles.roleBadge}>{user.role}</span>
                </div>
              </div>
            </div>

            <div className={styles.connections}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className={styles.connLabel}>Integrações</span>
                <button 
                  style={{ cursor: 'pointer', color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 500 }}
                  onClick={() => setShowConnModal(user.id)}
                >
                  <Settings2 size={12} />
                  Configurar
                </button>
              </div>

              <div className={styles.connItem}>
                <div className={styles.connInfo}>
                  <CheckSquare size={16} className={styles.connIcon} />
                  <span>Asana</span>
                </div>
                <span className={`${styles.connStatus} ${user.connections?.asana ? styles.statusActive : styles.statusInactive}`}>
                  {user.connections?.asana ? 'Conectado' : 'Desconectado'}
                </span>
              </div>

              <div className={styles.connItem}>
                <div className={styles.connInfo}>
                  <HardDrive size={16} className={styles.connIcon} />
                  <span>Google Drive</span>
                </div>
                <span className={`${styles.connStatus} ${user.connections?.drive ? styles.statusActive : styles.statusInactive}`}>
                  {user.connections?.drive ? 'Conectado' : 'Desconectado'}
                </span>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Add User Modal */}
      {showAddModal && (
        <div className={styles.modalOverlay} onClick={() => setShowAddModal(false)}>
          <div className={styles.modalContent} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>Novo Usuário</h2>
              <button className={styles.closeBtn} onClick={() => setShowAddModal(false)}>
                <X size={20} />
              </button>
            </div>
            
            <form className={styles.form} onSubmit={handleAddUser}>
              <div className={styles.formGroup}>
                <label className={styles.label}>Nome Completo</label>
                <input 
                  type="text" 
                  className={styles.input} 
                  placeholder="Ex: João Silva" 
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  autoFocus
                  required
                />
              </div>
              <div className={styles.formGroup}>
                <label className={styles.label}>E-mail</label>
                <input 
                  type="email" 
                  className={styles.input} 
                  placeholder="Ex: joao@assinatura.com" 
                  value={newEmail}
                  onChange={e => setNewEmail(e.target.value)}
                  required
                />
              </div>
              <div className={styles.formGroup}>
                <label className={styles.label}>Cargo</label>
                <select 
                  className={styles.input}
                  value={newRole}
                  onChange={e => setNewRole(e.target.value)}
                >
                  <option value="Designer">Designer</option>
                  <option value="Administrador">Administrador</option>
                  <option value="Atendimento">Atendimento</option>
                </select>
              </div>

              <div className={styles.formActions}>
                <Button variant="secondary" type="button" onClick={() => setShowAddModal(false)}>
                  Cancelar
                </Button>
                <Button type="submit">
                  Convidar
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Connections Modal */}
      {showConnModal && selectedUser && (
        <div className={styles.modalOverlay} onClick={() => setShowConnModal(null)}>
          <div className={styles.modalContent} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>Conexões de {selectedUser.name.split(' ')[0]}</h2>
              <button className={styles.closeBtn} onClick={() => setShowConnModal(null)}>
                <X size={20} />
              </button>
            </div>
            
            <div className={styles.form}>
              <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', marginBottom: 8, lineHeight: 1.5 }}>
                Vincule as contas para permitir que a IA acesse briefs no Asana e exporte/importe insumos do Google Drive automaticamente.
              </p>

              <Card padding="md" style={{ background: 'var(--color-bg)' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ width: 40, height: 40, background: 'var(--color-surface)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--color-border)' }}>
                        <CheckSquare size={20} color="#F06A6A" />
                      </div>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 14 }}>Asana Workspace</div>
                        <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>Token Pessoal (PAT)</div>
                      </div>
                    </div>
                    {selectedUser.connections?.asana ? (
                      <Button 
                        variant="secondary"
                        onClick={() => toggleAsanaConnection(selectedUser.id)}
                      >
                        <Link2 size={14} />
                        Desconectar
                      </Button>
                    ) : (
                      <Button 
                        variant="primary"
                        onClick={() => toggleAsanaConnection(selectedUser.id)}
                        disabled={savingAsana || !asanaTokenInput}
                      >
                        <Link2 size={14} />
                        {savingAsana ? 'Conectando...' : 'Conectar'}
                      </Button>
                    )}
                  </div>
                  
                  {!selectedUser.connections?.asana && (
                    <div style={{ marginTop: 8 }}>
                      <input 
                        type="text" 
                        className={styles.input} 
                        placeholder="Cole o seu Personal Access Token (PAT) do Asana..." 
                        value={asanaTokenInput}
                        onChange={e => setAsanaTokenInput(e.target.value)}
                      />
                      <p style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 4 }}>
                        Crie um PAT no painel de desenvolvedor do Asana e cole aqui.
                      </p>
                    </div>
                  )}
                </div>
              </Card>

              <Card padding="md" style={{ background: 'var(--color-bg)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 40, height: 40, background: 'var(--color-surface)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--color-border)' }}>
                      <HardDrive size={20} color="#1FA463" />
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>Google Drive</div>
                      <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>OAuth 2.0</div>
                    </div>
                  </div>
                  {selectedUser.connections?.drive ? (
                    <Button 
                      variant="secondary"
                      onClick={() => alert('TODO: Implementar logout do Drive')}
                    >
                      <Link2 size={14} />
                      Desconectar
                    </Button>
                  ) : (
                    <Button 
                      variant="primary"
                      onClick={() => alert('TODO: Implementar OAuth do Drive')}
                    >
                      <Link2 size={14} />
                      Conectar
                    </Button>
                  )}
                </div>
              </Card>

              <div className={styles.formActions} style={{ marginTop: 16 }}>
                <Button onClick={() => setShowConnModal(null)}>
                  Concluído
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
