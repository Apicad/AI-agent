import { useEffect, useRef, useState } from 'react';

const POS_KEY = 'pixel-agents-phase-panel-pos';
const PANEL_WIDTH = 280;

interface Pos { x: number; y: number }

const DEFAULT_POS: Pos = { x: 50, y: 50 }; // canvas world coordinates

interface PhaseFlowPanelProps {
  /** Current canvas zoom level — needed so drag math converts mouse delta to world delta. */
  zoom: number;
}

/**
 * Phases overview panel. Lives INSIDE the canvas's transformed wrapper, so it pans/zooms
 * with the rest of the canvas content (just like an agent card). Drag handler divides the
 * mouse delta by the current zoom to convert client-pixel movement into canvas-world
 * movement.
 */
export function PhaseFlowPanel({ zoom }: PhaseFlowPanelProps) {
  const [pos, setPos] = useState<Pos>(() => {
    try {
      const raw = localStorage.getItem(POS_KEY);
      if (raw) return JSON.parse(raw);
    } catch {}
    return DEFAULT_POS;
  });
  const [, force] = useState(0);
  const dragRef = useRef<{
    active: boolean;
    startMouseX: number;
    startMouseY: number;
    startPosX: number;
    startPosY: number;
    zoom: number;
  }>({ active: false, startMouseX: 0, startMouseY: 0, startPosX: 0, startPosY: 0, zoom: 1 });

  // Re-render every 2s so localStorage phase changes get picked up
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 2000);
    return () => clearInterval(t);
  }, []);

  // Drag listeners — convert mouse delta to canvas-world delta via current zoom
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current.active) return;
      const dxClient = e.clientX - dragRef.current.startMouseX;
      const dyClient = e.clientY - dragRef.current.startMouseY;
      // Convert client (screen) delta -> world (canvas) delta by dividing by zoom
      const dxWorld = dxClient / dragRef.current.zoom;
      const dyWorld = dyClient / dragRef.current.zoom;
      setPos({
        x: dragRef.current.startPosX + dxWorld,
        y: dragRef.current.startPosY + dyWorld,
      });
    };
    const onUp = () => {
      if (!dragRef.current.active) return;
      dragRef.current.active = false;
      // Persist on release
      setPos((p) => {
        localStorage.setItem(POS_KEY, JSON.stringify(p));
        return p;
      });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  const onDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = {
      active: true,
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startPosX: pos.x,
      startPosY: pos.y,
      zoom: zoom > 0 ? zoom : 1,
    };
  };

  const resetPos = (e: React.MouseEvent) => {
    e.stopPropagation();
    setPos(DEFAULT_POS);
    localStorage.setItem(POS_KEY, JSON.stringify(DEFAULT_POS));
  };

  // Read live phase state
  const storedPhase = localStorage.getItem('pixel-agents-current-phase');
  if (!storedPhase) return null;

  const cur = Number(storedPhase);
  const gateRaw = (() => {
    try { return JSON.parse(localStorage.getItem('pixel-agents-phase-gate') ?? 'null') as { phase: number; timestamp: number } | null; }
    catch { return null; }
  })();
  const gatePhase: number | null = gateRaw && (Date.now() - gateRaw.timestamp) < 7_200_000 ? gateRaw.phase : null;
  const phaseNamesRaw = (() => {
    try { return JSON.parse(localStorage.getItem('pixel-agents-phase-names') ?? '[]') as string[]; }
    catch { return []; }
  })();
  const phaseList = phaseNamesRaw.length > 0
    ? phaseNamesRaw.map((name, i) => ({ num: i + 1, name }))
    : [1, 2, 3, 4].map((p) => ({ num: p, name: `Phase ${p}` }));

  const statusOf = (p: number): 'awaiting' | 'complete' | 'active' | 'pending' => {
    if (gatePhase === p) return 'awaiting';
    if (p < cur) return 'complete';
    if (p === cur) return 'active';
    return 'pending';
  };

  return (
    <div
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      style={{
        // ABSOLUTE — positioned in canvas world coordinates, lives inside the transform.
        position: 'absolute',
        top: pos.y,
        left: pos.x,
        zIndex: 5,
        width: PANEL_WIDTH,
        background: 'var(--color-bg-dark)',
        border: '2px solid #6030ff',
        boxShadow: '0 6px 24px rgba(0,0,0,0.6), 0 0 12px rgba(96,48,255,0.25)',
        fontFamily: 'FS Pixel Sans, monospace',
        userSelect: 'none',
      }}
    >
      {/* Drag handle — header bar */}
      <div
        onMouseDown={onDragStart}
        title="Drag to move within the canvas · double-click to reset position"
        onDoubleClick={resetPos}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 14px',
          background: 'rgba(96,48,255,0.12)',
          borderBottom: '2px solid #6030ff',
          cursor: 'grab',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            color: 'rgba(255,255,255,0.55)', fontSize: 14, lineHeight: 0.8,
            letterSpacing: -2,
          }}>⋮⋮</span>
          <span style={{
            fontSize: 13, fontWeight: 'bold', color: '#a78bfa',
            letterSpacing: '0.12em',
          }}>
            PHASES
          </span>
        </div>
        <span style={{
          fontSize: 11, color: 'rgba(255,255,255,0.55)',
          fontWeight: 'normal', letterSpacing: '0.02em',
        }}>
          {cur}/{phaseList.length}
        </span>
      </div>

      {/* Body — phase rows */}
      <div style={{ padding: '12px 14px' }}>
        {phaseList.map(({ num, name }, idx) => {
          const status = statusOf(num);
          const isActive = status === 'active';
          const isComplete = status === 'complete';
          const isAwaiting = status === 'awaiting';
          return (
            <div key={num}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 10px',
                background: isActive
                  ? 'rgba(249,115,22,0.18)'
                  : isComplete
                  ? 'rgba(34,197,94,0.12)'
                  : isAwaiting
                  ? 'rgba(245,158,11,0.14)'
                  : 'rgba(255,255,255,0.04)',
                border: `2px solid ${
                  isActive ? '#f97316'
                  : isComplete ? '#22c55e'
                  : isAwaiting ? '#f59e0b'
                  : 'rgba(255,255,255,0.10)'
                }`,
                animation: isActive
                  ? 'phase-active-glow 2.5s ease-in-out infinite'
                  : isAwaiting
                  ? 'phase-gate-pulse 1.2s ease-in-out infinite'
                  : 'none',
                marginBottom: 6,
              }}>
                <span style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  width: 26, height: 26,
                  fontSize: 12, fontWeight: 'bold',
                  background: isComplete ? '#22c55e' : isActive ? '#f97316' : isAwaiting ? '#f59e0b' : 'rgba(255,255,255,0.08)',
                  color: (isComplete || isActive || isAwaiting) ? '#0a1628' : 'rgba(255,255,255,0.4)',
                  flexShrink: 0,
                }}>
                  {isComplete ? '✓' : String(num).padStart(2, '0')}
                </span>
                <span style={{
                  fontSize: 14,
                  fontWeight: isActive ? 'bold' : 600,
                  color: status === 'pending' ? 'rgba(255,255,255,0.45)' : '#fff',
                  flex: 1,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}>
                  {name}
                </span>
                {(isActive || isComplete || isAwaiting) && (
                  <span style={{
                    fontSize: 10, fontWeight: 'bold',
                    color: isAwaiting ? '#0a1628' : isComplete ? '#22c55e' : '#f97316',
                    background: isAwaiting ? '#f59e0b' : 'transparent',
                    padding: isAwaiting ? '2px 8px' : 0,
                    letterSpacing: '0.05em',
                  }}>
                    {isAwaiting ? 'GATE' : isActive ? 'ACTIVE' : 'DONE'}
                  </span>
                )}
              </div>
              {idx < phaseList.length - 1 && (
                <div style={{ height: 6, marginLeft: 23, marginBottom: 2 }}>
                  <div style={{
                    width: 2, height: '100%',
                    background: isComplete ? 'rgba(34,197,94,0.5)' : 'rgba(255,255,255,0.1)',
                  }} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
