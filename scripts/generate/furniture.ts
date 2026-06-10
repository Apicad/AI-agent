/**
 * Generate pixel art furniture sprites via the PixelLab API.
 * Usage: npx tsx scripts/generate/furniture.ts
 * Requires: PIXELLAB_API_KEY environment variable (add to .env)
 */

import * as fs from 'fs';
import * as path from 'path';
import { PNG } from 'pngjs';

const API_KEY = process.env.PIXELLAB_API_KEY;
if (!API_KEY) {
  console.error('Error: PIXELLAB_API_KEY environment variable is not set.');
  console.error('Add PIXELLAB_API_KEY=your-key to your .env file');
  process.exit(1);
}

const BASE_URL = 'https://api.pixellab.ai/v2';
const ASSETS_DIR = path.join(
  import.meta.dirname ?? __dirname,
  '../../webview-ui/public/assets/furniture',
);

interface PixelImage {
  type: string;
  width: number;
  base64: string;
}

interface LastResponse {
  images?: PixelImage[];
}

interface JobResponse {
  background_job_id?: string;
  status: string;
  images?: PixelImage[];
  image?: PixelImage;
  last_response?: LastResponse;
}

/** Convert raw RGBA bytes to PNG buffer using pngjs. */
function rgbaBytesToPng(base64: string, width: number): Buffer {
  const raw = Buffer.from(base64, 'base64');
  const height = raw.length / (width * 4);
  const png = new PNG({ width, height });
  png.data = raw;
  return PNG.sync.write(png);
}

/** Extract PNG buffer from a PixelImage (rgba_bytes or base64 PNG). */
function extractPng(img: PixelImage): Buffer {
  if (img.type === 'rgba_bytes') {
    return rgbaBytesToPng(img.base64, img.width);
  }
  return Buffer.from(img.base64, 'base64');
}

async function generateImage(description: string, width: number, height: number): Promise<Buffer> {
  const res = await fetch(`${BASE_URL}/generate-image-v2`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      description,
      image_size: { width, height },
      no_background: true,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`API error ${res.status}: ${err}`);
  }

  const data = (await res.json()) as JobResponse;

  if (data.image) return extractPng(data.image);
  if (data.images?.[0]) return extractPng(data.images[0]);
  if (data.last_response?.images?.[0]) return extractPng(data.last_response.images[0]);

  const jobId = data.background_job_id;
  if (!jobId) throw new Error(`No job ID in response: ${JSON.stringify(data)}`);

  console.log(`  Polling job ${jobId}...`);
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const pollRes = await fetch(`${BASE_URL}/background-jobs/${jobId}`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
    const pollData = (await pollRes.json()) as JobResponse;
    if (pollData.status === 'completed' || pollData.status === 'done') {
      const img =
        pollData.image ?? pollData.images?.[0] ?? pollData.last_response?.images?.[0];
      if (img) return extractPng(img);
      throw new Error(`Job done but no image: ${JSON.stringify(pollData).slice(0, 200)}`);
    }
    if (pollData.status === 'failed') {
      throw new Error(`Job failed: ${JSON.stringify(pollData)}`);
    }
    process.stdout.write('.');
  }
  throw new Error('Timed out waiting for job');
}

function savePng(buf: Buffer, filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, buf);
}

// ── Furniture definitions ─────────────────────────────────────

interface FurnitureDef {
  id: string;
  name: string;
  category: string;
  isDesk?: boolean;
  canPlaceOnWalls?: boolean;
  canPlaceOnSurfaces?: boolean;
  backgroundTiles?: number;
  assets: Array<{
    id: string;
    width: number;
    height: number;
    footprintW: number;
    footprintH: number;
    orientation?: string;
    state?: string;
    description: string;
    mirrorSide?: boolean;
  }>;
  groupType?: string;
  rotationScheme?: string;
}

// ── Batch 1 ───────────────────────────────────────────────────

const FURNITURE_BATCH_1: FurnitureDef[] = [
  {
    id: 'COFFEE_MACHINE',
    name: 'Coffee Machine',
    category: 'electronics',
    canPlaceOnSurfaces: true,
    backgroundTiles: 1,
    groupType: 'rotation',
    rotationScheme: '1-way',
    assets: [
      {
        id: 'COFFEE_MACHINE_FRONT',
        width: 16,
        height: 32,
        footprintW: 1,
        footprintH: 2,
        orientation: 'front',
        description:
          'top-down isometric pixel art coffee machine, office kitchen appliance, silver and black, seen from slightly above, 16x32 pixels, transparent background',
      },
    ],
  },
  {
    id: 'PRINTER',
    name: 'Printer',
    category: 'electronics',
    canPlaceOnSurfaces: true,
    backgroundTiles: 1,
    groupType: 'rotation',
    rotationScheme: '1-way',
    assets: [
      {
        id: 'PRINTER_FRONT',
        width: 16,
        height: 16,
        footprintW: 1,
        footprintH: 1,
        orientation: 'front',
        description:
          'top-down pixel art office printer, white and gray, seen from slightly above front, 16x16 pixels, transparent background',
      },
    ],
  },
  {
    id: 'FILING_CABINET',
    name: 'Filing Cabinet',
    category: 'storage',
    backgroundTiles: 0,
    groupType: 'rotation',
    rotationScheme: '1-way',
    assets: [
      {
        id: 'FILING_CABINET_FRONT',
        width: 16,
        height: 32,
        footprintW: 1,
        footprintH: 2,
        orientation: 'front',
        description:
          'top-down pixel art metal filing cabinet with 3 drawers, gray, office furniture, seen from slightly above, 16x32 pixels, transparent background',
      },
    ],
  },
  {
    id: 'LOCKER',
    name: 'Locker',
    category: 'storage',
    backgroundTiles: 0,
    groupType: 'rotation',
    rotationScheme: '1-way',
    assets: [
      {
        id: 'LOCKER_FRONT',
        width: 32,
        height: 32,
        footprintW: 2,
        footprintH: 2,
        orientation: 'front',
        description:
          'top-down pixel art row of 2 metal lockers, school or office lockers, blue or gray, seen from slightly above front, 32x32 pixels, transparent background',
      },
    ],
  },
  {
    id: 'WATER_COOLER',
    name: 'Water Cooler',
    category: 'misc',
    backgroundTiles: 0,
    groupType: 'rotation',
    rotationScheme: '1-way',
    assets: [
      {
        id: 'WATER_COOLER_FRONT',
        width: 16,
        height: 32,
        footprintW: 1,
        footprintH: 2,
        orientation: 'front',
        description:
          'top-down pixel art office water cooler dispenser with blue water bottle on top, white body, seen from slightly above, 16x32 pixels, transparent background',
      },
    ],
  },
  {
    id: 'ARCADE_CABINET',
    name: 'Arcade Cabinet',
    category: 'decor',
    backgroundTiles: 0,
    groupType: 'rotation',
    rotationScheme: '2-way',
    assets: [
      {
        id: 'ARCADE_CABINET_FRONT',
        width: 16,
        height: 32,
        footprintW: 1,
        footprintH: 2,
        orientation: 'front',
        description:
          'top-down pixel art retro arcade cabinet with colorful screen, seen from slightly above front, dark cabinet with glowing screen, 16x32 pixels, transparent background',
      },
      {
        id: 'ARCADE_CABINET_BACK',
        width: 16,
        height: 32,
        footprintW: 1,
        footprintH: 2,
        orientation: 'back',
        description:
          'top-down pixel art back of retro arcade cabinet, dark gray back panel, seen from slightly above behind, 16x32 pixels, transparent background',
      },
    ],
  },
  {
    id: 'PINBOARD',
    name: 'Pinboard',
    category: 'wall',
    canPlaceOnWalls: true,
    backgroundTiles: 0,
    groupType: 'rotation',
    rotationScheme: '1-way',
    assets: [
      {
        id: 'PINBOARD_FRONT',
        width: 32,
        height: 16,
        footprintW: 2,
        footprintH: 1,
        orientation: 'front',
        description:
          'pixel art corkboard pinboard on wall with colorful sticky notes and pins, office bulletin board, top-down view, 32x16 pixels, transparent background',
      },
    ],
  },
  {
    id: 'CONFERENCE_TABLE',
    name: 'Conference Table',
    category: 'desks',
    backgroundTiles: 1,
    groupType: 'rotation',
    rotationScheme: '1-way',
    assets: [
      {
        id: 'CONFERENCE_TABLE_FRONT',
        width: 64,
        height: 32,
        footprintW: 4,
        footprintH: 2,
        orientation: 'front',
        description:
          'top-down pixel art large oval conference table, wooden surface, office meeting room, seen from slightly above, 64x32 pixels, transparent background',
      },
    ],
  },
  {
    id: 'SNACK_MACHINE',
    name: 'Snack Machine',
    category: 'misc',
    backgroundTiles: 0,
    groupType: 'rotation',
    rotationScheme: '1-way',
    assets: [
      {
        id: 'SNACK_MACHINE_FRONT',
        width: 16,
        height: 32,
        footprintW: 1,
        footprintH: 2,
        orientation: 'front',
        description:
          'top-down pixel art vending machine snack machine with colorful items inside, glass front, office break room, seen from slightly above, 16x32 pixels, transparent background',
      },
    ],
  },
  {
    id: 'COUCH_CORNER',
    name: 'Corner Couch',
    category: 'chairs',
    backgroundTiles: 0,
    groupType: 'rotation',
    rotationScheme: '1-way',
    assets: [
      {
        id: 'COUCH_CORNER_FRONT',
        width: 32,
        height: 32,
        footprintW: 2,
        footprintH: 2,
        orientation: 'front',
        description:
          'top-down pixel art corner couch sofa for office lounge, L-shaped, comfortable, gray or blue, seen from above slightly, 32x32 pixels, transparent background',
      },
    ],
  },
];

// ── Batch 2 ───────────────────────────────────────────────────

const FURNITURE_BATCH_2: FurnitureDef[] = [
  {
    id: 'TV_WALL',
    name: 'Wall TV',
    category: 'wall',
    canPlaceOnWalls: true,
    groupType: 'rotation',
    rotationScheme: '1-way',
    assets: [
      {
        id: 'TV_WALL_FRONT',
        width: 32,
        height: 16,
        footprintW: 2,
        footprintH: 1,
        orientation: 'front',
        description:
          'pixel art flat screen TV mounted on wall, turned on with colorful screen showing, modern television, seen from slightly above front, 32x16 pixels, no background',
      },
    ],
  },
  {
    id: 'ARMCHAIR',
    name: 'Armchair',
    category: 'chairs',
    groupType: 'rotation',
    rotationScheme: '1-way',
    assets: [
      {
        id: 'ARMCHAIR_FRONT',
        width: 16,
        height: 16,
        footprintW: 1,
        footprintH: 1,
        orientation: 'front',
        description:
          'pixel art cozy armchair seen from slightly above front, comfortable upholstered chair with armrests, warm brown or teal color, office lounge chair, 16x16 pixels, no background',
      },
    ],
  },
  {
    id: 'FLOOR_LAMP',
    name: 'Floor Lamp',
    category: 'decor',
    groupType: 'rotation',
    rotationScheme: '1-way',
    assets: [
      {
        id: 'FLOOR_LAMP_FRONT',
        width: 16,
        height: 32,
        footprintW: 1,
        footprintH: 2,
        orientation: 'front',
        description:
          'pixel art tall floor standing lamp, modern arc floor lamp, golden or silver pole with round lampshade glowing warm yellow, seen from slightly above, 16x32 pixels, no background',
      },
    ],
  },
  {
    id: 'BEAN_BAG',
    name: 'Bean Bag',
    category: 'chairs',
    groupType: 'rotation',
    rotationScheme: '1-way',
    assets: [
      {
        id: 'BEAN_BAG_FRONT',
        width: 16,
        height: 16,
        footprintW: 1,
        footprintH: 1,
        orientation: 'front',
        description:
          'pixel art bean bag chair seen from above, round comfortable floor cushion, colorful purple or orange, office lounge seating, top-down 2.5D view, 16x16 pixels, no background',
      },
    ],
  },
  {
    id: 'WALL_PAINTING_3',
    name: 'Abstract Painting',
    category: 'wall',
    canPlaceOnWalls: true,
    groupType: 'rotation',
    rotationScheme: '1-way',
    assets: [
      {
        id: 'WALL_PAINTING_3_FRONT',
        width: 16,
        height: 16,
        footprintW: 1,
        footprintH: 1,
        orientation: 'front',
        description:
          'pixel art colorful abstract painting hanging on wall, framed artwork with vibrant colors, modern office art, front view, 16x16 pixels, no background',
      },
    ],
  },
  {
    id: 'FERN_PLANT',
    name: 'Fern Plant',
    category: 'decor',
    groupType: 'rotation',
    rotationScheme: '1-way',
    assets: [
      {
        id: 'FERN_PLANT_FRONT',
        width: 16,
        height: 32,
        footprintW: 1,
        footprintH: 2,
        orientation: 'front',
        description:
          'pixel art potted fern plant, lush green fern leaves in a terracotta pot, office decor, seen from slightly above, 16x32 pixels, no background',
      },
    ],
  },
  {
    id: 'NEON_SIGN',
    name: 'Neon Sign',
    category: 'wall',
    canPlaceOnWalls: true,
    groupType: 'rotation',
    rotationScheme: '1-way',
    assets: [
      {
        id: 'NEON_SIGN_FRONT',
        width: 32,
        height: 16,
        footprintW: 2,
        footprintH: 1,
        orientation: 'front',
        description:
          'pixel art glowing neon sign on wall, bright pink or cyan neon tube lights forming a simple shape or word, retro aesthetic, 32x16 pixels, no background',
      },
    ],
  },
  {
    id: 'STANDING_DESK',
    name: 'Standing Desk',
    category: 'desks',
    isDesk: true,
    groupType: 'rotation',
    rotationScheme: '1-way',
    assets: [
      {
        id: 'STANDING_DESK_FRONT',
        width: 32,
        height: 16,
        footprintW: 2,
        footprintH: 1,
        orientation: 'front',
        description:
          'pixel art height adjustable standing desk, modern office desk with metal legs, white or light wood top, seen from slightly above front, 32x16 pixels, no background',
      },
    ],
  },
  {
    id: 'MINI_FRIDGE',
    name: 'Mini Fridge',
    category: 'misc',
    groupType: 'rotation',
    rotationScheme: '1-way',
    assets: [
      {
        id: 'MINI_FRIDGE_FRONT',
        width: 16,
        height: 32,
        footprintW: 1,
        footprintH: 2,
        orientation: 'front',
        description:
          'pixel art small mini fridge refrigerator, white or silver compact fridge for office, seen from slightly above front, 16x32 pixels, no background',
      },
    ],
  },
  {
    id: 'TROPHY_SHELF',
    name: 'Trophy Shelf',
    category: 'decor',
    groupType: 'rotation',
    rotationScheme: '1-way',
    assets: [
      {
        id: 'TROPHY_SHELF_FRONT',
        width: 32,
        height: 32,
        footprintW: 2,
        footprintH: 2,
        orientation: 'front',
        description:
          'pixel art display shelf with small trophies and awards on it, wooden shelf unit, golden trophies, office achievement display, slightly above top-down view, 32x32 pixels, no background',
      },
    ],
  },
  {
    id: 'POOL_TABLE',
    name: 'Pool Table',
    category: 'misc',
    groupType: 'rotation',
    rotationScheme: '1-way',
    assets: [
      {
        id: 'POOL_TABLE_FRONT',
        width: 48,
        height: 32,
        footprintW: 3,
        footprintH: 2,
        orientation: 'front',
        description:
          'pixel art billiard pool table with bright green felt surface, dark wooden frame with carved legs, white cue ball and colored billiard balls arranged in triangle rack, wooden pool cue resting on side, seen from slightly above isometric 2.5D view, 48x32 pixels, no background',
      },
    ],
  },
];

// ── Main ──────────────────────────────────────────────────────

async function generateBatch(items: FurnitureDef[]): Promise<void> {
  for (const item of items) {
    const itemDir = path.join(ASSETS_DIR, item.id);
    const manifestPath = path.join(itemDir, 'manifest.json');

    if (fs.existsSync(manifestPath)) {
      console.log(`✓ ${item.id} already exists, skipping.`);
      continue;
    }

    console.log(`\n→ Generating ${item.name} (${item.id})`);
    fs.mkdirSync(itemDir, { recursive: true });

    const members = [];

    for (const asset of item.assets) {
      const pngPath = path.join(itemDir, `${asset.id}.png`);
      try {
        console.log(`  Generating ${asset.id} (${asset.width}x${asset.height})...`);
        const pngBuf = await generateImage(asset.description, asset.width, asset.height);
        savePng(pngBuf, pngPath);
        console.log(`  ✓ Saved ${asset.id}.png`);

        const assetEntry: Record<string, unknown> = {
          type: 'asset',
          id: asset.id,
          file: `${asset.id}.png`,
          width: asset.width,
          height: asset.height,
          footprintW: asset.footprintW,
          footprintH: asset.footprintH,
        };
        if (asset.orientation) assetEntry.orientation = asset.orientation;
        if (asset.state) assetEntry.state = asset.state;
        if (asset.mirrorSide) assetEntry.mirrorSide = true;
        members.push(assetEntry);
      } catch (err) {
        console.error(`  ✗ Failed to generate ${asset.id}:`, err);
      }
    }

    if (members.length === 0) {
      console.log(`  ✗ No assets generated for ${item.id}, skipping manifest.`);
      continue;
    }

    const manifest: Record<string, unknown> = {
      id: item.id,
      name: item.name,
      category: item.category,
      type: members.length === 1 ? undefined : 'group',
      groupType: item.groupType,
      rotationScheme: item.rotationScheme,
      canPlaceOnWalls: item.canPlaceOnWalls ?? false,
      canPlaceOnSurfaces: item.canPlaceOnSurfaces ?? false,
    };
    if (item.backgroundTiles) manifest.backgroundTiles = item.backgroundTiles;
    if (item.isDesk) manifest.isDesk = true;

    if (members.length === 1) {
      const single = members[0] as Record<string, unknown>;
      Object.assign(manifest, {
        id: item.id,
        name: item.name,
        category: item.category,
        file: single.file,
        width: single.width,
        height: single.height,
        footprintW: single.footprintW,
        footprintH: single.footprintH,
      });
      if (single.orientation) manifest.orientation = single.orientation;
      delete manifest.type;
      delete manifest.groupType;
      delete manifest.rotationScheme;
    } else {
      manifest.members = members;
    }

    for (const key of Object.keys(manifest)) {
      if (manifest[key] === undefined) delete manifest[key];
    }

    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    console.log(`  ✓ Wrote manifest.json for ${item.id}`);
  }
}

async function main() {
  const allItems = [...FURNITURE_BATCH_1, ...FURNITURE_BATCH_2];
  console.log(`Generating ${allItems.length} furniture items...\n`);
  await generateBatch(allItems);
  console.log('\n✓ Done! Rebuild with: npm run app:build');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
