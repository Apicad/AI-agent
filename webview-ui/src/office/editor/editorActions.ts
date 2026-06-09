import type { ColorValue } from '../../components/ui/types.js';
import { DEFAULT_NEUTRAL_COLOR } from '../../constants.js';
import { getCatalogEntry, getRotatedType, getToggledType } from '../layout/furnitureCatalog.js';
import { getPlacementBlockedTiles } from '../layout/layoutSerializer.js';
import type { OfficeLayout, PlacedFurniture, RoomZone, TileType as TileTypeVal } from '../types.js';
import { MAX_COLS, MAX_ROWS, TileType } from '../types.js';

/** Paint a single tile with pattern and color. Returns new layout (immutable). */
export function paintTile(
  layout: OfficeLayout,
  col: number,
  row: number,
  tileType: TileTypeVal,
  color?: ColorValue,
): OfficeLayout {
  const idx = row * layout.cols + col;
  if (idx < 0 || idx >= layout.tiles.length) return layout;

  const existingColors = layout.tileColors || new Array(layout.tiles.length).fill(null);
  const newColor =
    color ??
    (tileType === TileType.WALL || tileType === TileType.VOID
      ? null
      : { ...DEFAULT_NEUTRAL_COLOR });

  // Check if anything actually changed
  if (layout.tiles[idx] === tileType) {
    const existingColor = existingColors[idx];
    if (newColor === null && existingColor === null) return layout;
    if (
      newColor &&
      existingColor &&
      newColor.h === existingColor.h &&
      newColor.s === existingColor.s &&
      newColor.b === existingColor.b &&
      newColor.c === existingColor.c &&
      !!newColor.colorize === !!existingColor.colorize
    )
      return layout;
  }

  const tiles = [...layout.tiles];
  tiles[idx] = tileType;
  const tileColors = [...existingColors];
  tileColors[idx] = newColor;
  return { ...layout, tiles, tileColors };
}

/**
 * Flood-fill: starting at (col, row), replace all connected tiles that share
 * the same TileType with `newTileType` and `newColor`. 4-directional BFS.
 * Returns a new layout (immutable).
 */
export function bucketFill(
  layout: OfficeLayout,
  col: number,
  row: number,
  newTileType: TileTypeVal,
  newColor?: ColorValue,
): OfficeLayout {
  const { cols, rows, tiles } = layout;
  const startIdx = row * cols + col;
  if (startIdx < 0 || startIdx >= tiles.length) return layout;

  const targetType = tiles[startIdx];
  // Nothing to fill if already this type (color changes still allowed)
  if (targetType === newTileType && !newColor) return layout;

  const visited = new Uint8Array(tiles.length);
  const queue: number[] = [startIdx];
  visited[startIdx] = 1;
  const toFill: number[] = [];

  while (queue.length > 0) {
    const idx = queue.pop()!;
    if (tiles[idx] !== targetType) continue;
    toFill.push(idx);
    const r = Math.floor(idx / cols);
    const c = idx % cols;
    const neighbors = [
      r > 0 ? idx - cols : -1,
      r < rows - 1 ? idx + cols : -1,
      c > 0 ? idx - 1 : -1,
      c < cols - 1 ? idx + 1 : -1,
    ];
    for (const n of neighbors) {
      if (n >= 0 && !visited[n]) {
        visited[n] = 1;
        queue.push(n);
      }
    }
  }

  if (toFill.length === 0) return layout;

  const newTiles = [...tiles];
  const existingColors = layout.tileColors || new Array(tiles.length).fill(null);
  const newTileColors = [...existingColors];
  const fillColor =
    newColor ?? (newTileType === TileType.WALL || newTileType === TileType.VOID ? null : { ...DEFAULT_NEUTRAL_COLOR });

  for (const idx of toFill) {
    newTiles[idx] = newTileType;
    newTileColors[idx] = fillColor;
  }

  return { ...layout, tiles: newTiles, tileColors: newTileColors };
}

/** Place furniture. Returns new layout (immutable). */
export function placeFurniture(layout: OfficeLayout, item: PlacedFurniture): OfficeLayout {
  if (!canPlaceFurniture(layout, item.type, item.col, item.row)) return layout;
  return { ...layout, furniture: [...layout.furniture, item] };
}

/** Remove furniture by uid. Returns new layout (immutable). */
export function removeFurniture(layout: OfficeLayout, uid: string): OfficeLayout {
  const filtered = layout.furniture.filter((f) => f.uid !== uid);
  if (filtered.length === layout.furniture.length) return layout;
  return { ...layout, furniture: filtered };
}

/** Remove multiple furniture items by uid array. Returns new layout (immutable). */
export function removeMultipleFurniture(layout: OfficeLayout, uids: string[]): OfficeLayout {
  if (uids.length === 0) return layout;
  const set = new Set(uids);
  const filtered = layout.furniture.filter((f) => !set.has(f.uid));
  if (filtered.length === layout.furniture.length) return layout;
  return { ...layout, furniture: filtered };
}

/**
 * Erase a square area of tiles to VOID centered on (col, row) with the given brush size.
 * size=1 → single tile, size=3 → 3×3 area centered on tile. Returns new layout (immutable).
 */
export function eraseArea(
  layout: OfficeLayout,
  col: number,
  row: number,
  size: number,
): OfficeLayout {
  if (size <= 1) {
    return paintTile(layout, col, row, TileType.VOID);
  }
  const half = Math.floor(size / 2);
  let current = layout;
  for (let dr = -half; dr <= half; dr++) {
    for (let dc = -half; dc <= half; dc++) {
      const c = col + dc;
      const r = row + dr;
      if (c >= 0 && c < layout.cols && r >= 0 && r < layout.rows) {
        current = paintTile(current, c, r, TileType.VOID);
      }
    }
  }
  return current;
}

/** Move furniture to new position. Returns new layout (immutable). */
export function moveFurniture(
  layout: OfficeLayout,
  uid: string,
  newCol: number,
  newRow: number,
): OfficeLayout {
  const item = layout.furniture.find((f) => f.uid === uid);
  if (!item) return layout;
  if (!canPlaceFurniture(layout, item.type, newCol, newRow, uid)) return layout;
  return {
    ...layout,
    furniture: layout.furniture.map((f) =>
      f.uid === uid ? { ...f, col: newCol, row: newRow } : f,
    ),
  };
}

/** Move multiple furniture items by the same delta. Items moving together don't block each other. */
export function moveMultipleFurniture(
  layout: OfficeLayout,
  moves: Array<{ uid: string; col: number; row: number }>,
): OfficeLayout {
  const moveMap = new Map(moves.map((m) => [m.uid, m]));
  const newFurniture = layout.furniture.map((f) => {
    const move = moveMap.get(f.uid);
    if (!move) return f;
    // Only bounds-check; items moving together don't block each other
    const entry = getCatalogEntry(f.type);
    if (!entry) return f;
    if (
      move.col < 0 || move.row < 0 ||
      move.col + entry.footprintW > layout.cols ||
      move.row + entry.footprintH > layout.rows
    ) return f;
    return { ...f, col: move.col, row: move.row };
  });
  const changed = newFurniture.some((f, i) => f !== layout.furniture[i]);
  return changed ? { ...layout, furniture: newFurniture } : layout;
}

/** Rotate furniture to the next orientation. Returns new layout (immutable). */
export function rotateFurniture(
  layout: OfficeLayout,
  uid: string,
  direction: 'cw' | 'ccw',
): OfficeLayout {
  const item = layout.furniture.find((f) => f.uid === uid);
  if (!item) return layout;
  const newType = getRotatedType(item.type, direction);
  if (!newType) return layout;
  return {
    ...layout,
    furniture: layout.furniture.map((f) => (f.uid === uid ? { ...f, type: newType } : f)),
  };
}

/** Toggle furniture state (on/off). Returns new layout (immutable). */
export function toggleFurnitureState(layout: OfficeLayout, uid: string): OfficeLayout {
  const item = layout.furniture.find((f) => f.uid === uid);
  if (!item) return layout;
  const newType = getToggledType(item.type);
  if (!newType) return layout;
  return {
    ...layout,
    furniture: layout.furniture.map((f) => (f.uid === uid ? { ...f, type: newType } : f)),
  };
}

/** For wall items, offset the row so the bottom row aligns with the hovered tile. */
export function getWallPlacementRow(type: string, row: number): number {
  const entry = getCatalogEntry(type);
  if (!entry?.canPlaceOnWalls) return row;
  return row - (entry.footprintH - 1);
}

/** Check if furniture can be placed at (col, row) without overlapping. */
export function canPlaceFurniture(
  layout: OfficeLayout,
  type: string, // FurnitureType enum or asset ID
  col: number,
  row: number,
  excludeUid?: string,
): boolean {
  const entry = getCatalogEntry(type);
  if (!entry) return false;

  // Check bounds — wall items may extend above the map (top rows hang above the wall)
  if (entry.canPlaceOnWalls) {
    const bottomRow = row + entry.footprintH - 1;
    if (
      col < 0 ||
      col + entry.footprintW > layout.cols ||
      bottomRow < 0 ||
      bottomRow >= layout.rows
    ) {
      return false;
    }
  } else {
    if (
      col < 0 ||
      row < 0 ||
      col + entry.footprintW > layout.cols ||
      row + entry.footprintH > layout.rows
    ) {
      return false;
    }
  }

  // Wall/VOID placement check (background rows skip this check)
  const bgRows = entry.backgroundTiles || 0;
  for (let dr = 0; dr < entry.footprintH; dr++) {
    if (dr < bgRows) continue;
    if (row + dr < 0) continue; // row above map (wall items extending upward)
    // Wall items: only the bottom row must be on wall tiles; upper rows can overlap VOID/anything
    if (entry.canPlaceOnWalls && dr < entry.footprintH - 1) continue;
    for (let dc = 0; dc < entry.footprintW; dc++) {
      const idx = (row + dr) * layout.cols + (col + dc);
      const tileVal = layout.tiles[idx];
      if (entry.canPlaceOnWalls) {
        if (tileVal !== TileType.WALL) return false;
      } else {
        if (tileVal === TileType.VOID) return false; // Cannot place on VOID
        if (tileVal === TileType.WALL) return false; // Normal items cannot overlap walls
      }
    }
  }

  // Build occupied set excluding the item being moved, skipping background tile rows
  const occupied = getPlacementBlockedTiles(layout.furniture, excludeUid);

  // If this item can be placed on surfaces, build set of desk tiles to exclude from collision
  let deskTiles: Set<string> | null = null;
  if (entry.canPlaceOnSurfaces) {
    deskTiles = new Set<string>();
    for (const item of layout.furniture) {
      if (item.uid === excludeUid) continue;
      const itemEntry = getCatalogEntry(item.type);
      if (!itemEntry || !itemEntry.isDesk) continue;
      for (let dr = 0; dr < itemEntry.footprintH; dr++) {
        for (let dc = 0; dc < itemEntry.footprintW; dc++) {
          deskTiles.add(`${item.col + dc},${item.row + dr}`);
        }
      }
    }
  }

  // Check overlap — also skip the NEW item's own background rows
  const newBgRows = entry.backgroundTiles || 0;
  for (let dr = 0; dr < entry.footprintH; dr++) {
    if (dr < newBgRows) continue; // new item's background rows can overlap existing items
    if (row + dr < 0) continue; // row above map (wall items extending upward)
    for (let dc = 0; dc < entry.footprintW; dc++) {
      const key = `${col + dc},${row + dr}`;
      if (occupied.has(key) && !deskTiles?.has(key)) return false;
    }
  }

  return true;
}

/**
 * Stamp a room template onto an existing layout at a given offset.
 * Non-VOID tiles from the template overwrite base tiles. Furniture is cloned
 * with new UIDs and placed at offset positions. Returns a new layout (immutable).
 */
export function stampRoom(
  base: OfficeLayout,
  template: OfficeLayout,
  offsetCol: number,
  offsetRow: number,
): OfficeLayout {
  const newTiles = [...base.tiles];
  const existingColors = base.tileColors || new Array(base.tiles.length).fill(null);
  const newColors: Array<(typeof existingColors)[number]> = [...existingColors];
  const templateColors = template.tileColors || new Array(template.tiles.length).fill(null);

  for (let tr = 0; tr < template.rows; tr++) {
    for (let tc = 0; tc < template.cols; tc++) {
      const tileVal = template.tiles[tr * template.cols + tc];
      if (tileVal === TileType.VOID) continue;
      const bc = offsetCol + tc;
      const br = offsetRow + tr;
      if (bc < 0 || bc >= base.cols || br < 0 || br >= base.rows) continue;
      const baseIdx = br * base.cols + bc;
      newTiles[baseIdx] = tileVal;
      newColors[baseIdx] = templateColors[tr * template.cols + tc];
    }
  }

  const newFurniture: PlacedFurniture[] = [
    ...base.furniture,
    ...template.furniture
      .map((f) => ({ ...f, uid: crypto.randomUUID(), col: f.col + offsetCol, row: f.row + offsetRow }))
      .filter((f) => f.col >= 0 && f.col < base.cols && f.row >= 0 && f.row < base.rows),
  ];

  return { ...base, tiles: newTiles, tileColors: newColors, furniture: newFurniture };
}

export type ExpandDirection = 'left' | 'right' | 'up' | 'down';

/**
 * Expand layout by 1 tile in the given direction. New tiles are VOID.
 * Furniture and tile indices are shifted when expanding left or up.
 * Returns { layout, shift } or null if exceeding MAX_COLS/MAX_ROWS.
 */
export function expandLayout(
  layout: OfficeLayout,
  direction: ExpandDirection,
): { layout: OfficeLayout; shift: { col: number; row: number } } | null {
  const { cols, rows, tiles, furniture, tileColors } = layout;
  const existingColors = tileColors || new Array(tiles.length).fill(null);

  let newCols = cols;
  let newRows = rows;
  let shiftCol = 0;
  let shiftRow = 0;

  if (direction === 'right') {
    newCols = cols + 1;
  } else if (direction === 'left') {
    newCols = cols + 1;
    shiftCol = 1;
  } else if (direction === 'down') {
    newRows = rows + 1;
  } else if (direction === 'up') {
    newRows = rows + 1;
    shiftRow = 1;
  }

  if (newCols > MAX_COLS || newRows > MAX_ROWS) return null;

  // Build new tile array
  const newTiles: TileTypeVal[] = new Array(newCols * newRows).fill(TileType.VOID as TileTypeVal);
  const newColors: Array<ColorValue | null> = new Array(newCols * newRows).fill(null);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const oldIdx = r * cols + c;
      const newIdx = (r + shiftRow) * newCols + (c + shiftCol);
      newTiles[newIdx] = tiles[oldIdx];
      newColors[newIdx] = existingColors[oldIdx];
    }
  }

  // Shift furniture positions
  const newFurniture: PlacedFurniture[] = furniture.map((f) => ({
    ...f,
    col: f.col + shiftCol,
    row: f.row + shiftRow,
  }));

  return {
    layout: {
      ...layout,
      cols: newCols,
      rows: newRows,
      tiles: newTiles,
      tileColors: newColors,
      furniture: newFurniture,
      zones: layout.zones?.map((z) => ({
        ...z,
        col: z.col + shiftCol,
        row: z.row + shiftRow,
      })),
    },
    shift: { col: shiftCol, row: shiftRow },
  };
}

/**
 * Trim VOID-only rows and columns from all four edges of the layout, shrinking the grid to
 * the tightest bounding box that contains all non-VOID tiles and all furniture.
 * Furniture positions and zone coords are shifted to stay correct.
 */
export function trimLayout(layout: OfficeLayout): OfficeLayout {
  let minCol = layout.cols;
  let maxCol = -1;
  let minRow = layout.rows;
  let maxRow = -1;

  // Expand bbox from non-VOID tiles
  for (let row = 0; row < layout.rows; row++) {
    for (let col = 0; col < layout.cols; col++) {
      if (layout.tiles[row * layout.cols + col] !== TileType.VOID) {
        if (col < minCol) minCol = col;
        if (col > maxCol) maxCol = col;
        if (row < minRow) minRow = row;
        if (row > maxRow) maxRow = row;
      }
    }
  }

  // Also include furniture footprints (wall items can have row < 0)
  for (const f of layout.furniture) {
    const entry = getCatalogEntry(f.type);
    if (!entry) continue;
    if (f.col < minCol) minCol = f.col;
    if (f.col + entry.footprintW - 1 > maxCol) maxCol = f.col + entry.footprintW - 1;
    // For row: only expand downward from VOID-less area; don't expand upward into negatives
    // (wall items extend above the visible grid intentionally)
    const effectiveRow = Math.max(0, f.row);
    if (effectiveRow < minRow) minRow = effectiveRow;
    if (f.row + entry.footprintH - 1 > maxRow) maxRow = f.row + entry.footprintH - 1;
  }

  if (maxCol < 0 || maxRow < 0) return layout; // nothing to trim

  const newCols = maxCol - minCol + 1;
  const newRows = maxRow - minRow + 1;

  if (minCol === 0 && minRow === 0 && newCols === layout.cols && newRows === layout.rows) {
    return layout; // already tight
  }

  // Rebuild tile array
  const newTiles: number[] = new Array(newCols * newRows).fill(TileType.VOID);
  const newTileColors: (unknown | null)[] = new Array(newCols * newRows).fill(null);
  for (let row = minRow; row <= maxRow; row++) {
    for (let col = minCol; col <= maxCol; col++) {
      const srcIdx = row * layout.cols + col;
      const dstIdx = (row - minRow) * newCols + (col - minCol);
      newTiles[dstIdx] = layout.tiles[srcIdx] ?? TileType.VOID;
      newTileColors[dstIdx] = layout.tileColors?.[srcIdx] ?? null;
    }
  }

  const hasTileColors = newTileColors.some((c) => c !== null);

  return {
    ...layout,
    cols: newCols,
    rows: newRows,
    tiles: newTiles,
    tileColors: hasTileColors ? newTileColors : layout.tileColors ? [] : undefined,
    furniture: layout.furniture.map((f) => ({ ...f, col: f.col - minCol, row: f.row - minRow })),
    zones: layout.zones?.map((z) => ({
      ...z,
      col: z.col - minCol,
      row: z.row - minRow,
    })),
  };
}

/** Add a new zone to the layout. Returns new layout (immutable). */
export function addZone(layout: OfficeLayout, zone: RoomZone): OfficeLayout {
  return { ...layout, zones: [...(layout.zones ?? []), zone] };
}

/** Update fields on an existing zone by id. Returns new layout (immutable). */
export function updateZone(
  layout: OfficeLayout,
  id: string,
  changes: Partial<RoomZone>,
): OfficeLayout {
  return {
    ...layout,
    zones: (layout.zones ?? []).map((z) => (z.id === id ? { ...z, ...changes } : z)),
  };
}

/** Remove a zone by id. Returns new layout (immutable). */
export function removeZone(layout: OfficeLayout, id: string): OfficeLayout {
  return { ...layout, zones: (layout.zones ?? []).filter((z) => z.id !== id) };
}
