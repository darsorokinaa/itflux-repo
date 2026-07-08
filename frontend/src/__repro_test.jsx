const ITEMS = [{ id: 1, Icon: () => null }];

export default function Repro() {
  return (
    <div>
      {ITEMS.map(({ id, Icon }) => (
        <span key={id}>
          <Icon />
        </span>
      ))}
    </div>
  );
}
