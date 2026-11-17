// pedestrians.js — Solmar's walkers: sidewalk strollers who flee gunfire,
// panic at speeding cars, and occasionally jaywalk. They make the city alive
// and give the wanted system something to react to.

import { clamp, dist, randRange, pick, mulberry32 } from './utils.js';

const SKINS = ['#f2c89b', '#c98d5f', '#8a5a3b', '#e8b88a'];
const SHIRTS = ['#d94f3d', '#3d7dd9', '#e8b13d', '#7ac74f', '#8a5fd9', '#e87a3d', '#4fc9c9', '#f2f2f2', '#2b2b30'];

export class Ped {
  constructor(x, y, rng) {
    this.x = x; this.y = y;
    this.angle = randRange(rng, 0, Math.PI * 2);
    this.speed = randRange(rng, 28, 52);
    this.skin = pick(rng, SKINS);
    this.shirt = pick(rng, SHIRTS);
    this.r = 11;
    this.state = 'walk';       // walk | flee | down
    this.fleeTimer = 0;
    this.target = null;        // {x, y} sidewalk waypoint
    this.downTimer = 0;
    this.walkPhase = randRange(rng, 0, Math.PI * 2);
    this.panic = 0;
  }

  // Pick a new waypoint on a nearby sidewalk (just off a road edge).
  pickTarget(game, rng) {
    const p = game.city.nearestRoadPoint(this.x, this.y);
    const dir = rng() < 0.5 ? 1 : -1;
    const along = randRange(rng, 120, 500) * dir;
    const onVertical = Math.abs(p.x - this.x) < Math.abs(p.y - this.y);
    if (onVertical) this.target = { x: p.x + (rng() < 0.5 ? -58 : 58), y: clamp(p.y + along, 80, 3520) };
    else this.target = { x: clamp(p.x + along, 80, 3520), y: p.y + (rng() < 0.5 ? -58 : 58) };
  }

  update(dt, game) {
    if (this.state === 'down') {
      this.downTimer -= dt;
      if (this.downTimer <= 0) { this.state = 'walk'; this.pickTarget(game, game.rng); }
      return;
    }
    if (this.state === 'flee') {
      this.fleeTimer -= dt;
      if (this.fleeTimer <= 0) { this.state = 'walk'; this.panic = 0; }
    }
    if (!this.target || dist(this.x, this.y, this.target.x, this.target.y) < 14) {
      this.pickTarget(game, game.rng);
    }
    const speed = this.state === 'flee' ? this.speed * 3.1 : this.speed;
    const want = Math.atan2(this.target.y - this.y, this.target.x - this.x);
    let diff = want - this.angle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.angle += clamp(diff, -3.2 * dt, 3.2 * dt);
    const nx = this.x + Math.cos(this.angle) * speed * dt;
    const ny = this.y + Math.sin(this.angle) * speed * dt;
    // Walkers slide around buildings instead of walking through them.
    const res = game.city.collideCircle(nx, ny, this.r);
    this.x = res.x; this.y = res.y;
    this.walkPhase += dt * (this.state === 'flee' ? 14 : 7);
  }

  scare(x, y, game) {
    if (this.state === 'down') return;
    this.state = 'flee';
    this.fleeTimer = 2.5 + Math.random() * 2;
    // Run away from the scare.
    const a = Math.atan2(this.y - y, this.x - x);
    this.target = { x: clamp(this.x + Math.cos(a) * 300, 80, 3520), y: clamp(this.y + Math.sin(a) * 300, 80, 3520) };
    this.panic = 1;
  }

  knockDown(game) {
    this.state = 'down';
    this.downTimer = 6;
    game.effects.blood(this.x, this.y);
  }
}

export function spawnPedestrians(game, count, rng) {
  const peds = [];
  for (let i = 0; i < count; i++) {
    const p = game.city.nearestRoadPoint(randRange(rng, 200, 3400), randRange(rng, 200, 3400));
    const ped = new Ped(clamp(p.x + randRange(rng, -70, 70), 80, 3520), clamp(p.y + randRange(rng, -70, 70), 80, 3520), rng);
    ped.pickTarget(game, rng);
    peds.push(ped);
  }
  return peds;
}
