// Port de avatarHTML() del wireframe: círculo con iniciales y color estable por nombre.
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
export const initials = (name: string) =>
  name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
export default function Avatar({ name }: { name: string }) {
  let hash = 0;
  for (let i = 0; i < name.length; i++)
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
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
