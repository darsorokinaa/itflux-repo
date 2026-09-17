export default function TaskBlock({
  as: Comp = "section",
  displayNumber,
  className = "",
  children,
  ...rest
}) {
  const n = Number(displayNumber);
  const shown = Number.isFinite(n) && n >= 1 ? n : undefined;
  return (
    <Comp
      className={`tdoc-task task-block ${className}`.trim()}
      data-display-number={shown}
      {...rest}
    >
      {children}
    </Comp>
  );
}
