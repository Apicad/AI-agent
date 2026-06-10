import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { LoadedAssetData } from '../office/layout/furnitureCatalog.js';
import {
  buildDynamicCatalog,
  getCatalogByCategory,
  getActiveCategories,
} from '../office/layout/furnitureCatalog.js';
import { getCachedSprite } from '../office/sprites/spriteCache.js';
import type { SpriteData } from '../office/types.js';
import { vscode } from '../vscodeApi.js';

const PANEL_LEFT = 84;
const PANEL_WIDTH = 420;
const SPRITE_ZOOM = 3;
const TILE_PX = 16 * SPRITE_ZOOM; // 48px per tile
const DELETED_STORAGE_KEY = 'pixel-agents.furniture-deleted-types';

function loadDeleted(): Set<string> {
  try {
    const raw = localStorage.getItem(DELETED_STORAGE_KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch {
    return new Set();
  }
}

function saveDeleted(set: Set<string>) {
  localStorage.setItem(DELETED_STORAGE_KEY, JSON.stringify([...set]));
}

interface FurnitureLibraryPanelProps {
  isOpen: boolean;
  onClose: () => void;
  loadedAssets: LoadedAssetData | undefined;
  selectedFurnitureType: string;
  onSelectFurniture: (type: string) => void;
  externalAssetDirectories: string[];
  onActivatePick?: () => void;
  isPickActive?: boolean;
}

// Fixed thumbnail box — all cards the same size regardless of footprint
const THUMB_H = 110;

// ── Sprite thumbnail ─────────────────────────────────────────────────────────

function SpriteThumb({ sprite }: { sprite: SpriteData }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !sprite?.length) return;
    const spriteW = (sprite[0]?.length ?? 0) * SPRITE_ZOOM;
    const spriteH = sprite.length * SPRITE_ZOOM;
    canvas.width = spriteW;
    canvas.height = spriteH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(getCachedSprite(sprite, SPRITE_ZOOM), 0, 0);
  }, [sprite]);

  return (
    <div
      style={{
        width: '100%',
        height: THUMB_H,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      <canvas
        ref={canvasRef}
        style={{ imageRendering: 'pixelated', maxWidth: '100%', maxHeight: '100%' }}
      />
    </div>
  );
}

// ── Item card ────────────────────────────────────────────────────────────────

function FurnitureCard({
  type,
  label,
  sprite,
  selected,
  onClick,
  onHide,
}: {
  type: string;
  label: string;
  sprite: SpriteData;
  selected: boolean;
  onClick: () => void;
  onHide: (type: string) => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onClick={onClick}
      title={label}
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: 4,
        padding: '6px 4px 6px',
        border: selected ? '2px solid var(--color-accent)' : '2px solid var(--color-border)',
        background: selected ? 'rgba(96,48,255,0.25)' : hovered ? '#2a2a4a' : 'var(--color-bg-dark)',
        cursor: 'pointer',
        height: THUMB_H + 36,
        width: '100%',
        boxSizing: 'border-box',
        transition: 'border-color 0.1s, background 0.1s',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Delete button — appears on hover */}
      {hovered && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onHide(type);
          }}
          title="Hide from library"
          style={{
            position: 'absolute',
            top: 3,
            right: 3,
            width: 18,
            height: 18,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--color-danger, #d14249)',
            border: 'none',
            color: '#fff',
            cursor: 'pointer',
            fontSize: 11,
            lineHeight: 1,
            padding: 0,
            zIndex: 1,
          }}
        >
          ✕
        </button>
      )}
      <SpriteThumb sprite={sprite} />
      <span
        style={{
          fontSize: 11,
          color: 'var(--color-text-muted)',
          textAlign: 'center',
          lineHeight: 1.3,
          maxWidth: '100%',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          width: '100%',
          paddingInline: 2,
        }}
      >
        {label}
      </span>
    </div>
  );
}

// ── Panel ────────────────────────────────────────────────────────────────────

export function FurnitureLibraryPanel({
  isOpen,
  onClose,
  loadedAssets,
  selectedFurnitureType,
  onSelectFurniture,
  externalAssetDirectories,
  onActivatePick,
  isPickActive = false,
}: FurnitureLibraryPanelProps) {
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('All');
  const [catalogReady, setCatalogReady] = useState(false);
  const [deletedTypes, setDeletedTypes] = useState<Set<string>>(() => loadDeleted());

  // Re-build catalog when assets change
  useEffect(() => {
    if (loadedAssets) {
      buildDynamicCatalog(loadedAssets);
      setCatalogReady(true);
    }
  }, [loadedAssets]);

  const categories = useMemo(() => {
    if (!catalogReady) return [];
    return getActiveCategories();
  }, [catalogReady]);

  const items = useMemo(() => {
    if (!catalogReady) return [];
    let list =
      activeCategory === 'All'
        ? categories.flatMap((c) => getCatalogByCategory(c.id))
        : getCatalogByCategory(activeCategory as Parameters<typeof getCatalogByCategory>[0]);

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((e) => e.label.toLowerCase().includes(q) || e.type.toLowerCase().includes(q));
    }

    list = list.filter((e) => !deletedTypes.has(e.type));

    return list;
  }, [catalogReady, activeCategory, categories, search, deletedTypes]);

  const handleDelete = useCallback((type: string) => {
    setDeletedTypes((prev) => {
      const next = new Set(prev);
      next.add(type);
      saveDeleted(next);
      return next;
    });
    fetch(`/api/admin/furniture/${encodeURIComponent(type)}`, { method: 'DELETE' })
      .then((r) => r.json())
      .then((data: { ok: boolean }) => {
        if (data.ok) {
          vscode.postMessage({ type: 'reloadFurnitureAssets' });
        }
      })
      .catch(() => {});
  }, []);

  const handleAddPack = useCallback(() => {
    vscode.postMessage({ type: 'addExternalAssetDirectory' });
  }, []);

  const handleRemovePack = useCallback((path: string) => {
    vscode.postMessage({ type: 'removeExternalAssetDirectory', path });
  }, []);

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        left: PANEL_LEFT,
        top: 0,
        bottom: 0,
        width: PANEL_WIDTH,
        zIndex: 20,
        background: 'var(--color-bg)',
        borderRight: '2px solid var(--color-border)',
        boxShadow: '2px 2px 0px #0a0a14',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 12px',
          borderBottom: '2px solid var(--color-border)',
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text)' }}>
          Furniture Library
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {onActivatePick && (
            <button
              onClick={onActivatePick}
              title="Pick item + color from a placed furniture on canvas"
              style={{
                padding: '4px 10px',
                fontSize: 12,
                background: isPickActive ? 'var(--color-accent)' : 'transparent',
                border: `2px solid ${isPickActive ? 'var(--color-accent)' : 'var(--color-border)'}`,
                color: isPickActive ? '#fff' : 'var(--color-text-muted)',
                cursor: 'pointer',
              }}
            >
              Pick
            </button>
          )}
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--color-text-muted)',
              cursor: 'pointer',
              fontSize: 16,
              padding: '0 2px',
              lineHeight: 1,
            }}
            title="Close"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Search */}
      <div style={{ padding: '8px 10px', flexShrink: 0, borderBottom: '1px solid var(--color-border)' }}>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search..."
          style={{
            width: '100%',
            boxSizing: 'border-box',
            background: '#2a2a3e',
            border: '2px solid var(--color-border)',
            color: 'var(--color-text)',
            fontSize: 13,
            padding: '5px 8px',
            outline: 'none',
          }}
        />
      </div>

      {/* Category tabs */}
      <div
        style={{
          display: 'flex',
          gap: 3,
          padding: '6px 8px',
          flexShrink: 0,
          borderBottom: '2px solid var(--color-border)',
          flexWrap: 'wrap',
        }}
      >
        {(['All', ...categories.map((c) => c.id)] as string[]).map((cat) => {
          const label = cat === 'All' ? 'All' : (categories.find((c) => c.id === cat)?.label ?? cat);
          const isActive = activeCategory === cat;
          return (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              style={{
                padding: '5px 12px',
                fontSize: 13,
                border: isActive ? '2px solid var(--color-accent)' : '2px solid var(--color-border)',
                background: isActive ? 'var(--color-accent)' : 'transparent',
                color: isActive ? '#fff' : 'var(--color-text-muted)',
                cursor: 'pointer',
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Sprite grid */}
      <div
        className="no-scrollbar"
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: 8,
        }}
      >
        {!catalogReady ? (
          <div style={{ color: 'var(--color-text-muted)', fontSize: 13, padding: 8, textAlign: 'center' }}>
            Loading assets...
          </div>
        ) : items.length === 0 ? (
          <div style={{ color: 'var(--color-text-muted)', fontSize: 13, padding: 8, textAlign: 'center' }}>
            No items found.
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: 6,
            }}
          >
            {items.map((entry) => (
              <FurnitureCard
                key={entry.type}
                type={entry.type}
                label={entry.label}
                sprite={entry.sprite}
                selected={selectedFurnitureType === entry.type}
                onClick={() => onSelectFurniture(entry.type)}
                onHide={handleDelete}
              />
            ))}
          </div>
        )}
      </div>

      {/* Footer: import + external packs */}
      <div
        style={{
          flexShrink: 0,
          borderTop: '2px solid var(--color-border)',
          padding: '8px 10px',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
        }}
      >
        <button
          onClick={handleAddPack}
          style={{
            width: '100%',
            padding: '6px 0',
            fontSize: 12,
            background: 'transparent',
            border: '2px solid var(--color-accent)',
            color: 'var(--color-accent)',
            cursor: 'pointer',
          }}
        >
          + Import Asset Pack
        </button>
        {externalAssetDirectories.map((dir) => {
          const name = dir.split('/').pop() ?? dir;
          return (
            <div
              key={dir}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 11,
                color: 'var(--color-text-muted)',
              }}
            >
              <span
                style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                title={dir}
              >
                {name}
              </span>
              <button
                onClick={() => handleRemovePack(dir)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--color-text-muted)',
                  cursor: 'pointer',
                  fontSize: 13,
                  padding: 0,
                  lineHeight: 1,
                  flexShrink: 0,
                }}
                title={`Remove ${name}`}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
