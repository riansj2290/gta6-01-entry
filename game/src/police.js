// police.js — the wanted system and the Solmar PD.
// Wanted 0-5 stars. Heat rises with crimes and cools when unseen; police run a
// hierarchical FSM (game-ai skill): Patrol -> Chase (hysteresis: chase at close
// range, give up farther out) -> Search last-known position -> Patrol. Cops
// chase the player's last KNOWN position, never the live one, once sight breaks.

import { clamp, dist, angleTo, turnToward, rr, pick } from './utils.js';
import { Car } from './vehicles.js';

const HEAT_PER_STAR = 100;      // heat 0..500 maps to stars 0..5
const CHASE_ENTER = 620;        // start chasing inside this range (or when seen)
const CHASE_EXIT = 900;         // give up beyond this range
const SIGHT_RANGE = 520;

export class Police {
  constructor(game) {
    this.game = game;
    this.heat = 0;
    this.wanted = 0;
    this.cops = [];             // { car, state, lastKnown, stateTime, searchNode }
    this.footCops = [];         // { x, y, angle, state, lastKnown, stateTime, speed }
    this.spawnTimer = 0;
    this.coolTimer = 0;
    this.bustTimer = 0;         // counts up while a cop is touching the player on foot
    this._lastStar = 0;
  }

  addHeat(amount, crime) {
    if (this.game.player.dead) return;
    const before = this.wanted;
    this.heat = clamp(this.heat + amount, 0, 500);
    this.wanted = Math.floor(this.heat / HEAT_PER_STAR);
    if (this.wanted > before) {
      this.game.audio.wantedUp();
      this.game.hud.toast('WANTED LEVEL ' + this.wanted + ' — Solmar PD is on you!');
      this.game.hud.flashWanted();
    }
    this.coolTimer = 4; // heat only starts cooling after 4 s without a crime
  }

  // Called every frame: cool heat, keep the right number of cops on the street.
  update(dt) {
    const game = this.game;
    const player = game.player;
    if (this.coolTimer > 0) this.coolTimer -= dt;
    else if (this.wanted > 0 && !this.anyCopSeesPlayer()) {
      this.heat = Math.max(0, this.heat - 7 * dt);
      const w = Math.floor(this.heat / HEAT_PER_STAR);
      if (w !== this.wanted) { this.wanted = w; game.hud.toast(w === 0 ? 'You lost them. Heat is off.' : 'Wanted level dropped to ' + w); }
    }
    if (this.wanted !== this._lastStar) { this._lastStar = this.wanted; game.audio.setSiren(this.wanted > 0); }

    // Desired cops: 1 car per star (up to 4) + foot cops at higher stars.
    const wantCars = this.wanted === 0 ? 0 : Math.min(4, this.wanted);
    const wantFoot = this.wanted >= 3 ? Math.min(3, this.wanted - 2) : 0;
    this.spawnTimer -= dt;
    if ((this.cops.length < wantCars || this.footCops.length < wantFoot) && this.spawnTimer <= 0 && !player.dead) {
      this.spawnTimer = 0.8;
      this.spawnCop(this.cops.length < wantCars);
    }
    // Despawn cops far away when the heat is off.
    if (this.wanted === 0) {
      for (const c of this.cops) c.car.dead = true;
      this.cops = [];
      this.footCops = [];
      this.bustTimer = 0;
    }
    for (const cop of this.cops) this.updateCopCar(cop, dt);
    this.cops = this.cops.filter((c) => !c.car.dead);
    for (const fc of this.footCops) this.updateFootCop(fc, dt);
    this.footCops = this.footCops.filter((f) => f.hp > 0);

    // Bust: a foot cop standing on the player (on foot, slow) arrests them.
    if (!player.inCar && !player.dead) {
      const near = this.footCops.some((f) => dist(f.x, f.y, player.x, player.y) < 34);
      const carNear = this.cops.some((c) => dist(c.car.x, c.car.y, player.x, player.y) < 46 && Math.abs(c.car.speed) < 40);
      if (near || carNear) {
        this.bustTimer += dt;
        if (this.bustTimer > 2.2) { this.bustTimer = 0; game.onPlayerBusted(); }
      } else this.bustTimer = 0;
    } else this.bustTimer = 0;
  }

  anyCopSeesPlayer() {
    const p = this.game.player;
    for (const c of this.cops) if (dist(c.car.x, c.car.y, p.x, p.y) < SIGHT_RANGE) return true;
    for (const f of this.footCops) if (dist(f.x, f.y, p.x, p.y) < SIGHT_RANGE) return true;
    return false;
  }

  spawnCop(inCar) {
    const game = this.game;
    const p = game.player;
    // Spawn on a road 500-700 px from the player, off-screen-ish.
    const a = rr(0, Math.PI * 2);
    const sx = clamp(p.x + Math.cos(a) * rr(500, 700), 120, 3480);
    const sy = clamp(p.y + Math.sin(a) * rr(500, 700), 120, 3480);
    const rp = game.city.nearestRoadPoint(sx, sy);
    if (inCar) {
      const car = new Car(rp.x, rp.y, rr(0, Math.PI * 2), {
        color: '#1c2733', name: 'Interceptor', isPolice: true,
        maxSpeed: 560 + this.wanted * 22, accel: 430,
      });
      car.driver = 'police';
      game.cars.push(car);
      this.cops.push({ car, state: 'chase', lastKnown: { x: p.x, y: p.y }, stateTime: 0, path: null, pathIdx: 0, repath: 0 });
      game.audio.phone();
    } else {
      this.footCops.push({ x: rp.x, y: rp.y, angle: 0, state: 'chase', lastKnown: { x: p.x, y: p.y }, stateTime: 0, hp: 60, speed: 200 + this.wanted * 12, walkPhase: 0 });
    }
  }

  updateCopCar(cop, dt) {
    const game = this.game;
    const p = game.player;
    const car = cop.car;
    cop.stateTime += dt;
    const d = dist(car.x, car.y, p.x, p.y);
    const sees = d < SIGHT_RANGE && !p.dead;

    // --- FSM transitions (hysteresis: enter close, exit far) ---
    if (cop.state === 'patrol') {
      if (sees && d < CHASE_ENTER) { cop.state = 'chase'; cop.stateTime = 0; }
    } else if (cop.state === 'chase') {
      if (sees) cop.lastKnown = { x: p.x, y: p.y };
      else if (d > CHASE_EXIT || cop.stateTime > 14) { cop.state = 'search'; cop.stateTime = 0; }
    } else if (cop.state === 'search') {
      if (sees && d < CHASE_ENTER) { cop.state = 'chase'; cop.stateTime = 0; }
      else if (dist(car.x, car.y, cop.lastKnown.x, cop.lastKnown.y) < 60 || cop.stateTime > 8) {
        cop.state = 'patrol'; cop.stateTime = 0; cop.path = null;
      }
    }

    // --- Steering per state ---
    let target = null;
    if (cop.state === 'chase') target = sees ? { x: p.x, y: p.y } : cop.lastKnown;
    else if (cop.state === 'search') target = cop.lastKnown;
    else target = null;

    if (target) {
      // Drive on the road graph toward the target's intersection, then home in.
      cop.repath -= dt;
      const targetNode = game.city.nearestNode(target.x, target.y);
      const curNode = game.city.nearestNode(car.x, car.y);
      if (!cop.path || cop.repath <= 0) {
        cop.path = game.city.findPath(curNode, targetNode) || [targetNode];
        cop.pathIdx = 0;
        cop.repath = 0.6;
      }
      let waypoint = target;
      if (cop.path && cop.pathIdx < cop.path.length) {
        const node = game.city.nodes[cop.path[cop.pathIdx]];
        if (dist(car.x, car.y, node.x, node.y) < 40) cop.pathIdx++;
        else waypoint = node;
      }
      // Close in: steer straight at the target when near, else follow the path.
      const wantAngle = Math.atan2(waypoint.y - car.y, waypoint.x - car.x);
      const diff = (() => { let dd = wantAngle - car.angle; while (dd > Math.PI) dd -= Math.PI * 2; while (dd < -Math.PI) dd += Math.PI * 2; return dd; })();
      const steer = clamp(diff * 2.4, -1, 1);
      const wantSpeed = d < 120 && sees ? Math.min(car.maxSpeed, 620) : car.maxSpeed * 0.85;
      const throttle = car.speed < wantSpeed ? 1 : -0.4;
      car.drive(dt, throttle, steer, false);
      // Ram the player when close and in a car.
      if (p.inCar && d < 70 && Math.abs(car.speed) > 200) {
        p.car.damage(14 * dt * 10, game);
        game.effects.crash(car.x, car.y);
      }
    } else {
      // Patrol: slow cruise along the graph.
      car.throttle = 0.4; car.steer = 0;
      car.drive(dt, 0.3, 0, false);
    }
    car.resolveBuildingCollisions(game);
    car.resolveCarCollisions(game);
    // Cop cars that get wrecked drop out of the chase.
    if (car.hp <= 0 && !car.dead) car.damage(1, game);
  }

  updateFootCop(fc, dt) {
    const game = this.game;
    const p = game.player;
    fc.stateTime += dt;
    const d = dist(fc.x, fc.y, p.x, p.y);
    const sees = d < SIGHT_RANGE && !p.dead;
    if (fc.state === 'chase') {
      if (sees) fc.lastKnown = { x: p.x, y: p.y };
      else if (d > CHASE_EXIT || fc.stateTime > 10) { fc.state = 'search'; fc.stateTime = 0; }
    } else if (fc.state === 'search') {
      if (sees && d < CHASE_ENTER) { fc.state = 'chase'; fc.stateTime = 0; }
      else if (dist(fc.x, fc.y, fc.lastKnown.x, fc.lastKnown.y) < 30 || fc.stateTime > 6) {
        fc.state = 'patrol'; fc.stateTime = 0;
      }
    } else if (sees && d < CHASE_ENTER) { fc.state = 'chase'; fc.stateTime = 0; }

    const target = fc.state === 'patrol' ? null : fc.lastKnown;
    if (target) {
      const want = Math.atan2(target.y - fc.y, target.x - fc.x);
      fc.angle = turnToward(fc.angle, want, 5 * dt);
      const sp = fc.state === 'chase' ? fc.speed : fc.speed * 0.5;
      const nx = fc.x + Math.cos(fc.angle) * sp * dt;
      const ny = fc.y + Math.sin(fc.angle) * sp * dt;
      const res = game.city.collideCircle(nx, ny, 12);
      fc.x = res.x; fc.y = res.y;
      fc.walkPhase += dt * 9;
      // A foot cop in punching range hurts the player.
      if (!p.inCar && d < 30 && !p.dead) {
        p.damage(9 * dt, game, 'cop');
      }
    }
  }

  // Clear all heat (mission reward / safehouse).
  clearHeat() {
    this.heat = 0; this.wanted = 0;
    for (const c of this.cops) c.car.dead = true;
    this.cops = []; this.footCops = [];
    this.game.audio.setSiren(false);
  }
}
