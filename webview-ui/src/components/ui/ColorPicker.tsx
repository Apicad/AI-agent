import { useCallback, useEffect, useRef, useState } from 'react';

import {
  adjustSwatchPreview,
  COLOR_PALETTE_MAX_SWATCHES,
  COLOR_PALETTE_STORAGE_KEY,
  COLOR_PICKER_FALLBACK_HEX,
  colorPickerPreview,
  GRADIENT_BRIGHTNESS,
  GRADIENT_CONTRAST,
  GRADIENT_HUE_RAINBOW,
} from '../../constants.js';
import type { ColorValue } from './types.js';

// ── Hex ↔ Colorize conversion helpers ──────────────────────────

function hexToRgb(hex: string): [number, number, number] | null {
  const clean = hex.replace('#', '').trim();
  if (clean.length !== 6) return null;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
  return [r, g, b];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
    else if (max === gn) h = ((bn - rn) / d + 2) / 6;
    else h = ((rn - gn) / d + 4) / 6;
  }
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

function hslChannel(n: number, h: number, s: number, l: number): number {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const k = (n + h / 30) % 12;
  return Math.round(255 * (l / 100 - a * Math.max(Math.min(k - 3, 9 - k, 1), -1)));
}

function hslToHex(h: number, s: number, l: number): string {
  const r = hslChannel(0, h, s, l).toString(16).padStart(2, '0');
  const g = hslChannel(8, h, s, l).toString(16).padStart(2, '0');
  const b = hslChannel(4, h, s, l).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}

function hexToColorize(hex: string): ColorValue | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const [hv, sv, lv] = rgbToHsl(...rgb);
  const bv = Math.max(-100, Math.min(100, Math.round((lv - 50) / 0.3)));
  return { h: hv, s: sv, b: bv, c: 0, colorize: true };
}

function colorizeToHex(h: number, s: number, b: number): string {
  const l = Math.max(10, Math.min(90, 50 + b * 0.3));
  return hslToHex(h, s, l);
}

// ── Palette ─────────────────────────────────────────────────────

// Preset swatches always shown (cannot be removed)
const PRESET_COLORS: ColorValue[] = [
  { h: 0,   s: 90, b: 10, c: 0, colorize: true },  // red
  { h: 25,  s: 95, b: 17, c: 0, colorize: true },  // orange
  { h: 50,  s: 95, b: 20, c: 0, colorize: true },  // yellow
  { h: 120, s: 80, b: 5,  c: 0, colorize: true },  // green
  { h: 195, s: 90, b: 10, c: 0, colorize: true },  // cyan
  { h: 220, s: 85, b: 10, c: 0, colorize: true },  // blue
  { h: 270, s: 80, b: 10, c: 0, colorize: true },  // purple
  { h: 300, s: 85, b: 10, c: 0, colorize: true },  // magenta
  { h: 340, s: 85, b: 10, c: 0, colorize: true },  // pink
  { h: 15,  s: 60, b: -5, c: 0, colorize: true },  // brown
  { h: 0,   s: 0,  b: 30, c: 0, colorize: true },  // light gray
  { h: 0,   s: 0,  b: -30,c: 0, colorize: true },  // dark gray
];

function loadPalette(): ColorValue[] {
  try {
    const raw = localStorage.getItem(COLOR_PALETTE_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ColorValue[]) : [];
  } catch { return []; }
}
function savePalette(p: ColorValue[]) {
  localStorage.setItem(COLOR_PALETTE_STORAGE_KEY, JSON.stringify(p));
}

function ColorSwatch({
  color,
  isCurrent,
  isPreset,
  onClick,
  onRemove,
}: {
  color: ColorValue;
  isCurrent: boolean;
  isPreset: boolean;
  onClick: () => void;
  onRemove?: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const bg = color.colorize
    ? colorPickerPreview(color.h, color.s, color.b)
    : adjustSwatchPreview(color.h, color.s);

  return (
    <div
      style={{ position: 'relative', flexShrink: 0 }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        onClick={onClick}
        title="Apply color"
        style={{
          width: 26,
          height: 26,
          borderRadius: '50%',
          background: bg,
          cursor: 'pointer',
          boxSizing: 'border-box',
          border: isCurrent ? '2px solid #fff' : '2px solid transparent',
          outline: isCurrent ? '2px solid rgba(255,255,255,0.4)' : 'none',
          transition: 'transform 0.1s',
          transform: hovered ? 'scale(1.15)' : 'scale(1)',
        }}
      />
      {!isPreset && hovered && onRemove && (
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          style={{
            position: 'absolute', top: -4, right: -4,
            width: 13, height: 13, borderRadius: '50%',
            fontSize: 9, lineHeight: '11px', textAlign: 'center',
            padding: 0, background: '#d14249', color: '#fff',
            border: '1px solid var(--color-bg-dark)', cursor: 'pointer',
          }}
        >×</button>
      )}
    </div>
  );
}

// ── 2D Sat/Bright picker ────────────────────────────────────────

function SatBrightPicker({
  hue, saturation, brightness, onChange,
}: {
  hue: number; saturation: number; brightness: number;
  onChange: (s: number, b: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragging = useRef(false);

  // Draw the gradient + cursor
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { width: w, height: h } = canvas;

    // White → Hue (left to right)
    const gradH = ctx.createLinearGradient(0, 0, w, 0);
    gradH.addColorStop(0, '#ffffff');
    gradH.addColorStop(1, `hsl(${hue}, 100%, 50%)`);
    ctx.fillStyle = gradH;
    ctx.fillRect(0, 0, w, h);

    // Transparent → Black (top to bottom)
    const gradV = ctx.createLinearGradient(0, 0, 0, h);
    gradV.addColorStop(0, 'rgba(0,0,0,0)');
    gradV.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.fillStyle = gradV;
    ctx.fillRect(0, 0, w, h);

    // Cursor circle — map saturation 0-100 → x, brightness -100..+100 → y (top=bright)
    const cx = (saturation / 100) * w;
    const cy = ((100 - brightness) / 200) * h;
    ctx.beginPath();
    ctx.arc(cx, cy, 7, 0, Math.PI * 2);
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, 7, 0, Math.PI * 2);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
  }, [hue, saturation, brightness]);

  const pick = useCallback((e: React.MouseEvent | MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
    const s = Math.round((x / rect.width) * 100);
    const b = Math.round((1 - y / rect.height) * 200 - 100);
    onChange(s, b);
  }, [onChange]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => { if (dragging.current) pick(e); };
    const onUp = () => { dragging.current = false; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [pick]);

  return (
    <canvas
      ref={canvasRef}
      width={256}
      height={140}
      style={{ width: '100%', height: 140, cursor: 'crosshair', display: 'block' }}
      onMouseDown={(e) => { dragging.current = true; pick(e); }}
    />
  );
}

// ── Hue strip ──────────────────────────────────────────────────

function HueStrip({ hue, onChange }: { hue: number; onChange: (h: number) => void }) {
  return (
    <div style={{ position: 'relative', height: 16, background: GRADIENT_HUE_RAINBOW, border: '1px solid var(--color-border)' }}>
      <input
        type="range" min={0} max={360} value={hue}
        onChange={(e) => onChange(Number(e.target.value))}
        className="gradient-track"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', margin: 0, cursor: 'pointer' }}
      />
    </div>
  );
}

// ── Thin slider ────────────────────────────────────────────────

function ThinSlider({
  label, value, min, max, gradient, onChange,
}: {
  label: string; value: number; min: number; max: number;
  gradient: string; onChange: (v: number) => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontSize: 16, color: 'var(--color-text-muted)', width: 70, textAlign: 'right', flexShrink: 0 }}>
        {label}
      </span>
      <div style={{ position: 'relative', flex: 1, height: 10, background: gradient, border: '1px solid var(--color-border)' }}>
        <input
          type="range" min={min} max={max} value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="gradient-track"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', margin: 0, cursor: 'pointer' }}
        />
      </div>
      <span style={{ fontSize: 16, color: 'var(--color-text-muted)', width: 36, textAlign: 'right', flexShrink: 0 }}>
        {value}
      </span>
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────

interface ColorPickerProps {
  value: ColorValue;
  onChange: (color: ColorValue) => void;
  colorize?: boolean;
  showColorizeToggle?: boolean;
}

export function ColorPicker({ value, onChange, colorize, showColorizeToggle }: ColorPickerProps) {
  const isColorize = colorize || !!value.colorize;

  const hexInputRef = useRef<HTMLInputElement>(null);
  const [hexInput, setHexInput] = useState(() =>
    isColorize ? colorizeToHex(value.h, value.s, value.b) : '',
  );
  const isEditingHexRef = useRef(false);
  useEffect(() => {
    if (!isEditingHexRef.current) {
      setHexInput(isColorize ? colorizeToHex(value.h, value.s, value.b) : '');
    }
  }, [value, isColorize]);

  const [palette, setPalette] = useState<ColorValue[]>(loadPalette);

  const applyHex = (hex: string) => {
    const converted = hexToColorize(hex);
    if (converted) {
      onChange(converted);
      setHexInput(colorizeToHex(converted.h, converted.s, converted.b));
    }
  };

  const handleHexCommit = () => {
    isEditingHexRef.current = false;
    applyHex(hexInput);
  };

  const handleSavePalette = () => {
    const entry: ColorValue = { ...value };
    const next = [
      entry,
      ...palette.filter(
        (p) => !(p.h === entry.h && p.s === entry.s && p.b === entry.b && p.c === entry.c && !!p.colorize === !!entry.colorize),
      ),
    ].slice(0, COLOR_PALETTE_MAX_SWATCHES);
    setPalette(next);
    savePalette(next);
  };

  const handleRemoveSwatch = (idx: number) => {
    const next = palette.filter((_, i) => i !== idx);
    setPalette(next);
    savePalette(next);
  };

  const previewHex = isColorize ? colorizeToHex(value.h, value.s, value.b) : null;
  const previewHsl = isColorize ? colorPickerPreview(value.h, value.s, value.b) : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 12px', background: 'var(--color-bg-dark)', border: '2px solid var(--color-border)' }}>

      {/* 2D Sat/Bright picker (colorize mode only) */}
      {isColorize && (
        <SatBrightPicker
          hue={value.h}
          saturation={value.s}
          brightness={value.b}
          onChange={(s, b) => onChange({ ...value, s, b })}
        />
      )}

      {/* Hue strip */}
      <HueStrip hue={value.h} onChange={(h) => onChange({ ...value, h })} />

      {/* Hex + preview row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input
          type="color"
          value={previewHex ?? COLOR_PICKER_FALLBACK_HEX}
          onChange={(e) => applyHex(e.target.value)}
          title="Pick a color"
          style={{ width: 28, height: 28, padding: 0, border: '2px solid var(--color-border)', borderRadius: 0, cursor: 'pointer', flexShrink: 0, background: 'none' }}
        />
        {previewHsl && (
          <div style={{ width: 28, height: 28, background: previewHsl, border: '2px solid var(--color-border)', flexShrink: 0 }} />
        )}
        <input
          ref={hexInputRef}
          type="text"
          value={hexInput}
          maxLength={7}
          placeholder="#rrggbb"
          onChange={(e) => { isEditingHexRef.current = true; setHexInput(e.target.value); }}
          onBlur={handleHexCommit}
          onKeyDown={(e) => { if (e.key === 'Enter') { handleHexCommit(); hexInputRef.current?.blur(); } }}
          style={{ flex: 1, minWidth: 0, fontSize: 16, background: 'var(--color-bg)', color: 'var(--color-text)', border: '2px solid var(--color-border)', borderRadius: 0, padding: '2px 6px', outline: 'none' }}
        />
      </div>

      {/* Brightness + Contrast fine-tune */}
      <ThinSlider label="Brightness" value={value.b} min={-100} max={100} gradient={GRADIENT_BRIGHTNESS} onChange={(b) => onChange({ ...value, b })} />
      <ThinSlider label="Contrast" value={value.c} min={-100} max={100} gradient={GRADIENT_CONTRAST} onChange={(c) => onChange({ ...value, c })} />

      {showColorizeToggle && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 16, color: 'var(--color-text-muted)', cursor: 'pointer' }}>
          <input type="checkbox" checked={!!value.colorize} onChange={(e) => onChange({ ...value, colorize: e.target.checked || undefined })} className="accent-accent" />
          Colorize
        </label>
      )}

      {/* Color swatches: presets + saved */}
      <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 14, color: 'var(--color-text-muted)' }}>Saved colors:</span>
          <button
            onClick={handleSavePalette}
            title="Add current color to palette"
            style={{ fontSize: 13, padding: '5px 14px', background: 'transparent', color: 'var(--color-accent)', border: '2px solid var(--color-accent)', cursor: 'pointer' }}
          >
            + Add
          </button>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {PRESET_COLORS.map((swatch, i) => (
            <ColorSwatch
              key={`preset-${i}`}
              color={swatch}
              isCurrent={swatch.h === value.h && swatch.s === value.s && swatch.b === value.b}
              isPreset
              onClick={() => onChange(swatch)}
            />
          ))}
          {palette.map((swatch, i) => (
            <ColorSwatch
              key={`saved-${i}`}
              color={swatch}
              isCurrent={swatch.h === value.h && swatch.s === value.s && swatch.b === value.b}
              isPreset={false}
              onClick={() => onChange(swatch)}
              onRemove={() => handleRemoveSwatch(i)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
