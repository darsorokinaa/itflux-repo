const SIZES = new Set(["small", "medium", "large"]);

export default function SolutionArea({ size = "medium", className = "" }) {
  const safe = SIZES.has(size) ? size : "medium";
  return (
    <div
      className={`tdoc-solution tdoc-solution--${safe} solution-area solution-area--${safe} ${className}`.trim()}
    >
      <div className="tdoc-solution__grid solution-grid" role="presentation" />
    </div>
  );
}
