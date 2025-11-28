/**
 * Colored SVG icons for furniture items
 * These are inline SVG components with realistic material colors
 */

export const FurnitureIcons: Record<string, React.FC<{ className?: string; style?: React.CSSProperties }>> = {
  // ========== BEDROOM ==========
  'bed-single': ({ className, style }) => (
    <svg viewBox="0 0 100 100" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      {/* Frame - oak wood */}
      <rect x="0" y="0" width="100" height="100" fill="#C8A882" stroke="#A88B6A" strokeWidth="1" />
      {/* Headboard - darker oak */}
      <rect x="0" y="0" width="100" height="18" fill="#A88B6A" />
      {/* Mattress - beige fabric */}
      <rect x="5" y="15" width="90" height="80" fill="#E8D5C4" stroke="#D4C2B1" strokeWidth="1" />
      {/* Pillow */}
      <rect x="15" y="20" width="70" height="25" fill="#FFFFFF" stroke="#E8E8E8" strokeWidth="1" rx="3" />
    </svg>
  ),

  'bed-double': ({ className, style }) => (
    <svg viewBox="0 0 100 100" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      {/* Frame - oak wood */}
      <rect x="0" y="0" width="100" height="100" fill="#C8A882" stroke="#A88B6A" strokeWidth="1" />
      {/* Headboard - darker oak */}
      <rect x="0" y="0" width="100" height="18" fill="#A88B6A" />
      {/* Mattress - beige fabric */}
      <rect x="3" y="15" width="94" height="80" fill="#E8D5C4" stroke="#D4C2B1" strokeWidth="1" />
      {/* Center line to show double */}
      <line x1="50" y1="15" x2="50" y2="95" stroke="#D4C2B1" strokeWidth="1" opacity="0.5" />
      {/* Pillows (two side by side) */}
      <rect x="10" y="20" width="35" height="20" fill="#FFFFFF" stroke="#E8E8E8" strokeWidth="1" rx="2" />
      <rect x="55" y="20" width="35" height="20" fill="#FFFFFF" stroke="#E8E8E8" strokeWidth="1" rx="2" />
    </svg>
  ),

  'bed-queen': ({ className, style }) => (
    <svg viewBox="0 0 100 100" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      {/* Frame - oak wood */}
      <rect x="0" y="0" width="100" height="100" fill="#C8A882" stroke="#A88B6A" strokeWidth="1" />
      {/* Headboard - darker oak */}
      <rect x="0" y="0" width="100" height="16" fill="#A88B6A" />
      {/* Mattress - beige fabric */}
      <rect x="3" y="14" width="94" height="83" fill="#E8D5C4" stroke="#D4C2B1" strokeWidth="1" />
      {/* Pillows (two side by side) */}
      <rect x="10" y="18" width="35" height="20" fill="#FFFFFF" stroke="#E8E8E8" strokeWidth="1" rx="2" />
      <rect x="55" y="18" width="35" height="20" fill="#FFFFFF" stroke="#E8E8E8" strokeWidth="1" rx="2" />
    </svg>
  ),

  'bed-king': ({ className, style }) => (
    <svg viewBox="0 0 100 100" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      {/* Frame - oak wood */}
      <rect x="0" y="0" width="100" height="100" fill="#C8A882" stroke="#A88B6A" strokeWidth="1" />
      {/* Headboard - darker oak */}
      <rect x="0" y="0" width="100" height="16" fill="#A88B6A" />
      {/* Mattress - beige fabric */}
      <rect x="2" y="14" width="96" height="83" fill="#E8D5C4" stroke="#D4C2B1" strokeWidth="1" />
      {/* Pillows (two side by side) */}
      <rect x="8" y="18" width="38" height="20" fill="#FFFFFF" stroke="#E8E8E8" strokeWidth="1" rx="2" />
      <rect x="54" y="18" width="38" height="20" fill="#FFFFFF" stroke="#E8E8E8" strokeWidth="1" rx="2" />
    </svg>
  ),

  'nightstand': ({ className, style }) => (
    <svg viewBox="0 0 100 100" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      {/* Body - walnut wood */}
      <rect x="0" y="0" width="100" height="100" fill="#5C4033" stroke="#4A3329" strokeWidth="1" />
      {/* Drawer handle */}
      <rect x="25" y="42" width="50" height="16" fill="#8B6F5C" rx="3" />
    </svg>
  ),

  'dresser': ({ className, style }) => (
    <svg viewBox="0 0 100 100" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      {/* Body - walnut wood */}
      <rect x="0" y="0" width="100" height="100" fill="#5C4033" stroke="#4A3329" strokeWidth="1" />
      {/* Drawer handles */}
      <rect x="12" y="25" width="30" height="10" fill="#8B6F5C" rx="2" />
      <rect x="58" y="25" width="30" height="10" fill="#8B6F5C" rx="2" />
      <rect x="12" y="55" width="30" height="10" fill="#8B6F5C" rx="2" />
      <rect x="58" y="55" width="30" height="10" fill="#8B6F5C" rx="2" />
    </svg>
  ),

  'wardrobe': ({ className, style }) => (
    <svg viewBox="0 0 100 100" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      {/* Body - pine wood */}
      <rect x="0" y="0" width="100" height="100" fill="#E3C08C" stroke="#D4B07F" strokeWidth="1" />
      {/* Center divider */}
      <line x1="50" y1="0" x2="50" y2="100" stroke="#D4B07F" strokeWidth="2" />
      {/* Door handles */}
      <rect x="38" y="42" width="8" height="16" fill="#B89968" rx="2" />
      <rect x="54" y="42" width="8" height="16" fill="#B89968" rx="2" />
    </svg>
  ),

  'bed-super-king': ({ className, style }) => (
    <svg viewBox="0 0 100 100" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="100" height="100" fill="#C8A882" stroke="#A88B6A" strokeWidth="1" />
      <rect x="0" y="0" width="100" height="14" fill="#A88B6A" />
      <rect x="2" y="12" width="96" height="85" fill="#E8D5C4" stroke="#D4C2B1" strokeWidth="1" />
      <rect x="6" y="16" width="40" height="18" fill="#FFFFFF" stroke="#E8E8E8" strokeWidth="1" rx="2" />
      <rect x="54" y="16" width="40" height="18" fill="#FFFFFF" stroke="#E8E8E8" strokeWidth="1" rx="2" />
    </svg>
  ),

  'bed-bunk': ({ className, style }) => (
    <svg viewBox="0 0 100 100" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="100" height="100" fill="#C8A882" stroke="#A88B6A" strokeWidth="1" />
      <rect x="5" y="5" width="90" height="40" fill="#E8D5C4" stroke="#D4C2B1" strokeWidth="1" />
      <rect x="5" y="55" width="90" height="40" fill="#E8D5C4" stroke="#D4C2B1" strokeWidth="1" />
      <rect x="15" y="10" width="30" height="12" fill="#FFFFFF" stroke="#E8E8E8" strokeWidth="1" rx="2" />
      <rect x="15" y="60" width="30" height="12" fill="#FFFFFF" stroke="#E8E8E8" strokeWidth="1" rx="2" />
    </svg>
  ),

  'crib': ({ className, style }) => (
    <svg viewBox="0 0 100 100" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="100" height="100" fill="#F5F0E8" stroke="#E0D8D0" strokeWidth="2" />
      <rect x="8" y="20" width="84" height="60" fill="#FFFAF5" stroke="#E8E0D8" strokeWidth="1" />
      {/* Rails */}
      <line x1="20" y1="0" x2="20" y2="100" stroke="#E0D8D0" strokeWidth="3" />
      <line x1="40" y1="0" x2="40" y2="100" stroke="#E0D8D0" strokeWidth="3" />
      <line x1="60" y1="0" x2="60" y2="100" stroke="#E0D8D0" strokeWidth="3" />
      <line x1="80" y1="0" x2="80" y2="100" stroke="#E0D8D0" strokeWidth="3" />
    </svg>
  ),

  'vanity': ({ className, style }) => (
    <svg viewBox="0 0 100 100" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="100" height="100" fill="#F5F0E8" stroke="#E0D8D0" strokeWidth="1" />
      {/* Mirror */}
      <ellipse cx="50" cy="25" rx="30" ry="20" fill="#B8D4E8" stroke="#A0C0D8" strokeWidth="1" />
      {/* Drawers */}
      <rect x="10" y="55" width="35" height="15" fill="#E8E0D8" stroke="#D0C8C0" strokeWidth="1" />
      <rect x="55" y="55" width="35" height="15" fill="#E8E0D8" stroke="#D0C8C0" strokeWidth="1" />
      <rect x="10" y="75" width="35" height="15" fill="#E8E0D8" stroke="#D0C8C0" strokeWidth="1" />
      <rect x="55" y="75" width="35" height="15" fill="#E8E0D8" stroke="#D0C8C0" strokeWidth="1" />
    </svg>
  ),

  'chest-of-drawers': ({ className, style }) => (
    <svg viewBox="0 0 100 100" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="100" height="100" fill="#5C4033" stroke="#4A3329" strokeWidth="1" />
      <rect x="8" y="8" width="84" height="20" fill="#6C5043" stroke="#5C4033" strokeWidth="1" />
      <rect x="8" y="32" width="84" height="20" fill="#6C5043" stroke="#5C4033" strokeWidth="1" />
      <rect x="8" y="56" width="84" height="20" fill="#6C5043" stroke="#5C4033" strokeWidth="1" />
      <rect x="8" y="80" width="84" height="16" fill="#6C5043" stroke="#5C4033" strokeWidth="1" />
      <rect x="42" y="14" width="16" height="8" fill="#8B6F5C" rx="2" />
      <rect x="42" y="38" width="16" height="8" fill="#8B6F5C" rx="2" />
      <rect x="42" y="62" width="16" height="8" fill="#8B6F5C" rx="2" />
      <rect x="42" y="84" width="16" height="8" fill="#8B6F5C" rx="2" />
    </svg>
  ),

  'wardrobe-double': ({ className, style }) => (
    <svg viewBox="0 0 100 100" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="100" height="100" fill="#E3C08C" stroke="#D4B07F" strokeWidth="1" />
      <line x1="25" y1="0" x2="25" y2="100" stroke="#D4B07F" strokeWidth="2" />
      <line x1="50" y1="0" x2="50" y2="100" stroke="#D4B07F" strokeWidth="2" />
      <line x1="75" y1="0" x2="75" y2="100" stroke="#D4B07F" strokeWidth="2" />
      <rect x="10" y="42" width="6" height="16" fill="#B89968" rx="2" />
      <rect x="32" y="42" width="6" height="16" fill="#B89968" rx="2" />
      <rect x="62" y="42" width="6" height="16" fill="#B89968" rx="2" />
      <rect x="84" y="42" width="6" height="16" fill="#B89968" rx="2" />
    </svg>
  ),

  'ottoman-bedroom': ({ className, style }) => (
    <svg viewBox="0 0 100 100" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="100" height="100" fill="#C8B8A8" stroke="#B0A090" strokeWidth="1" rx="5" />
      <rect x="5" y="5" width="90" height="90" fill="#D8C8B8" stroke="#C8B8A8" strokeWidth="1" rx="3" />
      {/* Tufting */}
      <circle cx="25" cy="50" r="3" fill="#B0A090" />
      <circle cx="50" cy="50" r="3" fill="#B0A090" />
      <circle cx="75" cy="50" r="3" fill="#B0A090" />
    </svg>
  ),

  'changing-table': ({ className, style }) => (
    <svg viewBox="0 0 100 100" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="100" height="100" fill="#F5F0E8" stroke="#E0D8D0" strokeWidth="1" />
      {/* Changing pad */}
      <rect x="5" y="5" width="90" height="45" fill="#A8D8B8" stroke="#90C0A0" strokeWidth="1" rx="3" />
      {/* Shelves */}
      <rect x="5" y="55" width="90" height="20" fill="#E8E0D8" stroke="#D0C8C0" strokeWidth="1" />
      <rect x="5" y="78" width="90" height="18" fill="#E8E0D8" stroke="#D0C8C0" strokeWidth="1" />
    </svg>
  ),

  // ========== LIVING ROOM ==========
  'sofa-2seat': ({ className, style }) => (
    <svg viewBox="0 0 100 100" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      {/* Base - medium gray */}
      <rect x="0" y="0" width="100" height="100" fill="#8B8B8B" stroke="#6E6E6E" strokeWidth="1" />
      {/* Backrest - darker gray */}
      <rect x="0" y="0" width="100" height="25" fill="#707070" stroke="#6E6E6E" strokeWidth="1" />
      {/* Left armrest */}
      <rect x="0" y="20" width="12" height="80" fill="#6E6E6E" />
      {/* Right armrest */}
      <rect x="88" y="20" width="12" height="80" fill="#6E6E6E" />
      {/* Two seat cushions */}
      <rect x="16" y="30" width="30" height="60" fill="#9D9D9D" stroke="#8B8B8B" strokeWidth="1" rx="3" />
      <rect x="54" y="30" width="30" height="60" fill="#9D9D9D" stroke="#8B8B8B" strokeWidth="1" rx="3" />
      {/* Two back cushions */}
      <rect x="18" y="5" width="26" height="22" fill="#A0A0A0" stroke="#8B8B8B" strokeWidth="1" rx="2" />
      <rect x="56" y="5" width="26" height="22" fill="#A0A0A0" stroke="#8B8B8B" strokeWidth="1" rx="2" />
    </svg>
  ),

  'sofa-3seat': ({ className, style }) => (
    <svg viewBox="0 0 100 100" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      {/* Base - medium gray */}
      <rect x="0" y="0" width="100" height="100" fill="#8B8B8B" stroke="#6E6E6E" strokeWidth="1" />
      {/* Backrest - darker gray */}
      <rect x="0" y="0" width="100" height="25" fill="#707070" stroke="#6E6E6E" strokeWidth="1" />
      {/* Left armrest */}
      <rect x="0" y="20" width="10" height="80" fill="#6E6E6E" />
      {/* Right armrest */}
      <rect x="90" y="20" width="10" height="80" fill="#6E6E6E" />
      {/* Three seat cushions */}
      <rect x="13" y="30" width="22" height="60" fill="#9D9D9D" stroke="#8B8B8B" strokeWidth="1" rx="3" />
      <rect x="39" y="30" width="22" height="60" fill="#9D9D9D" stroke="#8B8B8B" strokeWidth="1" rx="3" />
      <rect x="65" y="30" width="22" height="60" fill="#9D9D9D" stroke="#8B8B8B" strokeWidth="1" rx="3" />
      {/* Three back cushions */}
      <rect x="14" y="5" width="20" height="22" fill="#A0A0A0" stroke="#8B8B8B" strokeWidth="1" rx="2" />
      <rect x="40" y="5" width="20" height="22" fill="#A0A0A0" stroke="#8B8B8B" strokeWidth="1" rx="2" />
      <rect x="66" y="5" width="20" height="22" fill="#A0A0A0" stroke="#8B8B8B" strokeWidth="1" rx="2" />
    </svg>
  ),

  'sofa-lshaped': ({ className, style }) => (
    <svg viewBox="0 0 100 100" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      {/* Main horizontal section (bottom) - charcoal gray */}
      <rect x="0" y="55" width="100" height="45" fill="#4A4A4A" stroke="#3A3A3A" strokeWidth="1" />
      {/* Vertical section (left) */}
      <rect x="0" y="0" width="45" height="100" fill="#4A4A4A" stroke="#3A3A3A" strokeWidth="1" />
      {/* Backrest - horizontal section */}
      <rect x="0" y="55" width="100" height="18" fill="#3A3A3A" />
      {/* Backrest - vertical section */}
      <rect x="0" y="0" width="18" height="100" fill="#3A3A3A" />
      {/* Seat cushions - horizontal section */}
      <rect x="22" y="75" width="24" height="20" fill="#5A5A5A" stroke="#4A4A4A" strokeWidth="1" rx="2" />
      <rect x="52" y="75" width="24" height="20" fill="#5A5A5A" stroke="#4A4A4A" strokeWidth="1" rx="2" />
      <rect x="78" y="75" width="18" height="20" fill="#5A5A5A" stroke="#4A4A4A" strokeWidth="1" rx="2" />
      {/* Seat cushions - vertical section */}
      <rect x="22" y="8" width="20" height="24" fill="#5A5A5A" stroke="#4A4A4A" strokeWidth="1" rx="2" />
      <rect x="22" y="35" width="20" height="24" fill="#5A5A5A" stroke="#4A4A4A" strokeWidth="1" rx="2" />
    </svg>
  ),

  'armchair': ({ className, style }) => (
    <svg viewBox="0 0 100 100" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      {/* Base - blue fabric */}
      <rect x="0" y="0" width="100" height="100" fill="#4A6FA5" stroke="#3D5A87" strokeWidth="1" />
      {/* Backrest - darker blue */}
      <rect x="0" y="0" width="100" height="30" fill="#3D5A87" stroke="#2C4A6A" strokeWidth="1" />
      {/* Left armrest - thick */}
      <rect x="0" y="25" width="18" height="75" fill="#3D5A87" />
      {/* Right armrest - thick */}
      <rect x="82" y="25" width="18" height="75" fill="#3D5A87" />
      {/* Single large seat cushion */}
      <rect x="22" y="35" width="56" height="60" fill="#5A7FB5" stroke="#4A6FA5" strokeWidth="1" rx="4" />
      {/* Single back cushion */}
      <rect x="25" y="8" width="50" height="28" fill="#7A9BC8" stroke="#5A7FB5" strokeWidth="1" rx="3" />
    </svg>
  ),

  'coffee-table': ({ className, style }) => (
    <svg viewBox="0 0 100 100" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      {/* Tabletop - walnut wood */}
      <rect x="0" y="0" width="100" height="100" fill="#5C4033" stroke="#4A3329" strokeWidth="1" />
      {/* Legs - darker walnut */}
      <circle cx="13" cy="13" r="4" fill="#3A2319" />
      <circle cx="87" cy="13" r="4" fill="#3A2319" />
      <circle cx="13" cy="87" r="4" fill="#3A2319" />
      <circle cx="87" cy="87" r="4" fill="#3A2319" />
    </svg>
  ),

  'tv-stand': ({ className, style }) => (
    <svg viewBox="0 0 100 100" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      {/* Body - black metal */}
      <rect x="0" y="0" width="100" height="100" fill="#2C2C2C" stroke="#1C1C1C" strokeWidth="1" />
      {/* Cabinet doors */}
      <rect x="8" y="25" width="35" height="50" fill="#3C3C3C" stroke="#2C2C2C" strokeWidth="1" />
      <rect x="57" y="25" width="35" height="50" fill="#3C3C3C" stroke="#2C2C2C" strokeWidth="1" />
    </svg>
  ),

  'bookshelf': ({ className, style }) => (
    <svg viewBox="0 0 100 100" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      {/* Frame - oak wood */}
      <rect x="0" y="0" width="100" height="100" fill="#D4A574" stroke="#B8936A" strokeWidth="1" />
      {/* Shelves */}
      <line x1="0" y1="20" x2="100" y2="20" stroke="#B8936A" strokeWidth="2" />
      <line x1="0" y1="40" x2="100" y2="40" stroke="#B8936A" strokeWidth="2" />
      <line x1="0" y1="60" x2="100" y2="60" stroke="#B8936A" strokeWidth="2" />
      <line x1="0" y1="80" x2="100" y2="80" stroke="#B8936A" strokeWidth="2" />
    </svg>
  ),

  'recliner': ({ className, style }) => (
    <svg viewBox="0 0 100 100" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="100" height="100" fill="#6B5344" stroke="#5A4234" strokeWidth="1" />
      <rect x="0" y="0" width="100" height="30" fill="#5A4234" />
      <rect x="0" y="25" width="15" height="75" fill="#5A4234" />
      <rect x="85" y="25" width="15" height="75" fill="#5A4234" />
      <rect x="18" y="35" width="64" height="60" fill="#7B6454" stroke="#6B5344" strokeWidth="1" rx="3" />
      <rect x="22" y="8" width="56" height="28" fill="#8B7464" stroke="#6B5344" strokeWidth="1" rx="3" />
    </svg>
  ),

  'ottoman': ({ className, style }) => (
    <svg viewBox="0 0 100 100" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="100" height="100" fill="#8B8B8B" stroke="#6E6E6E" strokeWidth="1" rx="8" />
      <rect x="5" y="5" width="90" height="90" fill="#9D9D9D" stroke="#8B8B8B" strokeWidth="1" rx="6" />
      <circle cx="30" cy="50" r="4" fill="#6E6E6E" />
      <circle cx="50" cy="50" r="4" fill="#6E6E6E" />
      <circle cx="70" cy="50" r="4" fill="#6E6E6E" />
    </svg>
  ),

  'side-table': ({ className, style }) => (
    <svg viewBox="0 0 100 100" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="100" height="100" fill="#5C4033" stroke="#4A3329" strokeWidth="1" rx="4" />
      <circle cx="20" cy="20" r="6" fill="#3A2319" />
      <circle cx="80" cy="20" r="6" fill="#3A2319" />
      <circle cx="20" cy="80" r="6" fill="#3A2319" />
      <circle cx="80" cy="80" r="6" fill="#3A2319" />
    </svg>
  ),

  'console-table': ({ className, style }) => (
    <svg viewBox="0 0 100 100" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="100" height="100" fill="#5C4033" stroke="#4A3329" strokeWidth="1" />
      <rect x="5" y="40" width="90" height="20" fill="#4A3329" stroke="#3A2319" strokeWidth="1" />
      <circle cx="15" cy="15" r="5" fill="#3A2319" />
      <circle cx="85" cy="15" r="5" fill="#3A2319" />
      <circle cx="15" cy="85" r="5" fill="#3A2319" />
      <circle cx="85" cy="85" r="5" fill="#3A2319" />
    </svg>
  ),

  'entertainment-center': ({ className, style }) => (
    <svg viewBox="0 0 100 100" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="100" height="100" fill="#2C2C2C" stroke="#1C1C1C" strokeWidth="1" />
      <rect x="5" y="5" width="40" height="45" fill="#3C3C3C" stroke="#2C2C2C" strokeWidth="1" />
      <rect x="55" y="5" width="40" height="45" fill="#3C3C3C" stroke="#2C2C2C" strokeWidth="1" />
      <rect x="5" y="55" width="90" height="40" fill="#3C3C3C" stroke="#2C2C2C" strokeWidth="1" />
    </svg>
  ),

  'chaise-lounge': ({ className, style }) => (
    <svg viewBox="0 0 100 100" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="100" height="100" fill="#C85A6A" stroke="#B84A5A" strokeWidth="1" />
      <rect x="0" y="0" width="100" height="25" fill="#B84A5A" />
      <rect x="0" y="20" width="20" height="80" fill="#B84A5A" />
      <rect x="25" y="30" width="70" height="65" fill="#D86A7A" stroke="#C85A6A" strokeWidth="1" rx="3" />
    </svg>
  ),

  'bean-bag': ({ className, style }) => (
    <svg viewBox="0 0 100 100" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="50" cy="55" rx="45" ry="40" fill="#E87A5A" stroke="#D86A4A" strokeWidth="1" />
      <ellipse cx="50" cy="35" rx="35" ry="25" fill="#F88A6A" stroke="#E87A5A" strokeWidth="1" />
    </svg>
  ),

  'floor-lamp': ({ className, style }) => (
    <svg viewBox="0 0 100 100" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      <circle cx="50" cy="90" r="15" fill="#3C3C3C" stroke="#2C2C2C" strokeWidth="1" />
      <rect x="47" y="30" width="6" height="60" fill="#4C4C4C" />
      <ellipse cx="50" cy="20" rx="25" ry="18" fill="#F5E6C8" stroke="#E5D6B8" strokeWidth="1" />
      <ellipse cx="50" cy="22" rx="20" ry="12" fill="#FFFAE8" />
    </svg>
  ),

  'plant-large': ({ className, style }) => (
    <svg viewBox="0 0 100 100" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      <rect x="25" y="60" width="50" height="38" fill="#8B5A2B" stroke="#6B4A1B" strokeWidth="1" rx="3" />
      <ellipse cx="50" cy="40" rx="35" ry="35" fill="#228B22" stroke="#1A6B1A" strokeWidth="1" />
      <ellipse cx="35" cy="35" rx="15" ry="20" fill="#2A9B2A" />
      <ellipse cx="65" cy="35" rx="15" ry="20" fill="#2A9B2A" />
      <ellipse cx="50" cy="25" rx="12" ry="18" fill="#32AB32" />
    </svg>
  ),

  'fireplace': ({ className, style }) => (
    <svg viewBox="0 0 100 100" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="100" height="100" fill="#4A4A4A" stroke="#3A3A3A" strokeWidth="1" />
      <rect x="10" y="25" width="80" height="70" fill="#2C2C2C" stroke="#1C1C1C" strokeWidth="1" />
      <rect x="20" y="40" width="60" height="50" fill="#1C1C1C" />
      {/* Fire */}
      <ellipse cx="50" cy="75" rx="20" ry="15" fill="#FF6B35" />
      <ellipse cx="45" cy="70" rx="10" ry="12" fill="#FF8C42" />
      <ellipse cx="55" cy="72" rx="8" ry="10" fill="#FFD166" />
    </svg>
  ),

  'storage-cabinet': ({ className, style }) => (
    <svg viewBox="0 0 100 100" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="100" height="100" fill="#F5F0E8" stroke="#E0D8D0" strokeWidth="1" />
      <rect x="5" y="5" width="42" height="90" fill="#E8E0D8" stroke="#D0C8C0" strokeWidth="1" />
      <rect x="53" y="5" width="42" height="90" fill="#E8E0D8" stroke="#D0C8C0" strokeWidth="1" />
      <rect x="40" y="45" width="6" height="10" fill="#C0B0A0" rx="2" />
      <rect x="54" y="45" width="6" height="10" fill="#C0B0A0" rx="2" />
    </svg>
  ),

  'room-divider': ({ className, style }) => (
    <svg viewBox="0 0 100 100" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="32" height="100" fill="#D4A574" stroke="#B8936A" strokeWidth="1" />
      <rect x="34" y="0" width="32" height="100" fill="#E4B584" stroke="#C8A37A" strokeWidth="1" />
      <rect x="68" y="0" width="32" height="100" fill="#D4A574" stroke="#B8936A" strokeWidth="1" />
    </svg>
  ),

  // ========== OFFICE ==========
  'desk-standard': ({ className, style }) => (
    <svg viewBox="0 0 100 100" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      {/* Desktop - walnut wood */}
      <rect x="0" y="0" width="100" height="100" fill="#5C4033" stroke="#4A3329" strokeWidth="1" />
      {/* Legs/drawers - darker walnut */}
      <rect x="8" y="20" width="25" height="60" fill="#4A3329" stroke="#3A2319" strokeWidth="1" />
      <rect x="67" y="20" width="25" height="60" fill="#4A3329" stroke="#3A2319" strokeWidth="1" />
    </svg>
  ),

  'desk-lshaped': ({ className, style }) => (
    <svg viewBox="0 0 100 100" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      {/* Horizontal section - mahogany wood */}
      <rect x="0" y="0" width="70" height="40" fill="#C04000" stroke="#A03500" strokeWidth="1" />
      {/* Vertical section */}
      <rect x="50" y="0" width="50" height="100" fill="#C04000" stroke="#A03500" strokeWidth="1" />
      {/* Support/drawers */}
      <rect x="7" y="10" width="18" height="24" fill="#A03500" stroke="#903000" strokeWidth="1" />
      <rect x="63" y="68" width="18" height="24" fill="#A03500" stroke="#903000" strokeWidth="1" />
    </svg>
  ),

  'desk-gaming': ({ className, style }) => (
    <svg viewBox="0 0 100 100" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      {/* Desktop - black metal/laminate */}
      <rect x="0" y="0" width="100" height="100" fill="#2C2C2C" stroke="#1C1C1C" strokeWidth="1" />
      {/* Legs */}
      <rect x="8" y="18" width="22" height="64" fill="#3C3C3C" stroke="#2C2C2C" strokeWidth="1" />
      <rect x="70" y="18" width="22" height="64" fill="#3C3C3C" stroke="#2C2C2C" strokeWidth="1" />
      {/* Cable management cutout */}
      <rect x="36" y="8" width="28" height="14" fill="#1C1C1C" rx="3" />
    </svg>
  ),

  'chair-office': ({ className, style }) => (
    <svg viewBox="0 0 100 100" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      {/* Backrest - navy fabric */}
      <rect x="20" y="0" width="60" height="40" fill="#2C3E50" stroke="#1F2D3D" strokeWidth="1" rx="8" />
      {/* Seat cushion - lighter navy */}
      <ellipse cx="50" cy="48" rx="35" ry="25" fill="#3D5A7E" stroke="#2C3E50" strokeWidth="1" />
      {/* Post - black metal */}
      <rect x="43" y="70" width="14" height="18" fill="#2C2C2C" />
      {/* Base star - black metal */}
      <circle cx="50" cy="90" r="2" fill="#3C3C3C" />
      <line x1="50" y1="88" x2="50" y2="78" stroke="#3C3C3C" strokeWidth="3" />
      <line x1="50" y1="88" x2="30" y2="95" stroke="#3C3C3C" strokeWidth="3" />
      <line x1="50" y1="88" x2="70" y2="95" stroke="#3C3C3C" strokeWidth="3" />
      <line x1="50" y1="88" x2="35" y2="82" stroke="#3C3C3C" strokeWidth="3" />
      <line x1="50" y1="88" x2="65" y2="82" stroke="#3C3C3C" strokeWidth="3" />
      {/* Wheels */}
      <circle cx="30" cy="96" r="4" fill="#1C1C1C" />
      <circle cx="70" cy="96" r="4" fill="#1C1C1C" />
      <circle cx="35" cy="81" r="3" fill="#1C1C1C" />
      <circle cx="65" cy="81" r="3" fill="#1C1C1C" />
      <circle cx="50" cy="76" r="3" fill="#1C1C1C" />
    </svg>
  ),

  'bookshelf-office': ({ className, style }) => (
    <svg viewBox="0 0 100 100" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      {/* Frame - oak wood */}
      <rect x="0" y="0" width="100" height="100" fill="#D4A574" stroke="#B8936A" strokeWidth="1" />
      {/* Shelves */}
      <line x1="0" y1="20" x2="100" y2="20" stroke="#B8936A" strokeWidth="2" />
      <line x1="0" y1="40" x2="100" y2="40" stroke="#B8936A" strokeWidth="2" />
      <line x1="0" y1="60" x2="100" y2="60" stroke="#B8936A" strokeWidth="2" />
      <line x1="0" y1="80" x2="100" y2="80" stroke="#B8936A" strokeWidth="2" />
    </svg>
  ),

  'desk-standing': ({ className, style }) => (
    <svg viewBox="0 0 100 100" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="100" height="100" fill="#2C2C2C" stroke="#1C1C1C" strokeWidth="1" />
      <rect x="5" y="15" width="90" height="70" fill="#3C3C3C" stroke="#2C2C2C" strokeWidth="1" />
      <rect x="10" y="5" width="35" height="10" fill="#4C4C4C" />
      <rect x="55" y="5" width="35" height="10" fill="#4C4C4C" />
    </svg>
  ),

  'filing-cabinet': ({ className, style }) => (
    <svg viewBox="0 0 100 100" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="100" height="100" fill="#6E6E6E" stroke="#5E5E5E" strokeWidth="1" />
      <rect x="5" y="5" width="90" height="28" fill="#7E7E7E" stroke="#6E6E6E" strokeWidth="1" />
      <rect x="5" y="36" width="90" height="28" fill="#7E7E7E" stroke="#6E6E6E" strokeWidth="1" />
      <rect x="5" y="67" width="90" height="28" fill="#7E7E7E" stroke="#6E6E6E" strokeWidth="1" />
      <rect x="40" y="15" width="20" height="6" fill="#4E4E4E" rx="2" />
      <rect x="40" y="46" width="20" height="6" fill="#4E4E4E" rx="2" />
      <rect x="40" y="77" width="20" height="6" fill="#4E4E4E" rx="2" />
    </svg>
  ),

  'printer-stand': ({ className, style }) => (
    <svg viewBox="0 0 100 100" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="100" height="100" fill="#5C4033" stroke="#4A3329" strokeWidth="1" />
      <rect x="10" y="10" width="80" height="35" fill="#2C2C2C" stroke="#1C1C1C" strokeWidth="1" />
      <rect x="15" y="15" width="70" height="10" fill="#4C4C4C" />
      <rect x="5" y="55" width="90" height="40" fill="#4A3329" stroke="#3A2319" strokeWidth="1" />
    </svg>
  ),

  'meeting-table': ({ className, style }) => (
    <svg viewBox="0 0 100 100" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="100" height="100" fill="#5C4033" stroke="#4A3329" strokeWidth="1" rx="8" />
      <circle cx="15" cy="15" r="5" fill="#3A2319" />
      <circle cx="85" cy="15" r="5" fill="#3A2319" />
      <circle cx="15" cy="85" r="5" fill="#3A2319" />
      <circle cx="85" cy="85" r="5" fill="#3A2319" />
      <circle cx="50" cy="15" r="5" fill="#3A2319" />
      <circle cx="50" cy="85" r="5" fill="#3A2319" />
    </svg>
  ),

  'conference-chair': ({ className, style }) => (
    <svg viewBox="0 0 100 100" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      <rect x="15" y="0" width="70" height="45" fill="#1A1A1A" stroke="#0A0A0A" strokeWidth="1" rx="6" />
      <ellipse cx="50" cy="52" rx="38" ry="22" fill="#2A2A2A" stroke="#1A1A1A" strokeWidth="1" />
      <rect x="43" y="72" width="14" height="15" fill="#3A3A3A" />
      <line x1="50" y1="87" x2="25" y2="97" stroke="#3A3A3A" strokeWidth="4" />
      <line x1="50" y1="87" x2="75" y2="97" stroke="#3A3A3A" strokeWidth="4" />
      <circle cx="25" cy="97" r="4" fill="#2A2A2A" />
      <circle cx="75" cy="97" r="4" fill="#2A2A2A" />
    </svg>
  ),

  'credenza': ({ className, style }) => (
    <svg viewBox="0 0 100 100" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="100" height="100" fill="#5C4033" stroke="#4A3329" strokeWidth="1" />
      <rect x="5" y="5" width="28" height="90" fill="#6C5043" stroke="#5C4033" strokeWidth="1" />
      <rect x="36" y="5" width="28" height="90" fill="#6C5043" stroke="#5C4033" strokeWidth="1" />
      <rect x="67" y="5" width="28" height="90" fill="#6C5043" stroke="#5C4033" strokeWidth="1" />
      <rect x="15" y="45" width="8" height="10" fill="#8B6F5C" rx="2" />
      <rect x="46" y="45" width="8" height="10" fill="#8B6F5C" rx="2" />
      <rect x="77" y="45" width="8" height="10" fill="#8B6F5C" rx="2" />
    </svg>
  ),

  'whiteboard': ({ className, style }) => (
    <svg viewBox="0 0 100 100" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="100" height="100" fill="#E8E8E8" stroke="#C8C8C8" strokeWidth="2" />
      <rect x="5" y="5" width="90" height="90" fill="#FFFFFF" stroke="#D8D8D8" strokeWidth="1" />
      <rect x="0" y="90" width="100" height="10" fill="#A0A0A0" />
    </svg>
  ),

  'server-rack': ({ className, style }) => (
    <svg viewBox="0 0 100 100" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="100" height="100" fill="#1A1A1A" stroke="#0A0A0A" strokeWidth="1" />
      <rect x="5" y="5" width="90" height="18" fill="#2A2A2A" stroke="#1A1A1A" strokeWidth="1" />
      <rect x="5" y="26" width="90" height="18" fill="#2A2A2A" stroke="#1A1A1A" strokeWidth="1" />
      <rect x="5" y="47" width="90" height="18" fill="#2A2A2A" stroke="#1A1A1A" strokeWidth="1" />
      <rect x="5" y="68" width="90" height="18" fill="#2A2A2A" stroke="#1A1A1A" strokeWidth="1" />
      <circle cx="15" cy="14" r="3" fill="#00FF00" />
      <circle cx="15" cy="35" r="3" fill="#00FF00" />
      <circle cx="15" cy="56" r="3" fill="#FFAA00" />
      <circle cx="15" cy="77" r="3" fill="#00FF00" />
    </svg>
  ),

  // ========== DINING ==========
  'dining-table-4': ({ className, style }) => (
    <svg viewBox="0 0 100 100" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      {/* Tabletop - mahogany wood */}
      <rect x="0" y="0" width="100" height="100" fill="#C04000" stroke="#A03500" strokeWidth="1" rx="6" />
      {/* Legs - darker mahogany */}
      <circle cx="14" cy="14" r="5" fill="#903000" />
      <circle cx="86" cy="14" r="5" fill="#903000" />
      <circle cx="14" cy="86" r="5" fill="#903000" />
      <circle cx="86" cy="86" r="5" fill="#903000" />
    </svg>
  ),

  'dining-table-6': ({ className, style }) => (
    <svg viewBox="0 0 100 100" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      {/* Tabletop - mahogany wood */}
      <rect x="0" y="0" width="100" height="100" fill="#C04000" stroke="#A03500" strokeWidth="1" rx="6" />
      {/* Legs - darker mahogany (6 legs for 6-seater) */}
      <circle cx="10" cy="14" r="5" fill="#903000" />
      <circle cx="50" cy="14" r="5" fill="#903000" />
      <circle cx="90" cy="14" r="5" fill="#903000" />
      <circle cx="10" cy="86" r="5" fill="#903000" />
      <circle cx="50" cy="86" r="5" fill="#903000" />
      <circle cx="90" cy="86" r="5" fill="#903000" />
    </svg>
  ),

  'chair-dining': ({ className, style }) => (
    <svg viewBox="0 0 100 100" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      {/* Backrest - darker oak with spindles */}
      <rect x="8" y="0" width="84" height="50" fill="#B8936A" stroke="#A88B6A" strokeWidth="1" rx="6" />
      {/* Vertical spindles */}
      <rect x="30" y="8" width="5" height="36" fill="#A88B6A" rx="2" />
      <rect x="47" y="8" width="5" height="36" fill="#A88B6A" rx="2" />
      <rect x="64" y="8" width="5" height="36" fill="#A88B6A" rx="2" />
      {/* Seat - lighter oak */}
      <rect x="0" y="45" width="100" height="55" fill="#D4A574" stroke="#B8936A" strokeWidth="1" rx="5" />
      {/* Seat cushion detail */}
      <rect x="8" y="52" width="84" height="40" fill="#E8D5C4" stroke="#D4A574" strokeWidth="1" rx="4" />
    </svg>
  ),

  'dining-table-8': ({ className, style }) => (
    <svg viewBox="0 0 100 100" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="100" height="100" fill="#C04000" stroke="#A03500" strokeWidth="1" rx="6" />
      <circle cx="10" cy="14" r="4" fill="#903000" />
      <circle cx="35" cy="14" r="4" fill="#903000" />
      <circle cx="65" cy="14" r="4" fill="#903000" />
      <circle cx="90" cy="14" r="4" fill="#903000" />
      <circle cx="10" cy="86" r="4" fill="#903000" />
      <circle cx="35" cy="86" r="4" fill="#903000" />
      <circle cx="65" cy="86" r="4" fill="#903000" />
      <circle cx="90" cy="86" r="4" fill="#903000" />
    </svg>
  ),

  'dining-table-round': ({ className, style }) => (
    <svg viewBox="0 0 100 100" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      <circle cx="50" cy="50" r="48" fill="#C04000" stroke="#A03500" strokeWidth="1" />
      <circle cx="50" cy="50" r="15" fill="#903000" />
    </svg>
  ),

  'bar-table': ({ className, style }) => (
    <svg viewBox="0 0 100 100" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="100" height="100" fill="#2C2C2C" stroke="#1C1C1C" strokeWidth="1" />
      <rect x="35" y="20" width="30" height="60" fill="#3C3C3C" stroke="#2C2C2C" strokeWidth="1" />
      <circle cx="50" cy="90" r="25" fill="#3C3C3C" stroke="#2C2C2C" strokeWidth="1" />
    </svg>
  ),

  'bar-stool': ({ className, style }) => (
    <svg viewBox="0 0 100 100" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      <circle cx="50" cy="25" r="25" fill="#2C2C2C" stroke="#1C1C1C" strokeWidth="1" />
      <rect x="45" y="45" width="10" height="35" fill="#3C3C3C" />
      <circle cx="50" cy="90" r="20" fill="#3C3C3C" stroke="#2C2C2C" strokeWidth="1" />
    </svg>
  ),

  'sideboard': ({ className, style }) => (
    <svg viewBox="0 0 100 100" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="100" height="100" fill="#5C4033" stroke="#4A3329" strokeWidth="1" />
      <rect x="5" y="5" width="42" height="90" fill="#6C5043" stroke="#5C4033" strokeWidth="1" />
      <rect x="53" y="5" width="42" height="90" fill="#6C5043" stroke="#5C4033" strokeWidth="1" />
      <rect x="20" y="45" width="12" height="10" fill="#8B6F5C" rx="2" />
      <rect x="68" y="45" width="12" height="10" fill="#8B6F5C" rx="2" />
    </svg>
  ),

  'dining-bench': ({ className, style }) => (
    <svg viewBox="0 0 100 100" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="100" height="100" fill="#D4A574" stroke="#B8936A" strokeWidth="1" rx="3" />
      <rect x="5" y="5" width="90" height="90" fill="#E8D5C4" stroke="#D4A574" strokeWidth="1" rx="2" />
      <circle cx="15" cy="15" r="4" fill="#B8936A" />
      <circle cx="85" cy="15" r="4" fill="#B8936A" />
      <circle cx="15" cy="85" r="4" fill="#B8936A" />
      <circle cx="85" cy="85" r="4" fill="#B8936A" />
    </svg>
  ),

  'china-cabinet': ({ className, style }) => (
    <svg viewBox="0 0 100 100" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="100" height="100" fill="#5C4033" stroke="#4A3329" strokeWidth="1" />
      <rect x="5" y="5" width="90" height="45" fill="#A8C8D8" stroke="#98B8C8" strokeWidth="1" />
      <line x1="5" y1="20" x2="95" y2="20" stroke="#98B8C8" strokeWidth="1" />
      <line x1="5" y1="35" x2="95" y2="35" stroke="#98B8C8" strokeWidth="1" />
      <rect x="5" y="55" width="90" height="40" fill="#6C5043" stroke="#5C4033" strokeWidth="1" />
      <rect x="42" y="70" width="16" height="10" fill="#8B6F5C" rx="2" />
    </svg>
  ),

  'kitchen-island': ({ className, style }) => (
    <svg viewBox="0 0 100 100" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="100" height="100" fill="#E8E0D8" stroke="#D0C8C0" strokeWidth="1" />
      <rect x="5" y="5" width="90" height="15" fill="#6E6E6E" stroke="#5E5E5E" strokeWidth="1" />
      <rect x="5" y="25" width="42" height="70" fill="#D8D0C8" stroke="#C8C0B8" strokeWidth="1" />
      <rect x="53" y="25" width="42" height="70" fill="#D8D0C8" stroke="#C8C0B8" strokeWidth="1" />
      <rect x="20" y="55" width="12" height="8" fill="#A0A0A0" rx="2" />
      <rect x="68" y="55" width="12" height="8" fill="#A0A0A0" rx="2" />
    </svg>
  ),

  'breakfast-bar': ({ className, style }) => (
    <svg viewBox="0 0 100 100" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="100" height="100" fill="#5C4033" stroke="#4A3329" strokeWidth="1" />
      <rect x="5" y="15" width="90" height="70" fill="#4A3329" stroke="#3A2319" strokeWidth="1" />
      <rect x="10" y="5" width="25" height="10" fill="#6C5043" />
      <rect x="65" y="5" width="25" height="10" fill="#6C5043" />
    </svg>
  ),

  // ========== RUGS ==========
  'rug-small-round': ({ className, style }) => (
    <svg viewBox="0 0 100 100" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      {/* Outer border - beige */}
      <circle cx="50" cy="50" r="48" fill="#D9C8B0" />
      {/* Inner pattern - lighter beige */}
      <circle cx="50" cy="50" r="40" fill="#E5D6C0" />
      {/* Center medallion */}
      <circle cx="50" cy="50" r="25" fill="#CDB8A0" />
      {/* Decorative lines */}
      <circle cx="50" cy="50" r="20" fill="none" stroke="#B8A890" strokeWidth="1" />
      <circle cx="50" cy="50" r="15" fill="none" stroke="#B8A890" strokeWidth="0.5" />
    </svg>
  ),

  'rug-medium-round': ({ className, style }) => (
    <svg viewBox="0 0 100 100" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      {/* Outer border - terracotta */}
      <circle cx="50" cy="50" r="48" fill="#C85A3C" />
      {/* Inner pattern - cream */}
      <circle cx="50" cy="50" r="40" fill="#F4E8D8" />
      {/* Center medallion */}
      <circle cx="50" cy="50" r="25" fill="#A84832" />
      {/* Decorative pattern */}
      <circle cx="50" cy="50" r="20" fill="none" stroke="#8B3A26" strokeWidth="1" />
      <circle cx="50" cy="50" r="30" fill="none" stroke="#A84832" strokeWidth="0.5" />
    </svg>
  ),

  'rug-small-rect': ({ className, style }) => (
    <svg viewBox="0 0 100 100" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      {/* Base - gray blue */}
      <rect x="0" y="0" width="100" height="100" fill="#6B8CA8" rx="2" />
      {/* Border pattern */}
      <rect x="5" y="5" width="90" height="90" fill="#7B9CB8" stroke="#5B7C98" strokeWidth="1" />
      {/* Inner rectangle */}
      <rect x="15" y="15" width="70" height="70" fill="#8BACBE" />
      {/* Decorative lines */}
      <line x1="10" y1="10" x2="90" y2="10" stroke="#5B7C98" strokeWidth="0.5" />
      <line x1="10" y1="90" x2="90" y2="90" stroke="#5B7C98" strokeWidth="0.5" />
      <line x1="10" y1="10" x2="10" y2="90" stroke="#5B7C98" strokeWidth="0.5" />
      <line x1="90" y1="10" x2="90" y2="90" stroke="#5B7C98" strokeWidth="0.5" />
    </svg>
  ),

  'rug-medium-rect': ({ className, style }) => (
    <svg viewBox="0 0 100 100" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      {/* Base - burgundy */}
      <rect x="0" y="0" width="100" height="100" fill="#8B3A3A" rx="2" />
      {/* Border - gold/cream */}
      <rect x="4" y="4" width="92" height="92" fill="#D4A574" stroke="#C09050" strokeWidth="1" />
      {/* Inner field - darker red */}
      <rect x="12" y="12" width="76" height="76" fill="#A84848" />
      {/* Center medallion */}
      <ellipse cx="50" cy="50" rx="20" ry="15" fill="#D4A574" />
      {/* Decorative corners */}
      <circle cx="20" cy="20" r="3" fill="#D4A574" />
      <circle cx="80" cy="20" r="3" fill="#D4A574" />
      <circle cx="20" cy="80" r="3" fill="#D4A574" />
      <circle cx="80" cy="80" r="3" fill="#D4A574" />
    </svg>
  ),

  'rug-large-rect': ({ className, style }) => (
    <svg viewBox="0 0 100 100" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      {/* Base - navy blue */}
      <rect x="0" y="0" width="100" height="100" fill="#2C3E50" rx="2" />
      {/* Border - lighter blue */}
      <rect x="3" y="3" width="94" height="94" fill="#4A6FA5" stroke="#3D5A87" strokeWidth="1" />
      {/* Inner field - medium blue */}
      <rect x="10" y="10" width="80" height="80" fill="#5A7FB5" />
      {/* Geometric pattern */}
      <rect x="30" y="30" width="40" height="40" fill="#3D5A87" opacity="0.5" />
      <rect x="35" y="35" width="30" height="30" fill="#7A9BC8" opacity="0.5" />
      {/* Border details */}
      <rect x="8" y="8" width="84" height="84" fill="none" stroke="#7A9BC8" strokeWidth="0.5" />
    </svg>
  ),

  'rug-runner': ({ className, style }) => (
    <svg viewBox="0 0 100 100" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      {/* Base - warm brown */}
      <rect x="0" y="0" width="100" height="100" fill="#8B7355" rx="1" />
      {/* Striped pattern */}
      <rect x="0" y="0" width="100" height="20" fill="#9A8266" />
      <rect x="0" y="25" width="100" height="20" fill="#9A8266" />
      <rect x="0" y="50" width="100" height="20" fill="#9A8266" />
      <rect x="0" y="75" width="100" height="20" fill="#9A8266" />
      {/* Border */}
      <rect x="2" y="2" width="96" height="96" fill="none" stroke="#7A6345" strokeWidth="1" />
      {/* Fringe effect (small lines at edges) */}
      <line x1="0" y1="3" x2="0" y2="8" stroke="#6A5335" strokeWidth="1" />
      <line x1="0" y1="12" x2="0" y2="17" stroke="#6A5335" strokeWidth="1" />
      <line x1="0" y1="92" x2="0" y2="97" stroke="#6A5335" strokeWidth="1" />
      <line x1="0" y1="83" x2="0" y2="88" stroke="#6A5335" strokeWidth="1" />
    </svg>
  ),

  // ========== BATHROOM ==========
  'bathtub': ({ className, style }) => (
    <svg viewBox="0 0 100 100" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="100" height="100" fill="#FFFFFF" stroke="#E0E0E0" strokeWidth="2" rx="10" />
      <rect x="5" y="15" width="90" height="70" fill="#E8F4F8" stroke="#D0E8F0" strokeWidth="1" rx="8" />
      <ellipse cx="85" cy="25" rx="8" ry="8" fill="#C0C0C0" />
    </svg>
  ),

  'shower-enclosure': ({ className, style }) => (
    <svg viewBox="0 0 100 100" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="100" height="100" fill="#E8F4F8" stroke="#A0C0D0" strokeWidth="2" />
      <rect x="0" y="0" width="50" height="100" fill="#B8D8E8" stroke="#A0C0D0" strokeWidth="1" />
      <circle cx="75" cy="20" r="12" fill="#C0C0C0" stroke="#A0A0A0" strokeWidth="1" />
    </svg>
  ),

  'shower-walk-in': ({ className, style }) => (
    <svg viewBox="0 0 100 100" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="100" height="100" fill="#E0E0E0" stroke="#C0C0C0" strokeWidth="2" />
      <rect x="5" y="5" width="90" height="90" fill="#E8F4F8" stroke="#D0E8F0" strokeWidth="1" />
      <circle cx="80" cy="20" r="10" fill="#C0C0C0" />
      <rect x="75" y="25" width="3" height="40" fill="#A0A0A0" />
    </svg>
  ),

  'toilet': ({ className, style }) => (
    <svg viewBox="0 0 100 100" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      <rect x="20" y="0" width="60" height="40" fill="#FFFFFF" stroke="#E0E0E0" strokeWidth="2" rx="5" />
      <ellipse cx="50" cy="70" rx="35" ry="28" fill="#FFFFFF" stroke="#E0E0E0" strokeWidth="2" />
      <ellipse cx="50" cy="70" rx="25" ry="18" fill="#E8F4F8" stroke="#D0E8F0" strokeWidth="1" />
    </svg>
  ),

  'sink-bathroom': ({ className, style }) => (
    <svg viewBox="0 0 100 100" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="100" height="100" fill="#F5F0E8" stroke="#E0D8D0" strokeWidth="1" />
      <ellipse cx="50" cy="40" rx="35" ry="25" fill="#FFFFFF" stroke="#E0E0E0" strokeWidth="2" />
      <ellipse cx="50" cy="40" rx="25" ry="15" fill="#E8F4F8" />
      <circle cx="50" cy="45" r="5" fill="#C0C0C0" />
      <rect x="45" y="10" width="10" height="15" fill="#C0C0C0" rx="2" />
    </svg>
  ),

  'double-vanity': ({ className, style }) => (
    <svg viewBox="0 0 100 100" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="100" height="100" fill="#F5F0E8" stroke="#E0D8D0" strokeWidth="1" />
      <ellipse cx="25" cy="35" rx="18" ry="15" fill="#FFFFFF" stroke="#E0E0E0" strokeWidth="1" />
      <ellipse cx="75" cy="35" rx="18" ry="15" fill="#FFFFFF" stroke="#E0E0E0" strokeWidth="1" />
      <rect x="5" y="55" width="40" height="40" fill="#E8E0D8" stroke="#D0C8C0" strokeWidth="1" />
      <rect x="55" y="55" width="40" height="40" fill="#E8E0D8" stroke="#D0C8C0" strokeWidth="1" />
    </svg>
  ),

  // ========== UTILITY / HALLWAY ==========
  'shoe-rack': ({ className, style }) => (
    <svg viewBox="0 0 100 100" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="100" height="100" fill="#D4A574" stroke="#B8936A" strokeWidth="1" />
      <line x1="0" y1="25" x2="100" y2="25" stroke="#B8936A" strokeWidth="2" />
      <line x1="0" y1="50" x2="100" y2="50" stroke="#B8936A" strokeWidth="2" />
      <line x1="0" y1="75" x2="100" y2="75" stroke="#B8936A" strokeWidth="2" />
    </svg>
  ),

  'coat-rack': ({ className, style }) => (
    <svg viewBox="0 0 100 100" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      <circle cx="50" cy="90" r="20" fill="#5C4033" stroke="#4A3329" strokeWidth="1" />
      <rect x="47" y="20" width="6" height="70" fill="#6C5043" />
      <line x1="50" y1="25" x2="20" y2="35" stroke="#6C5043" strokeWidth="4" />
      <line x1="50" y1="25" x2="80" y2="35" stroke="#6C5043" strokeWidth="4" />
      <line x1="50" y1="40" x2="25" y2="50" stroke="#6C5043" strokeWidth="4" />
      <line x1="50" y1="40" x2="75" y2="50" stroke="#6C5043" strokeWidth="4" />
      <circle cx="20" cy="35" r="4" fill="#8B6F5C" />
      <circle cx="80" cy="35" r="4" fill="#8B6F5C" />
      <circle cx="25" cy="50" r="4" fill="#8B6F5C" />
      <circle cx="75" cy="50" r="4" fill="#8B6F5C" />
    </svg>
  ),

  'hallway-console': ({ className, style }) => (
    <svg viewBox="0 0 100 100" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="100" height="100" fill="#5C4033" stroke="#4A3329" strokeWidth="1" />
      <rect x="5" y="40" width="90" height="55" fill="#6C5043" stroke="#5C4033" strokeWidth="1" />
      <rect x="42" y="65" width="16" height="10" fill="#8B6F5C" rx="2" />
    </svg>
  ),

  'umbrella-stand': ({ className, style }) => (
    <svg viewBox="0 0 100 100" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="50" cy="85" rx="30" ry="12" fill="#3C3C3C" stroke="#2C2C2C" strokeWidth="1" />
      <rect x="30" y="20" width="40" height="65" fill="#4C4C4C" stroke="#3C3C3C" strokeWidth="1" rx="5" />
      <ellipse cx="50" cy="20" rx="20" ry="8" fill="#5C5C5C" stroke="#4C4C4C" strokeWidth="1" />
    </svg>
  ),

  'storage-bench': ({ className, style }) => (
    <svg viewBox="0 0 100 100" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="100" height="100" fill="#D4A574" stroke="#B8936A" strokeWidth="1" />
      <rect x="5" y="5" width="90" height="40" fill="#E8D5C4" stroke="#D4A574" strokeWidth="1" rx="3" />
      <rect x="5" y="50" width="90" height="45" fill="#C4A064" stroke="#B8936A" strokeWidth="1" />
    </svg>
  ),

  // ========== APPLIANCES / MISC ==========
  'washing-machine': ({ className, style }) => (
    <svg viewBox="0 0 100 100" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="100" height="100" fill="#FFFFFF" stroke="#E0E0E0" strokeWidth="2" />
      <rect x="5" y="5" width="90" height="20" fill="#E8E8E8" stroke="#D0D0D0" strokeWidth="1" />
      <circle cx="50" cy="60" r="30" fill="#E8F4F8" stroke="#A0C0D0" strokeWidth="2" />
      <circle cx="50" cy="60" r="20" fill="#B8D8E8" />
      <circle cx="20" cy="15" r="5" fill="#4A90D9" />
      <circle cx="80" cy="15" r="5" fill="#C0C0C0" />
    </svg>
  ),

  'dryer': ({ className, style }) => (
    <svg viewBox="0 0 100 100" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="100" height="100" fill="#FFFFFF" stroke="#E0E0E0" strokeWidth="2" />
      <rect x="5" y="5" width="90" height="20" fill="#E8E8E8" stroke="#D0D0D0" strokeWidth="1" />
      <circle cx="50" cy="60" r="30" fill="#2C2C2C" stroke="#1C1C1C" strokeWidth="2" />
      <circle cx="50" cy="60" r="22" fill="#3C3C3C" />
      <circle cx="20" cy="15" r="5" fill="#FF6B35" />
      <circle cx="80" cy="15" r="5" fill="#C0C0C0" />
    </svg>
  ),

  'refrigerator': ({ className, style }) => (
    <svg viewBox="0 0 100 100" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="100" height="100" fill="#E8E8E8" stroke="#C0C0C0" strokeWidth="2" />
      <rect x="5" y="5" width="90" height="35" fill="#D8D8D8" stroke="#C0C0C0" strokeWidth="1" />
      <rect x="5" y="45" width="90" height="50" fill="#D8D8D8" stroke="#C0C0C0" strokeWidth="1" />
      <rect x="80" y="15" width="8" height="15" fill="#A0A0A0" rx="2" />
      <rect x="80" y="60" width="8" height="25" fill="#A0A0A0" rx="2" />
    </svg>
  ),

  'exercise-bike': ({ className, style }) => (
    <svg viewBox="0 0 100 100" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      <circle cx="25" cy="75" r="18" fill="none" stroke="#2C2C2C" strokeWidth="4" />
      <circle cx="75" cy="75" r="18" fill="none" stroke="#2C2C2C" strokeWidth="4" />
      <line x1="25" y1="75" x2="50" y2="45" stroke="#3C3C3C" strokeWidth="4" />
      <line x1="50" y1="45" x2="75" y2="75" stroke="#3C3C3C" strokeWidth="4" />
      <line x1="50" y1="45" x2="50" y2="20" stroke="#3C3C3C" strokeWidth="4" />
      <rect x="40" y="15" width="20" height="10" fill="#FF4444" rx="3" />
      <ellipse cx="50" cy="45" rx="8" ry="5" fill="#4C4C4C" />
    </svg>
  ),

  'treadmill': ({ className, style }) => (
    <svg viewBox="0 0 100 100" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      <rect x="5" y="60" width="90" height="35" fill="#2C2C2C" stroke="#1C1C1C" strokeWidth="1" rx="3" />
      <rect x="10" y="65" width="80" height="25" fill="#4C4C4C" stroke="#3C3C3C" strokeWidth="1" />
      <rect x="70" y="10" width="20" height="50" fill="#3C3C3C" stroke="#2C2C2C" strokeWidth="1" />
      <rect x="75" y="15" width="10" height="20" fill="#1C1C1C" />
      <line x1="5" y1="60" x2="70" y2="30" stroke="#3C3C3C" strokeWidth="3" />
    </svg>
  ),

  'piano-upright': ({ className, style }) => (
    <svg viewBox="0 0 100 100" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="100" height="100" fill="#1A1A1A" stroke="#0A0A0A" strokeWidth="1" />
      <rect x="5" y="60" width="90" height="35" fill="#2A2A2A" stroke="#1A1A1A" strokeWidth="1" />
      {/* Keys */}
      <rect x="10" y="65" width="8" height="25" fill="#FFFFFF" stroke="#E0E0E0" strokeWidth="0.5" />
      <rect x="20" y="65" width="8" height="25" fill="#FFFFFF" stroke="#E0E0E0" strokeWidth="0.5" />
      <rect x="30" y="65" width="8" height="25" fill="#FFFFFF" stroke="#E0E0E0" strokeWidth="0.5" />
      <rect x="40" y="65" width="8" height="25" fill="#FFFFFF" stroke="#E0E0E0" strokeWidth="0.5" />
      <rect x="50" y="65" width="8" height="25" fill="#FFFFFF" stroke="#E0E0E0" strokeWidth="0.5" />
      <rect x="60" y="65" width="8" height="25" fill="#FFFFFF" stroke="#E0E0E0" strokeWidth="0.5" />
      <rect x="70" y="65" width="8" height="25" fill="#FFFFFF" stroke="#E0E0E0" strokeWidth="0.5" />
      <rect x="80" y="65" width="8" height="25" fill="#FFFFFF" stroke="#E0E0E0" strokeWidth="0.5" />
      {/* Black keys */}
      <rect x="15" y="65" width="5" height="15" fill="#0A0A0A" />
      <rect x="25" y="65" width="5" height="15" fill="#0A0A0A" />
      <rect x="45" y="65" width="5" height="15" fill="#0A0A0A" />
      <rect x="55" y="65" width="5" height="15" fill="#0A0A0A" />
      <rect x="65" y="65" width="5" height="15" fill="#0A0A0A" />
    </svg>
  ),

  'piano-grand': ({ className, style }) => (
    <svg viewBox="0 0 100 100" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="50" cy="50" rx="48" ry="45" fill="#1A1A1A" stroke="#0A0A0A" strokeWidth="1" />
      <rect x="10" y="70" width="80" height="20" fill="#2A2A2A" stroke="#1A1A1A" strokeWidth="1" />
      {/* Keys */}
      <rect x="15" y="73" width="6" height="14" fill="#FFFFFF" stroke="#E0E0E0" strokeWidth="0.5" />
      <rect x="23" y="73" width="6" height="14" fill="#FFFFFF" stroke="#E0E0E0" strokeWidth="0.5" />
      <rect x="31" y="73" width="6" height="14" fill="#FFFFFF" stroke="#E0E0E0" strokeWidth="0.5" />
      <rect x="39" y="73" width="6" height="14" fill="#FFFFFF" stroke="#E0E0E0" strokeWidth="0.5" />
      <rect x="47" y="73" width="6" height="14" fill="#FFFFFF" stroke="#E0E0E0" strokeWidth="0.5" />
      <rect x="55" y="73" width="6" height="14" fill="#FFFFFF" stroke="#E0E0E0" strokeWidth="0.5" />
      <rect x="63" y="73" width="6" height="14" fill="#FFFFFF" stroke="#E0E0E0" strokeWidth="0.5" />
      <rect x="71" y="73" width="6" height="14" fill="#FFFFFF" stroke="#E0E0E0" strokeWidth="0.5" />
      <rect x="79" y="73" width="6" height="14" fill="#FFFFFF" stroke="#E0E0E0" strokeWidth="0.5" />
    </svg>
  ),

  'chest-storage': ({ className, style }) => (
    <svg viewBox="0 0 100 100" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="100" height="100" fill="#8B5A2B" stroke="#6B4A1B" strokeWidth="2" />
      <rect x="5" y="5" width="90" height="90" fill="#A06A3B" stroke="#8B5A2B" strokeWidth="1" />
      <rect x="35" y="45" width="30" height="10" fill="#6B4A1B" rx="3" />
      <line x1="50" y1="5" x2="50" y2="95" stroke="#8B5A2B" strokeWidth="2" />
    </svg>
  ),

  'floor-mirror': ({ className, style }) => (
    <svg viewBox="0 0 100 100" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      <rect x="10" y="0" width="80" height="100" fill="#5C4033" stroke="#4A3329" strokeWidth="2" />
      <rect x="15" y="5" width="70" height="90" fill="#B8D4E8" stroke="#A0C0D8" strokeWidth="1" />
      <rect x="20" y="10" width="60" height="80" fill="#D0E8F8" />
    </svg>
  ),

  'pet-bed-small': ({ className, style }) => (
    <svg viewBox="0 0 100 100" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="50" cy="55" rx="45" ry="35" fill="#8B5A2B" stroke="#6B4A1B" strokeWidth="2" />
      <ellipse cx="50" cy="55" rx="35" ry="25" fill="#C8A882" stroke="#A88B6A" strokeWidth="1" />
    </svg>
  ),

  'pet-bed-large': ({ className, style }) => (
    <svg viewBox="0 0 100 100" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="50" cy="55" rx="48" ry="40" fill="#4A6FA5" stroke="#3D5A87" strokeWidth="2" />
      <ellipse cx="50" cy="55" rx="38" ry="30" fill="#5A7FB5" stroke="#4A6FA5" strokeWidth="1" />
      <ellipse cx="50" cy="45" rx="25" ry="15" fill="#7A9BC8" />
    </svg>
  ),

  'baby-gate': ({ className, style }) => (
    <svg viewBox="0 0 100 100" className={className} style={style} xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="100" height="100" fill="#F5F0E8" stroke="#E0D8D0" strokeWidth="2" />
      <line x1="10" y1="0" x2="10" y2="100" stroke="#E0D8D0" strokeWidth="4" />
      <line x1="25" y1="0" x2="25" y2="100" stroke="#E0D8D0" strokeWidth="4" />
      <line x1="40" y1="0" x2="40" y2="100" stroke="#E0D8D0" strokeWidth="4" />
      <line x1="55" y1="0" x2="55" y2="100" stroke="#E0D8D0" strokeWidth="4" />
      <line x1="70" y1="0" x2="70" y2="100" stroke="#E0D8D0" strokeWidth="4" />
      <line x1="85" y1="0" x2="85" y2="100" stroke="#E0D8D0" strokeWidth="4" />
      <rect x="0" y="45" width="100" height="10" fill="#D0C8C0" />
    </svg>
  ),
};

/**
 * Get furniture icon component by furniture type ID
 */
export const getFurnitureIcon = (typeId: string): React.FC<{ className?: string; style?: React.CSSProperties }> | null => {
  return FurnitureIcons[typeId] || null;
};
