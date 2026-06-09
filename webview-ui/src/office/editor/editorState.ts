import type { ColorValue } from '../../components/ui/types.js';
import { DEFAULT_FLOOR_COLOR, DEFAULT_WALL_COLOR, UNDO_STACK_MAX_SIZE } from '../../constants.js';
import type { OfficeLayout, TileType as TileTypeVal } from '../types.js';
import { EditTool, TileType } from '../types.js';

export class EditorState {
  isEditMode = false;
  activeTool: EditTool = EditTool.SELECT;
  selectedTileType: TileTypeVal = TileType.FLOOR_1;
  selectedFurnitureType = ''; // asset ID, set when catalog loads

  // Floor color settings (applied to new tiles when painting)
  floorColor: ColorValue = { ...DEFAULT_FLOOR_COLOR };

  // Wall color settings (applied to new wall tiles when painting)
  wallColor: ColorValue = { ...DEFAULT_WALL_COLOR };

  // Selected wall set index (0-based, indexes into loaded wall sets)
  selectedWallSet = 0;

  // Tracks toggle direction during wall drag (true=adding walls, false=removing, null=undecided)
  wallDragAdding: boolean | null = null;

  // Picked furniture color (copied by pick tool, applied on placement)
  pickedFurnitureColor: ColorValue | null = null;

  // Ghost preview position
  ghostCol = -1;
  ghostRow = -1;
  ghostValid = false;

  // Primary selection (used for color editing, rotate, delete button placement)
  selectedFurnitureUid: string | null = null;

  // Multi-selection set (all selected UIDs including primary)
  selectedFurnitureUids: Set<string> = new Set();

  // Mouse drag state (tile paint)
  isDragging = false;

  // Undo / Redo stacks
  undoStack: OfficeLayout[] = [];
  redoStack: OfficeLayout[] = [];

  // Dirty flag — true when layout differs from last save
  isDirty = false;

  // Drag-to-move state
  dragUid: string | null = null;
  dragStartCol = 0;
  dragStartRow = 0;
  dragOffsetCol = 0;
  dragOffsetRow = 0;
  isDragMoving = false;

  // Rect-select drag state (SELECT tool, drag on empty canvas)
  isRectSelecting = false;
  rectSelectStartCol = -1;
  rectSelectStartRow = -1;
  rectSelectEndCol = -1;
  rectSelectEndRow = -1;

  // Eraser brush size (1–5 tiles)
  eraserSize = 1;

  // Zone draw state (ZONE_EDIT tool — drag to create new zone)
  zoneDrawStartCol = -1;
  zoneDrawStartRow = -1;
  zoneDrawEndCol = -1;
  zoneDrawEndRow = -1;
  isDrawingZone = false;
  /** Currently selected zone id in the zone list (for editing) */
  selectedZoneId: string | null = null;

  // Zone drag state (move existing zone)
  zoneDragId: string | null = null;
  zoneDragOffsetCol = 0;
  zoneDragOffsetRow = 0;
  isZoneDragging = false;

  // Zone resize state (drag handles to resize existing zone)
  zoneResizeId: string | null = null;
  zoneResizeHandle: 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w' | null = null;
  zoneResizeOriginal: { col: number; row: number; cols: number; rows: number } | null = null;
  zoneResizeStartMouseCol = 0;
  zoneResizeStartMouseRow = 0;

  pushUndo(layout: OfficeLayout): void {
    this.undoStack.push(layout);
    if (this.undoStack.length > UNDO_STACK_MAX_SIZE) {
      this.undoStack.shift();
    }
  }

  popUndo(): OfficeLayout | null {
    return this.undoStack.pop() || null;
  }

  pushRedo(layout: OfficeLayout): void {
    this.redoStack.push(layout);
    if (this.redoStack.length > UNDO_STACK_MAX_SIZE) {
      this.redoStack.shift();
    }
  }

  popRedo(): OfficeLayout | null {
    return this.redoStack.pop() || null;
  }

  clearRedo(): void {
    this.redoStack = [];
  }

  clearSelection(): void {
    this.selectedFurnitureUid = null;
    this.selectedFurnitureUids = new Set();
  }

  /** Select a single furniture item. If addToExisting=true, adds to multi-select set. */
  selectFurniture(uid: string, addToExisting = false): void {
    if (!addToExisting) this.selectedFurnitureUids = new Set();
    this.selectedFurnitureUids.add(uid);
    this.selectedFurnitureUid = uid;
  }

  /** Toggle a furniture item in/out of the multi-select set. */
  toggleSelectFurniture(uid: string): void {
    if (this.selectedFurnitureUids.has(uid)) {
      this.selectedFurnitureUids.delete(uid);
      this.selectedFurnitureUid = [...this.selectedFurnitureUids].at(-1) ?? null;
    } else {
      this.selectedFurnitureUids.add(uid);
      this.selectedFurnitureUid = uid;
    }
  }

  /** Start a rect-select drag from a tile. */
  startRectSelect(col: number, row: number): void {
    this.isRectSelecting = true;
    this.rectSelectStartCol = col;
    this.rectSelectStartRow = row;
    this.rectSelectEndCol = col;
    this.rectSelectEndRow = row;
  }

  clearRectSelect(): void {
    this.isRectSelecting = false;
    this.rectSelectStartCol = -1;
    this.rectSelectStartRow = -1;
    this.rectSelectEndCol = -1;
    this.rectSelectEndRow = -1;
  }

  clearGhost(): void {
    this.ghostCol = -1;
    this.ghostRow = -1;
    this.ghostValid = false;
  }

  startDrag(
    uid: string,
    startCol: number,
    startRow: number,
    offsetCol: number,
    offsetRow: number,
  ): void {
    this.dragUid = uid;
    this.dragStartCol = startCol;
    this.dragStartRow = startRow;
    this.dragOffsetCol = offsetCol;
    this.dragOffsetRow = offsetRow;
    this.isDragMoving = false;
  }

  clearDrag(): void {
    this.dragUid = null;
    this.isDragMoving = false;
  }

  clearZoneDraw(): void {
    this.zoneDrawStartCol = -1;
    this.zoneDrawStartRow = -1;
    this.zoneDrawEndCol = -1;
    this.zoneDrawEndRow = -1;
    this.isDrawingZone = false;
  }

  startZoneDrag(id: string, offsetCol: number, offsetRow: number): void {
    this.zoneDragId = id;
    this.zoneDragOffsetCol = offsetCol;
    this.zoneDragOffsetRow = offsetRow;
    this.isZoneDragging = true;
  }

  clearZoneDrag(): void {
    this.zoneDragId = null;
    this.zoneDragOffsetCol = 0;
    this.zoneDragOffsetRow = 0;
    this.isZoneDragging = false;
  }

  startZoneResize(
    id: string,
    handle: 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w',
    original: { col: number; row: number; cols: number; rows: number },
    mouseCol: number,
    mouseRow: number,
  ): void {
    this.zoneResizeId = id;
    this.zoneResizeHandle = handle;
    this.zoneResizeOriginal = { ...original };
    this.zoneResizeStartMouseCol = mouseCol;
    this.zoneResizeStartMouseRow = mouseRow;
  }

  clearZoneResize(): void {
    this.zoneResizeId = null;
    this.zoneResizeHandle = null;
    this.zoneResizeOriginal = null;
    this.zoneResizeStartMouseCol = 0;
    this.zoneResizeStartMouseRow = 0;
  }

  reset(): void {
    this.activeTool = EditTool.SELECT;
    this.selectedFurnitureUid = null;
    this.selectedFurnitureUids = new Set();
    this.ghostCol = -1;
    this.ghostRow = -1;
    this.ghostValid = false;
    this.isDragging = false;
    this.wallDragAdding = null;
    this.undoStack = [];
    this.redoStack = [];
    this.isDirty = false;
    this.dragUid = null;
    this.isDragMoving = false;
    this.isRectSelecting = false;
    this.rectSelectStartCol = -1;
    this.rectSelectStartRow = -1;
    this.rectSelectEndCol = -1;
    this.rectSelectEndRow = -1;
    this.eraserSize = 1;
    this.zoneDrawStartCol = -1;
    this.zoneDrawStartRow = -1;
    this.zoneDrawEndCol = -1;
    this.zoneDrawEndRow = -1;
    this.isDrawingZone = false;
    this.selectedZoneId = null;
    this.zoneDragId = null;
    this.isZoneDragging = false;
    this.zoneResizeId = null;
    this.zoneResizeHandle = null;
    this.zoneResizeOriginal = null;
  }
}
