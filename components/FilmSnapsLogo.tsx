export default function FilmSnapsPremiumLogo({
  className,
}: {
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 64 64"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      fill="currentColor"
      aria-hidden="true"
    >
      {/* Letter F */}
      <rect x="8" y="8" width="10" height="48" rx="2" />
      <rect x="8" y="8" width="28" height="10" rx="2" />
      <rect x="8" y="28" width="22" height="10" rx="2" />

      {/* Letter S (proper, real S shape, shorter than F) */}
      <text
        x="38"
        y="44"
        fontFamily="Inter, sans-serif"
        fontWeight="700"
        fontSize="36"
        textAnchor="middle"
        dominantBaseline="middle"
      >
        S
      </text>
    </svg>
  );
}
