export function PlaneIcon({ className = "" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M21 16v-2l-8-5V3.5A1.5 1.5 0 0 0 11.5 2 1.5 1.5 0 0 0 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5L21 16z"
      />
    </svg>
  );
}

export function TravelMiniMap({ className = "" }) {
  return (
    <span className={`variant-theme-minimap ${className}`.trim()} aria-hidden="true">
      <span className="variant-theme-minimap__path" />
      <span className="variant-theme-minimap__dot variant-theme-minimap__dot--a" />
      <span className="variant-theme-minimap__dot variant-theme-minimap__dot--b" />
      <span className="variant-theme-minimap__dot variant-theme-minimap__dot--c" />
      <PlaneIcon className="variant-theme-minimap__plane" />
    </span>
  );
}
