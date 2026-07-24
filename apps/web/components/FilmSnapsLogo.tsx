export default function FilmSnapsPremiumLogo({
  className,
  size = 32,
}: {
  className?: string;
  size?: number;
}) {
  return (
    <img
      src="/logo.png"
      alt="FilmSnaps"
      width={size}
      height={size}
      className={className}
      style={{ objectFit: 'contain' }}
    />
  );
}
