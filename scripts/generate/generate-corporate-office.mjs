/**
 * Generate a Corporate Office layout (44 cols × 24 rows).
 *
 * Tile values:
 *   255 = VOID   (exterior / empty)
 *     0 = WALL
 *     1 = FLOOR_1 (dark carpet)   — conference room
 *     2 = FLOOR_2 (light wood)    — open plan, break room
 *     3 = FLOOR_3 (warm carpet)   — private offices, huddle room
 *     4 = FLOOR_4 (carpet)        — reception / waiting
 *     5 = FLOOR_5 (gray tile)     — server room, restrooms
 *
 * Grid coordinates: col = 0..43, row = 0..23
 */

const COLS = 44;
const ROWS = 24;

const VOID = 255;
const WALL = 0;
const F1   = 1;  // dark carpet      → conference room
const F2   = 2;  // light wood       → open plan, break room
const F3   = 3;  // warm carpet      → private offices, huddle room
const F4   = 4;  // carpet           → reception / waiting
const F5   = 5;  // gray tile        → server room, restrooms

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeTiles() {
  return new Array(COLS * ROWS).fill(VOID);
}

function idx(col, row) {
  return row * COLS + col;
}

function setTile(tiles, col, row, val) {
  if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return;
  tiles[idx(col, row)] = val;
}

function fillRect(tiles, col, row, cols, rows, val) {
  for (let r = row; r < row + rows; r++) {
    for (let c = col; c < col + cols; c++) {
      setTile(tiles, c, r, val);
    }
  }
}

// Draw a horizontal wall line, optionally leaving a doorway gap
function hWall(tiles, col, row, len, doorCols = []) {
  const doorSet = new Set(doorCols);
  for (let c = col; c < col + len; c++) {
    setTile(tiles, c, row, doorSet.has(c) ? VOID : WALL);
  }
}

// Draw a vertical wall line, optionally leaving a doorway gap
function vWall(tiles, col, row, len, doorRows = []) {
  const doorSet = new Set(doorRows);
  for (let r = row; r < row + len; r++) {
    setTile(tiles, col, r, doorSet.has(r) ? VOID : WALL);
  }
}

// ── Build layout ─────────────────────────────────────────────────────────────

const tiles = makeTiles();

// ── Outer building wall ──────────────────────────────────────────────────────
// VOID border: rows 0, 23, cols 0, 43  (already VOID from init)
// Outer wall ring: row 1, row 22, col 1, col 42
hWall(tiles, 1, 1, 42);       // top outer wall
hWall(tiles, 1, 22, 42);      // bottom outer wall
vWall(tiles, 1, 1, 22);       // left outer wall
vWall(tiles, 42, 1, 22);      // right outer wall

// ── TOP SECTION — private offices + server + conference (rows 2–10) ──────────

// Floor fills first (rows 2..10)
//  Office 1:     cols 2–8
fillRect(tiles, 2,  2, 7, 9, F3);
//  Office 2:     cols 10–16
fillRect(tiles, 10, 2, 7, 9, F3);
//  Office 3:     cols 18–24
fillRect(tiles, 18, 2, 7, 9, F3);
//  Server Room:  cols 26–29
fillRect(tiles, 26, 2, 4, 9, F5);
//  Conference:   cols 31–41
fillRect(tiles, 31, 2, 11, 9, F1);

// Internal vertical dividing walls (col 9, 17, 25, 30) — rows 1..11
// (row 1 and 11 are already outer/dividing walls)
vWall(tiles, 9,  2, 9);   // Ofc1 | Ofc2
vWall(tiles, 17, 2, 9);   // Ofc2 | Ofc3
vWall(tiles, 25, 2, 9);   // Ofc3 | Server
vWall(tiles, 30, 2, 9);   // Server | Conference

// ── DIVIDING WALL — row 11 (horizontal wall between top and bottom) ───────────
// Full wall cols 1..42, with doorways at:
//   col 5  (Office 1 corridor),  col 13 (Office 2), col 21 (Office 3)
//   col 28 (Server Room),        col 36 (Conference)
hWall(tiles, 1, 11, 42, [5, 13, 21, 28, 36]);

// ── BOTTOM SECTION — rows 12–21 ──────────────────────────────────────────────

// Reception / Waiting: cols 2–11
fillRect(tiles, 2,  12, 10, 10, F4);

// Open Plan Workstations: cols 13–27
fillRect(tiles, 13, 12, 15, 10, F2);

// Restrooms: cols 29–41, rows 12–16
fillRect(tiles, 29, 12, 13, 5, F5);

// Huddle Room: cols 29–34, rows 18–21
fillRect(tiles, 29, 18, 6, 4, F3);

// Break Room: cols 36–41, rows 18–21
fillRect(tiles, 36, 18, 6, 4, F2);

// ── INTERNAL VERTICAL WALLS ───────────────────────────────────────────────────

// col 12 separates Reception from Open Plan (rows 11..22), door at row 17
vWall(tiles, 12, 11, 12, [17]);

// col 28 separates Open Plan from Restrooms / Huddle / Break (rows 11..22), door at row 16
vWall(tiles, 28, 11, 12, [16]);

// Row 17 horizontal wall between restrooms area (top) and huddle/break (bottom)
// cols 28..42, doors at col 32 (huddle entry) and col 38 (break room entry)
hWall(tiles, 28, 17, 15, [32, 38]);

// col 35 between huddle and break rooms (rows 17..22)
vWall(tiles, 35, 17, 6);

// ── CORRIDOR WALLS (gap rows between restrooms area and row 17) ──────────────
// Fill the corridor gap (rows 17 within restrooms cols 29-27 is already handled)
// Seal corridor row 17 tile at cols 29..27 (already wall from hWall above)

// ── Verify ───────────────────────────────────────────────────────────────────
const totalTiles = tiles.length;
console.error(`[generate-corporate-office] Total tiles: ${totalTiles} (expected ${COLS * ROWS})`);
const floorCount = tiles.filter(t => t >= 1 && t <= 9).length;
const wallCount  = tiles.filter(t => t === 0).length;
const voidCount  = tiles.filter(t => t === 255).length;
console.error(`  FLOOR: ${floorCount}, WALL: ${wallCount}, VOID: ${voidCount}, sum: ${floorCount + wallCount + voidCount}`);

// ── Output layout JSON ────────────────────────────────────────────────────────
const layout = {
  name: "Corporate Office",
  version: 1,
  cols: COLS,
  rows: ROWS,
  tiles,
  furniture: [],
  tileColors: new Array(COLS * ROWS).fill(null),
};

process.stdout.write(JSON.stringify(layout));
