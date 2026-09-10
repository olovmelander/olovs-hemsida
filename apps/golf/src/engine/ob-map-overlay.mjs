/* Dashed white lines are virtual map annotations for reviewed OB boundaries.
 * They deliberately do not create 3D stakes or painted lines on the terrain. */
export function drawOutOfBoundsOverlay(context, outOfBounds, projectX, projectZ) {
  const lines = (outOfBounds?.lines || []).filter(record => record.virtual === true &&
    Array.isArray(record.line) && record.line.length >= 2);
  if (!lines.length) return 0;
  context.save();
  context.strokeStyle = 'rgba(250,249,241,.85)';
  context.lineWidth = 1.6;
  context.lineJoin = 'round';
  context.setLineDash([4, 3]);
  for (const record of lines) {
    context.beginPath();
    record.line.forEach(([x, z], i) => i ? context.lineTo(projectX(x), projectZ(z)) :
      context.moveTo(projectX(x), projectZ(z)));
    context.stroke();
  }
  context.setLineDash([]);
  context.font = '500 10px Outfit,sans-serif';
  context.textAlign = 'left';
  context.fillStyle = 'rgba(250,249,241,.85)';
  context.fillText('OB (karta)', 12, context.canvas.height - 12);
  context.restore();
  return lines.length;
}
