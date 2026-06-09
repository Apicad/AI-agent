import { useEffect, useState } from 'react';

import { Button } from '../../components/ui/Button.js';
import { ColorPicker } from '../../components/ui/ColorPicker.js';
import { ItemSelect } from '../../components/ui/ItemSelect.js';
import type { ColorValue } from '../../components/ui/types.js';
import { CANVAS_FALLBACK_TILE_COLOR } from '../../constants.js';
import { getColorizedSprite } from '../colorize.js';
import { getColorizedFloorSprite, getFloorPatternCount, hasFloorSprites } from '../floorTiles.js';
import type { FurnitureCategory, LoadedAssetData } from '../layout/furnitureCatalog.js';
import {
  buildDynamicCatalog,
  getActiveCategories,
} from '../layout/furnitureCatalog.js';
import { getCachedSprite } from '../sprites/spriteCache.js';
import type { RoomZone, TileType as TileTypeVal } from '../types.js';
import { EditTool } from '../types.js';
import { getWallSetCount, getWallSetPreviewSprite } from '../wallTiles.js';

interface EditorToolbarProps {
  isEditMode: boolean;
  activeTool: EditTool;
  selectedTileType: TileTypeVal;
  selectedFurnitureType: string;
  selectedFurnitureUid: string | null;
  selectedFurnitureColor: ColorValue | null;
  floorColor: ColorValue;
  wallColor: ColorValue;
  selectedWallSet: number;
  eraserSize: number;
  onToolChange: (tool: EditTool) => void;
  onTileTypeChange: (type: TileTypeVal) => void;
  onFloorColorChange: (color: ColorValue) => void;
  onWallColorChange: (color: ColorValue) => void;
  onWallSetChange: (setIndex: number) => void;
  onSelectedFurnitureColorChange: (color: ColorValue | null) => void;
  onFurnitureTypeChange: (type: string) => void;
  onEraserSizeChange: (size: number) => void;
  loadedAssets?: LoadedAssetData;
  onOpenRooms: () => void;
  onToggleEditMode: () => void;
  isFurnitureLibraryOpen: boolean;
  onToggleFurnitureLibrary: () => void;
  zones?: RoomZone[];
  onAddZone?: (zone: RoomZone) => void;
  onUpdateZone?: (id: string, changes: Partial<RoomZone>) => void;
  onRemoveZone?: (id: string) => void;
}

const DEFAULT_FURNITURE_COLOR: ColorValue = { h: 0, s: 0, b: 0, c: 0 };

const STRIP_WIDTH = 84;
const SUBPANEL_WIDTH = 280;

// ── SVG Icons ────────────────────────────────────────────────────
const S = 26;
const icons = {
  select: (
    <svg width={S} height={S} viewBox="0 0 24 24" fill="currentColor">
      {/* clean cursor arrow */}
      <path d="M5 2L5 17L9 13L12 19.5L14.5 18.5L11.5 12L17 12Z"/>
    </svg>
  ),
  items: (
    <svg width={S} height={S} viewBox="0 0 24 24" fill="currentColor">
      {/* sofa top-down: back bar, two cushions, two armrests */}
      <rect x="2" y="3" width="20" height="4" rx="1"/>
      <rect x="2" y="7" width="4" height="11" rx="1"/>
      <rect x="18" y="7" width="4" height="11" rx="1"/>
      <rect x="6" y="7" width="5" height="11" rx="1"/>
      <rect x="13" y="7" width="5" height="11" rx="1"/>
      <rect x="2" y="18" width="20" height="3" rx="1"/>
    </svg>
  ),
  floor: (
    <svg width={S} height={S} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="2" y="2" width="9" height="9"/>
      <rect x="13" y="2" width="9" height="9"/>
      <rect x="2" y="13" width="9" height="9"/>
      <rect x="13" y="13" width="9" height="9"/>
    </svg>
  ),
  wall: (
    <svg width={S} height={S} viewBox="0 0 24 24" fill="currentColor">
      {/* 3-row brick pattern */}
      <rect x="1" y="2" width="10" height="5"/>
      <rect x="13" y="2" width="10" height="5"/>
      <rect x="1" y="9" width="5" height="5"/>
      <rect x="8" y="9" width="15" height="5"/>
      <rect x="1" y="16" width="10" height="5"/>
      <rect x="13" y="16" width="10" height="5"/>
    </svg>
  ),
  erase: (
    <svg width={S} height={S} viewBox="0 0 24 24" fill="currentColor">
      {/* eraser: parallelogram body + base line */}
      <path d="M5 19L14 6L20 10L11 22H5Z"/>
      <rect x="2" y="20" width="20" height="2"/>
      {/* highlight stripe */}
      <line x1="8.5" y1="19" x2="13" y2="12" stroke="rgba(0,0,0,0.35)" strokeWidth="2"/>
    </svg>
  ),
  fill: (
    <svg width={S} height={S} viewBox="0 0 24 24" fill="currentColor">
      {/* paint bucket */}
      <path d="M6 10H18L16 20H8Z"/>
      <path d="M6 10L8 5H16L18 10" fill="none" stroke="currentColor" strokeWidth="2"/>
      <path d="M10 5L10 3M14 5L14 3M10 3L14 3" fill="none" stroke="currentColor" strokeWidth="1.8"/>
      {/* paint drop */}
      <path d="M20 14 Q22 16 20 18 Q18 16 20 14Z"/>
    </svg>
  ),
  rooms: (
    <svg width={S} height={S} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      {/* floor plan: outer rect, one internal wall with door gap */}
      <rect x="2" y="2" width="20" height="20"/>
      <line x1="12" y1="2" x2="12" y2="14"/>
      <line x1="2" y1="12" x2="12" y2="12"/>
    </svg>
  ),
  zones: (
    <svg width={S} height={S} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="4 2.5">
      <rect x="3" y="3" width="18" height="18"/>
    </svg>
  ),
};

// Icon button for the left strip
function ToolButton({
  label,
  icon,
  active,
  onClick,
  title,
}: {
  label: string;
  icon: React.ReactNode;
  active?: boolean;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title ?? label}
      style={{
        width: 72,
        height: 60,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        background: active ? 'var(--color-accent)' : 'transparent',
        border: active ? '2px solid var(--color-accent-bright)' : '2px solid transparent',
        color: active ? '#fff' : 'rgba(255,255,255,0.55)',
        cursor: 'pointer',
        padding: 0,
        flexShrink: 0,
        transition: 'background 0.1s, color 0.1s',
      }}
      onMouseEnter={(e) => {
        if (!active) {
          (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.08)';
          (e.currentTarget as HTMLButtonElement).style.color = '#fff';
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
          (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.55)';
        }
      }}
    >
      {icon}
      <span style={{ fontSize: 11, lineHeight: 1, letterSpacing: 0 }}>{label}</span>
    </button>
  );
}

export function EditorToolbar({
  isEditMode,
  activeTool,
  selectedTileType,
  selectedFurnitureType,
  selectedFurnitureUid,
  selectedFurnitureColor,
  floorColor,
  wallColor,
  selectedWallSet,
  eraserSize,
  onToolChange,
  onTileTypeChange,
  onFloorColorChange,
  onWallColorChange,
  onWallSetChange,
  onSelectedFurnitureColorChange,
  onEraserSizeChange,
  loadedAssets,
  onOpenRooms,
  onToggleEditMode,
  isFurnitureLibraryOpen,
  onToggleFurnitureLibrary,
  zones = [],
  onUpdateZone,
  onRemoveZone,
}: EditorToolbarProps) {
  const [showFloorColor, setShowFloorColor] = useState(false);
  const [showFurnitureColor, setShowFurnitureColor] = useState(false);
  const [expandedZoneId, setExpandedZoneId] = useState<string | null>(null);

  // Keep track of last non-furniture tool (for back-navigation from furniture pick)
  const [_activeCategory, _setActiveCategory] = useState<FurnitureCategory>('desks');

  useEffect(() => {
    if (loadedAssets) {
      try {
        buildDynamicCatalog(loadedAssets);
        const activeCategories = getActiveCategories();
        if (activeCategories.length > 0) {
          const firstCat = activeCategories[0]?.id;
          if (firstCat) _setActiveCategory(firstCat);
        }
      } catch {
        // ignore
      }
    }
  }, [loadedAssets]);

  const effectiveColor = selectedFurnitureColor ?? DEFAULT_FURNITURE_COLOR;
  const patternCount = getFloorPatternCount();
  const floorPatterns = Array.from({ length: patternCount }, (_, i) => i + 1);

  const isSelectActive = activeTool === EditTool.SELECT;
  const isFloorActive = activeTool === EditTool.TILE_PAINT || activeTool === EditTool.EYEDROPPER;
  const isWallActive = activeTool === EditTool.WALL_PAINT || activeTool === EditTool.WALL_EYEDROPPER;
  const isEraseActive = activeTool === EditTool.ERASE;
  const isBucketActive = activeTool === EditTool.BUCKET;
  const isFurnitureActive =
    activeTool === EditTool.FURNITURE_PLACE || activeTool === EditTool.FURNITURE_PICK;
  const isZoneActive = activeTool === EditTool.ZONE_EDIT;

  const hasSubPanel =
    isFloorActive || isWallActive || isEraseActive || isZoneActive ||
    (isSelectActive && !!selectedFurnitureUid) ||
    (isFurnitureActive && !!selectedFurnitureUid);

  const subPanelStyle: React.CSSProperties = {
    position: 'fixed',
    left: STRIP_WIDTH,
    top: 0,
    bottom: 0,
    width: SUBPANEL_WIDTH,
    zIndex: 20,
    background: 'var(--color-bg)',
    borderRight: '2px solid var(--color-border)',
    boxShadow: '2px 2px 0px #0a0a14',
    display: 'flex',
    flexDirection: 'column',
    padding: 12,
    gap: 8,
    overflowY: 'auto',
  };

  return (
    <>
      {/* ── Left icon strip ─────────────────────────────────────────── */}
      <div
        style={{
          position: 'fixed',
          left: 0,
          top: 0,
          bottom: 0,
          width: STRIP_WIDTH,
          zIndex: 21,
          background: 'var(--color-bg)',
          borderRight: '2px solid var(--color-border)',
          boxShadow: '2px 2px 0px #0a0a14',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          paddingTop: 8,
          paddingBottom: 8,
          gap: 2,
        }}
      >
        <ToolButton icon={icons.select} label="Select" active={isSelectActive} onClick={() => onToolChange(EditTool.SELECT)} title="Select / move furniture" />
        <ToolButton icon={icons.items} label="Items" active={isFurnitureActive || isFurnitureLibraryOpen} onClick={onToggleFurnitureLibrary} title="Furniture library" />
        <ToolButton icon={icons.floor} label="Floor" active={isFloorActive} onClick={() => onToolChange(EditTool.TILE_PAINT)} title="Paint floor tiles" />
        <ToolButton icon={icons.wall} label="Wall" active={isWallActive} onClick={() => onToolChange(EditTool.WALL_PAINT)} title="Paint walls" />
        <ToolButton icon={icons.erase} label="Erase" active={isEraseActive} onClick={() => onToolChange(EditTool.ERASE)} title="Erase tiles to void" />
        <ToolButton icon={icons.fill} label="Fill" active={isBucketActive} onClick={() => onToolChange(EditTool.BUCKET)} title="Bucket fill" />
        <ToolButton icon={icons.rooms} label="Rooms" active={false} onClick={onOpenRooms} title="Apply premade room" />
        <ToolButton icon={icons.zones} label="Zones" active={isZoneActive} onClick={() => onToolChange(EditTool.ZONE_EDIT)} title="Draw room zones" />

        {/* Spacer */}
        <div style={{ flex: 1 }} />
      </div>

      {/* ── Sub-panels (only when in edit mode) ─────────────────────── */}
      {/* ── Floor sub-panel ─────────────────────────────────────────── */}
      {isEditMode && isFloorActive && (
        <div style={subPanelStyle}>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 600, marginBottom: 4 }}>
            Floor Tiles
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <Button
              variant={showFloorColor ? 'active' : 'default'}
              size="sm"
              onClick={() => setShowFloorColor((v) => !v)}
            >
              Color
            </Button>
            <Button
              variant={activeTool === EditTool.EYEDROPPER ? 'active' : 'ghost'}
              size="sm"
              onClick={() => onToolChange(EditTool.EYEDROPPER)}
              title="Pick floor pattern + color from tile"
            >
              Pick
            </Button>
          </div>
          {showFloorColor && <ColorPicker value={floorColor} onChange={onFloorColorChange} colorize />}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {floorPatterns.map((patIdx) => (
              <ItemSelect
                key={patIdx}
                width={36}
                height={36}
                selected={selectedTileType === patIdx}
                onClick={() => onTileTypeChange(patIdx as TileTypeVal)}
                title={`Floor ${patIdx}`}
                deps={[patIdx, floorColor]}
                draw={(ctx, w, h) => {
                  if (!hasFloorSprites()) {
                    ctx.fillStyle = CANVAS_FALLBACK_TILE_COLOR;
                    ctx.fillRect(0, 0, w, h);
                    return;
                  }
                  const sprite = getColorizedFloorSprite(patIdx, floorColor);
                  ctx.drawImage(getCachedSprite(sprite, 2), 0, 0);
                }}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Wall sub-panel ─────────────────────────────────────────── */}
      {isEditMode && isWallActive && (
        <div style={subPanelStyle}>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 600, marginBottom: 4 }}>
            Wall Tiles
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
            <Button
              variant={activeTool === EditTool.WALL_EYEDROPPER ? 'active' : 'default'}
              size="sm"
              onClick={() => onToolChange(EditTool.WALL_EYEDROPPER)}
              title="Pick wall color from an existing wall tile"
            >
              Pick
            </Button>
          </div>
          <ColorPicker value={wallColor} onChange={onWallColorChange} colorize />
          {getWallSetCount() > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {Array.from({ length: getWallSetCount() }, (_, i) => (
                <ItemSelect
                  key={i}
                  width={48}
                  height={96}
                  selected={selectedWallSet === i}
                  onClick={() => onWallSetChange(i)}
                  title={`Wall ${i + 1}`}
                  deps={[i, wallColor]}
                  draw={(ctx, w, h) => {
                    const sprite = getWallSetPreviewSprite(i);
                    if (!sprite) {
                      ctx.fillStyle = CANVAS_FALLBACK_TILE_COLOR;
                      ctx.fillRect(0, 0, w, h);
                      return;
                    }
                    const cacheKey = `wall-preview-${i}-${wallColor.h}-${wallColor.s}-${wallColor.b}-${wallColor.c}`;
                    const colorized = getColorizedSprite(cacheKey, sprite, { ...wallColor, colorize: true });
                    ctx.drawImage(getCachedSprite(colorized, 3), 0, 0);
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Erase sub-panel ────────────────────────────────────────── */}
      {isEditMode && isEraseActive && (
        <div style={subPanelStyle}>
          <div style={{ fontSize: 13, color: 'var(--color-text-muted)', fontWeight: 600, marginBottom: 8 }}>
            Eraser Size
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                onClick={() => onEraserSizeChange(n)}
                title={`${n}×${n} tiles`}
                style={{
                  width: 48,
                  height: 48,
                  background: eraserSize === n ? 'var(--color-accent)' : 'var(--color-bg-dark)',
                  border: `2px solid ${eraserSize === n ? 'var(--color-accent)' : 'var(--color-border)'}`,
                  color: eraserSize === n ? '#fff' : 'var(--color-text-muted)',
                  cursor: 'pointer',
                  fontSize: 20,
                  fontWeight: 700,
                }}
              >
                {n}
              </button>
            ))}
          </div>
          <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 8 }}>
            Erases a {eraserSize}×{eraserSize} tile area
          </div>
        </div>
      )}

      {/* ── Zones sub-panel ────────────────────────────────────────── */}
      {isEditMode && isZoneActive && (
        <div style={subPanelStyle}>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 600, marginBottom: 4 }}>
            Room Zones
          </div>
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 4 }}>
            Drag on canvas to create a zone. Click an existing zone to select and move/resize it.
          </div>
          {zones.length === 0 && (
            <div style={{ fontSize: 13, color: 'var(--color-text-muted)', padding: '4px 0' }}>
              No zones yet.
            </div>
          )}
          {zones.map((zone) => (
            <div
              key={zone.id}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                padding: '4px 6px',
                border: `1px solid ${zone.color}44`,
                background: `${zone.color}18`,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button
                  onClick={() => {
                    const presets = ['#4a9eff', '#57a55a', '#e06c2e', '#a857d4', '#e6c040', '#57c4c8'];
                    const idx = presets.indexOf(zone.color);
                    const next = presets[(idx + 1) % presets.length] ?? presets[0] ?? '#4a9eff';
                    onUpdateZone?.(zone.id, { color: next });
                  }}
                  style={{
                    width: 16,
                    height: 16,
                    background: zone.color,
                    border: '1px solid var(--color-border)',
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
                  title="Click to change color"
                />
                <input
                  value={zone.name}
                  onChange={(e) => onUpdateZone?.(zone.id, { name: e.target.value })}
                  style={{
                    flex: 1,
                    background: 'transparent',
                    border: 'none',
                    borderBottom: '1px solid var(--color-border)',
                    color: 'var(--color-text)',
                    fontSize: 13,
                    padding: '1px 2px',
                    outline: 'none',
                    minWidth: 0,
                  }}
                />
                <button
                  onClick={() => setExpandedZoneId((prev) => (prev === zone.id ? null : zone.id))}
                  style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: 11, padding: '0 2px', flexShrink: 0 }}
                  title="Edit description"
                >
                  {expandedZoneId === zone.id ? '▲' : '▼'}
                </button>
                <button
                  onClick={() => onRemoveZone?.(zone.id)}
                  style={{ background: 'none', border: 'none', color: 'var(--color-status-permission)', cursor: 'pointer', fontSize: 13, padding: '0 2px', flexShrink: 0 }}
                  title="Delete zone"
                >
                  ✕
                </button>
              </div>
              {expandedZoneId === zone.id && (
                <textarea
                  value={zone.description ?? ''}
                  onChange={(e) => onUpdateZone?.(zone.id, { description: e.target.value })}
                  placeholder="Describe this zone's purpose…"
                  rows={2}
                  style={{
                    width: '100%',
                    background: 'transparent',
                    border: '1px solid var(--color-border)',
                    color: 'var(--color-text)',
                    fontSize: 12,
                    padding: '3px 6px',
                    outline: 'none',
                    resize: 'vertical',
                    boxSizing: 'border-box',
                  }}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Selected furniture color sub-panel ──────────────────────── */}
      {isEditMode && selectedFurnitureUid && isFurnitureActive && !isFloorActive && !isWallActive && !isEraseActive && !isZoneActive && (
        <div style={subPanelStyle}>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 600, marginBottom: 4 }}>
            Furniture Color
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <Button
              variant={showFurnitureColor ? 'active' : 'default'}
              size="sm"
              onClick={() => setShowFurnitureColor((v) => !v)}
            >
              Color
            </Button>
            {selectedFurnitureColor && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onSelectedFurnitureColorChange(null)}
                title="Remove color"
              >
                Clear
              </Button>
            )}
          </div>
          {showFurnitureColor && (
            <ColorPicker value={effectiveColor} onChange={onSelectedFurnitureColorChange} showColorizeToggle />
          )}
        </div>
      )}
    </>
  );
}
