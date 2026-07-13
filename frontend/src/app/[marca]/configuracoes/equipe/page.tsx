'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, UserPlus, Shield, X, Loader2, Trash2 } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import styles from '../configuracoes.module.css';
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
        // Email ainda sem conta: o backend devolve um link de uso único. Não há serviço
        // de email no projeto, então quem convida repassa o link.
        setInviteLink(res.invite.url);
      } else {
        // Já tinha conta: entrou direto na equipe.
        setInviteModalOpen(false);
      }

      setInviteEmail('');
      fetchMembers();
    } catch (error) {
      // Mostra a mensagem real do backend (permissão, email já na equipe, role inválida)
      // em vez de um texto genérico que chuta a causa.
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
    <div>
      <Link href={`/${params.marca}/configuracoes`} className={styles.backLink}>
        <ArrowLeft size={16} />
        Voltar para configurações
      </Link>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
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
        <p style={{ fontSize: '13px', color: 'var(--color-text-dim)', marginBottom: '16px' }}>
          {hint} Você pode ver a equipe, mas não alterá-la.
        </p>
      )}

      {erro && (
        <p style={{ fontSize: '13px', color: '#ef4444', marginBottom: '16px' }} role="alert">
          {erro}
        </p>
      )}

      <Card padding="lg">
        {loading ? (
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <Loader2 className="animate-spin" size={16} /> Carregando equipe...
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {members.map(member => (
              <div key={member.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', border: '1px solid var(--color-border)', borderRadius: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{ width: 32, height: 32, borderRadius: '50%', backgroundColor: 'var(--color-accent)', color: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold' }}>
                    {member.user.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontWeight: 500 }}>{member.user.name}</div>
                    <div style={{ fontSize: '12px', color: 'var(--color-text-dim)' }}>{member.user.email}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span style={{ fontSize: '12px', background: 'var(--color-bg-elevated)', padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--color-border)' }}>
                    {ROLE_LABELS[member.role as BrandRole] ?? member.role}
                  </span>
                  {member.role !== 'OWNER' && canManageTeam && (
                    <button onClick={() => handleRemove(member.userId)} style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer' }}>
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              </div>
            ))}
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
                <p style={{ fontSize: '13px', color: 'var(--color-text-muted, #9ca3af)', lineHeight: 1.5 }}>
                  Esta pessoa ainda não tem conta. Envie o link abaixo para ela criar a senha
                  e entrar na equipe. O link vale por 7 dias e só pode ser usado uma vez.
                </p>
                <input
                  readOnly
                  value={inviteLink}
                  onFocus={e => e.currentTarget.select()}
                  style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: '#fff', fontSize: '12px' }}
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
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '24px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', marginBottom: '8px' }}>Email</label>
                  <input
                    type="email"
                    required
                    style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--color-border)', background: 'transparent', color: '#fff' }}
                    value={inviteEmail}
                    onChange={e => setInviteEmail(e.target.value)}
                    placeholder="email@exemplo.com"
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', marginBottom: '8px' }}>Nível de Permissão</label>
                  <select
                    style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: '#fff' }}
                    value={inviteRole}
                    onChange={e => setInviteRole(e.target.value)}
                  >
                    <option value="ADMIN">ADMIN (Pode convidar outras pessoas)</option>
                    <option value="EDITOR">EDITOR (Pode criar e alterar designs)</option>
                    <option value="VIEWER">VIEWER (Apenas visualiza e comenta)</option>
                  </select>
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
