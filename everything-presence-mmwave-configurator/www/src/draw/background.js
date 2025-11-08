export function drawRadarBackground(ctx, scaleX, scaleY, installationAngle, detectionRange) {
  const centerX = scaleX(0);
  const centerY = scaleY(0);
  const halfDetectionAngle = 60;
  const startAngleRadians = ((-halfDetectionAngle - installationAngle) / 180) * Math.PI;
  const endAngleRadians = ((halfDetectionAngle - installationAngle) / 180) * Math.PI;

  const startAngle = Math.PI / 2 + startAngleRadians;
  const endAngle = Math.PI / 2 + endAngleRadians;

  const radius = scaleY(detectionRange) - scaleY(0);

  ctx.beginPath();
  ctx.moveTo(centerX, centerY);
  ctx.arc(centerX, centerY, radius, startAngle, endAngle, false);
  ctx.closePath();

  ctx.fillStyle = 'rgba(168, 216, 234, 0.15)';
  ctx.fill();

  ctx.strokeStyle = 'rgba(168, 216, 234, 0.5)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

export function drawGrid(ctx, scaleX, scaleY) {
  const gridSize = 1000; // Grid every 1000 mm
  ctx.strokeStyle = '#e0e0e0';
  ctx.lineWidth = 1;

  // Vertical grid lines
  for (let x = -6000; x <= 6000; x += gridSize) {
    ctx.beginPath();
    ctx.moveTo(scaleX(x), scaleY(-2000));
    ctx.lineTo(scaleX(x), scaleY(7500));
    ctx.stroke();
  }

  // Horizontal grid lines
  for (let y = -2000; y <= 7500; y += gridSize) {
    ctx.beginPath();
    ctx.moveTo(scaleX(-6000), scaleY(y));
    ctx.lineTo(scaleX(6000), scaleY(y));
    ctx.stroke();
  }
}

