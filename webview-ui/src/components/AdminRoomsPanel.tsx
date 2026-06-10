import { useCallback, useEffect, useState } from 'react';

import type { OfficeLayout } from '../office/types.js';
import type { RoomTemplate } from '../hooks/useExtensionMessages.js';

// ── Types ────────────────────────────────────────────────────────────────────

interface InventorySprite {
  id: string;
  dataUrl: string;
  width: number;
  height: number;
  alreadyImported: boolean;
}

interface AdminRoomsPanelProps {
  rooms: RoomTemplate[];
  onClose: () => void;
  onLoadRoom: (layout: OfficeLayout) => void;
  onGetCurrentLayout: () => OfficeLayout;
  onSaveRooms: (rooms: RoomTemplate[]) => void;
}

const FURNITURE_CATEGORIES = ['desks', 'chairs', 'decor', 'storage', 'electronics', 'misc', 'wall'];

// ── Rooms Tab ────────────────────────────────────────────────────────────────

function RoomsTab({
  rooms,
  onLoadRoom,
  onGetCurrentLayout,
  onSaveRooms,
}: {
  rooms: RoomTemplate[];
  onLoadRoom: (layout: OfficeLayout) => void;
  onGetCurrentLayout: () => OfficeLayout;
  onSaveRooms: (rooms: RoomTemplate[]) => void;
}) {
  const [localRooms, setLocalRooms] = useState<RoomTemplate[]>(rooms);
  const [renamingIdx, setRenamingIdx] = useState<number | null>(null);
  const [renameVal, setRenameVal] = useState('');
  const [saveMsg, setSaveMsg] = useState('');

  useEffect(() => { setLocalRooms(rooms); }, [rooms]);

  const save = useCallback((updated: RoomTemplate[]) => {
    setLocalRooms(updated);
    onSaveRooms(updated);
    setSaveMsg('Saved!');
    setTimeout(() => setSaveMsg(''), 1500);
  }, [onSaveRooms]);

  const handleSaveAsDefault = useCallback(() => {
    const layout = onGetCurrentLayout();
    fetch('/api/admin/save-default-layout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ layout }),
    })
      .then((r) => r.json())
      .then((data: { ok: boolean }) => {
        setSaveMsg(data.ok ? 'Saved as default!' : 'Save failed');
        setTimeout(() => setSaveMsg(''), 2000);
      })
      .catch(() => {
        setSaveMsg('Save failed');
        setTimeout(() => setSaveMsg(''), 2000);
      });
  }, [onGetCurrentLayout]);

  const handleLoad = useCallback((room: RoomTemplate) => {
    onLoadRoom(room as unknown as OfficeLayout);
  }, [onLoadRoom]);

  const handleSaveCurrentHere = useCallback((idx: number) => {
    const layout = onGetCurrentLayout();
    const updated = localRooms.map((r, i) =>
      i === idx
        ? { ...r, cols: layout.cols, rows: layout.rows, tiles: layout.tiles as number[], furniture: layout.furniture, tileColors: (layout.tileColors ?? []) as (unknown | null)[] }
        : r
    );
    save(updated);
  }, [localRooms, onGetCurrentLayout, save]);

  const handleNew = useCallback(() => {
    const name = window.prompt('Room name:');
    if (!name?.trim()) return;
    const layout = onGetCurrentLayout();
    const newRoom: RoomTemplate = {
      name: name.trim(), version: 1,
      cols: layout.cols, rows: layout.rows,
      tiles: layout.tiles as number[],
      furniture: layout.furniture,
      tileColors: (layout.tileColors ?? []) as (unknown | null)[],
    };
    save([...localRooms, newRoom]);
  }, [localRooms, onGetCurrentLayout, save]);

  const handleDelete = useCallback((idx: number) => {
    if (!window.confirm(`Delete "${localRooms[idx].name}"?`)) return;
    save(localRooms.filter((_, i) => i !== idx));
  }, [localRooms, save]);

  const handleMove = useCallback((idx: number, dir: -1 | 1) => {
    const next = idx + dir;
    if (next < 0 || next >= localRooms.length) return;
    const updated = [...localRooms];
    [updated[idx], updated[next]] = [updated[next], updated[idx]];
    save(updated);
  }, [localRooms, save]);

  const handleRenameStart = useCallback((idx: number) => {
    setRenamingIdx(idx);
    setRenameVal(localRooms[idx].name);
  }, [localRooms]);

  const handleRenameCommit = useCallback(() => {
    if (renamingIdx === null) return;
    const updated = localRooms.map((r, i) => i === renamingIdx ? { ...r, name: renameVal.trim() || r.name } : r);
    setRenamingIdx(null);
    save(updated);
  }, [renamingIdx, renameVal, localRooms, save]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1, overflowY: 'auto' }}>
      {/* Save as Default Layout */}
      <div style={{ borderBottom: '2px solid var(--color-border)', paddingBottom: 10, marginBottom: 2 }}>
        <button
          type="button"
          onClick={handleSaveAsDefault}
          style={{ width: '100%', fontSize: 15, padding: '8px 0', background: '#2a4a2a', color: '#8fbc8f', border: '2px solid #4a7a4a', cursor: 'pointer' }}
        >
          📌 Save Current Canvas as Default Layout
        </button>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color: 'var(--color-text-muted)', fontSize: 15 }}>
          {localRooms.length} premade room{localRooms.length !== 1 ? 's' : ''}
        </span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {saveMsg && <span style={{ color: 'var(--color-accent)', fontSize: 15 }}>{saveMsg}</span>}
          <button
            type="button"
            onClick={handleNew}
            style={{ fontSize: 15, padding: '6px 14px', background: 'var(--color-accent)', color: 'var(--color-bg)', border: '2px solid var(--color-accent)', cursor: 'pointer' }}
          >
            + New from Canvas
          </button>
        </div>
      </div>

      {localRooms.map((room, idx) => (
        <div
          key={idx}
          style={{ border: '2px solid var(--color-border)', padding: '12px 14px', background: 'var(--color-bg)', display: 'flex', flexDirection: 'column', gap: 10 }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {renamingIdx === idx ? (
              <input
                autoFocus
                value={renameVal}
                onChange={e => setRenameVal(e.target.value)}
                onBlur={handleRenameCommit}
                onKeyDown={e => { if (e.key === 'Enter') handleRenameCommit(); if (e.key === 'Escape') setRenamingIdx(null); }}
                style={{ flex: 1, fontSize: 18, fontWeight: 'bold', background: 'var(--color-bg)', color: 'var(--color-text)', border: '1px solid var(--color-accent)', padding: '3px 6px' }}
              />
            ) : (
              <span
                style={{ flex: 1, fontSize: 18, fontWeight: 'bold', color: 'var(--color-text)', cursor: 'text' }}
                onDoubleClick={() => handleRenameStart(idx)}
                title="Double-click to rename"
              >
                {room.name}
              </span>
            )}
            <span style={{ fontSize: 14, color: 'var(--color-text-muted)' }}>
              {room.cols}×{room.rows}
            </span>
          </div>

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button type="button" onClick={() => handleLoad(room)} style={btnStyle('var(--color-accent)')}>Load</button>
            <button type="button" onClick={() => handleSaveCurrentHere(idx)} style={btnStyle('#6a8a6a')}>Save Canvas Here</button>
            <button type="button" onClick={() => handleRenameStart(idx)} style={btnStyle('var(--color-text-muted)')}>Rename</button>
            <button type="button" onClick={() => handleMove(idx, -1)} disabled={idx === 0} style={btnStyle('var(--color-text-muted)')}>▲</button>
            <button type="button" onClick={() => handleMove(idx, 1)} disabled={idx === localRooms.length - 1} style={btnStyle('var(--color-text-muted)')}>▼</button>
            <button type="button" onClick={() => handleDelete(idx)} style={btnStyle('#a06060')}>Delete</button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Import Tab ───────────────────────────────────────────────────────────────

function ImportTab() {
  const [sprites, setSprites] = useState<InventorySprite[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<InventorySprite | null>(null);
  const [editName, setEditName] = useState('');
  const [editCategory, setEditCategory] = useState('decor');
  const [editFootprintW, setEditFootprintW] = useState(1);
  const [editFootprintH, setEditFootprintH] = useState(1);
  const [editWall, setEditWall] = useState(false);
  const [editSurface, setEditSurface] = useState(false);
  const [editIsFloor, setEditIsFloor] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState('');

  const loadInventory = useCallback(() => {
    setLoading(true);
    fetch('/api/admin/inventory')
      .then(r => r.json())
      .then((data: { sources: InventorySprite[] }) => { setSprites(data.sources); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const handleSelect = useCallback((sprite: InventorySprite) => {
    setSelected(sprite);
    // Auto-suggest name from ID
    const suggested = sprite.id
      .replace(/^Sprite-\d+$/, '')
      .replace(/^tiles_r\d+_c\d+$/, 'Floor Tile')
      .replace(/_/g, ' ')
      .trim() || sprite.id;
    setEditName(suggested);
    // Auto-suggest footprint from pixel dimensions
    const fw = Math.max(1, Math.round(sprite.width / 16));
    const fh = Math.max(1, Math.round(sprite.height / 16));
    setEditFootprintW(fw);
    setEditFootprintH(fh);
    setEditIsFloor(sprite.id.startsWith('tiles_'));
    setEditWall(false);
    setEditSurface(false);
    setEditCategory('decor');
    setImportMsg('');
  }, []);

  const handleImport = useCallback(() => {
    if (!selected || !editName.trim()) return;
    setImporting(true);
    fetch('/api/admin/import-sprite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceId: selected.id,
        dataUrl: selected.dataUrl,
        name: editName.trim(),
        category: editIsFloor ? 'floor' : editCategory,
        footprintW: editFootprintW,
        footprintH: editFootprintH,
        canPlaceOnWalls: editWall,
        canPlaceOnSurfaces: editSurface,
        isFloor: editIsFloor,
      }),
    })
      .then(r => r.json())
      .then((data: { ok: boolean; id?: string; error?: string }) => {
        setImporting(false);
        if (data.ok) {
          setImportMsg(`Imported as ${data.id ?? editName}!`);
          setSprites(prev => prev.map(s => s.id === selected.id ? { ...s, alreadyImported: true } : s));
          setSelected(prev => prev ? { ...prev, alreadyImported: true } : prev);
        } else {
          setImportMsg(`Error: ${data.error ?? 'unknown'}`);
        }
      })
      .catch(err => { setImporting(false); setImportMsg(`Error: ${String(err)}`); });
  }, [selected, editName, editCategory, editFootprintW, editFootprintH, editWall, editSurface, editIsFloor]);

  return (
    <div style={{ display: 'flex', flex: 1, gap: 10, overflow: 'hidden', minHeight: 0 }}>
      {/* Left: sprite grid */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={loadInventory}
            style={{ fontSize: 13, padding: '3px 10px', background: 'var(--color-accent)', color: 'var(--color-bg)', border: '2px solid var(--color-accent)', cursor: 'pointer' }}
          >
            {loading ? 'Loading…' : sprites.length ? 'Refresh' : 'Load Sprites'}
          </button>
          {sprites.length > 0 && (
            <span style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>
              {sprites.length} sprites · {sprites.filter(s => s.alreadyImported).length} imported
            </span>
          )}
        </div>

        <div style={{
          flex: 1, overflowY: 'auto',
          display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(64px, 1fr))', gap: 6,
          alignContent: 'start',
        }}>
          {sprites.map(sprite => (
            <div
              key={sprite.id}
              onClick={() => handleSelect(sprite)}
              title={sprite.id}
              style={{
                border: `2px solid ${selected?.id === sprite.id ? 'var(--color-accent)' : 'var(--color-border)'}`,
                padding: 4, cursor: 'pointer', position: 'relative',
                background: selected?.id === sprite.id ? 'rgba(100,180,100,0.1)' : 'var(--color-bg)',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                opacity: sprite.alreadyImported ? 0.45 : 1,
              }}
            >
              <img
                src={sprite.dataUrl}
                alt={sprite.id}
                style={{ width: 48, height: 48, objectFit: 'contain', imageRendering: 'pixelated' }}
              />
              {sprite.alreadyImported && (
                <span style={{ position: 'absolute', top: 2, right: 4, fontSize: 12, color: 'var(--color-accent)' }}>✓</span>
              )}
              <span style={{ fontSize: 10, color: 'var(--color-text-muted)', textAlign: 'center', wordBreak: 'break-all' }}>
                {sprite.id.replace('Sprite-', '#').replace(/tiles_r(\d+)_c(\d+)/, 'T$1,$2')}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Right: edit form */}
      {selected && (
        <div style={{ width: 180, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto' }}>
          <img
            src={selected.dataUrl}
            alt={selected.id}
            style={{ width: 64, height: 64, objectFit: 'contain', imageRendering: 'pixelated', border: '2px solid var(--color-border)', alignSelf: 'center' }}
          />
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', textAlign: 'center' }}>
            {selected.width}×{selected.height}px
          </div>

          <label style={labelStyle}>
            Name
            <input
              value={editName}
              onChange={e => setEditName(e.target.value)}
              style={inputStyle}
            />
          </label>

          <label style={{ ...labelStyle, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={editIsFloor} onChange={e => setEditIsFloor(e.target.checked)} />
            Floor tile
          </label>

          {!editIsFloor && (
            <>
              <label style={labelStyle}>
                Category
                <select value={editCategory} onChange={e => setEditCategory(e.target.value)} style={inputStyle}>
                  {FURNITURE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>

              <div style={{ display: 'flex', gap: 6 }}>
                <label style={{ ...labelStyle, flex: 1 }}>
                  W (tiles)
                  <input type="number" min={1} max={8} value={editFootprintW} onChange={e => setEditFootprintW(Math.max(1, parseInt(e.target.value) || 1))} style={inputStyle} />
                </label>
                <label style={{ ...labelStyle, flex: 1 }}>
                  H (tiles)
                  <input type="number" min={1} max={8} value={editFootprintH} onChange={e => setEditFootprintH(Math.max(1, parseInt(e.target.value) || 1))} style={inputStyle} />
                </label>
              </div>

              <label style={{ ...labelStyle, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <input type="checkbox" checked={editWall} onChange={e => setEditWall(e.target.checked)} />
                Wall-mounted
              </label>

              <label style={{ ...labelStyle, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <input type="checkbox" checked={editSurface} onChange={e => setEditSurface(e.target.checked)} />
                Surface item
              </label>
            </>
          )}

          {importMsg && (
            <div style={{ fontSize: 12, color: importMsg.startsWith('Error') ? '#c06060' : 'var(--color-accent)', padding: '4px 6px', border: '1px solid currentColor' }}>
              {importMsg}
            </div>
          )}

          <button
            onClick={handleImport}
            disabled={importing || !editName.trim() || selected.alreadyImported}
            style={{
              padding: '6px 0', fontSize: 14, cursor: importing || selected.alreadyImported ? 'default' : 'pointer',
              background: selected.alreadyImported ? 'var(--color-border)' : 'var(--color-accent)',
              color: 'var(--color-bg)', border: '2px solid var(--color-accent)', opacity: importing ? 0.6 : 1,
            }}
          >
            {importing ? 'Importing…' : selected.alreadyImported ? 'Already Imported' : 'Import This'}
          </button>

          <div style={{ fontSize: 11, color: 'var(--color-text-muted)', lineHeight: 1.4 }}>
            Restart server after importing to see new assets in the editor.
          </div>
        </div>
      )}
    </div>
  );
}

// ── Shared styles ────────────────────────────────────────────────────────────

function btnStyle(color: string): React.CSSProperties {
  return {
    fontSize: 14, padding: '5px 12px', cursor: 'pointer',
    background: 'var(--color-bg)', color, border: `2px solid ${color}`,
  };
}

const labelStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 3,
  fontSize: 13, color: 'var(--color-text)',
};

const inputStyle: React.CSSProperties = {
  fontSize: 13, padding: '3px 6px',
  background: 'var(--color-bg)', color: 'var(--color-text)',
  border: '1.5px solid var(--color-border)', width: '100%', boxSizing: 'border-box',
};

// ── Main panel ───────────────────────────────────────────────────────────────

export function AdminRoomsPanel({
  rooms,
  onClose,
  onLoadRoom,
  onGetCurrentLayout,
  onSaveRooms,
}: AdminRoomsPanelProps) {
  const [activeTab, setActiveTab] = useState<'rooms' | 'import'>('rooms');

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: '8px 18px', fontSize: 16, cursor: 'pointer', border: 'none',
    background: active ? 'var(--color-accent)' : 'var(--color-bg)',
    color: active ? 'var(--color-bg)' : 'var(--color-text)',
    borderBottom: active ? '2px solid var(--color-accent)' : '2px solid var(--color-border)',
  });

  return (
    <div
      style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 55,
        width: 480, maxWidth: 'calc(100vw - 60px)',
        background: 'var(--color-bg)', borderLeft: '2px solid var(--color-border)',
        display: 'flex', flexDirection: 'column', boxShadow: '-4px 0 16px rgba(0,0,0,0.4)',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '2px solid var(--color-border)', flexShrink: 0 }}>
        <span style={{ fontSize: 22, fontWeight: 'bold', color: 'var(--color-text)' }}>Admin</span>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: 18, padding: '0 4px' }}
        >
          ✕
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '2px solid var(--color-border)', flexShrink: 0 }}>
        <button style={tabStyle(activeTab === 'rooms')} onClick={() => setActiveTab('rooms')}>Rooms</button>
        <button style={tabStyle(activeTab === 'import')} onClick={() => setActiveTab('import')}>Import</button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, padding: 14, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
        {activeTab === 'rooms' ? (
          <RoomsTab
            rooms={rooms}
            onLoadRoom={onLoadRoom}
            onGetCurrentLayout={onGetCurrentLayout}
            onSaveRooms={onSaveRooms}
          />
        ) : (
          <ImportTab />
        )}
      </div>
    </div>
  );
}
