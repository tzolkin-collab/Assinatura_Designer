import { redirect } from 'next/navigation';

// "Memória da IA" é a mesma memória que já se edita em "Agente e memória". Esta página não
// tinha nenhum link de entrada e duplicava a função; quem tiver o endereço antigo salvo cai
// na tela certa.
export default async function MemoriaPage({ params }: { params: Promise<{ marca: string }> }) {
  const { marca } = await params;
  redirect(`/${marca}/configuracoes/agent`);
}
