const PALETTE = [
  '#4f46e5',
  '#0891b2',
  '#b45309',
  '#be185d',
  '#15803d',
  '#6d28d9',
  '#0369a1',
  '#c2410c',
];

function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join('');
}

export default function Avatar({ name }: { name: string }) {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = 31 * hash + name.charCodeAt(index);
  }

  return (
    <span
      className="av"
      style={{ background: PALETTE[hash % PALETTE.length] }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}
