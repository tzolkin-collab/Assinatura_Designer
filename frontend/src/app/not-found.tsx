import Link from 'next/link';
import styles from './not-found.module.css';

/**
 * 404 do app. Sem ele valia a página padrão do Next, que em sistema no modo escuro pinta o texto
 * de branco sobre o nosso fundo claro: a mensagem sumia.
 */
export default function NotFound() {
  return (
    <div className={styles.wrap}>
      <p className={styles.code}>404</p>
      <h1 className={styles.title}>Esta página não existe</h1>
      <p className={styles.text}>O endereço pode ter mudado ou a peça foi apagada.</p>
      <Link href="/" className={styles.link}>Voltar para o início</Link>
    </div>
  );
}
