const TILES = [
  { top: "8%", left: "4%" },
  { top: "18%", left: "38%" },
  { top: "12%", left: "70%" },
  { top: "42%", left: "10%" },
  { top: "48%", left: "48%" },
  { top: "38%", left: "78%" },
  { top: "72%", left: "6%" },
  { top: "78%", left: "42%" },
  { top: "68%", left: "74%" },
];

export default function MaterialWatermarkOverlay({ text = "ДЕМО · ЦИФРОВОЙ ПОТОК" }) {
  return (
    <div className="material-demo-watermark" aria-hidden="true">
      {TILES.map((tile, index) => (
        <span key={index} className="material-demo-watermark__tile" style={tile}>
          {text}
        </span>
      ))}
    </div>
  );
}
