type HeroStatItemProps = {
  value: string;
  label: string;
};

export default function HeroStatItem({ value, label }: HeroStatItemProps) {
  return (
    <li className="home-hero-stat-item">
      <span className="home-hero-stat-item__value">{value}</span>
      <span className="home-hero-stat-item__label">{label}</span>
    </li>
  );
}
