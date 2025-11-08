export function drawTarget(ctx, scaleX, scaleY, target) {
  const x = scaleX(target.x);
  const y = scaleY(target.y);
  ctx.beginPath();
  ctx.arc(x, y, 5, 0, 2 * Math.PI);
  ctx.fillStyle = 'red';
  ctx.fill();
  ctx.closePath();
}

export function drawPersistentDots(ctx, scaleX, scaleY, dots) {
  ctx.fillStyle = 'black';
  dots.forEach((dot) => {
    ctx.beginPath();
    ctx.arc(scaleX(dot.x), scaleY(dot.y), 3, 0, 2 * Math.PI);
    ctx.fill();
    ctx.closePath();
  });
}

