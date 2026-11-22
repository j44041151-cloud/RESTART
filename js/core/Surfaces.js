/**
 * Where the Restorer is standing.
 *
 * The city is built from merged geometry, so instead of asking the ground mesh
 * for a material we resolve the surface from the district layout: plaza paving,
 * the solar catwalk, the flooded fountain, the garden soil, the broken streets
 * and the dust flats between them.
 */
export const SURFACE_NAMES = ['sand', 'mud', 'concrete', 'rubble', 'metal', 'water'];

const STREET_HALF_WIDTH = 10.5;

export function surfaceAt(pos) {
  const x = pos.x;
  const z = pos.z;
  const y = pos.y;

  // Solar Walkway: the elevated deck and its ramp platforms are steel grating.
  if (y > 2.6 && x > 66 && x < 108 && Math.abs(z) < 23) return 'metal';
  if (y > 1.6 && x > 32 && x < 68 && Math.abs(z) < 5.5) return 'metal';

  // Water Station fountain basin — shallow standing water once it is running.
  if (Math.hypot(x + 72, z) < 7.2 && y < 1.1) return 'water';

  // Overgrown Courtyard: wet soil and leaf litter.
  if (Math.hypot(x - 0, z - 88) < 25) return 'mud';

  // Arrival Plaza paving.
  if (Math.hypot(x, z) < 26.5) return 'concrete';

  // Reclamation station apron: wet concrete, not open water.
  if (Math.hypot(x + 72, z) < 25) return 'concrete';

  // The four avenues out of the plaza: broken asphalt and rubble.
  if (Math.abs(x) < STREET_HALF_WIDTH || Math.abs(z) < STREET_HALF_WIDTH) return 'rubble';

  // Everything else is wind-blown dust and grit between the ruins.
  return 'sand';
}

/** Reverb tail for a given surface (0 = dry, 1 = cavernous). */
export function surfaceReverb(surface) {
  switch (surface) {
    case 'metal': return 0.32;
    case 'concrete': return 0.24;
    case 'rubble': return 0.17;
    case 'water': return 0.13;
    case 'mud': return 0.06;
    case 'sand': return 0.05;
    default: return 0.15;
  }
}
