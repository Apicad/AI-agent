import { HANDOFF_EDGE_COLOR, HANDOFF_FAINT_ALPHA, HANDOFF_LABEL_COLOR } from '../../constants.js';
import type { Character } from '../types.js';
import { getFleetHandoffs } from './handoffStore.js';

/** Handoffs newer than this pulse (animated, solid, labeled). */
const HANDOFF_PULSE_MS = 15 * 60_000;
/** Handoffs older than the pulse window fade out until this age, then hide. */
const HANDOFF_FADE_MS = 2 * 60 * 60_000;
/** Vertical anchor: connect characters mid-body (sprite is 16x24, bottom-center anchored). */
const EDGE_ANCHOR_Y_PX = 12;

/**
 * Draw fleet communication edges between characters named like the handoff
 * tokens (<from>--<to>--<topic>.md). Recent handoffs pulse with the topic
 * label; older ones render as faint dashed arcs; ancient ones are hidden.
 * One edge per directed pair — handoffs arrive newest-first, first wins.
 */
export function renderHandoffEdges(
  ctx: CanvasRenderingContext2D,
  characters: Character[],
  offsetX: number,
  offsetY: number,
  zoom: number,
): void {
  const handoffs = getFleetHandoffs();
  if (handoffs.length === 0) return;

  const now = Date.now();
  const byName = new Map<string, Character>();
  for (const ch of characters) {
    if (ch.customName && !ch.isSubagent) byName.set(ch.customName.toLowerCase(), ch);
  }
  if (byName.size === 0) return;

  const seen = new Set<string>();
  ctx.save();
  for (const h of handoffs) {
    const age = now - h.mtime;
    if (age > HANDOFF_FADE_MS) continue;
    const src = byName.get(h.from.toLowerCase());
    const dst = byName.get(h.to.toLowerCase());
    if (!src || !dst || src === dst) continue;
    const key = `${src.id}>${dst.id}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const x1 = offsetX + src.x * zoom;
    const y1 = offsetY + (src.y - EDGE_ANCHOR_Y_PX) * zoom;
    const x2 = offsetX + dst.x * zoom;
    const y2 = offsetY + (dst.y - EDGE_ANCHOR_Y_PX) * zoom;
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2 - 24 * zoom; // arc upward

    const pulsing = age < HANDOFF_PULSE_MS;
    ctx.globalAlpha = pulsing
      ? 0.55 + 0.35 * Math.sin(now / 180)
      : HANDOFF_FAINT_ALPHA * (1 - (age - HANDOFF_PULSE_MS) / (HANDOFF_FADE_MS - HANDOFF_PULSE_MS));
    ctx.strokeStyle = HANDOFF_EDGE_COLOR;
    ctx.lineWidth = pulsing ? 2 : 1;
    ctx.setLineDash(pulsing ? [] : [4, 4]);

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.quadraticCurveTo(midX, midY, x2, y2);
    ctx.stroke();

    // Arrowhead at the destination, oriented along the curve's end tangent.
    const angle = Math.atan2(y2 - midY, x2 - midX);
    const ah = 6 * Math.max(zoom, 0.5);
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - ah * Math.cos(angle - 0.4), y2 - ah * Math.sin(angle - 0.4));
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - ah * Math.cos(angle + 0.4), y2 - ah * Math.sin(angle + 0.4));
    ctx.stroke();

    if (pulsing) {
      ctx.globalAlpha = 1;
      ctx.fillStyle = HANDOFF_LABEL_COLOR;
      ctx.font = `${Math.max(9, Math.round(9 * zoom))}px monospace`;
      ctx.textAlign = 'center';
      ctx.fillText(h.topic, midX, midY + 12 * zoom);
    }
  }
  ctx.restore();
}
