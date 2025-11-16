// Draw a single zone rectangle with styling, hover and simple appear/disappear animations.

export function drawZone(ctx, scaleX, scaleY, zone, index, zoneType, { animatedZones, hoveredZone }) {
  const x = scaleX(Math.min(zone.beginX, zone.endX));
  const y = scaleY(Math.min(zone.beginY, zone.endY));
  const width = Math.abs(scaleX(zone.endX) - scaleX(zone.beginX));
  const height = Math.abs(scaleY(zone.endY) - scaleY(zone.beginY));

  const isDarkMode = document.body.classList.contains('dark-mode');

  const animationKey = `${zoneType}-${index}`;
  const animation = animatedZones?.get(animationKey);
  let transform = { scale: 1, opacity: 1 };

  if (animation) {
    const elapsed = Date.now() - animation.startTime;
    const progress = Math.min(elapsed / animation.duration, 1);
    transform = getAnimationTransform(animation.type, progress);
  }

  ctx.save();

  if (transform.scale !== 1) {
    const cx = x + width / 2;
    const cy = y + height / 2;
    ctx.translate(cx, cy);
    ctx.scale(transform.scale, transform.scale);
    ctx.translate(-cx, -cy);
  }
  ctx.globalAlpha = transform.opacity;

  const cornerRadius = 8;
  const isHovered = hoveredZone && hoveredZone.type === zoneType && hoveredZone.index === index && (zoneType === 'user' || zoneType === 'exclusion' || zoneType === 'entry');

  let fillGradient, strokeColor, shadowColor;
  if (zoneType === 'ha') {
    const colors = [
      { fill: ['#3b82f6', '#1d4ed8'], stroke: '#1e40af', shadow: '#3b82f680' },
      { fill: ['#10b981', '#047857'], stroke: '#065f46', shadow: '#10b98180' },
      { fill: ['#f59e0b', '#d97706'], stroke: '#92400e', shadow: '#f59e0b80' },
      { fill: ['#ef4444', '#dc2626'], stroke: '#991b1b', shadow: '#ef444480' },
    ];
    const color = colors[index % colors.length];
    fillGradient = color.fill;
    strokeColor = color.stroke;
    shadowColor = color.shadow;
  } else if (zoneType === 'user') {
    fillGradient = ['#8b5cf6', '#7c3aed'];
    strokeColor = '#6d28d9';
    shadowColor = '#8b5cf680';
  } else if (zoneType === 'haExclusion' || zoneType === 'exclusion') {
    fillGradient = ['#f87171', '#ef4444'];
    strokeColor = '#dc2626';
    shadowColor = '#f8717180';
  } else if (zoneType === 'haEntry' || zoneType === 'entry') {
    fillGradient = ['#14b8a6', '#0d9488']; // teal gradient
    strokeColor = '#0f766e';
    shadowColor = '#14b8a680';
  } else {
    fillGradient = ['#999999', '#777777'];
    strokeColor = '#555555';
    shadowColor = '#00000040';
  }

  const gradient = ctx.createLinearGradient(x, y, x, y + height);
  const topOpacity = isHovered ? '30' : '20';
  const bottomOpacity = isHovered ? '40' : '30';
  gradient.addColorStop(0, fillGradient[0] + topOpacity);
  gradient.addColorStop(1, fillGradient[1] + bottomOpacity);

  ctx.shadowColor = shadowColor;
  ctx.shadowBlur = isHovered ? 12 : 6;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = isHovered ? 3 : 2;

  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, cornerRadius);
  ctx.fill();

  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;

  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = isHovered ? 3 : 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, cornerRadius);
  ctx.stroke();

  ctx.strokeStyle = fillGradient[0] + '40';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x + 1, y + 1, width - 2, height - 2, cornerRadius - 1);
  ctx.stroke();

  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.font = "500 12px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

  let zoneLabel = '';
  if (zoneType === 'ha') zoneLabel = `HA Zone ${index + 1}`;
  else if (zoneType === 'user') zoneLabel = `Zone ${index + 1}`;
  else if (zoneType === 'exclusion') zoneLabel = `Exclusion ${index + 1}`;
  else if (zoneType === 'entry') zoneLabel = `Entry ${index + 1}`;
  else if (zoneType === 'haExclusion') zoneLabel = `HA Exclusion ${index + 1}`;
  else if (zoneType === 'haEntry') zoneLabel = `HA Entry ${index + 1}`;

  const textMetrics = ctx.measureText(zoneLabel);
  const textWidth = textMetrics.width;
  const textHeight = 16;
  const textPadding = 8;
  const textX = x + 10;
  const textY = y + textHeight / 2 + 6;

  ctx.fillStyle = isDarkMode ? 'rgba(0, 0, 0, 0.3)' : 'rgba(255, 255, 255, 0.8)';
  ctx.beginPath();
  ctx.roundRect(textX - textPadding / 2, textY - textHeight / 2 + 1, textWidth + textPadding, textHeight - 2, 6);
  ctx.fill();

  ctx.fillStyle = isDarkMode ? '#ffffff' : '#1a202c';
  ctx.fillText(zoneLabel, textX, textY);

  ctx.restore();
}

// Local copy of the animation curve to match existing visuals
function getAnimationTransform(animationType, progress) {
  if (animationType === 'appear') {
    if (progress < 0.5) {
      const t = progress * 2;
      return { scale: t * 1.05, opacity: t * 0.8 };
    } else {
      const t = (progress - 0.5) * 2;
      return { scale: 1.05 - (t * 0.05), opacity: 0.8 + (t * 0.2) };
    }
  } else if (animationType === 'disappear') {
    if (progress < 0.5) {
      const t = progress * 2;
      return { scale: 1 + (t * 0.05), opacity: 1 - (t * 0.5) };
    } else {
      const t = (progress - 0.5) * 2;
      return { scale: 1.05 - (t * 1.05), opacity: 0.5 - (t * 0.5) };
    }
  }
  return { scale: 1, opacity: 1 };
}
