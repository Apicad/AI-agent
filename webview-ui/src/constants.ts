import type { ColorValue } from './components/ui/types.js';

// ── Grid & Layout ────────────────────────────────────────────
export const TILE_SIZE = 16;
export const DEFAULT_COLS = 20;
export const DEFAULT_ROWS = 11;
export const MAX_COLS = 64;
export const MAX_ROWS = 64;

// ── Character Animation ─────────────────────────────────────
export const WALK_SPEED_PX_PER_SEC = 48;
export const WALK_FRAME_DURATION_SEC = 0.15;
export const TYPE_FRAME_DURATION_SEC = 0.3;
export const WANDER_PAUSE_MIN_SEC = 2.0;
export const WANDER_PAUSE_MAX_SEC = 20.0;
export const WANDER_MOVES_BEFORE_REST_MIN = 3;
export const WANDER_MOVES_BEFORE_REST_MAX = 6;
export const SEAT_REST_MIN_SEC = 120.0;
export const SEAT_REST_MAX_SEC = 240.0;

// ── Matrix Effect ────────────────────────────────────────────
export const MATRIX_EFFECT_DURATION_SEC = 0.3;
export const MATRIX_TRAIL_LENGTH = 6;
export const MATRIX_SPRITE_COLS = 16;
export const MATRIX_SPRITE_ROWS = 24;
export const MATRIX_FLICKER_FPS = 30;
export const MATRIX_FLICKER_VISIBILITY_THRESHOLD = 180;
export const MATRIX_COLUMN_STAGGER_RANGE = 0.3;
export const MATRIX_HEAD_COLOR = '#ccffcc';
export const matrixGreenBright = (a: number): string => `rgba(0, 255, 65, ${a})`;
export const matrixGreenMid = (a: number): string => `rgba(0, 170, 40, ${a})`;
export const matrixGreenDim = (a: number): string => `rgba(0, 85, 20, ${a})`;
export const MATRIX_TRAIL_OVERLAY_ALPHA = 0.6;
export const MATRIX_TRAIL_EMPTY_ALPHA = 0.5;
export const MATRIX_TRAIL_MID_THRESHOLD = 0.33;
export const MATRIX_TRAIL_DIM_THRESHOLD = 0.66;

// ── Rendering ────────────────────────────────────────────────
export const CHARACTER_SITTING_OFFSET_PX = 6;
export const CHARACTER_Z_SORT_OFFSET = 0.5;
export const OUTLINE_Z_SORT_OFFSET = 0.001;
export const SELECTED_OUTLINE_ALPHA = 1.0;
export const HOVERED_OUTLINE_ALPHA = 0.5;
export const GHOST_PREVIEW_SPRITE_ALPHA = 0.5;
export const GHOST_PREVIEW_TINT_ALPHA = 0.25;
export const SELECTION_DASH_PATTERN: [number, number] = [4, 3];
export const BUTTON_MIN_RADIUS = 6;
export const BUTTON_RADIUS_ZOOM_FACTOR = 3;
export const BUTTON_ICON_SIZE_FACTOR = 0.45;
export const BUTTON_LINE_WIDTH_MIN = 1.5;
export const BUTTON_LINE_WIDTH_ZOOM_FACTOR = 0.5;
export const BUBBLE_FADE_DURATION_SEC = 0.5;
export const BUBBLE_SITTING_OFFSET_PX = 10;
export const BUBBLE_VERTICAL_OFFSET_PX = 24;
export const FALLBACK_FLOOR_COLOR = '#808080';

// ── Rendering - Overlay Colors (canvas, not CSS) ─────────────
export const SEAT_OWN_COLOR = 'rgba(0, 127, 212, 0.35)';
export const SEAT_AVAILABLE_COLOR = 'rgba(0, 200, 80, 0.35)';
export const SEAT_BUSY_COLOR = 'rgba(220, 50, 50, 0.35)';
export const GRID_LINE_COLOR = 'rgba(255,255,255,0.12)';
export const VOID_TILE_OUTLINE_COLOR = 'rgba(255,255,255,0.08)';
export const VOID_TILE_DASH_PATTERN: [number, number] = [2, 2];
export const GHOST_BORDER_HOVER_FILL = 'rgba(60, 130, 220, 0.25)';
export const GHOST_BORDER_HOVER_STROKE = 'rgba(60, 130, 220, 0.5)';
export const GHOST_BORDER_STROKE = 'rgba(255, 255, 255, 0.06)';
export const GHOST_VALID_TINT = '#00ff00';
export const GHOST_INVALID_TINT = '#ff0000';
export const ROOM_STAMP_GHOST_VALID_FILL = 'rgba(60,255,120,0.25)';
export const ROOM_STAMP_GHOST_VALID_STROKE = 'rgba(60,255,120,0.85)';
export const ROOM_STAMP_GHOST_INVALID_FILL = 'rgba(255,60,60,0.25)';
export const ROOM_STAMP_GHOST_INVALID_STROKE = 'rgba(255,60,60,0.85)';
export const SELECTION_HIGHLIGHT_COLOR = '#007fd4';
export const DELETE_BUTTON_BG = 'rgba(200, 50, 50, 0.85)';
export const ROTATE_BUTTON_BG = 'rgba(50, 120, 200, 0.85)';
export const BUTTON_ICON_COLOR = '#fff';
export const CANVAS_FALLBACK_TILE_COLOR = '#444';
export const CANVAS_ERROR_TILE_COLOR = '#FF00FF';
export const WALL_COLOR = '#3A3A5C';

// ── Zone overlay rendering ────────────────────────────────────
export const ZONE_FILL_ALPHA = 0.15;
export const ZONE_BORDER_ALPHA = 0.55;
export const ZONE_LABEL_ALPHA = 0.75;
export const ZONE_DRAW_GHOST_FILL = 'rgba(255,255,255,0.1)';
export const ZONE_DRAW_GHOST_STROKE = 'rgba(255,255,255,0.6)';

// ── Camera ───────────────────────────────────────────────────
export const CAMERA_FOLLOW_LERP = 0.1;
export const CAMERA_FOLLOW_SNAP_THRESHOLD = 0.5;

// ── Zoom ─────────────────────────────────────────────────────
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 10;
export const ZOOM_DEFAULT_DPR_FACTOR = 2;
export const ZOOM_LEVEL_FADE_DELAY_MS = 1500;
export const ZOOM_LEVEL_HIDE_DELAY_MS = 2000;
export const ZOOM_LEVEL_FADE_DURATION_SEC = 0.5;
export const ZOOM_SCROLL_THRESHOLD = 50;
export const PAN_MARGIN_FRACTION = 0.25;

// ── Editor ───────────────────────────────────────────────────
export const UNDO_STACK_MAX_SIZE = 50;
export const LAYOUT_SAVE_DEBOUNCE_MS = 500;
export const DEFAULT_FLOOR_COLOR: ColorValue = { h: 35, s: 30, b: 15, c: 0 };
export const DEFAULT_WALL_COLOR: ColorValue = { h: 240, s: 25, b: 0, c: 0 };
export const DEFAULT_NEUTRAL_COLOR: ColorValue = { h: 0, s: 0, b: 0, c: 0 };

// ── Notification Sound (done: ascending chime) ─────────────
export const NOTIFICATION_NOTE_1_HZ = 659.25; // E5
export const NOTIFICATION_NOTE_2_HZ = 1318.51; // E6 (octave up)
export const NOTIFICATION_NOTE_1_START_SEC = 0;
export const NOTIFICATION_NOTE_2_START_SEC = 0.1;
export const NOTIFICATION_NOTE_DURATION_SEC = 0.18;
export const NOTIFICATION_VOLUME = 0.14;

// ── Permission Sound (attention: descending double tap) ────
export const PERMISSION_NOTE_1_HZ = 880; // A5
export const PERMISSION_NOTE_2_HZ = 659.25; // E5 (down a fourth)
export const PERMISSION_NOTE_1_START_SEC = 0;
export const PERMISSION_NOTE_2_START_SEC = 0.12;
export const PERMISSION_NOTE_DURATION_SEC = 0.15;
export const PERMISSION_VOLUME = 0.12;

// ── Furniture Animation ─────────────────────────────────────
export const FURNITURE_ANIM_INTERVAL_SEC = 0.2;

// ── Version Notice ──────────────────────────────────────────
export const WHATS_NEW_AUTO_CLOSE_MS = 20000;
export const WHATS_NEW_FADE_MS = 1000;

// ── Game Logic ───────────────────────────────────────────────
export const MAX_DELTA_TIME_SEC = 0.1;
export const WAITING_BUBBLE_DURATION_SEC = 2.0;
export const DISMISS_BUBBLE_FAST_FADE_SEC = 0.3;
export const INACTIVE_SEAT_TIMER_MIN_SEC = 3.0;
export const INACTIVE_SEAT_TIMER_RANGE_SEC = 2.0;
/** Default/fallback palette count (bundled characters). Actual count comes from getLoadedCharacterCount(). */
export const PALETTE_COUNT = 6;
export const HUE_SHIFT_MIN_DEG = 45;
export const HUE_SHIFT_RANGE_DEG = 271;
export const AUTO_ON_FACING_DEPTH = 3;
export const AUTO_ON_SIDE_DEPTH = 2;
export const CHARACTER_HIT_HALF_WIDTH = 8;
export const CHARACTER_HIT_HEIGHT = 24;
export const TOOL_OVERLAY_VERTICAL_OFFSET = 32;

// ── Color Picker ──────────────────────────────────────────────
export const COLOR_PALETTE_STORAGE_KEY = 'pixel-agents.color-palette';
export const COLOR_PALETTE_MAX_SWATCHES = 12;
export const COLOR_PICKER_FALLBACK_HEX = '#888888';

/** Approximate preview for adjust-mode swatch (no source sprite, best-effort). */
export function adjustSwatchPreview(h: number, s: number): string {
  const hNorm = ((h % 360) + 360) % 360;
  const sNorm = Math.max(0, Math.min(100, 50 + s / 2));
  return `hsl(${hNorm}, ${sNorm}%, 50%)`;
}

// ── Color Picker Gradients ────────────────────────────────────
export const GRADIENT_HUE_RAINBOW =
  'linear-gradient(to right, hsl(0,100%,50%), hsl(60,100%,50%), hsl(120,100%,50%), hsl(180,100%,50%), hsl(240,100%,50%), hsl(300,100%,50%), hsl(360,100%,50%))';
export const GRADIENT_BRIGHTNESS = 'linear-gradient(to right, #111, #888, #fff)';
export const GRADIENT_CONTRAST = 'linear-gradient(to right, #555, #888, #fff)';

/** Approximate preview color for colorize mode. */
export function colorPickerPreview(h: number, s: number, b: number): string {
  const l = Math.max(10, Math.min(90, 50 + b * 0.3));
  return `hsl(${h}, ${s}%, ${l}%)`;
}

/** Saturation gradient at a given hue. */
export function gradientSaturation(h: number): string {
  return `linear-gradient(to right, hsl(${h},0%,50%), hsl(${h},100%,50%))`;
}

/** Hue-shift adjustment gradient (adjust mode). */
export function gradientHueAdjust(h: number): string {
  const mid = ((h + 360) % 360) as number;
  const end = ((h + 180 + 360) % 360) as number;
  return `linear-gradient(to right, hsl(${mid},70%,50%), hsl(${end},70%,50%))`;
}

// ── Edit tool cursors (SVG data URIs, pixel-art style, 16×16) ─
const _svgCursor = (svg: string, hx: number, hy: number) =>
  `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${hx} ${hy}, crosshair`;

// Pencil — hotspot at tip (0,15)
export const CURSOR_PENCIL = _svgCursor(
  `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect x="10" y="1" width="3" height="2" fill="#fff"/><rect x="9" y="3" width="3" height="2" fill="#ccc"/><rect x="7" y="5" width="3" height="2" fill="#fff"/><rect x="5" y="7" width="3" height="2" fill="#ccc"/><rect x="3" y="9" width="3" height="2" fill="#fff"/><rect x="1" y="11" width="3" height="2" fill="#ccc"/><rect x="0" y="13" width="2" height="2" fill="#ff0"/><rect x="1" y="14" width="1" height="2" fill="#888"/></svg>`,
  0, 15,
);

// Eraser — hotspot center (4,4)
export const CURSOR_ERASER = _svgCursor(
  `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect x="2" y="2" width="10" height="8" fill="#fff" stroke="#999" stroke-width="1"/><rect x="2" y="10" width="10" height="2" fill="#f88"/><rect x="0" y="14" width="16" height="1" fill="#999"/></svg>`,
  4, 4,
);

// Eyedropper — hotspot at tip (1,14)
export const CURSOR_EYEDROPPER = _svgCursor(
  `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect x="8" y="1" width="4" height="2" fill="#ccc"/><rect x="6" y="3" width="6" height="2" fill="#fff"/><rect x="5" y="5" width="5" height="2" fill="#ccc"/><rect x="4" y="7" width="3" height="2" fill="#fff"/><rect x="3" y="9" width="3" height="2" fill="#ccc"/><rect x="2" y="11" width="2" height="2" fill="#fff"/><rect x="1" y="13" width="2" height="2" fill="#ff0"/><rect x="0" y="14" width="2" height="2" fill="#888"/></svg>`,
  1, 14,
);

// Paint bucket — hotspot at pour tip (1,14)
export const CURSOR_BUCKET = _svgCursor(
  `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect x="4" y="1" width="7" height="2" fill="#ccc"/><rect x="3" y="3" width="9" height="6" fill="#fff" stroke="#999" stroke-width="1"/><rect x="4" y="9" width="7" height="2" fill="#aaa"/><rect x="5" y="11" width="5" height="1" fill="#888"/><rect x="0" y="12" width="3" height="3" fill="#4af"/><rect x="1" y="14" width="2" height="2" fill="#4af"/></svg>`,
  1, 14,
);

// Move (4-arrow) — hotspot center (8,8)
export const CURSOR_MOVE = _svgCursor(
  `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect x="7" y="0" width="2" height="4" fill="#fff"/><rect x="6" y="1" width="4" height="2" fill="#fff"/><rect x="7" y="12" width="2" height="4" fill="#fff"/><rect x="6" y="13" width="4" height="2" fill="#fff"/><rect x="0" y="7" width="4" height="2" fill="#fff"/><rect x="1" y="6" width="2" height="4" fill="#fff"/><rect x="12" y="7" width="4" height="2" fill="#fff"/><rect x="13" y="6" width="2" height="4" fill="#fff"/><rect x="6" y="6" width="4" height="4" fill="#fff"/></svg>`,
  8, 8,
);
