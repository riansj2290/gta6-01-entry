// city.js — Solmar: a procedural sun-soaked coastal city.
// One grid of roads, five districts, buildings as AABBs, and the road graph
// (intersections + BFS) that traffic and police drive on. Deterministic per seed.

import { mulberry32, pick, randRange, randInt, clamp, circleVsBox } from './utils.js';

export const WORLD = 3600;            // world is WORLD x WORLD, origin top-left
export const ROAD_W = 96;             // road width in px
export const ROAD_STEP = 400;         // distance between road centrelines
export const ROAD_LINES = [300, 700, 1100, 1500, 1900, 2300, 2700, 3100];

// District palettes and building styles.
const DISTRICTS = [
  { name: 'Downtown', x0: 1100, y0: 1100, x1: 2500, y1: 2300, tall: true,
    colors: ['#7d8aa5', '#8f9bb0', '#6b7a94', '#a08b7a', '#5f7089'] },
  { name: 'Marina', x0: 3100, y0: 0, x1: 3600, y1: 3600, tall: false, beach: true,
    colors: ['#e8d9b0', '#f2e3c2', '#d9c49a', '#cdb98e'] },
  { name: 'Suburbs', x0: 0, y0: 0, x1: 1100, y1: 1100, tall: false,
    colors: ['#e8b4a0', '#f0c9a8', '#d9a0a8', '#c9d6a8', '#b8c9e8'] },
  { name: 'Industrial', x0: 0, y0: 2700, x1: 1500, y1: 3600, tall: false, industrial: true,
    colors: ['#9aa0a8', '#8a8f96', '#a8a098', '#7d838a'] },
  { name: 'Old Town', x0: 2500, y0: 2300, x1: 3600, y1: 3600, tall: false,
    colors: ['#d9a06b', '#e8b878', '#c98f5c', '#e0c078'] },
];
function districtAt(x, y) {
  for (const d of DISTRICTS) if (x >= d.x0 && x < d.x1 && y >= d.y0 && y < d.y1) return d;
  return DISTRICTS[0];
}

export class City {
  constructor(seed = 1) {
    this.seed = seed;
    this.rng = mulberry32(seed);
    this.buildings = [];   // {x,y,w,h,hgt,color,district,roof}
    this.trees = [];       // {x,y,r}
    this.lamps = [];       // {x,y}
    this.parks = [];       // {x,y,w,h}
    this.generate();
    this.buildGraph();
  }

  generate() {
    const rng = this.rng;
    // Central park: the block between roads 1500..1900 on both axes.
    this.parks.push({ x: 1548, y: 1548, w: 304, h: 304 });
    // Beach strip along the east edge + a pier.
    this.beach = { x0: 3300, x1: 3600 };
    this.pier = { x: 3350, y: 1500, w: 120, h: 26 };

    for (let bx = 0; bx < 8; bx++) {
      for (let by = 0; by < 8; by++) {
        const x0 = ROAD_LINES[bx] + ROAD_W / 2 + 8;
        const y0 = ROAD_LINES[by] + ROAD_W / 2 + 8;
        const w = ROAD_STEP - ROAD_W - 16;
        const h = ROAD_STEP - ROAD_W - 16;
        const cx = x0 + w / 2, cy = y0 + h / 2;
        const d = districtAt(cx, cy);
        // Park block stays green.
        if (x0 === 1548 && y0 === 1548) {
          for (let i = 0; i < 14; i++) {
            this.trees.push({ x: randRange(rng, x0 + 20, x0 + w - 20), y: randRange(rng, y0 + 20, y0 + h - 20), r: randRange(rng, 10, 16) });
          }
          continue;
        }
        // Beach blocks: sand, palms, no buildings.
        if (d.beach) {
          for (let i = 0; i < 5; i++) {
            this.trees.push({ x: randRange(rng, x0 + 20, x0 + w - 20), y: randRange(rng, y0 + 20, y0 + h - 20), r: randRange(rng, 9, 13), palm: true });
          }
          continue;
        }
        // 1-4 buildings per block, with a courtyard gap.
        const count = d.tall ? randInt(rng, 2, 4) : randInt(rng, 1, 3);
        if (count === 1) {
          this.addBuilding(x0 + 20, y0 + 20, w - 40, h - 40, d, rng);
        } else {
          const cols = count === 2 ? 2 : 2, rows = count === 2 ? 1 : 2;
          const bw = (w - 24 * (cols + 1)) / cols, bh = (h - 24 * (rows + 1)) / rows;
          for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
            if (i * rows + j >= count) break;
            this.addBuilding(x0 + 24 + i * (bw + 24), y0 + 24 + j * (bh + 24), bw, bh, d, rng);
          }
        }
        // Street trees on block corners.
        if (rng() < 0.7) this.trees.push({ x: x0 + 12, y: y0 + 12, r: randRange(rng, 8, 12) });
        if (rng() < 0.5) this.trees.push({ x: x0 + w - 12, y: y0 + h - 12, r: randRange(rng, 8, 12) });
      }
    }
    // Lamps along every road, staggered.
    for (const lx of ROAD_LINES) for (const ly of ROAD_LINES) {
      this.lamps.push({ x: lx - ROAD_W / 2 - 10, y: ly - ROAD_W / 2 - 10 });
      this.lamps.push({ x: lx + ROAD_W / 2 + 10, y: ly + ROAD_W / 2 + 10 });
    }
  }

  addBuilding(x, y, w, h, d, rng) {
    const hgt = d.tall ? randInt(rng, 3, 9) : d.industrial ? randInt(rng, 1, 2) : randInt(rng, 1, 3);
    this.buildings.push({
      x, y, w, h, hgt,
      color: pick(rng, d.colors),
      roof: pick(rng, ['#5a6472', '#6b5a48', '#7a8a99', '#4e5a68']),
      district: d.name,
    });
  }

  // ---- Road graph: nodes are intersections, edges run along roads. ----
  buildGraph() {
    this.nodes = [];            // {x, y, id}
    this.nodeId = new Map();
    for (const x of ROAD_LINES) for (const y of ROAD_LINES) {
      const id = this.nodes.length;
      this.nodes.push({ x, y, id });
      this.nodeId.set(x + ',' + y, id);
    }
    this.adj = this.nodes.map(() => []);
    const link = (a, b) => { this.adj[a].push(b); this.adj[b].push(a); };
    for (let i = 0; i < ROAD_LINES.length; i++) {
      for (let j = 0; j < ROAD_LINES.length; j++) {
        const id = i * ROAD_LINES.length + j;
        if (j + 1 < ROAD_LINES.length) link(id, id + 1);
        if (i + 1 < ROAD_LINES.length) link(id, id + ROAD_LINES.length);
      }
    }
  }

  nearestNode(x, y) {
    let best = 0, bestD = Infinity;
    for (const n of this.nodes) {
      const d = (n.x - x) * (n.x - x) + (n.y - y) * (n.y - y);
      if (d < bestD) { bestD = d; best = n.id; }
    }
    return best;
  }

  // BFS shortest path of node ids from start to goal (null if none).
  findPath(startId, goalId) {
    if (startId === goalId) return [startId];
    const prev = new Int32Array(this.nodes.length).fill(-1);
    const queue = [startId];
    prev[startId] = startId;
    for (let qi = 0; qi < queue.length; qi++) {
      const cur = queue[qi];
      for (const nb of this.adj[cur]) {
        if (prev[nb] !== -1) continue;
        prev[nb] = cur;
        if (nb === goalId) {
          const path = [goalId];
          let p = cur;
          while (p !== startId) { path.push(p); p = prev[p]; }
          path.push(startId);
          return path.reverse();
        }
        queue.push(nb);
      }
    }
    return null;
  }

  // Is a point on a road (within the asphalt)?
  onRoad(x, y) {
    for (const lx of ROAD_LINES) if (Math.abs(x - lx) <= ROAD_W / 2) return true;
    for (const ly of ROAD_LINES) if (Math.abs(y - ly) <= ROAD_W / 2) return true;
    return false;
  }

  // Nearest point on the road network to (x, y): snap to the closest road line.
  nearestRoadPoint(x, y) {
    let bestX = x, bestY = y, bestD = Infinity;
    for (const lx of ROAD_LINES) {
      const d = Math.abs(x - lx);
      if (d < bestD) { bestD = d; bestX = lx; bestY = clamp(y, 100, WORLD - 100); }
    }
    for (const ly of ROAD_LINES) {
      const d = Math.abs(y - ly);
      if (d < bestD) { bestD = d; bestX = clamp(x, 100, WORLD - 100); bestY = ly; }
    }
    return { x: bestX, y: bestY };
  }

  // Push a circle out of every building it overlaps; returns true if any hit.
  collideCircle(x, y, r) {
    let hit = false;
    for (const b of this.buildings) {
      // Cheap broad-phase: skip buildings far away.
      if (x < b.x - r || x > b.x + b.w + r || y < b.y - r || y > b.y + b.h + r) continue;
      const res = circleVsBox(x, y, r, b.x, b.y, b.w, b.h);
      if (res) {
        x += res.nx * res.depth; y += res.ny * res.depth;
        hit = true;
      }
    }
    return { x, y, hit };
  }

  // Point inside any building?
  insideBuilding(x, y) {
    for (const b of this.buildings) {
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b;
    }
    return null;
  }

  districtName(x, y) { return districtAt(x, y).name; }
}
