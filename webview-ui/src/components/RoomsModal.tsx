import { useCallback, useEffect, useState } from 'react';

import type { OfficeLayout } from '../office/types.js';

interface RoomTemplate {
  name: string;
  cols: number;
  rows: number;
  tiles: number[];
  furniture: unknown[];
  tileColors: (unknown | null)[];
  version: number;
}

interface RoomsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApply: (layout: OfficeLayout) => void;
  onStamp?: (layout: OfficeLayout) => void;
}

const ROOM_ICONS: Record<string, string> = {
  'Startup Office': '🏢',
  'Meeting Room': '📋',
  'Lounge': '🛋️',
  'Home Office': '🏠',
  'War Room': '⚡',
};

const ROOM_DESCRIPTIONS: Record<string, string> = {
  'Startup Office': 'Open-plan desks with whiteboards and plants — perfect for a growing team.',
  'Meeting Room': 'Central table with chairs and a whiteboard for collaborative sessions.',
  'Lounge': 'Sofas, coffee tables, and plants for a relaxed break area.',
  'Home Office': 'Cozy single-desk setup with bookshelves and plants.',
  'War Room': 'High-density desk setup with dual whiteboard rows for intense work.',
};

function RoomCard({
  room,
  selected,
  onSelect,
}: {
  room: RoomTemplate;
  selected: boolean;
  onSelect: (room: RoomTemplate) => void;
}) {
  const icon = ROOM_ICONS[room.name] ?? '🏗️';
  const desc = ROOM_DESCRIPTIONS[room.name] ?? '';

  return (
    <div
      onClick={() => onSelect(room)}
      style={{
        border: selected ? '2px solid var(--color-accent)' : '2px solid var(--color-border)',
        background: selected ? 'rgba(96,48,255,0.15)' : 'var(--color-bg)',
        padding: '12px 14px',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        transition: 'border-color 0.1s, background 0.1s',
      }}
      onMouseEnter={(e) => {
        if (!selected) (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--color-accent)';
      }}
      onMouseLeave={(e) => {
        if (!selected) (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--color-border)';
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 28, lineHeight: 1 }}>{icon}</span>
        <div>
          <div style={{ fontSize: 20, fontWeight: 'bold', color: 'var(--color-text)' }}>
            {room.name}
          </div>
          <div style={{ fontSize: 15, color: 'var(--color-text-muted)' }}>
            {room.cols}×{room.rows} · {room.furniture.length} items
          </div>
        </div>
      </div>
      {desc && (
        <div style={{ fontSize: 16, color: 'var(--color-text-muted)', lineHeight: 1.4 }}>
          {desc}
        </div>
      )}
    </div>
  );
}

export function RoomsModal({ isOpen, onClose, onApply, onStamp }: RoomsModalProps) {
  const [rooms, setRooms] = useState<RoomTemplate[]>([]);
  const [selectedRoom, setSelectedRoom] = useState<RoomTemplate | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen || rooms.length > 0) return;
    setLoading(true);
    fetch('./assets/premade-rooms.json')
      .then((r) => r.json())
      .then((data: RoomTemplate[]) => {
        setRooms(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [isOpen, rooms.length]);

  const handleApply = useCallback(() => {
    if (!selectedRoom) return;
    onApply(selectedRoom as unknown as OfficeLayout);
    onClose();
  }, [selectedRoom, onApply, onClose]);

  const handleStamp = useCallback(() => {
    if (!selectedRoom) return;
    onStamp?.(selectedRoom as unknown as OfficeLayout);
    onClose();
  }, [selectedRoom, onStamp, onClose]);

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--modal-overlay-bg)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="pixel-panel"
        style={{
          width: 480,
          maxWidth: 'calc(100vw - 40px)',
          maxHeight: 'calc(100vh - 80px)',
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
            padding: '10px 14px',
            borderBottom: '2px solid var(--color-border)',
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 22, fontWeight: 'bold', color: 'var(--color-text)' }}>
            Premade Rooms
          </span>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--color-text-muted)',
              cursor: 'pointer',
              fontSize: 20,
              padding: '0 4px',
            }}
          >
            ✕
          </button>
        </div>

        {/* Room list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 14 }}>
          {loading ? (
            <div
              style={{
                textAlign: 'center',
                color: 'var(--color-text-muted)',
                fontSize: 18,
                padding: 24,
              }}
            >
              Loading rooms...
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontSize: 16, color: 'var(--color-text-muted)', marginBottom: 4 }}>
                Pick a layout to start with. You can edit everything after applying.
              </div>
              {rooms.map((room) => (
                <RoomCard
                  key={room.name}
                  room={room}
                  selected={selectedRoom?.name === room.name}
                  onSelect={setSelectedRoom}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer: action buttons, visible only when a room is selected */}
        {selectedRoom && (
          <div
            style={{
              flexShrink: 0,
              borderTop: '2px solid var(--color-border)',
              padding: '10px 14px',
              display: 'flex',
              gap: 8,
            }}
          >
            <button
              onClick={handleApply}
              style={{
                flex: 1,
                padding: '8px 0',
                fontSize: 16,
                background: 'var(--color-accent)',
                color: '#fff',
                border: '2px solid var(--color-accent)',
                cursor: 'pointer',
              }}
            >
              Replace Layout
            </button>
            {onStamp && (
              <button
                onClick={handleStamp}
                style={{
                  flex: 1,
                  padding: '8px 0',
                  fontSize: 16,
                  background: 'transparent',
                  color: 'var(--color-accent)',
                  border: '2px solid var(--color-accent)',
                  cursor: 'pointer',
                }}
              >
                Place on Canvas
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
