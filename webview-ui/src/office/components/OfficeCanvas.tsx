import { useCallback, useEffect, useRef } from 'react';

import {
  CAMERA_FOLLOW_LERP,
  CAMERA_FOLLOW_SNAP_THRESHOLD,
  CURSOR_BUCKET,
  CURSOR_ERASER,
  CURSOR_EYEDROPPER,
  CURSOR_MOVE,
  CURSOR_PENCIL,
  PAN_MARGIN_FRACTION,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_SCROLL_THRESHOLD,
} from '../../constants.js';
import { unlockAudio } from '../../notificationSound.js';
import { vscode } from '../../vscodeApi.js';
import { canPlaceFurniture, getWallPlacementRow } from '../editor/editorActions.js';
import type { EditorState } from '../editor/editorState.js';
import type { RoomZone } from '../types.js';
import { startGameLoop } from '../engine/gameLoop.js';
import type { OfficeState } from '../engine/officeState.js';
import type {
  DeleteButtonBounds,
  EditorRenderState,
  RotateButtonBounds,
  SelectionRenderState,
} from '../engine/renderer.js';
import { renderFrame } from '../engine/renderer.js';
import { getCatalogEntry, isRotatable } from '../layout/furnitureCatalog.js';
import { EditTool, TILE_SIZE } from '../types.js';

// ── Zone interaction helpers ──────────────────────────────────────────────

type ZoneHandle = 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w';

/** Returns the handle name if the device-pixel coord is within 6px of a handle, or null. */
function hitTestZoneHandle(
  zone: RoomZone,
  deviceX: number,
  deviceY: number,
  offset: { x: number; y: number },
  zoom: number,
): ZoneHandle | null {
  const s = TILE_SIZE * zoom;
  const px = zone.col * s + offset.x;
  const py = zone.row * s + offset.y;
  const pw = zone.cols * s;
  const ph = zone.rows * s;

  const handlePositions: [ZoneHandle, number, number][] = [
    ['nw', px, py],          ['n', px + pw / 2, py],  ['ne', px + pw, py],
    ['w',  px, py + ph / 2],                           ['e',  px + pw, py + ph / 2],
    ['sw', px, py + ph],     ['s', px + pw / 2, py + ph], ['se', px + pw, py + ph],
  ];

  const HIT_RADIUS = 8;
  for (const [name, hx, hy] of handlePositions) {
    const dx = deviceX - hx;
    const dy = deviceY - hy;
    if (dx * dx + dy * dy <= HIT_RADIUS * HIT_RADIUS) return name;
  }
  return null;
}

/** Returns the CSS cursor name for a resize handle. */
function getResizeCursor(handle: ZoneHandle): string {
  const map: Record<ZoneHandle, string> = {
    nw: 'nw-resize', ne: 'ne-resize', sw: 'sw-resize', se: 'se-resize',
    n: 'n-resize', s: 's-resize', e: 'e-resize', w: 'w-resize',
  };
  return map[handle];
}

/** Returns true if the tile position is inside the zone's bounds. */
function isInsideZone(zone: RoomZone, tile: { col: number; row: number }): boolean {
  return (
    tile.col >= zone.col && tile.col < zone.col + zone.cols &&
    tile.row >= zone.row && tile.row < zone.row + zone.rows
  );
}

interface OfficeCanvasProps {
  officeState: OfficeState;
  onClick: (agentId: number) => void;
  isEditMode: boolean;
  editorState: EditorState;
  onEditorTileAction: (col: number, row: number) => void;
  onEditorEraseAction: (col: number, row: number) => void;
  onEditorSelectionChange: () => void;
  onDeleteSelected: () => void;
  onRotateSelected: () => void;
  onDragMove: (uid: string, newCol: number, newRow: number) => void;
  onDragMoveMultiple: (moves: Array<{ uid: string; col: number; row: number }>) => void;
  onRoomStampAction?: (col: number, row: number) => void;
  onRoomStampCancel?: () => void;
  pendingRoomStamp?: import('../types.js').OfficeLayout | null;
  onAddZone?: (zone: RoomZone) => void;
  onUpdateZone?: (id: string, changes: Partial<RoomZone>) => void;
  zones?: RoomZone[];
  editorTick: number;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  panRef: React.MutableRefObject<{ x: number; y: number }>;
}

export function OfficeCanvas({
  officeState,
  onClick,
  isEditMode,
  editorState,
  onEditorTileAction,
  onEditorEraseAction,
  onEditorSelectionChange,
  onDeleteSelected,
  onRotateSelected,
  onDragMove,
  onDragMoveMultiple,
  onRoomStampAction,
  onRoomStampCancel,
  pendingRoomStamp,
  onAddZone,
  onUpdateZone,
  zones,
  editorTick: _editorTick,
  zoom,
  onZoomChange,
  panRef,
}: OfficeCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef({ x: 0, y: 0 });
  // Middle-mouse pan state (imperative, no re-renders)
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ mouseX: 0, mouseY: 0, panX: 0, panY: 0 });
  // Delete/rotate button bounds (updated each frame by renderer)
  const deleteButtonBoundsRef = useRef<DeleteButtonBounds | null>(null);
  const rotateButtonBoundsRef = useRef<RotateButtonBounds | null>(null);
  // Right-click erase dragging
  const isEraseDraggingRef = useRef(false);
  // Zoom scroll accumulator for trackpad pinch sensitivity
  const zoomAccumulatorRef = useRef(0);
  // Shift key tracking for multi-select
  const shiftHeldRef = useRef(false);

  // Shift key tracking
  useEffect(() => {
    const dn = (e: KeyboardEvent) => { shiftHeldRef.current = e.shiftKey; };
    const up = (e: KeyboardEvent) => { shiftHeldRef.current = e.shiftKey; };
    window.addEventListener('keydown', dn);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', dn);
      window.removeEventListener('keyup', up);
    };
  }, []);

  // Clamp pan so the map edge can't go past a margin inside the viewport
  const clampPan = useCallback(
    (px: number, py: number): { x: number; y: number } => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: px, y: py };
      const layout = officeState.getLayout();
      const mapW = layout.cols * TILE_SIZE * zoom;
      const mapH = layout.rows * TILE_SIZE * zoom;
      const marginX = canvas.width * PAN_MARGIN_FRACTION;
      const marginY = canvas.height * PAN_MARGIN_FRACTION;
      const maxPanX = mapW / 2 + canvas.width / 2 - marginX;
      const maxPanY = mapH / 2 + canvas.height / 2 - marginY;
      return {
        x: Math.max(-maxPanX, Math.min(maxPanX, px)),
        y: Math.max(-maxPanY, Math.min(maxPanY, py)),
      };
    },
    [officeState, zoom],
  );

  // Resize canvas backing store to device pixels (no DPR transform on ctx)
  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const newW = Math.round(rect.width * dpr);
    const newH = Math.round(rect.height * dpr);
    // Only update if dimensions actually changed — setting canvas.width/height always
    // clears the canvas, causing a black frame flash even on same-size reflows.
    if (canvas.width === newW && canvas.height === newH) return;
    canvas.width = newW;
    canvas.height = newH;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    // No ctx.scale(dpr) — we render directly in device pixels
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    resizeCanvas();

    const observer = new ResizeObserver(() => resizeCanvas());
    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    const stop = startGameLoop(canvas, {
      update: (dt) => {
        officeState.update(dt);
      },
      render: (ctx) => {
        // Canvas dimensions are in device pixels
        const w = canvas.width;
        const h = canvas.height;

        // Build editor render state
        let editorRender: EditorRenderState | undefined;
        if (isEditMode) {
          const showGhostBorder =
            editorState.activeTool === EditTool.TILE_PAINT ||
            editorState.activeTool === EditTool.WALL_PAINT ||
            editorState.activeTool === EditTool.ERASE ||
            editorState.activeTool === EditTool.BUCKET;
          // Secondary multi-select highlights (all selected UIDs except primary)
          const selHighlights: Array<{ col: number; row: number; w: number; h: number }> = [];
          for (const uid of editorState.selectedFurnitureUids) {
            if (uid === editorState.selectedFurnitureUid) continue;
            const f = officeState.getLayout().furniture.find((fi) => fi.uid === uid);
            const entry = f ? getCatalogEntry(f.type) : null;
            if (f && entry) {
              selHighlights.push({ col: f.col, row: f.row, w: entry.footprintW, h: entry.footprintH });
            }
          }

          // Zone drag/resize previews
          let zoneDragPreview: { id: string; col: number; row: number } | null = null;
          let zoneResizePreview: { id: string; col: number; row: number; cols: number; rows: number } | null = null;
          if (editorState.isZoneDragging && editorState.zoneDragId) {
            const newCol = editorState.ghostCol - editorState.zoneDragOffsetCol;
            const newRow = editorState.ghostRow - editorState.zoneDragOffsetRow;
            zoneDragPreview = { id: editorState.zoneDragId, col: newCol, row: newRow };
          }
          if (editorState.zoneResizeId && editorState.zoneResizeOriginal && editorState.zoneResizeHandle) {
            const orig = editorState.zoneResizeOriginal;
            const dCol = editorState.ghostCol - editorState.zoneResizeStartMouseCol;
            const dRow = editorState.ghostRow - editorState.zoneResizeStartMouseRow;
            const handle = editorState.zoneResizeHandle;
            let { col: rc, row: rr, cols: rcols, rows: rrows } = orig;
            if (handle.includes('w')) { rc = orig.col + dCol; rcols = orig.cols - dCol; }
            if (handle.includes('e')) { rcols = orig.cols + dCol; }
            if (handle.includes('n')) { rr = orig.row + dRow; rrows = orig.rows - dRow; }
            if (handle.includes('s')) { rrows = orig.rows + dRow; }
            if (rcols >= 1 && rrows >= 1) {
              zoneResizePreview = { id: editorState.zoneResizeId, col: rc, row: rr, cols: rcols, rows: rrows };
            }
          }

          editorRender = {
            showGrid: true, // always show grid in edit mode (including ROOM_STAMP)
            ghostSprite: null,
            ghostMirrored: false,
            ghostCol: editorState.ghostCol,
            ghostRow: editorState.ghostRow,
            ghostValid: editorState.ghostValid,
            selectedCol: 0,
            selectedRow: 0,
            selectedW: 0,
            selectedH: 0,
            hasSelection: false,
            isRotatable: false,
            deleteButtonBounds: null,
            rotateButtonBounds: null,
            showGhostBorder,
            ghostBorderHoverCol: showGhostBorder ? editorState.ghostCol : -999,
            ghostBorderHoverRow: showGhostBorder ? editorState.ghostRow : -999,
            roomStampGhost:
              pendingRoomStamp && editorState.ghostCol >= 0
                ? {
                    layout: pendingRoomStamp,
                    centerCol: editorState.ghostCol,
                    centerRow: editorState.ghostRow,
                  }
                : null,
            zoneDrawGhost:
              editorState.isDrawingZone && editorState.zoneDrawStartCol >= 0
                ? {
                    col: Math.min(editorState.zoneDrawStartCol, editorState.zoneDrawEndCol),
                    row: Math.min(editorState.zoneDrawStartRow, editorState.zoneDrawEndRow),
                    cols:
                      Math.abs(editorState.zoneDrawEndCol - editorState.zoneDrawStartCol) + 1,
                    rows:
                      Math.abs(editorState.zoneDrawEndRow - editorState.zoneDrawStartRow) + 1,
                  }
                : null,
            selectedZoneId: editorState.selectedZoneId,
            selections: selHighlights,
            rectSelectGhost:
              editorState.isRectSelecting && editorState.rectSelectStartCol >= 0
                ? {
                    col: Math.min(editorState.rectSelectStartCol, editorState.rectSelectEndCol),
                    row: Math.min(editorState.rectSelectStartRow, editorState.rectSelectEndRow),
                    cols: Math.abs(editorState.rectSelectEndCol - editorState.rectSelectStartCol) + 1,
                    rows: Math.abs(editorState.rectSelectEndRow - editorState.rectSelectStartRow) + 1,
                  }
                : null,
            eraserGhost:
              editorState.activeTool === EditTool.ERASE && editorState.ghostCol >= 0
                ? { col: editorState.ghostCol, row: editorState.ghostRow, size: editorState.eraserSize }
                : null,
            zoneDragPreview,
            zoneResizePreview,
          };

          // Ghost preview for furniture placement
          if (editorState.activeTool === EditTool.FURNITURE_PLACE && editorState.ghostCol >= 0) {
            const entry = getCatalogEntry(editorState.selectedFurnitureType);
            if (entry) {
              const placementRow = getWallPlacementRow(
                editorState.selectedFurnitureType,
                editorState.ghostRow,
              );
              // Center ghost on cursor for floor items; wall items stay bottom-aligned
              const centeredCol = entry.canPlaceOnWalls
                ? editorState.ghostCol
                : editorState.ghostCol - Math.floor(entry.footprintW / 2);
              const centeredRow = entry.canPlaceOnWalls
                ? placementRow
                : placementRow - Math.floor(entry.footprintH / 2);
              editorRender.ghostSprite = entry.sprite;
              editorRender.ghostCol = centeredCol;
              editorRender.ghostRow = centeredRow;
              editorRender.ghostMirrored =
                !!entry.mirrorSide && editorState.selectedFurnitureType.endsWith(':left');
              editorRender.ghostValid = canPlaceFurniture(
                officeState.getLayout(),
                editorState.selectedFurnitureType,
                centeredCol,
                centeredRow,
              );
            }
          }

          // Ghost preview for drag-to-move
          if (editorState.isDragMoving && editorState.dragUid && editorState.ghostCol >= 0) {
            const layout = officeState.getLayout();
            const draggedItem = layout.furniture.find((f) => f.uid === editorState.dragUid);
            if (draggedItem) {
              const entry = getCatalogEntry(draggedItem.type);
              if (entry) {
                const ghostCol = editorState.ghostCol - editorState.dragOffsetCol;
                const ghostRow = editorState.ghostRow - editorState.dragOffsetRow;
                const deltaCol = ghostCol - draggedItem.col;
                const deltaRow = ghostRow - draggedItem.row;
                editorRender.ghostSprite = entry.sprite;
                editorRender.ghostCol = ghostCol;
                editorRender.ghostRow = ghostRow;
                editorRender.ghostMirrored =
                  !!entry.mirrorSide && draggedItem.type.endsWith(':left');
                editorRender.ghostValid = canPlaceFurniture(
                  layout,
                  draggedItem.type,
                  ghostCol,
                  ghostRow,
                  editorState.dragUid,
                );

                // Multi-select: show ghosts for all other selected items at their offset positions
                const isMultiDrag =
                  editorState.selectedFurnitureUids.size > 1 &&
                  editorState.selectedFurnitureUids.has(editorState.dragUid);
                if (isMultiDrag) {
                  editorRender.multiDragGhosts = [];
                  for (const f of layout.furniture) {
                    if (f.uid === editorState.dragUid) continue;
                    if (!editorState.selectedFurnitureUids.has(f.uid)) continue;
                    const fe = getCatalogEntry(f.type);
                    if (!fe) continue;
                    editorRender.multiDragGhosts.push({
                      sprite: fe.sprite,
                      col: f.col + deltaCol,
                      row: f.row + deltaRow,
                      valid: true,
                      mirrored: !!fe.mirrorSide && f.type.endsWith(':left'),
                    });
                  }
                }
              }
            }
          }

          // Selection highlight
          if (editorState.selectedFurnitureUid && !editorState.isDragMoving) {
            const item = officeState
              .getLayout()
              .furniture.find((f) => f.uid === editorState.selectedFurnitureUid);
            if (item) {
              const entry = getCatalogEntry(item.type);
              if (entry) {
                editorRender.hasSelection = true;
                editorRender.selectedCol = item.col;
                editorRender.selectedRow = item.row;
                editorRender.selectedW = entry.footprintW;
                editorRender.selectedH = entry.footprintH;
                editorRender.isRotatable = isRotatable(item.type);
              }
            }
          }
        }

        // Camera follow: smoothly center on followed agent
        if (officeState.cameraFollowId !== null) {
          const followCh = officeState.characters.get(officeState.cameraFollowId);
          if (followCh) {
            const layout = officeState.getLayout();
            const mapW = layout.cols * TILE_SIZE * zoom;
            const mapH = layout.rows * TILE_SIZE * zoom;
            const targetX = mapW / 2 - followCh.x * zoom;
            const targetY = mapH / 2 - followCh.y * zoom;
            const dx = targetX - panRef.current.x;
            const dy = targetY - panRef.current.y;
            if (
              Math.abs(dx) < CAMERA_FOLLOW_SNAP_THRESHOLD &&
              Math.abs(dy) < CAMERA_FOLLOW_SNAP_THRESHOLD
            ) {
              panRef.current = { x: targetX, y: targetY };
            } else {
              panRef.current = {
                x: panRef.current.x + dx * CAMERA_FOLLOW_LERP,
                y: panRef.current.y + dy * CAMERA_FOLLOW_LERP,
              };
            }
          }
        }

        // Build selection render state
        const selectionRender: SelectionRenderState = {
          selectedAgentId: officeState.selectedAgentId,
          hoveredAgentId: officeState.hoveredAgentId,
          hoveredTile: officeState.hoveredTile,
          seats: officeState.seats,
          characters: officeState.characters,
        };

        const { offsetX, offsetY } = renderFrame(
          ctx,
          w,
          h,
          officeState.tileMap,
          officeState.furniture,
          officeState.getCharacters(),
          zoom,
          panRef.current.x,
          panRef.current.y,
          selectionRender,
          editorRender,
          officeState.getLayout().tileColors,
          officeState.getLayout().cols,
          officeState.getLayout().rows,
          zones ?? officeState.getLayout().zones,
        );
        offsetRef.current = { x: offsetX, y: offsetY };

        // Store delete/rotate button bounds for hit-testing
        deleteButtonBoundsRef.current = editorRender?.deleteButtonBounds ?? null;
        rotateButtonBoundsRef.current = editorRender?.rotateButtonBounds ?? null;
      },
    });

    return () => {
      stop();
      observer.disconnect();
    };
  }, [officeState, resizeCanvas, isEditMode, editorState, _editorTick, zoom, panRef, pendingRoomStamp, zones]);

  // Convert CSS mouse coords to world (sprite pixel) coords
  const screenToWorld = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      // CSS coords relative to canvas
      const cssX = clientX - rect.left;
      const cssY = clientY - rect.top;
      // Convert to device pixels
      const deviceX = cssX * dpr;
      const deviceY = cssY * dpr;
      // Convert to world (sprite pixel) coords
      const worldX = (deviceX - offsetRef.current.x) / zoom;
      const worldY = (deviceY - offsetRef.current.y) / zoom;
      return { worldX, worldY, screenX: cssX, screenY: cssY, deviceX, deviceY };
    },
    [zoom],
  );

  const screenToTile = useCallback(
    (clientX: number, clientY: number): { col: number; row: number } | null => {
      const pos = screenToWorld(clientX, clientY);
      if (!pos) return null;
      const col = Math.floor(pos.worldX / TILE_SIZE);
      const row = Math.floor(pos.worldY / TILE_SIZE);
      const layout = officeState.getLayout();
      // In edit mode with floor/wall/erase tool, extend valid range by 1 for ghost border
      if (
        isEditMode &&
        (editorState.activeTool === EditTool.TILE_PAINT ||
          editorState.activeTool === EditTool.WALL_PAINT ||
          editorState.activeTool === EditTool.ERASE)
      ) {
        if (col < -1 || col > layout.cols || row < -1 || row > layout.rows) return null;
        return { col, row };
      }
      if (isEditMode && editorState.activeTool === EditTool.ROOM_STAMP) {
        // Allow any tile; stamp can be offset outside bounds (clamped in stampRoom)
        return { col, row };
      }
      if (col < 0 || col >= layout.cols || row < 0 || row >= layout.rows) return null;
      return { col, row };
    },
    [screenToWorld, officeState, isEditMode, editorState],
  );

  // Check if device-pixel coords hit the delete button
  const hitTestDeleteButton = useCallback((deviceX: number, deviceY: number): boolean => {
    const bounds = deleteButtonBoundsRef.current;
    if (!bounds) return false;
    const dx = deviceX - bounds.cx;
    const dy = deviceY - bounds.cy;
    return dx * dx + dy * dy <= (bounds.radius + 2) * (bounds.radius + 2); // small padding
  }, []);

  // Check if device-pixel coords hit the rotate button
  const hitTestRotateButton = useCallback((deviceX: number, deviceY: number): boolean => {
    const bounds = rotateButtonBoundsRef.current;
    if (!bounds) return false;
    const dx = deviceX - bounds.cx;
    const dy = deviceY - bounds.cy;
    return dx * dx + dy * dy <= (bounds.radius + 2) * (bounds.radius + 2);
  }, []);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      // Handle middle-mouse panning
      if (isPanningRef.current) {
        const dpr = window.devicePixelRatio || 1;
        const dx = (e.clientX - panStartRef.current.mouseX) * dpr;
        const dy = (e.clientY - panStartRef.current.mouseY) * dpr;
        panRef.current = clampPan(panStartRef.current.panX + dx, panStartRef.current.panY + dy);
        return;
      }

      if (isEditMode) {
        const tile = screenToTile(e.clientX, e.clientY);
        if (tile) {
          editorState.ghostCol = tile.col;
          editorState.ghostRow = tile.row;

          // Drag-to-move: check if cursor moved to different tile
          if (editorState.dragUid && !editorState.isDragMoving) {
            if (tile.col !== editorState.dragStartCol || tile.row !== editorState.dragStartRow) {
              editorState.isDragMoving = true;
            }
          }

          // Zone draw: update end corner
          if (editorState.isDrawingZone) {
            editorState.zoneDrawEndCol = tile.col;
            editorState.zoneDrawEndRow = tile.row;
          }

          // Rect-select: update end tile
          if (editorState.isRectSelecting) {
            editorState.rectSelectEndCol = tile.col;
            editorState.rectSelectEndRow = tile.row;
          }

          // Paint on drag (tile/wall/erase paint tool only, not during furniture drag)
          if (
            editorState.isDragging &&
            (editorState.activeTool === EditTool.TILE_PAINT ||
              editorState.activeTool === EditTool.WALL_PAINT ||
              editorState.activeTool === EditTool.ERASE) &&
            !editorState.dragUid
          ) {
            onEditorTileAction(tile.col, tile.row);
          }
          // Right-click erase drag
          if (
            isEraseDraggingRef.current &&
            (editorState.activeTool === EditTool.TILE_PAINT ||
              editorState.activeTool === EditTool.WALL_PAINT ||
              editorState.activeTool === EditTool.ERASE)
          ) {
            const layout = officeState.getLayout();
            if (
              tile.col >= 0 &&
              tile.col < layout.cols &&
              tile.row >= 0 &&
              tile.row < layout.rows
            ) {
              onEditorEraseAction(tile.col, tile.row);
            }
          }
        } else {
          editorState.ghostCol = -1;
          editorState.ghostRow = -1;
        }

        // Cursor: show grab during drag, pointer over delete button, crosshair otherwise
        const canvas = canvasRef.current;
        if (canvas) {
          if (editorState.isDragMoving) {
            canvas.style.cursor = 'grabbing';
          } else {
            const pos = screenToWorld(e.clientX, e.clientY);
            if (
              pos &&
              (hitTestDeleteButton(pos.deviceX, pos.deviceY) ||
                hitTestRotateButton(pos.deviceX, pos.deviceY))
            ) {
              canvas.style.cursor = 'pointer';
            } else if (editorState.activeTool === EditTool.FURNITURE_PICK && tile) {
              // Pick mode: show eyedropper over furniture, eyedropper elsewhere
              canvas.style.cursor = CURSOR_EYEDROPPER;
            } else if (
              (editorState.activeTool === EditTool.SELECT ||
                (editorState.activeTool === EditTool.FURNITURE_PLACE &&
                  editorState.selectedFurnitureType === '')) &&
              tile
            ) {
              // Check if hovering over furniture
              const layout = officeState.getLayout();
              const hitFurniture = layout.furniture.find((f) => {
                const entry = getCatalogEntry(f.type);
                if (!entry) return false;
                return (
                  tile.col >= f.col &&
                  tile.col < f.col + entry.footprintW &&
                  tile.row >= f.row &&
                  tile.row < f.row + entry.footprintH
                );
              });
              canvas.style.cursor = hitFurniture ? CURSOR_MOVE : 'default';
            } else if (editorState.activeTool === EditTool.ROOM_STAMP) {
              canvas.style.cursor = CURSOR_PENCIL;
            } else if (editorState.activeTool === EditTool.ZONE_EDIT) {
              // Resize cursor over zone handles
              if (editorState.isZoneDragging) {
                canvas.style.cursor = 'grabbing';
              } else if (editorState.selectedZoneId && pos) {
                const currentZones = zones ?? officeState.getLayout().zones ?? [];
                const selZone = currentZones.find((z) => z.id === editorState.selectedZoneId);
                if (selZone) {
                  const handle = hitTestZoneHandle(selZone, pos.deviceX, pos.deviceY, offsetRef.current, zoom);
                  canvas.style.cursor = handle ? getResizeCursor(handle) : (tile && isInsideZone(selZone, tile) ? 'grab' : 'cell');
                } else {
                  canvas.style.cursor = 'cell';
                }
              } else {
                canvas.style.cursor = 'cell';
              }
            } else if (editorState.activeTool === EditTool.ERASE) {
              canvas.style.cursor = CURSOR_ERASER;
            } else if (editorState.activeTool === EditTool.EYEDROPPER || editorState.activeTool === EditTool.WALL_EYEDROPPER) {
              canvas.style.cursor = CURSOR_EYEDROPPER;
            } else if (editorState.activeTool === EditTool.BUCKET) {
              canvas.style.cursor = CURSOR_BUCKET;
            } else if (
              editorState.activeTool === EditTool.TILE_PAINT ||
              editorState.activeTool === EditTool.WALL_PAINT
            ) {
              canvas.style.cursor = CURSOR_PENCIL;
            } else {
              canvas.style.cursor = 'crosshair';
            }
          }
        }
        return;
      }

      const pos = screenToWorld(e.clientX, e.clientY);
      if (!pos) return;
      const hitId = officeState.getCharacterAt(pos.worldX, pos.worldY);
      const tile = screenToTile(e.clientX, e.clientY);
      officeState.hoveredTile = tile;
      const canvas = canvasRef.current;
      if (canvas) {
        let cursor = 'default';
        if (hitId !== null) {
          cursor = 'pointer';
        } else if (officeState.selectedAgentId !== null && tile) {
          // Check if hovering over a clickable seat (available or own)
          const seatId = officeState.getSeatAtTile(tile.col, tile.row);
          if (seatId) {
            const seat = officeState.seats.get(seatId);
            if (seat) {
              const selectedCh = officeState.characters.get(officeState.selectedAgentId);
              if (!seat.assigned || (selectedCh && selectedCh.seatId === seatId)) {
                cursor = 'pointer';
              }
            }
          }
        }
        canvas.style.cursor = cursor;
      }
      officeState.hoveredAgentId = hitId;
    },
    [
      officeState,
      screenToWorld,
      screenToTile,
      isEditMode,
      editorState,
      onEditorTileAction,
      onEditorEraseAction,
      panRef,
      hitTestDeleteButton,
      hitTestRotateButton,
      clampPan,
      zones,
      zoom,
    ],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      unlockAudio();
      // Middle mouse button (button 1) starts panning
      if (e.button === 1) {
        e.preventDefault();
        // Break camera follow on manual pan
        officeState.cameraFollowId = null;
        isPanningRef.current = true;
        panStartRef.current = {
          mouseX: e.clientX,
          mouseY: e.clientY,
          panX: panRef.current.x,
          panY: panRef.current.y,
        };
        const canvas = canvasRef.current;
        if (canvas) canvas.style.cursor = 'grabbing';
        return;
      }

      // Right-click in edit mode for erasing
      if (e.button === 2 && isEditMode) {
        const tile = screenToTile(e.clientX, e.clientY);
        if (
          tile &&
          (editorState.activeTool === EditTool.TILE_PAINT ||
            editorState.activeTool === EditTool.WALL_PAINT ||
            editorState.activeTool === EditTool.ERASE)
        ) {
          const layout = officeState.getLayout();
          if (tile.col >= 0 && tile.col < layout.cols && tile.row >= 0 && tile.row < layout.rows) {
            isEraseDraggingRef.current = true;
            onEditorEraseAction(tile.col, tile.row);
          }
        }
        return;
      }

      if (!isEditMode) return;

      // Check rotate/delete button hit first
      const pos = screenToWorld(e.clientX, e.clientY);
      if (pos && hitTestRotateButton(pos.deviceX, pos.deviceY)) {
        onRotateSelected();
        return;
      }
      if (pos && hitTestDeleteButton(pos.deviceX, pos.deviceY)) {
        onDeleteSelected();
        return;
      }

      const tile = screenToTile(e.clientX, e.clientY);

      // ROOM_STAMP: click places the stamp at hovered tile
      if (editorState.activeTool === EditTool.ROOM_STAMP && tile) {
        onRoomStampAction?.(tile.col, tile.row);
        return;
      }

      // ZONE_EDIT: drag existing zone or its handles; else draw new zone
      if (editorState.activeTool === EditTool.ZONE_EDIT && tile) {
        const currentZones = zones ?? officeState.getLayout().zones ?? [];

        // Check resize handles of currently selected zone
        if (editorState.selectedZoneId && pos) {
          const selZone = currentZones.find((z) => z.id === editorState.selectedZoneId);
          if (selZone) {
            const handle = hitTestZoneHandle(selZone, pos.deviceX, pos.deviceY, offsetRef.current, zoom);
            if (handle) {
              editorState.startZoneResize(
                selZone.id,
                handle,
                { col: selZone.col, row: selZone.row, cols: selZone.cols, rows: selZone.rows },
                tile.col,
                tile.row,
              );
              return;
            }
          }
        }

        // Check if clicking inside an existing zone body
        const hitZone = currentZones.find((z) => isInsideZone(z, tile));
        if (hitZone) {
          editorState.selectedZoneId = hitZone.id;
          editorState.startZoneDrag(hitZone.id, tile.col - hitZone.col, tile.row - hitZone.row);
          onEditorSelectionChange();
          return;
        }

        // Otherwise start drawing a new zone
        editorState.zoneDrawStartCol = tile.col;
        editorState.zoneDrawStartRow = tile.row;
        editorState.zoneDrawEndCol = tile.col;
        editorState.zoneDrawEndRow = tile.row;
        editorState.isDrawingZone = true;
        return;
      }

      // SELECT tool (or furniture tool with nothing selected): check for furniture hit to start drag
      const actAsSelect =
        editorState.activeTool === EditTool.SELECT ||
        (editorState.activeTool === EditTool.FURNITURE_PLACE &&
          editorState.selectedFurnitureType === '');
      if (actAsSelect && tile) {
        const layout = officeState.getLayout();
        // Find all furniture at clicked tile, prefer surface items (on top of desks)
        let hitFurniture = null as (typeof layout.furniture)[0] | null;
        for (const f of layout.furniture) {
          const entry = getCatalogEntry(f.type);
          if (!entry) continue;
          if (
            tile.col >= f.col &&
            tile.col < f.col + entry.footprintW &&
            tile.row >= f.row &&
            tile.row < f.row + entry.footprintH
          ) {
            if (!hitFurniture || entry.canPlaceOnSurfaces) hitFurniture = f;
          }
        }
        if (hitFurniture) {
          if (shiftHeldRef.current) {
            // Shift+click: toggle item in multi-select (don't start drag)
            editorState.toggleSelectFurniture(hitFurniture.uid);
            onEditorSelectionChange();
          } else {
            // Normal click: start drag (selection committed on mouseup)
            editorState.startDrag(
              hitFurniture.uid,
              tile.col,
              tile.row,
              tile.col - hitFurniture.col,
              tile.row - hitFurniture.row,
            );
          }
          return;
        } else {
          // Clicked empty space: clear selection (unless shift), start rect-select
          if (!shiftHeldRef.current) {
            editorState.clearSelection();
            onEditorSelectionChange();
          }
          editorState.startRectSelect(tile.col, tile.row);
          return;
        }
      }

      // Non-select tools: start paint drag
      editorState.isDragging = true;
      if (tile) {
        onEditorTileAction(tile.col, tile.row);
      }
    },
    [
      officeState,
      isEditMode,
      editorState,
      screenToTile,
      screenToWorld,
      onEditorTileAction,
      onEditorEraseAction,
      onEditorSelectionChange,
      onDeleteSelected,
      onRotateSelected,
      onRoomStampAction,
      hitTestDeleteButton,
      hitTestRotateButton,
      panRef,
      onAddZone,
      zones,
      zoom,
    ],
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent) => {
      if (e.button === 1) {
        isPanningRef.current = false;
        const canvas = canvasRef.current;
        if (canvas) canvas.style.cursor = isEditMode ? 'crosshair' : 'default';
        return;
      }
      if (e.button === 2) {
        isEraseDraggingRef.current = false;
        return;
      }

      // Finalize rect-select: collect furniture overlapping the rectangle
      if (editorState.isRectSelecting) {
        const tile = screenToTile(e.clientX, e.clientY);
        if (tile) {
          editorState.rectSelectEndCol = tile.col;
          editorState.rectSelectEndRow = tile.row;
        }
        const c1 = Math.min(editorState.rectSelectStartCol, editorState.rectSelectEndCol);
        const c2 = Math.max(editorState.rectSelectStartCol, editorState.rectSelectEndCol);
        const r1 = Math.min(editorState.rectSelectStartRow, editorState.rectSelectEndRow);
        const r2 = Math.max(editorState.rectSelectStartRow, editorState.rectSelectEndRow);
        for (const f of officeState.getLayout().furniture) {
          const entry = getCatalogEntry(f.type);
          if (!entry) continue;
          if (
            f.col <= c2 &&
            f.col + entry.footprintW - 1 >= c1 &&
            f.row <= r2 &&
            f.row + entry.footprintH - 1 >= r1
          ) {
            editorState.selectFurniture(f.uid, true);
          }
        }
        editorState.clearRectSelect();
        onEditorSelectionChange();
        editorState.isDragging = false;
        return;
      }

      // Finalize zone resize
      if (editorState.zoneResizeId && editorState.zoneResizeOriginal && editorState.zoneResizeHandle) {
        const tile = screenToTile(e.clientX, e.clientY);
        if (tile) {
          const orig = editorState.zoneResizeOriginal;
          const dCol = tile.col - editorState.zoneResizeStartMouseCol;
          const dRow = tile.row - editorState.zoneResizeStartMouseRow;
          const handle = editorState.zoneResizeHandle;
          let rc = orig.col;
          let rr = orig.row;
          let rcols = orig.cols;
          let rrows = orig.rows;
          if (handle.includes('w')) { rc = orig.col + dCol; rcols = orig.cols - dCol; }
          if (handle.includes('e')) { rcols = orig.cols + dCol; }
          if (handle.includes('n')) { rr = orig.row + dRow; rrows = orig.rows - dRow; }
          if (handle.includes('s')) { rrows = orig.rows + dRow; }
          if (rcols >= 1 && rrows >= 1) {
            onUpdateZone?.(editorState.zoneResizeId, { col: rc, row: rr, cols: rcols, rows: rrows });
          }
        }
        editorState.clearZoneResize();
        return;
      }

      // Finalize zone drag
      if (editorState.isZoneDragging && editorState.zoneDragId) {
        const tile = screenToTile(e.clientX, e.clientY);
        if (tile) {
          const newCol = tile.col - editorState.zoneDragOffsetCol;
          const newRow = tile.row - editorState.zoneDragOffsetRow;
          onUpdateZone?.(editorState.zoneDragId, { col: newCol, row: newRow });
        }
        editorState.clearZoneDrag();
        return;
      }

      // Handle drag-to-move completion
      if (editorState.dragUid) {
        if (editorState.isDragMoving) {
          // Compute target position for the primary dragged item
          const ghostCol = editorState.ghostCol - editorState.dragOffsetCol;
          const ghostRow = editorState.ghostRow - editorState.dragOffsetRow;
          const layout = officeState.getLayout();
          const draggedItem = layout.furniture.find((f) => f.uid === editorState.dragUid);
          if (draggedItem) {
            const isMultiMove =
              editorState.selectedFurnitureUids.size > 1 &&
              editorState.selectedFurnitureUids.has(editorState.dragUid);
            if (isMultiMove) {
              // Move all selected items by the same delta
              const deltaCol = ghostCol - draggedItem.col;
              const deltaRow = ghostRow - draggedItem.row;
              const moves = layout.furniture
                .filter((f) => editorState.selectedFurnitureUids.has(f.uid))
                .map((f) => ({ uid: f.uid, col: f.col + deltaCol, row: f.row + deltaRow }));
              onDragMoveMultiple(moves);
            } else {
              const valid = canPlaceFurniture(
                layout,
                draggedItem.type,
                ghostCol,
                ghostRow,
                editorState.dragUid,
              );
              if (valid) {
                onDragMove(editorState.dragUid, ghostCol, ghostRow);
              }
            }
          }
          // Keep selection after move so user can continue repositioning
        } else {
          // Click (no movement) — select this item (single, replacing any existing selection)
          editorState.selectFurniture(editorState.dragUid);
        }
        editorState.clearDrag();
        onEditorSelectionChange();
        const canvas = canvasRef.current;
        if (canvas) canvas.style.cursor = 'crosshair';
        return;
      }

      // ZONE_EDIT: finalize zone draw
      if (editorState.isDrawingZone) {
        const col = Math.min(editorState.zoneDrawStartCol, editorState.zoneDrawEndCol);
        const row = Math.min(editorState.zoneDrawStartRow, editorState.zoneDrawEndRow);
        const cols = Math.abs(editorState.zoneDrawEndCol - editorState.zoneDrawStartCol) + 1;
        const rows = Math.abs(editorState.zoneDrawEndRow - editorState.zoneDrawStartRow) + 1;
        if (cols >= 1 && rows >= 1) {
          const presets = ['#4a9eff', '#57a55a', '#e06c2e', '#a857d4', '#e6c040', '#57c4c8'];
          const existingZones = officeState.getLayout().zones ?? [];
          const color = presets[existingZones.length % presets.length] ?? '#4a9eff';
          onAddZone?.({
            id: crypto.randomUUID(),
            name: `Zone ${existingZones.length + 1}`,
            col,
            row,
            cols,
            rows,
            color,
          });
        }
        editorState.clearZoneDraw();
        return;
      }

      editorState.isDragging = false;
      editorState.wallDragAdding = null;
    },
    [editorState, isEditMode, officeState, onAddZone, onUpdateZone, onDragMove, onDragMoveMultiple, onEditorSelectionChange, screenToTile],
  );

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (isEditMode) return; // handled by mouseDown/mouseUp
      const pos = screenToWorld(e.clientX, e.clientY);
      if (!pos) return;

      const hitId = officeState.getCharacterAt(pos.worldX, pos.worldY);
      if (hitId !== null) {
        // Dismiss any active bubble on click
        officeState.dismissBubble(hitId);
        // Toggle selection: click same agent deselects, different agent selects
        if (officeState.selectedAgentId === hitId) {
          officeState.selectedAgentId = null;
          officeState.cameraFollowId = null;
        } else {
          officeState.selectedAgentId = hitId;
          officeState.cameraFollowId = hitId;
        }
        onClick(hitId); // still focus terminal
        return;
      }

      // No agent hit — check seat click while agent is selected
      if (officeState.selectedAgentId !== null) {
        const selectedCh = officeState.characters.get(officeState.selectedAgentId);
        // Skip seat reassignment for sub-agents
        if (selectedCh && !selectedCh.isSubagent) {
          const tile = screenToTile(e.clientX, e.clientY);
          if (tile) {
            const seatId = officeState.getSeatAtTile(tile.col, tile.row);
            if (seatId) {
              const seat = officeState.seats.get(seatId);
              if (seat && selectedCh) {
                if (selectedCh.seatId === seatId) {
                  // Clicked own seat — send agent back to it
                  officeState.sendToSeat(officeState.selectedAgentId);
                  officeState.selectedAgentId = null;
                  officeState.cameraFollowId = null;
                  return;
                } else if (!seat.assigned) {
                  // Clicked available seat — reassign
                  officeState.reassignSeat(officeState.selectedAgentId, seatId);
                  officeState.selectedAgentId = null;
                  officeState.cameraFollowId = null;
                  // Persist seat assignments (exclude sub-agents)
                  const seats: Record<number, { palette: number; seatId: string | null }> = {};
                  for (const ch of officeState.characters.values()) {
                    if (ch.isSubagent) continue;
                    seats[ch.id] = { palette: ch.palette, seatId: ch.seatId };
                  }
                  vscode.postMessage({ type: 'saveAgentSeats', seats });
                  return;
                }
              }
            }
          }
        }
        // Clicked empty space — deselect
        officeState.selectedAgentId = null;
        officeState.cameraFollowId = null;
      }
    },
    [officeState, onClick, screenToWorld, screenToTile, isEditMode],
  );

  const handleMouseLeave = useCallback(() => {
    isPanningRef.current = false;
    isEraseDraggingRef.current = false;
    editorState.isDragging = false;
    editorState.wallDragAdding = null;
    editorState.clearDrag();
    editorState.clearRectSelect();
    editorState.ghostCol = -1;
    editorState.ghostRow = -1;
    officeState.hoveredAgentId = null;
    officeState.hoveredTile = null;
  }, [officeState, editorState]);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      if (isEditMode) return;
      // Right-click to walk selected agent to tile
      if (officeState.selectedAgentId !== null) {
        const tile = screenToTile(e.clientX, e.clientY);
        if (tile) {
          officeState.walkToTile(officeState.selectedAgentId, tile.col, tile.row);
        }
      }
    },
    [isEditMode, officeState, screenToTile],
  );

  // Wheel: Ctrl+wheel to zoom, plain wheel/trackpad to pan
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        // Accumulate scroll delta, step zoom when threshold crossed
        zoomAccumulatorRef.current += e.deltaY;
        if (Math.abs(zoomAccumulatorRef.current) >= ZOOM_SCROLL_THRESHOLD) {
          const delta = zoomAccumulatorRef.current < 0 ? 1 : -1;
          zoomAccumulatorRef.current = 0;
          const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom + delta));
          if (newZoom !== zoom) {
            onZoomChange(newZoom);
          }
        }
      } else {
        // Pan via trackpad two-finger scroll or mouse wheel
        const dpr = window.devicePixelRatio || 1;
        officeState.cameraFollowId = null;
        panRef.current = clampPan(
          panRef.current.x - e.deltaX * dpr,
          panRef.current.y - e.deltaY * dpr,
        );
      }
    },
    [zoom, onZoomChange, officeState, panRef, clampPan],
  );

  // Prevent default middle-click browser behavior (auto-scroll)
  const handleAuxClick = useCallback((e: React.MouseEvent) => {
    if (e.button === 1) e.preventDefault();
  }, []);

  return (
    <div ref={containerRef} className="w-full h-full relative overflow-hidden bg-bg">
      <canvas
        ref={canvasRef}
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onClick={handleClick}
        onAuxClick={handleAuxClick}
        onMouseLeave={handleMouseLeave}
        onWheel={handleWheel}
        onContextMenu={handleContextMenu}
        className="block"
      />
    </div>
  );
}
