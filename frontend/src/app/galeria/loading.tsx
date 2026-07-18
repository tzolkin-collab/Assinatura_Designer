export default function Loading() {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '60vh',
      gap: '12px',
      color: 'var(--color-text-tertiary)',
      fontSize: '14px',
    }}>
      <div style={{
        width: 20,
        height: 20,
        border: '2px solid var(--color-border)',
        borderTopColor: 'var(--color-brand)',
        borderRadius: '50%',
        animation: 'spin 0.6s linear infinite',
      }} />
      Carregando…
    </div>
  );
}
