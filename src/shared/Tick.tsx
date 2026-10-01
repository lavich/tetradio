/** Галочка проверки: зелёная — сделано или верно, янтарная — почти; ошибки остаются красной ручкой. */
export function Tick({ className, label = "выполнено" }: { className?: string; label?: string }) {
  return (
    <svg className={className} viewBox="0 0 34 30" role="img" aria-label={label}>
      <path
        d="M3 16c3 1 6 5 8 9 4-9 10-16 20-22"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
