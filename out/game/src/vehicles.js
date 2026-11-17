// vehicles.js — cars: arcade driving physics, traffic AI on the road graph,
// parked cars to steal. One Car class serves the player, traffic and police
// (police just get a faster tune and a light bar).

import { clamp, angleDiff, dist, pick, randRange } from './utils.js';
import { ROAD_LINES } from './city.js';

export const CAR_COLORS = ['#d94f3d', '#3d7dd9', '#e8b13d', '#7ac74f', '#c9ccd4', '#8a5fd9', '#2b2b30', '#e87a3d', '#4fc9c9'];
export const CAR_NAMES = ['Comet', 'Stallion', 'Falcon', 'Vortex', 'Sunrunner', 'Bandit', 'Cruiser', 'Prowler'];
export const POLICE_COLOR = '#1c2733';

// Arcade car: speed along heading, steering scaled by speed, drift on handbrake.
export class Car {
  constructor(x, y, angle, opts = {}) {
    this.x = x; this.y = y; this.angle = angle;
    this.speed = 0;
    this.w = 44; this.h = 20;                 // footprint (top-down: length x width)
    this.color = opts.color || '#d94f3d';
    this.name = opts.name || 'Comet';
    this.isPolice = !!opts.isPolice;
    this.isTraffic = !!opts.isTraffic;
    this.maxSpeed = opts.maxSpeed || 520;     // px/s
    this.accel = opts.accel || 340;
    this.brake = 620;
    this.steerRate = 2.6;                      // rad/s at full lock
    this.hp = opts.hp || 100;
    this.smoking = false;
    this.dead = false;
    this.driver = null;                        // 'player' | 'traffic' | 'police' | null (parked)
    // Traffic AI state.
    this.path = null;                          // node ids to follow
    this.pathIdx = 0;
    this.waitAt = 0;                           // seconds to wait (intersection pause)
    this.targetSpeed = 0;
    this.steer = 0;
    this.throttle = 0;
  }

  // Arcade update: throttle -1..1, steer -1..1, handbrake bool. dt in seconds.
  drive(dt, throttle, steer, handbrake) {
    if (this.dead) { this.speed *= Math.pow(0.2, dt); return; }
    const forward = this.speed >= 0 ? 1 : -1;
    if (throttle > 0) this.speed += this.accel * throttle * dt;
    else if (throttle < 0) this.speed += this.brake * throttle * dt * 0.9;
    else this.speed -= Math.sign(this.speed) * 140 * dt; // coast drag
    if (handbrake) this.speed -= Math.sign(this.speed) * 500 * dt;
    this.speed = clamp(this.speed, -this.maxSpeed * 0.45, this.maxSpeed);
    if (Math.abs(this.speed) < 4 && throttle === 0) this.speed = 0;
    // Steering bites only while moving; handbrake lets the tail step out.
    const steerAuthority = clamp(Math.abs(this.speed) / 120, 0, 1);
    const turn = steer * this.steerRate * steerAuthority * (handbrake ? 1.5 : 1) * dt;
    this.angle += turn * forward;
    const slide = handbrake ? 0.35 : 0.06; // a little lateral slip, more on handbrake
    const nx = Math.cos(this.angle), ny = Math.sin(this.angle);
    this.x += nx * this.speed * dt;
    this.y += ny * this.speed * dt;
    // Keep inside the world.
    this.x = clamp(this.x, 60, 3540);
    this.y = clamp(this.y, 60, 3540);
  }

  // Traffic AI: follow the road graph toward a destination node.
  // Returns nothing; sets throttle/steer, called before drive().
  trafficUpdate(dt, game) {
    const city = game.city;
    if (this.waitAt > 0) { this.waitAt -= dt; this.throttle = 0; this.steer = 0; return; }
    if (!this.path || this.pathIdx >= this.path.length) {
      // Pick a new random destination a few intersections away.
      const cur = city.nearestNode(this.x, this.y);
      let goal = cur;
      for (let tries = 0; tries < 8 && goal === cur; tries++) {
        goal = Math.floor(Math.random() * city.nodes.length);
      }
      this.path = city.findPath(cur, goal) || [cur];
      this.pathIdx = 0;
    }
    const node = city.nodes[this.path[this.pathIdx]];
    const d = dist(this.x, this.y, node.x, node.y);
    if (d < 26) {
      this.pathIdx++;
      if (Math.random() < 0.08) this.waitAt = 0.6; // occasional pause at intersections
      return;
    }
    const wantAngle = Math.atan2(node.y - this.y, node.x - this.x);
    const diff = angleDiff(this.angle, wantAngle);
    this.steer = clamp(diff * 2.2, -1, 1);
    // Slow for sharp turns and when a car is ahead.
    const ahead = this.carAhead(game, 90);
    this.targetSpeed = ahead ? 0 : (Math.abs(diff) > 0.9 ? 130 : this.maxSpeed * 0.55);
    this.throttle = this.speed < this.targetSpeed ? 1 : (this.speed > this.targetSpeed + 20 ? -0.6 : 0);
  }

  // Is there a car directly ahead within `range` px? (traffic avoids pile-ups)
  carAhead(game, range) {
    const nx = Math.cos(this.angle), ny = Math.sin(this.angle);
    for (const c of game.cars) {
      if (c === this || c.dead) continue;
      const dx = c.x - this.x, dy = c.y - this.y;
      const along = dx * nx + dy * ny;
      const across = Math.abs(dx * -ny + dy * nx);
      if (along > 0 && along < range && across < 34) return c;
    }
    return null;
  }

  // Simple circle-vs-circle push-apart between cars.
  resolveCarCollisions(game) {
    for (const c of game.cars) {
      if (c === this || c.dead) continue;
      const dx = this.x - c.x, dy = this.y - c.y;
      const d = Math.hypot(dx, dy);
      const min = 46;
      if (d > 0.01 && d < min) {
        const push = (min - d) / 2;
        const ux = dx / d, uy = dy / d;
        this.x += ux * push; this.y += uy * push;
        c.x -= ux * push; c.y -= uy * push;
        const rel = Math.abs(this.speed - c.speed);
        if (rel > 120 && !this._crashCooldown) {
          this.hp -= rel * 0.04; c.hp -= rel * 0.04;
          this._crashCooldown = 0.5;
          game.effects.crash(this.x, this.y);
          game.audio.crash();
          if (this.driver === 'player' || c.driver === 'player') game.police.addHeat(6, 'crash');
        }
      }
    }
    if (this._crashCooldown) this._crashCooldown -= 1 / 60;
  }

  // Push out of buildings; scrape damage at speed.
  resolveBuildingCollisions(game) {
    const city = game.city;
    const r = 20;
    const res = city.collideCircle(this.x, this.y, r);
    if (res.hit) {
      const impact = Math.abs(this.speed);
      this.x = res.x; this.y = res.y;
      if (impact > 260) {
        this.hp -= impact * 0.03;
        this.speed *= -0.25;
        game.effects.crash(this.x, this.y);
        game.audio.crash();
        game.camera.addTrauma(0.35);
        if (this.driver === 'player') game.police.addHeat(4, 'crash');
      } else {
        this.speed *= 0.4;
      }
    }
  }

  damage(amount, game) {
    this.hp -= amount;
    if (this.hp <= 55) this.smoking = true;
    if (this.hp <= 0 && !this.dead) {
      this.dead = true;
      game.effects.explosion(this.x, this.y);
      game.audio.explosion();
      game.camera.addTrauma(0.9);
      game.camera.hitStop(0.12);
      if (this.driver === 'player') game.player.ejectFromCar(game);
    }
  }

  // A parked car waiting to be stolen, placed along a road edge (see spawnParkedCars).
}

// Spawn parked cars along road edges, away from the player start.
export function spawnParkedCars(game, count, rng) {
  const cars = [];
  const lines = ROAD_LINES;
  for (let i = 0; i < count; i++) {
    const vertical = rng() < 0.5;
    const line = pick(rng, lines);
    const along = randRange(rng, 200, 3400);
    const side = rng() < 0.5 ? -1 : 1;
    const off = 96 / 2 + 12; // just off the asphalt, on the shoulder (clear of buildings)
    const x = vertical ? line + side * off : along;
    const y = vertical ? along : line + side * off;
    if (game.city.insideBuilding(x, y)) continue;
    const angle = vertical ? (side > 0 ? Math.PI / 2 : -Math.PI / 2) : (side > 0 ? 0 : Math.PI);
    const car = new Car(x, y, angle, {
      color: pick(rng, CAR_COLORS),
      name: pick(rng, CAR_NAMES),
      maxSpeed: randRange(rng, 460, 560),
    });
    car.driver = null;
    cars.push(car);
  }
  return cars;
}

export function spawnTrafficCar(game, rng) {
  const node = pick(rng, game.city.nodes);
  const car = new Car(node.x + randRange(rng, -30, 30), node.y + randRange(rng, -30, 30),
    randRange(rng, 0, Math.PI * 2), {
      color: pick(rng, CAR_COLORS),
      name: pick(rng, CAR_NAMES),
      maxSpeed: randRange(rng, 300, 380),
    });
  car.isTraffic = true;
  car.driver = 'traffic';
  return car;
}
