import { redirect } from 'next/navigation';

// "Equipe e permissões" saiu das configurações (22/11/2026). Todo usuário da equipe interna vira
// membro de toda marca automaticamente (backend/src/lib/internalTeam.ts): quem era removido pela
// tela voltava na próxima sincronização da equipe, e convidar alguém que já tinha conta dava erro.
// Quem tiver o endereço antigo salvo cai na lista de configurações da marca.
export default async function EquipePage({ params }: { params: Promise<{ marca: string }> }) {
  const { marca } = await params;
  redirect(`/${marca}/configuracoes`);
}
