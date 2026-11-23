import { redirect } from 'next/navigation';

// "Projetos da equipe" repetia o filtro "Descobrir" da galeria de projetos: mesma lista
// (/brands/discover) e o mesmo pedido de acesso. Quem tiver o endereço antigo salvo cai na
// galeria já no modo Descobrir.
export default function ProjetosPage() {
  redirect('/galeria?modo=descobrir');
}
