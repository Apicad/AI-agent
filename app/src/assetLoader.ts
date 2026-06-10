import * as fs from 'fs';
import * as path from 'path';

// Use dynamic imports to handle the shared module paths at runtime
let _buildFurnitureCatalog: ((assetsDir: string) => unknown[]) | null = null;
let _decodeAllCharacters: ((assetsDir: string) => unknown[]) | null = null;
let _decodeAllFloors: ((assetsDir: string) => unknown[]) | null = null;
let _decodeAllWalls: ((assetsDir: string) => unknown[]) | null = null;
let _decodeAllFurniture: ((assetsDir: string, catalog: unknown[]) => Record<string, unknown>) | null = null;

async function loadSharedModules(projectRoot: string): Promise<void> {
  if (_buildFurnitureCatalog) return; // already loaded

  const buildPath = path.join(projectRoot, 'shared', 'dist', 'assets', 'build.js');
  const loaderPath = path.join(projectRoot, 'shared', 'dist', 'assets', 'loader.js');

  try {
    // Try compiled JS first
    if (fs.existsSync(buildPath)) {
      const buildMod = await import(buildPath) as { buildFurnitureCatalog: (assetsDir: string) => unknown[] };
      _buildFurnitureCatalog = buildMod.buildFurnitureCatalog;
    }
    if (fs.existsSync(loaderPath)) {
      const loaderMod = await import(loaderPath) as {
        decodeAllCharacters: (assetsDir: string) => unknown[];
        decodeAllFloors: (assetsDir: string) => unknown[];
        decodeAllWalls: (assetsDir: string) => unknown[];
        decodeAllFurniture: (assetsDir: string, catalog: unknown[]) => Record<string, unknown>;
      };
      _decodeAllCharacters = loaderMod.decodeAllCharacters;
      _decodeAllFloors = loaderMod.decodeAllFloors;
      _decodeAllWalls = loaderMod.decodeAllWalls;
      _decodeAllFurniture = loaderMod.decodeAllFurniture;
    }
  } catch (err) {
    console.warn('[Pixel Agents] Could not load shared modules (compiled JS):', err);
  }

  // Try tsx/ts-node path — import the TS source directly via tsx
  if (!_buildFurnitureCatalog) {
    try {
      const buildTsPath = path.join(projectRoot, 'shared', 'assets', 'build.ts');
      const loaderTsPath = path.join(projectRoot, 'shared', 'assets', 'loader.ts');
      if (fs.existsSync(buildTsPath)) {
        const buildMod = await import(buildTsPath) as { buildFurnitureCatalog: (assetsDir: string) => unknown[] };
        _buildFurnitureCatalog = buildMod.buildFurnitureCatalog;
      }
      if (fs.existsSync(loaderTsPath)) {
        const loaderMod = await import(loaderTsPath) as {
          decodeAllCharacters: (assetsDir: string) => unknown[];
          decodeAllFloors: (assetsDir: string) => unknown[];
          decodeAllWalls: (assetsDir: string) => unknown[];
          decodeAllFurniture: (assetsDir: string, catalog: unknown[]) => Record<string, unknown>;
        };
        _decodeAllCharacters = loaderMod.decodeAllCharacters;
        _decodeAllFloors = loaderMod.decodeAllFloors;
        _decodeAllWalls = loaderMod.decodeAllWalls;
        _decodeAllFurniture = loaderMod.decodeAllFurniture;
      }
    } catch (err) {
      console.warn('[Pixel Agents] Could not load shared modules (TS source):', err);
    }
  }
}

export interface LoadedAssets {
  characters: unknown[];
  floors: unknown[];
  walls: unknown[];
  furnitureCatalog: unknown[];
  furnitureSprites: Record<string, unknown>;
  defaultLayout: Record<string, unknown> | null;
}

export async function loadAssets(assetsDir: string, projectRoot: string): Promise<LoadedAssets> {
  await loadSharedModules(projectRoot);

  let characters: unknown[] = [];
  let floors: unknown[] = [];
  let walls: unknown[] = [];
  let furnitureCatalog: unknown[] = [];
  let furnitureSprites: Record<string, unknown> = {};

  try {
    if (_decodeAllCharacters) characters = _decodeAllCharacters(assetsDir);
  } catch (err) {
    console.warn('[Pixel Agents] Failed to decode characters:', err);
  }

  try {
    if (_decodeAllFloors) floors = _decodeAllFloors(assetsDir);
  } catch (err) {
    console.warn('[Pixel Agents] Failed to decode floors:', err);
  }

  try {
    if (_decodeAllWalls) walls = _decodeAllWalls(assetsDir);
  } catch (err) {
    console.warn('[Pixel Agents] Failed to decode walls:', err);
  }

  try {
    if (_buildFurnitureCatalog) furnitureCatalog = _buildFurnitureCatalog(assetsDir);
  } catch (err) {
    console.warn('[Pixel Agents] Failed to build furniture catalog:', err);
  }

  try {
    if (_decodeAllFurniture && furnitureCatalog.length > 0) {
      furnitureSprites = _decodeAllFurniture(assetsDir, furnitureCatalog);
    }
  } catch (err) {
    console.warn('[Pixel Agents] Failed to decode furniture sprites:', err);
  }

  // Load default layout
  let defaultLayout: Record<string, unknown> | null = null;
  try {
    // Try versioned layout first (highest revision number)
    let bestFile: string | null = null;
    let bestRev = 0;
    for (const f of fs.readdirSync(assetsDir)) {
      const m = /^default-layout-(\d+)\.json$/.exec(f);
      if (m) {
        const rev = parseInt(m[1], 10);
        if (rev > bestRev) { bestRev = rev; bestFile = f; }
      }
    }
    if (!bestFile) {
      const plainDefault = path.join(assetsDir, 'default-layout.json');
      if (fs.existsSync(plainDefault)) bestFile = 'default-layout.json';
    }
    if (bestFile) {
      const raw = fs.readFileSync(path.join(assetsDir, bestFile), 'utf-8');
      defaultLayout = JSON.parse(raw) as Record<string, unknown>;
    }
  } catch (err) {
    console.warn('[Pixel Agents] Failed to load default layout:', err);
  }

  console.log(`[Pixel Agents] Assets loaded: ${characters.length} chars, ${floors.length} floors, ${walls.length} walls, ${furnitureCatalog.length} furniture`);

  return { characters, floors, walls, furnitureCatalog, furnitureSprites, defaultLayout };
}
