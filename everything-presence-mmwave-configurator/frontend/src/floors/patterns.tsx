/**
 * Floor material SVG patterns. Referenced by fill="url(#floor-{id})".
 * All dimensions in mm. Keys must match material IDs in catalog.ts.
 */
import React from 'react';

export const FLOOR_PATTERNS: Record<string, React.ReactNode> = {
  // ========== WOOD FLOORS ==========
  'wood-oak': (
    <pattern id="floor-wood-oak" width="120" height="20" patternUnits="userSpaceOnUse">
      <rect width="120" height="20" fill="#C9A66B" />
      {/* Wood plank with grain lines */}
      <rect x="0" y="0" width="40" height="20" fill="#C9A66B" />
      <rect x="40" y="0" width="40" height="20" fill="#D4B07A" />
      <rect x="80" y="0" width="40" height="20" fill="#BF9C5E" />
      {/* Grain lines */}
      <line x1="5" y1="5" x2="35" y2="5" stroke="#B8945A" strokeWidth="0.3" opacity="0.4" />
      <line x1="8" y1="12" x2="32" y2="12" stroke="#B8945A" strokeWidth="0.3" opacity="0.3" />
      <line x1="45" y1="8" x2="75" y2="8" stroke="#C9A66B" strokeWidth="0.3" opacity="0.4" />
      <line x1="48" y1="15" x2="72" y2="15" stroke="#C9A66B" strokeWidth="0.3" opacity="0.3" />
      <line x1="85" y1="6" x2="115" y2="6" stroke="#A88C50" strokeWidth="0.3" opacity="0.4" />
      <line x1="88" y1="14" x2="112" y2="14" stroke="#A88C50" strokeWidth="0.3" opacity="0.3" />
      {/* Plank separators */}
      <line x1="40" y1="0" x2="40" y2="20" stroke="#8B7355" strokeWidth="0.5" opacity="0.3" />
      <line x1="80" y1="0" x2="80" y2="20" stroke="#8B7355" strokeWidth="0.5" opacity="0.3" />
    </pattern>
  ),

  'wood-walnut': (
    <pattern id="floor-wood-walnut" width="120" height="20" patternUnits="userSpaceOnUse">
      <rect width="120" height="20" fill="#5D4037" />
      <rect x="0" y="0" width="40" height="20" fill="#5D4037" />
      <rect x="40" y="0" width="40" height="20" fill="#6D5047" />
      <rect x="80" y="0" width="40" height="20" fill="#4D3027" />
      {/* Grain lines */}
      <line x1="5" y1="6" x2="35" y2="6" stroke="#4A3530" strokeWidth="0.3" opacity="0.5" />
      <line x1="8" y1="13" x2="32" y2="13" stroke="#4A3530" strokeWidth="0.3" opacity="0.4" />
      <line x1="45" y1="7" x2="75" y2="7" stroke="#5D4540" strokeWidth="0.3" opacity="0.5" />
      <line x1="85" y1="5" x2="115" y2="5" stroke="#3D2520" strokeWidth="0.3" opacity="0.5" />
      <line x1="88" y1="15" x2="112" y2="15" stroke="#3D2520" strokeWidth="0.3" opacity="0.4" />
      {/* Plank separators */}
      <line x1="40" y1="0" x2="40" y2="20" stroke="#3A2520" strokeWidth="0.5" opacity="0.4" />
      <line x1="80" y1="0" x2="80" y2="20" stroke="#3A2520" strokeWidth="0.5" opacity="0.4" />
    </pattern>
  ),

  'wood-cherry': (
    <pattern id="floor-wood-cherry" width="120" height="20" patternUnits="userSpaceOnUse">
      <rect width="120" height="20" fill="#8B4513" />
      <rect x="0" y="0" width="40" height="20" fill="#8B4513" />
      <rect x="40" y="0" width="40" height="20" fill="#9B5523" />
      <rect x="80" y="0" width="40" height="20" fill="#7B3503" />
      {/* Grain lines */}
      <line x1="5" y1="5" x2="35" y2="5" stroke="#6B3010" strokeWidth="0.3" opacity="0.4" />
      <line x1="8" y1="12" x2="32" y2="12" stroke="#6B3010" strokeWidth="0.3" opacity="0.3" />
      <line x1="45" y1="8" x2="75" y2="8" stroke="#7B4020" strokeWidth="0.3" opacity="0.4" />
      <line x1="85" y1="6" x2="115" y2="6" stroke="#5B2500" strokeWidth="0.3" opacity="0.4" />
      {/* Plank separators */}
      <line x1="40" y1="0" x2="40" y2="20" stroke="#5A2505" strokeWidth="0.5" opacity="0.4" />
      <line x1="80" y1="0" x2="80" y2="20" stroke="#5A2505" strokeWidth="0.5" opacity="0.4" />
    </pattern>
  ),

  'wood-ash': (
    <pattern id="floor-wood-ash" width="120" height="20" patternUnits="userSpaceOnUse">
      <rect width="120" height="20" fill="#E8DCC8" />
      <rect x="0" y="0" width="40" height="20" fill="#E8DCC8" />
      <rect x="40" y="0" width="40" height="20" fill="#F0E8D8" />
      <rect x="80" y="0" width="40" height="20" fill="#DFD0B8" />
      {/* Subtle grain lines */}
      <line x1="5" y1="5" x2="35" y2="5" stroke="#D0C0A8" strokeWidth="0.3" opacity="0.5" />
      <line x1="8" y1="12" x2="32" y2="12" stroke="#D0C0A8" strokeWidth="0.3" opacity="0.4" />
      <line x1="45" y1="8" x2="75" y2="8" stroke="#E0D5C0" strokeWidth="0.3" opacity="0.5" />
      <line x1="85" y1="6" x2="115" y2="6" stroke="#C8B8A0" strokeWidth="0.3" opacity="0.5" />
      {/* Plank separators */}
      <line x1="40" y1="0" x2="40" y2="20" stroke="#C0B0A0" strokeWidth="0.5" opacity="0.3" />
      <line x1="80" y1="0" x2="80" y2="20" stroke="#C0B0A0" strokeWidth="0.5" opacity="0.3" />
    </pattern>
  ),

  'wood-mahogany': (
    <pattern id="floor-wood-mahogany" width="120" height="20" patternUnits="userSpaceOnUse">
      <rect width="120" height="20" fill="#4A2020" />
      <rect x="0" y="0" width="40" height="20" fill="#4A2020" />
      <rect x="40" y="0" width="40" height="20" fill="#5A3030" />
      <rect x="80" y="0" width="40" height="20" fill="#3A1515" />
      {/* Grain lines */}
      <line x1="5" y1="5" x2="35" y2="5" stroke="#351515" strokeWidth="0.3" opacity="0.5" />
      <line x1="8" y1="12" x2="32" y2="12" stroke="#351515" strokeWidth="0.3" opacity="0.4" />
      <line x1="45" y1="8" x2="75" y2="8" stroke="#452525" strokeWidth="0.3" opacity="0.5" />
      <line x1="85" y1="6" x2="115" y2="6" stroke="#2A1010" strokeWidth="0.3" opacity="0.5" />
      {/* Plank separators */}
      <line x1="40" y1="0" x2="40" y2="20" stroke="#2A1010" strokeWidth="0.5" opacity="0.5" />
      <line x1="80" y1="0" x2="80" y2="20" stroke="#2A1010" strokeWidth="0.5" opacity="0.5" />
    </pattern>
  ),

  'wood-herringbone': (
    <pattern id="floor-wood-herringbone" width="40" height="40" patternUnits="userSpaceOnUse">
      <rect width="40" height="40" fill="#B8956E" />
      {/* Left-leaning planks */}
      <polygon points="0,0 10,0 10,20 0,20" fill="#C4A07A" />
      <polygon points="10,0 20,0 20,20 10,20" fill="#B8956E" />
      {/* Right-leaning planks */}
      <polygon points="20,0 30,0 30,20 20,20" fill="#AC895E" />
      <polygon points="30,0 40,0 40,20 30,20" fill="#C4A07A" />
      {/* Second row offset */}
      <polygon points="0,20 10,20 10,40 0,40" fill="#AC895E" />
      <polygon points="10,20 20,20 20,40 10,40" fill="#C4A07A" />
      <polygon points="20,20 30,20 30,40 20,40" fill="#B8956E" />
      <polygon points="30,20 40,20 40,40 30,40" fill="#AC895E" />
      {/* Diagonal lines for herringbone effect */}
      <line x1="0" y1="20" x2="20" y2="0" stroke="#9A7A55" strokeWidth="0.5" opacity="0.3" />
      <line x1="20" y1="20" x2="40" y2="0" stroke="#9A7A55" strokeWidth="0.5" opacity="0.3" />
      <line x1="0" y1="40" x2="20" y2="20" stroke="#9A7A55" strokeWidth="0.5" opacity="0.3" />
      <line x1="20" y1="40" x2="40" y2="20" stroke="#9A7A55" strokeWidth="0.5" opacity="0.3" />
    </pattern>
  ),

  // ========== CARPET FLOORS ==========
  'carpet-beige': (
    <pattern id="floor-carpet-beige" width="8" height="8" patternUnits="userSpaceOnUse">
      <rect width="8" height="8" fill="#D9C8B0" />
      {/* Carpet texture dots */}
      <circle cx="1" cy="1" r="0.6" fill="#E5D6C0" opacity="0.5" />
      <circle cx="5" cy="1" r="0.5" fill="#CDB8A0" opacity="0.4" />
      <circle cx="3" cy="3" r="0.7" fill="#E0CEB8" opacity="0.4" />
      <circle cx="7" cy="3" r="0.5" fill="#CDB8A0" opacity="0.5" />
      <circle cx="1" cy="5" r="0.5" fill="#CDB8A0" opacity="0.4" />
      <circle cx="5" cy="5" r="0.6" fill="#E5D6C0" opacity="0.5" />
      <circle cx="3" cy="7" r="0.5" fill="#CDB8A0" opacity="0.4" />
      <circle cx="7" cy="7" r="0.6" fill="#E0CEB8" opacity="0.5" />
    </pattern>
  ),

  'carpet-gray': (
    <pattern id="floor-carpet-gray" width="8" height="8" patternUnits="userSpaceOnUse">
      <rect width="8" height="8" fill="#9E9E9E" />
      <circle cx="1" cy="1" r="0.6" fill="#AEAEAE" opacity="0.5" />
      <circle cx="5" cy="1" r="0.5" fill="#8E8E8E" opacity="0.4" />
      <circle cx="3" cy="3" r="0.7" fill="#A8A8A8" opacity="0.4" />
      <circle cx="7" cy="3" r="0.5" fill="#8E8E8E" opacity="0.5" />
      <circle cx="1" cy="5" r="0.5" fill="#8E8E8E" opacity="0.4" />
      <circle cx="5" cy="5" r="0.6" fill="#AEAEAE" opacity="0.5" />
      <circle cx="3" cy="7" r="0.5" fill="#8E8E8E" opacity="0.4" />
      <circle cx="7" cy="7" r="0.6" fill="#A8A8A8" opacity="0.5" />
    </pattern>
  ),

  'carpet-charcoal': (
    <pattern id="floor-carpet-charcoal" width="8" height="8" patternUnits="userSpaceOnUse">
      <rect width="8" height="8" fill="#4A4A4A" />
      <circle cx="1" cy="1" r="0.6" fill="#5A5A5A" opacity="0.5" />
      <circle cx="5" cy="1" r="0.5" fill="#3A3A3A" opacity="0.4" />
      <circle cx="3" cy="3" r="0.7" fill="#555555" opacity="0.4" />
      <circle cx="7" cy="3" r="0.5" fill="#3A3A3A" opacity="0.5" />
      <circle cx="1" cy="5" r="0.5" fill="#3A3A3A" opacity="0.4" />
      <circle cx="5" cy="5" r="0.6" fill="#5A5A5A" opacity="0.5" />
      <circle cx="3" cy="7" r="0.5" fill="#3A3A3A" opacity="0.4" />
      <circle cx="7" cy="7" r="0.6" fill="#555555" opacity="0.5" />
    </pattern>
  ),

  'carpet-navy': (
    <pattern id="floor-carpet-navy" width="8" height="8" patternUnits="userSpaceOnUse">
      <rect width="8" height="8" fill="#2C3E50" />
      <circle cx="1" cy="1" r="0.6" fill="#3C4E60" opacity="0.5" />
      <circle cx="5" cy="1" r="0.5" fill="#1C2E40" opacity="0.4" />
      <circle cx="3" cy="3" r="0.7" fill="#364858" opacity="0.4" />
      <circle cx="7" cy="3" r="0.5" fill="#1C2E40" opacity="0.5" />
      <circle cx="1" cy="5" r="0.5" fill="#1C2E40" opacity="0.4" />
      <circle cx="5" cy="5" r="0.6" fill="#3C4E60" opacity="0.5" />
      <circle cx="3" cy="7" r="0.5" fill="#1C2E40" opacity="0.4" />
      <circle cx="7" cy="7" r="0.6" fill="#364858" opacity="0.5" />
    </pattern>
  ),

  'carpet-burgundy': (
    <pattern id="floor-carpet-burgundy" width="8" height="8" patternUnits="userSpaceOnUse">
      <rect width="8" height="8" fill="#722F37" />
      <circle cx="1" cy="1" r="0.6" fill="#823F47" opacity="0.5" />
      <circle cx="5" cy="1" r="0.5" fill="#621F27" opacity="0.4" />
      <circle cx="3" cy="3" r="0.7" fill="#7A3740" opacity="0.4" />
      <circle cx="7" cy="3" r="0.5" fill="#621F27" opacity="0.5" />
      <circle cx="1" cy="5" r="0.5" fill="#621F27" opacity="0.4" />
      <circle cx="5" cy="5" r="0.6" fill="#823F47" opacity="0.5" />
      <circle cx="3" cy="7" r="0.5" fill="#621F27" opacity="0.4" />
      <circle cx="7" cy="7" r="0.6" fill="#7A3740" opacity="0.5" />
    </pattern>
  ),

  // ========== HARD FLOORS ==========
  'tile-white': (
    <pattern id="floor-tile-white" width="50" height="50" patternUnits="userSpaceOnUse">
      <rect width="50" height="50" fill="#F5F5F5" />
      <rect x="1" y="1" width="48" height="48" fill="#FAFAFA" />
      {/* Grout lines */}
      <line x1="0" y1="0" x2="50" y2="0" stroke="#E0E0E0" strokeWidth="2" />
      <line x1="0" y1="0" x2="0" y2="50" stroke="#E0E0E0" strokeWidth="2" />
      {/* Subtle shine */}
      <rect x="5" y="5" width="15" height="10" fill="#FFFFFF" opacity="0.3" />
    </pattern>
  ),

  'tile-gray': (
    <pattern id="floor-tile-gray" width="50" height="50" patternUnits="userSpaceOnUse">
      <rect width="50" height="50" fill="#B0B0B0" />
      <rect x="1" y="1" width="48" height="48" fill="#B8B8B8" />
      {/* Grout lines */}
      <line x1="0" y1="0" x2="50" y2="0" stroke="#909090" strokeWidth="2" />
      <line x1="0" y1="0" x2="0" y2="50" stroke="#909090" strokeWidth="2" />
      {/* Subtle texture */}
      <rect x="5" y="5" width="12" height="8" fill="#C0C0C0" opacity="0.3" />
      <rect x="30" y="25" width="10" height="12" fill="#A0A0A0" opacity="0.2" />
    </pattern>
  ),

  'tile-terracotta': (
    <pattern id="floor-tile-terracotta" width="50" height="50" patternUnits="userSpaceOnUse">
      <rect width="50" height="50" fill="#C45A35" />
      <rect x="1" y="1" width="48" height="48" fill="#CA6040" />
      {/* Grout lines */}
      <line x1="0" y1="0" x2="50" y2="0" stroke="#8A3A20" strokeWidth="2" />
      <line x1="0" y1="0" x2="0" y2="50" stroke="#8A3A20" strokeWidth="2" />
      {/* Terracotta texture variation */}
      <rect x="8" y="8" width="15" height="10" fill="#D06A45" opacity="0.4" />
      <rect x="28" y="30" width="12" height="14" fill="#B04A30" opacity="0.3" />
      <circle cx="40" cy="12" r="3" fill="#D87050" opacity="0.2" />
    </pattern>
  ),

  'marble-white': (
    <pattern id="floor-marble-white" width="100" height="100" patternUnits="userSpaceOnUse">
      <rect width="100" height="100" fill="#F0EDE8" />
      {/* Marble veining */}
      <path d="M 0 20 Q 25 15, 50 25 T 100 20" stroke="#D8D0C8" strokeWidth="0.8" fill="none" opacity="0.5" />
      <path d="M 0 50 Q 30 45, 60 55 T 100 50" stroke="#E0D8D0" strokeWidth="0.6" fill="none" opacity="0.4" />
      <path d="M 0 80 Q 20 75, 40 85 T 100 80" stroke="#D0C8C0" strokeWidth="0.7" fill="none" opacity="0.5" />
      <path d="M 20 0 Q 25 30, 15 60 T 25 100" stroke="#D8D0C8" strokeWidth="0.5" fill="none" opacity="0.3" />
      <path d="M 70 0 Q 65 25, 75 50 T 65 100" stroke="#E0D8D0" strokeWidth="0.6" fill="none" opacity="0.4" />
      {/* Subtle shimmer */}
      <rect x="10" y="10" width="20" height="15" fill="#FFFFFF" opacity="0.15" />
      <rect x="60" y="50" width="25" height="20" fill="#FFFFFF" opacity="0.1" />
    </pattern>
  ),

  'marble-black': (
    <pattern id="floor-marble-black" width="100" height="100" patternUnits="userSpaceOnUse">
      <rect width="100" height="100" fill="#2A2A2A" />
      {/* Gold/white veining typical of black marble */}
      <path d="M 0 20 Q 25 15, 50 25 T 100 20" stroke="#C9A961" strokeWidth="0.6" fill="none" opacity="0.4" />
      <path d="M 0 50 Q 30 45, 60 55 T 100 50" stroke="#4A4A4A" strokeWidth="0.8" fill="none" opacity="0.5" />
      <path d="M 0 80 Q 20 75, 40 85 T 100 80" stroke="#C9A961" strokeWidth="0.5" fill="none" opacity="0.3" />
      <path d="M 20 0 Q 25 30, 15 60 T 25 100" stroke="#3A3A3A" strokeWidth="0.6" fill="none" opacity="0.4" />
      <path d="M 70 0 Q 65 25, 75 50 T 65 100" stroke="#C9A961" strokeWidth="0.4" fill="none" opacity="0.3" />
      {/* Subtle shimmer */}
      <rect x="10" y="10" width="20" height="15" fill="#3A3A3A" opacity="0.3" />
      <rect x="60" y="50" width="25" height="20" fill="#3A3A3A" opacity="0.2" />
    </pattern>
  ),

  slate: (
    <pattern id="floor-slate" width="60" height="40" patternUnits="userSpaceOnUse">
      <rect width="60" height="40" fill="#4A5568" />
      {/* Irregular slate pieces */}
      <rect x="0" y="0" width="28" height="18" fill="#525E70" />
      <rect x="30" y="0" width="30" height="18" fill="#424E60" />
      <rect x="0" y="20" width="35" height="20" fill="#3A4658" />
      <rect x="37" y="20" width="23" height="20" fill="#505C6E" />
      {/* Grout lines */}
      <line x1="29" y1="0" x2="29" y2="19" stroke="#2D3748" strokeWidth="1.5" />
      <line x1="0" y1="19" x2="60" y2="19" stroke="#2D3748" strokeWidth="1.5" />
      <line x1="36" y1="20" x2="36" y2="40" stroke="#2D3748" strokeWidth="1.5" />
      {/* Natural texture */}
      <line x1="5" y1="8" x2="22" y2="10" stroke="#5A6678" strokeWidth="0.4" opacity="0.4" />
      <line x1="35" y1="6" x2="55" y2="8" stroke="#3A4658" strokeWidth="0.4" opacity="0.4" />
    </pattern>
  ),

  concrete: (
    <pattern id="floor-concrete" width="80" height="80" patternUnits="userSpaceOnUse">
      <rect width="80" height="80" fill="#9CA3AF" />
      {/* Concrete texture - random spots and variations */}
      <circle cx="10" cy="15" r="1" fill="#8A9199" opacity="0.5" />
      <circle cx="25" cy="8" r="0.8" fill="#B0B7BF" opacity="0.4" />
      <circle cx="45" cy="20" r="1.2" fill="#8A9199" opacity="0.4" />
      <circle cx="65" cy="12" r="0.9" fill="#B0B7BF" opacity="0.5" />
      <circle cx="15" cy="40" r="1.1" fill="#8A9199" opacity="0.4" />
      <circle cx="35" cy="35" r="0.7" fill="#B0B7BF" opacity="0.5" />
      <circle cx="55" cy="45" r="1" fill="#8A9199" opacity="0.5" />
      <circle cx="72" cy="38" r="0.8" fill="#B0B7BF" opacity="0.4" />
      <circle cx="8" cy="65" r="0.9" fill="#8A9199" opacity="0.5" />
      <circle cx="30" cy="60" r="1.1" fill="#B0B7BF" opacity="0.4" />
      <circle cx="50" cy="70" r="0.8" fill="#8A9199" opacity="0.4" />
      <circle cx="70" cy="62" r="1" fill="#B0B7BF" opacity="0.5" />
      {/* Larger aggregate spots */}
      <ellipse cx="20" cy="25" rx="2" ry="1.5" fill="#8A9199" opacity="0.3" />
      <ellipse cx="60" cy="55" rx="1.8" ry="1.2" fill="#B0B7BF" opacity="0.25" />
      <ellipse cx="40" cy="75" rx="1.5" ry="2" fill="#8A9199" opacity="0.3" />
    </pattern>
  ),

  'vinyl-light': (
    <pattern id="floor-vinyl-light" width="100" height="18" patternUnits="userSpaceOnUse">
      <rect width="100" height="18" fill="#E5D9C9" />
      {/* Vinyl plank look */}
      <rect x="0" y="0" width="33" height="18" fill="#E5D9C9" />
      <rect x="33" y="0" width="34" height="18" fill="#EADECE" />
      <rect x="67" y="0" width="33" height="18" fill="#E0D4C4" />
      {/* Plank separators */}
      <line x1="33" y1="0" x2="33" y2="18" stroke="#C8BCA8" strokeWidth="0.5" opacity="0.4" />
      <line x1="67" y1="0" x2="67" y2="18" stroke="#C8BCA8" strokeWidth="0.5" opacity="0.4" />
      {/* Subtle wood-like lines */}
      <line x1="5" y1="6" x2="28" y2="6" stroke="#D8CCBC" strokeWidth="0.3" opacity="0.4" />
      <line x1="8" y1="12" x2="25" y2="12" stroke="#D8CCBC" strokeWidth="0.3" opacity="0.3" />
      <line x1="38" y1="8" x2="62" y2="8" stroke="#DFD3C3" strokeWidth="0.3" opacity="0.4" />
      <line x1="72" y1="5" x2="95" y2="5" stroke="#D5C9B9" strokeWidth="0.3" opacity="0.4" />
      <line x1="75" y1="13" x2="92" y2="13" stroke="#D5C9B9" strokeWidth="0.3" opacity="0.3" />
    </pattern>
  ),
};

export const getFloorPattern = (id: string): React.ReactNode | undefined => {
  return FLOOR_PATTERNS[id];
};

/**
 * Generate pattern for custom floor materials.
 */
export const generateCustomFloorPattern = (
  id: string,
  color: string,
  patternType: 'solid' | 'stripes' | 'checker' | 'dots'
): React.ReactNode => {
  const patternId = `floor-${id}`;

  const lighten = (hex: string, amount: number): string => {
    const num = parseInt(hex.slice(1), 16);
    const r = Math.min(255, ((num >> 16) & 0xff) + amount);
    const g = Math.min(255, ((num >> 8) & 0xff) + amount);
    const b = Math.min(255, (num & 0xff) + amount);
    return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
  };

  const darken = (hex: string, amount: number): string => {
    const num = parseInt(hex.slice(1), 16);
    const r = Math.max(0, ((num >> 16) & 0xff) - amount);
    const g = Math.max(0, ((num >> 8) & 0xff) - amount);
    const b = Math.max(0, (num & 0xff) - amount);
    return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
  };

  switch (patternType) {
    case 'stripes':
      return (
        <pattern id={patternId} width="20" height="20" patternUnits="userSpaceOnUse">
          <rect width="20" height="20" fill={color} />
          <rect x="0" y="0" width="10" height="20" fill={lighten(color, 20)} />
        </pattern>
      );

    case 'checker':
      return (
        <pattern id={patternId} width="40" height="40" patternUnits="userSpaceOnUse">
          <rect width="40" height="40" fill={color} />
          <rect x="0" y="0" width="20" height="20" fill={lighten(color, 25)} />
          <rect x="20" y="20" width="20" height="20" fill={lighten(color, 25)} />
        </pattern>
      );

    case 'dots':
      return (
        <pattern id={patternId} width="20" height="20" patternUnits="userSpaceOnUse">
          <rect width="20" height="20" fill={color} />
          <circle cx="10" cy="10" r="3" fill={darken(color, 30)} opacity="0.5" />
        </pattern>
      );

    case 'solid':
    default:
      return (
        <pattern id={patternId} width="10" height="10" patternUnits="userSpaceOnUse">
          <rect width="10" height="10" fill={color} />
        </pattern>
      );
  }
};
