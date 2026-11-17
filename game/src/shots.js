// shots.js — scripted demo states for the entry's screenshots (?shot=...).
// These are the game's own code rendering its own world: each mode places the
// player, the police and a mission in a real playable state, then an autopilot
// drives so the scene is alive when the screenshot lands. No faked pixels.

import { PLACES, MISSIONS } from './missions.js';
import { Car } from './vehicles.js';
import { clamp } from './utils.js';

export function applyShot(game, name) {
  const p = game.player;
  const police = game.police;
  const missions = game.missions;
  const putInCar = (x, y, angle, color, carName) => {
    const car = new Car(x, y, angle, { color, name: carName || 'Comet', maxSpeed: 560 });
    car.driver = 'player';
    game.cars.push(car);
    p.car = car;
    p.x = x; p.y = y; p.angle = angle;
    car.speed = 320;
    return car;
  };
  const spawnChasers = (n) => {
    for (let i = 0; i < n; i++) {
      const cop = new Car(p.x - 150 - i * 70, p.y + (i % 2 === 0 ? -30 : 30), 0, {
        color: '#1c2733', name: 'Interceptor', isPolice: true, maxSpeed: 660, accel: 480,
      });
      cop.driver = 'police';
      cop.speed = 430;
      game.cars.push(cop);
      police.cops.push({ car: cop, state: 'chase', lastKnown: { x: p.x, y: p.y }, stateTime: 0, path: null, pathIdx: 0, repath: 0 });
    }
  };

  if (name === 'start') {
    // Title screen over a slow pan of Downtown (main.js keeps state 'title').
    game.camera.snapTo(1900, 1900);
    game.shotPan = true;
    return;
  }
  if (name === 'chase') {
    putInCar(1500, 1500, 0, '#d94f3d', 'Comet');
    // Mission 3 "Heat Check": the objective matches a chase — lose the cops.
    missions.completed = 2;
    missions.startNext(); // sets wanted 2, marker at the Safehouse
    game.hud.hideDialogue(); // keep the chase frame clear of the briefing
    police.addHeat(110, 'chase'); // 3 stars for the shot
    spawnChasers(3);
    game.autopilot = { mode: 'drive' };
    game.shotZoom = 1.2;
    game.renderer.timeOfDay = 1;
    return;
  }
  if (name === 'onfoot') {
    p.x = 760; p.y = 820; p.angle = -Math.PI / 2;
    game.camera.snapTo(p.x, p.y);
    missions.completed = 0;
    missions.startNext(); // "First Wheels": steal a car, marker at the garage
    // Step 1 (steal a car) carries no map point; pin the garage so the
    // objective marker is visible in frame.
    missions.marker = { x: PLACES.garage.x, y: PLACES.garage.y, color: '#ffd23e', label: "Mara's Garage" };
    game.autopilot = { mode: 'walk', tx: 700, ty: 700 };
    game.shotZoom = 1.1;
    game.renderer.timeOfDay = 1;
    return;
  }
  if (name === 'mission') {
    missions.completed = 5;
    missions.startNext(); // The Big Score
    missions.active.step = 1; // hold step: inside the bank
    missions.holdProgress = 5.2;
    missions.marker = { x: PLACES.bank.x, y: PLACES.bank.y, color: '#ffd23e', label: 'Hold the bank door' };
    p.x = PLACES.bank.x + 30; p.y = PLACES.bank.y + 30;
    game.camera.snapTo(p.x, p.y);
    police.heat = 410; police.wanted = 4;
    spawnChasers(4);
    game.shotZoom = 1.1;
    game.renderer.timeOfDay = 1;
    return;
  }
  if (name === 'cruise') {
    putInCar(3100, 2900, -Math.PI / 2, '#3d7dd9', 'Sunrunner');
    game.autopilot = { mode: 'drive' };
    game.shotZoom = 1.15;
    game.renderer.timeOfDay = 2; // dusk over the Marina
    missions.completed = 6; // story done: free roam
    missions.active = null;
    game.hud.toast('Marina Beach — golden hour cruise');
    return;
  }
}

// Autopilot: drives the player's car along the road graph (or walks on foot)
// so screenshot scenes are in motion. Only active in ?shot= modes.
export function autopilotUpdate(game, dt) {
  const ap = game.autopilot;
  if (!ap) return;
  const p = game.player;
  if (ap.mode === 'drive' && p.car) {
    const car = p.car;
    // Off the road (shoved by a collision): steer back to the nearest road
    // point first instead of cutting diagonally through a block.
    if (!game.city.onRoad(car.x, car.y)) {
      ap.waypoint = game.city.nearestRoadPoint(car.x, car.y);
    } else if (!ap.waypoint || Math.hypot(ap.waypoint.x - car.x, ap.waypoint.y - car.y) < 60) {
      // Head for the mission marker when there is one (escape!), else keep
      // going straight: pick the neighbouring intersection most aligned with
      // the car's heading so the autopilot drives on, not in circles.
      const cur = game.city.nearestNode(car.x, car.y);
      const neighbours = game.city.adj[cur];
      const goal = game.missions.marker;
      let best = neighbours[0], bestScore = -Infinity;
      for (const n of neighbours) {
        const node = game.city.nodes[n];
        const dx = node.x - car.x, dy = node.y - car.y;
        const d = Math.hypot(dx, dy) || 1;
        const dot = (dx / d) * Math.cos(car.angle) + (dy / d) * Math.sin(car.angle);
        const score = goal
          ? -Math.hypot(node.x - goal.x, node.y - goal.y) + dot * 40
          : dot;
        if (score > bestScore) { bestScore = score; best = n; }
      }
      ap.waypoint = game.city.nodes[best];
    }
    const want = Math.atan2(ap.waypoint.y - car.y, ap.waypoint.x - car.x);
    let diff = want - car.angle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    car.drive(dt, 1, clamp(diff * 2.2, -1, 1), false);
    car.resolveBuildingCollisions(game);
    car.resolveCarCollisions(game);
    p.x = car.x; p.y = car.y; p.angle = car.angle;
    game.audio.setEngine(Math.abs(car.speed) / car.maxSpeed, true);
  } else if (ap.mode === 'walk' && !p.car) {
    // Walk toward the marker, then idle.
    const dx = ap.tx - p.x, dy = ap.ty - p.y;
    const d = Math.hypot(dx, dy);
    if (d > 12) {
      p.x += (dx / d) * 200 * dt;
      p.y += (dy / d) * 200 * dt;
      p.angle = Math.atan2(dy, dx);
      p.walkPhase += dt * 10;
    }
  }
}
