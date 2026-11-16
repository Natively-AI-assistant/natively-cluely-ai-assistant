// src/components/ui/StaticPrice.tsx
//
// A price that does not roll ("$12.50", "$30"), drawn in the same boxes as
// RollingPrice's odometer (settings/NativelyApiSettings.tsx): the "$" as a flex item,
// then the figure in an inline-block one em tall that sits on the baseline.
// That box is what sets the odometer's line height (one em plus the font's
// part below the baseline, 36px for the 32px price on macOS), so a card with
// a plain price stands exactly as tall as one with a rolling price, in any
// font (Evin, 2026-11-16: Yearly plan cards were 3.5px shorter than Monthly
// and the packs while "$12.50" was plain text).
import React from 'react';

export function StaticPrice({ price }: { price: string }) {
  const figure = price.startsWith('$') ? price.slice(1) : price;
  return (
    <span style={{ display: 'inline-flex' }}>
      {price.startsWith('$') && <span>$</span>}
      <span>
        <span style={{ display: 'inline-block', height: '1em', overflow: 'hidden' }}>{figure}</span>
      </span>
    </span>
  );
}

export default StaticPrice;
