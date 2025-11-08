// Ghost zone drawing for preview during creation

export function drawGhostZone(ctx, scaleX, scaleY, zone, zoneType, { isDarkMode = false } = {}) {
  if (!zone) return;

  const x = scaleX(Math.min(zone.beginX, zone.endX));
  const y = scaleY(Math.min(zone.beginY, zone.endY));
  const width = Math.abs(scaleX(zone.endX) - scaleX(zone.beginX));
  const height = Math.abs(scaleY(zone.endY) - scaleY(zone.beginY));

  ctx.save();

  const cornerRadius = 8;
  let fillColor, strokeColor, glowColor;
  if (zoneType === 'regular') {
    fillColor = '#8b5cf620';
    strokeColor = '#8b5cf6';
    glowColor = '#8b5cf640';
  } else if (zoneType === 'exclusion') {
    fillColor = '#f8717120';
    strokeColor = '#f87171';
    glowColor = '#f8717140';
  } else {
    fillColor = 'rgba(0,0,0,0.1)';
    strokeColor = '#000000';
    glowColor = 'rgba(0,0,0,0.2)';
  }

  ctx.shadowColor = glowColor;
  ctx.shadowBlur = 12;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;

  ctx.fillStyle = fillColor;
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, cornerRadius);
  ctx.fill();

  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;

  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, cornerRadius);
  ctx.stroke();

  // Inner border
  ctx.setLineDash([]);
  ctx.globalAlpha = 0.6;
  ctx.beginPath();
  ctx.roundRect(x + 2, y + 2, width - 4, height - 4, cornerRadius - 1);
  ctx.stroke();

  ctx.restore();
}

