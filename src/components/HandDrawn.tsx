/**
 * Filters that make drawn lines look hand-drawn in the journal look (journal-look.css): a fine noise shifts every
 * stroke by a fraction of a pixel, so icons get slightly uneven, jagged lines like the reference sheet's drawings
 * instead of perfect vectors. `journal-hand` for small icons, `journal-hand-lg` for larger stickers (flower, star),
 * `journal-edge` for the edges of stickers and keys.
 * Rendered once per window; CSS refers to them by id (`filter: url(#journal-hand)`).
 */
export function HandDrawnFilters() {
  return <svg className="hand-drawn-filters" width="0" height="0" aria-hidden="true" focusable="false" style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}>
    <filter id="journal-hand" x="-15%" y="-15%" width="130%" height="130%" colorInterpolationFilters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.32" numOctaves="2" seed="7" result="noise" />
      <feDisplacementMap in="SourceGraphic" in2="noise" scale="0.95" xChannelSelector="R" yChannelSelector="G" />
    </filter>
    <filter id="journal-hand-lg" x="-10%" y="-10%" width="120%" height="120%" colorInterpolationFilters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.09 0.11" numOctaves="2" seed="3" result="wobble" />
      <feDisplacementMap in="SourceGraphic" in2="wobble" scale="3" xChannelSelector="R" yChannelSelector="G" result="wobbled" />
      <feTurbulence type="fractalNoise" baseFrequency="0.7" numOctaves="1" seed="11" result="grain" />
      <feDisplacementMap in="wobbled" in2="grain" scale="1.2" xChannelSelector="G" yChannelSelector="R" />
    </filter>
    {/* Edges (the ink line and the white die-cut edge, drawn by a pseudo-element): a slow wobble along the outline and
        a fine grain, so a sticker's edge bulges and frays a little like a cut-out by hand. */}
    <filter id="journal-edge" x="-6%" y="-6%" width="112%" height="112%" colorInterpolationFilters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="5" result="wobble" />
      <feDisplacementMap in="SourceGraphic" in2="wobble" scale="4" xChannelSelector="R" yChannelSelector="G" result="wobbled" />
      <feTurbulence type="fractalNoise" baseFrequency="0.45" numOctaves="1" seed="9" result="grain" />
      <feDisplacementMap in="wobbled" in2="grain" scale="1.4" xChannelSelector="G" yChannelSelector="R" />
    </filter>
  </svg>;
}
