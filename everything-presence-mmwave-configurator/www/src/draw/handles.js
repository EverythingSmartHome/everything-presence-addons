export function drawCornerHandles(ctx, scaleX, scaleY, zone, index, zoneType, hoveredZone, hoveredCorner) {
  if (!hoveredZone || hoveredZone.type !== zoneType || hoveredZone.index !== index) return;

  const x = scaleX(Math.min(zone.beginX, zone.endX));
  const y = scaleY(Math.min(zone.beginY, zone.endY));
  const width = Math.abs(scaleX(zone.endX) - scaleX(zone.beginX));
  const height = Math.abs(scaleY(zone.endY) - scaleY(zone.beginY));

  const baseHandleSize = 8;
  const pulseEffect = 0.2 * Math.sin(Date.now() * 0.003);
  const handleSize = baseHandleSize + pulseEffect;
  const isDarkMode = document.body.classList.contains('dark-mode');

  const corners = [
    { x: x, y: y, corner: 'top-left' },
    { x: x + width, y: y, corner: 'top-right' },
    { x: x, y: y + height, corner: 'bottom-left' },
    { x: x + width, y: y + height, corner: 'bottom-right' },
  ];

  ctx.save();
  corners.forEach((corner) => {
    const isHovered = hoveredCorner === corner.corner;
    if (isHovered) {
      ctx.shadowColor = isDarkMode ? '#ffffff60' : '#00000040';
      ctx.shadowBlur = 8;
    } else {
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
    }

    ctx.fillStyle = isHovered ? (isDarkMode ? '#ffffff' : '#1a202c') : (isDarkMode ? '#ffffff80' : '#1a202c80');
    ctx.beginPath();
    ctx.arc(corner.x, corner.y, handleSize / 2, 0, 2 * Math.PI);
    ctx.fill();

    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.fillStyle = isHovered ? (isDarkMode ? '#1a202c' : '#ffffff') : (isDarkMode ? '#1a202c60' : '#ffffff60');
    ctx.beginPath();
    ctx.arc(corner.x, corner.y, 2, 0, 2 * Math.PI);
    ctx.fill();
  });
  ctx.restore();
}

