import { redirect } from 'next/navigation';

// A pesquisa de concorrentes (marcas de referência analisadas pelo agente) foi removida. Quem
// tiver o endereço antigo salvo cai na Visão geral da marca em vez de numa tela que não existe.
export default async function ReferenciasPage({ params }: { params: Promise<{ marca: string }> }) {
  const { marca } = await params;
  redirect(`/${marca}`);
}
