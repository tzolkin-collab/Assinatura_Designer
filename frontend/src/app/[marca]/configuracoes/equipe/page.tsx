'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, UserPlus, X, Loader2, Trash2 } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import styles from './equipe.module.css';
import { api, getApiErrorMessage } from '@/lib/api';
import { useBrandPermissions } from '@/hooks/useBrandPermissions';
import { ROLE_LABELS, type BrandRole } from '@/lib/permissions';

interface Member {
  id: string;
  role: string;
  userId: string;
  user: { name: string; email: string };
}

interface InviteResponse {
  member: Member | null;
  invite: { email: string; role: string; url: string; expiresAt: string } | null;
}

export default function EquipePage() {
  const params = useParams();
  const slug = params.marca as string;
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('EDITOR');
  const [inviting, setInviting] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [erro, setErro] = useState('');

  const { can, hint, loading: permsLoading } = useBrandPermissions();
  const canManageTeam = can('manage-team');

  const fetchMembers = async () => {
    try {
      const res = await api.get<Member[]>(`/brands/${slug}/members`);
      setMembers(res);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMembers();
  }, [slug]);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviting(true);
    try {
      const res = await api.post<InviteResponse>(`/brands/${slug}/members/invite`, {
        email: inviteEmail,
        role: inviteRole
      });

      if (res.invite) {
        setInviteLink(res.invite.url);
      } else {
        setInviteModalOpen(false);
      }

      setInviteEmail('');
      fetchMembers();
    } catch (error) {
      setErro(getApiErrorMessage(error, 'Não foi possível convidar.'));
    } finally {
      setInviting(false);
    }
  };

  const closeInviteModal = () => {
    setInviteModalOpen(false);
    setInviteLink(null);
    setErro('');
  };

  const handleRemove = async (userId: string) => {
    if (!confirm('Tem certeza que deseja remover este membro da marca?')) return;
    try {
      await api.delete(`/brands/${slug}/members/${userId}`);
      fetchMembers();
    } catch (e) {
      setErro(getApiErrorMessage(e, 'Não foi possível remover o membro.'));
    }
  };

  return (
    <div className={styles.container}>
      <Link href={`/${params.marca}/configuracoes`} className={styles.backLink}>
        <ArrowLeft size={16} />
        Voltar para configurações
      </Link>

      <div className={styles.headerRow}>
        <PageHeader
          title="Gestão de Equipe"
          description="Controle quem tem acesso aos designs desta marca."
        />
        <Button
          onClick={() => setInviteModalOpen(true)}
          disabled={!canManageTeam}
          title={canManageTeam ? undefined : hint}
        >
          <UserPlus size={16} /> Convidar Membro
        </Button>
      </div>

      {!canManageTeam && !permsLoading && (
        <p className={styles.hintText}>
          {hint} Você pode ver a equipe, mas não alterá-la.
        </p>
      )}

      {erro && (
        <p className={styles.errorText} role="alert">
          {erro}
        </p>
      )}

      <Card padding="none">
        {loading ? (
          <div style={{ padding: '32px', display: 'flex', gap: '8px', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-tertiary)' }}>
            <Loader2 className="animate-spin" size={16} /> Carregando equipe...
          </div>
        ) : (
          <div>
            <div className={styles.tableHeader}>
              <div>Usuário</div>
              <div>Nível de Acesso</div>
              <div></div>
            </div>
            <div className={styles.memberList}>
              {members.map(member => (
                <div key={member.id} className={styles.memberRow}>
                  <div className={styles.userInfo}>
                    <div className={styles.avatar}>
                      {member.user.name.charAt(0).toUpperCase()}
                    </div>
                    <div className={styles.userDetails}>
                      <span className={styles.userName}>{member.user.name}</span>
                      <span className={styles.userEmail}>{member.user.email}</span>
                    </div>
                  </div>
                  <div>
                    <span className={`${styles.roleBadge} ${member.role === 'ADMIN' || member.role === 'OWNER' ? styles.admin : ''}`}>
                      {ROLE_LABELS[member.role as BrandRole] ?? member.role}
                    </span>
                  </div>
                  <div className={styles.actions}>
                    {member.role !== 'OWNER' && canManageTeam && (
                      <button onClick={() => handleRemove(member.userId)} className={styles.deleteButton} title="Remover usuário">
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>

      {inviteModalOpen && (
        <div className={styles.modalOverlay} onClick={closeInviteModal}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>Convidar Membro</h2>
              <button className={styles.modalClose} onClick={closeInviteModal}>
                <X size={18} />
              </button>
            </div>

            {inviteLink ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <p style={{ fontSize: '13px', color: 'var(--color-text-tertiary)', lineHeight: 1.5 }}>
                  Esta pessoa ainda não tem conta. Envie o link abaixo para ela criar a senha
                  e entrar na equipe. O link vale por 7 dias e só pode ser usado uma vez.
                </p>
                <input
                  readOnly
                  value={inviteLink}
                  className={styles.inputField}
                  onFocus={e => e.currentTarget.select()}
                />
                <div className={styles.modalActions}>
                  <Button type="button" variant="secondary" onClick={closeInviteModal}>Fechar</Button>
                  <Button type="button" onClick={() => navigator.clipboard?.writeText(inviteLink)}>
                    Copiar link
                  </Button>
                </div>
              </div>
            ) : (
            <form onSubmit={handleInvite}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', marginBottom: '24px' }}>
                <div>
                  <label className={styles.inputLabel}>Email</label>
                  <input
                    type="email"
                    required
                    className={styles.inputField}
                    value={inviteEmail}
                    onChange={e => setInviteEmail(e.target.value)}
                    placeholder="email@exemplo.com"
                  />
                </div>
                
                <div>
                  <label className={styles.inputLabel}>Nível de Permissão</label>
                  <div className={styles.roleSelector}>
                    {/* Role ADMIN */}
                    <label className={`${styles.roleOption} ${inviteRole === 'ADMIN' ? styles.selected : ''}`}>
                      <input
                        type="radio"
                        name="role"
                        value="ADMIN"
                        checked={inviteRole === 'ADMIN'}
                        onChange={e => setInviteRole(e.target.value)}
                        className={styles.roleRadio}
                      />
                      <div className={styles.roleDetails}>
                        <span className={styles.roleName}>Administrador (ADMIN)</span>
                        <span className={styles.roleDesc}>Acesso total. Pode criar e editar designs, gerenciar equipe, configurar a IA e apagar a marca.</span>
                      </div>
                    </label>

                    {/* Role EDITOR */}
                    <label className={`${styles.roleOption} ${inviteRole === 'EDITOR' ? styles.selected : ''}`}>
                      <input
                        type="radio"
                        name="role"
                        value="EDITOR"
                        checked={inviteRole === 'EDITOR'}
                        onChange={e => setInviteRole(e.target.value)}
                        className={styles.roleRadio}
                      />
                      <div className={styles.roleDetails}>
                        <span className={styles.roleName}>Editor (EDITOR)</span>
                        <span className={styles.roleDesc}>Criador de conteúdo. Pode conversar com a IA, gerar novos designs e editar slides. Não gerencia a equipe.</span>
                      </div>
                    </label>

                    {/* Role VIEWER */}
                    <label className={`${styles.roleOption} ${inviteRole === 'VIEWER' ? styles.selected : ''}`}>
                      <input
                        type="radio"
                        name="role"
                        value="VIEWER"
                        checked={inviteRole === 'VIEWER'}
                        onChange={e => setInviteRole(e.target.value)}
                        className={styles.roleRadio}
                      />
                      <div className={styles.roleDetails}>
                        <span className={styles.roleName}>Visualizador (VIEWER)</span>
                        <span className={styles.roleDesc}>Somente leitura. Pode visualizar os designs gerados e baixar arquivos finais, mas não pode editar ou criar.</span>
                      </div>
                    </label>
                  </div>
                </div>
              </div>
              <div className={styles.modalActions}>
                <Button type="button" variant="secondary" onClick={closeInviteModal}>Cancelar</Button>
                <Button type="submit" disabled={inviting}>
                  {inviting ? 'Convidando...' : 'Enviar Convite'}
                </Button>
              </div>
            </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
