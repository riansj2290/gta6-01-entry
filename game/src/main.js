// main.js — SOLMAR: an open-world crime game. Bootstrap, game loop, state
// machine (title / playing / paused / dead / busted) and the wiring between
// every system. Static files only, no network, no library.

import { Input } from './input.js';
import { City, WORLD } from './city.js';
import { AudioEngine } from './audio.js';
import { Camera, Renderer } from './render.js';
import { HUD } from './hud.js';
import { Save } from './save.js';
import { Player } from './player.js';
import { Car, spawnParkedCars, spawnTrafficCar } from './vehicles.js';
import { Ped, spawnPedestrians } from './pedestrians.js';
import { Police } from './police.js';
import { Combat, Effects } from './combat.js';
import { MissionManager, PLACES } from './missions.js';
import { applyShot, autopilotUpdate } from './shots.js';
import { mulberry32, dist, clamp } from './utils.js';

const params = new URLSearchParams(location.search);
const SEED = parseInt(params.get('seed') || '7', 10) || 7;
const SHOT = params.get('shot') || null;
const AUTOTEST = params.get('autotest') === '1';

class Game {
  constructor() {
    this.canvas = document.getElementById('game');
    this.time = 0;
    this.state = 'title'; // title | playing | paused | dead | busted
    this.rng = mulberry32(SEED);
    this.city = new City(SEED);
    this.input = new Input(this.canvas);
    this.audio = new AudioEngine();
    this.camera = new Camera(this.canvas);
    this.renderer = new Renderer(this);
    this.hud = new HUD(this);
    this.save = new Save(this);
    this.effects = new Effects();
    this.combat = new Combat(this);
    this.police = new Police(this);
    this.missions = new MissionManager(this);
    this.player = new Player(760, 860);
    this.stats = { missionsDone: 0, earned: 0, fares: 0, carsStolen: 0, playSeconds: 0 };
    this.cars = [];
    this.peds = [];
    this.autopilot = null;
    this.shotPan = false;
    this._trafficTimer = 0;

    // Parked cars to steal + ambient traffic + pedestrians.
    this.cars.push(...spawnParkedCars(this, 26, this.rng));
    for (let i = 0; i < 12; i++) this.cars.push(spawnTrafficCar(this, this.rng));
    this.peds = spawnPedestrians(this, 70, this.rng);

    this.camera.snapTo(this.player.x, this.player.y);
    this.renderer.resize();
    window.addEventListener('resize', () => this.renderer.resize());
    this.bindScreens();
    // First gesture unlocks audio (browsers require it).
    const unlock = () => this.audio.ensure();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });

    // Screenshot / test modes.
    if (SHOT) {
      applyShot(this, SHOT);
      if (SHOT !== 'start') this.startPlaying();
    }
    const saved = this.save.load();
    if (saved) {
      document.getElementById('btnContinue').style.display = '';
      document.getElementById('saveNote').textContent =
        'Save found: ' + saved.missionsDone + ' missions done, $' + (saved.cash || 0) + ' cash.';
    }
    window.__solmar = this;
    window.__solmarReady = true;
  }

  bindScreens() {
    const show = (id, on) => document.getElementById(id).classList.toggle('on', on);
    document.getElementById('btnNew').addEventListener('click', () => {
      this.audio.ensure();
      this.save.clear();
      this.resetWorld();
      this.startPlaying();
    });
    document.getElementById('btnContinue').addEventListener('click', () => {
      this.audio.ensure();
      const data = this.save.load();
      if (data) this.save.apply(data);
      this.startPlaying();
    });
    document.getElementById('btnHow').addEventListener('click', () => {
      const el = document.getElementById('howto');
      el.style.display = el.style.display === 'none' ? 'block' : 'none';
    });
    document.getElementById('btnResume').addEventListener('click', () => this.resume());
    document.getElementById('btnSave').addEventListener('click', () => {
      const ok = this.save.save();
      this.hud.toast(ok ? 'Game saved.' : 'Save failed (browser storage blocked).');
    });
    document.getElementById('btnQuit').addEventListener('click', () => {
      this.save.save();
      this.state = 'title';
      show('pauseScreen', false);
      show('titleScreen', true);
      this.hud.hide();
    });
    document.getElementById('btnRespawn').addEventListener('click', () => {
      show('deadScreen', false);
      this.respawn(PLACES.hospital);
    });
    document.getElementById('btnRelease').addEventListener('click', () => {
      show('bustedScreen', false);
      this.player.cash = Math.max(0, this.player.cash - 200);
      this.police.clearHeat();
      this.respawn(PLACES.hospital);
      this.hud.toast('Bail posted — $200. Stay clean, Dario.');
    });
  }

  resetWorld() {
    this.player = new Player(760, 860);
    this.police = new Police(this);
    this.missions = new MissionManager(this);
    this.stats = { missionsDone: 0, earned: 0, fares: 0, carsStolen: 0, playSeconds: 0 };
    this.cars = [...spawnParkedCars(this, 26, this.rng)];
    for (let i = 0; i < 12; i++) this.cars.push(spawnTrafficCar(this, this.rng));
    this.peds = spawnPedestrians(this, 70, this.rng);
    this.camera.snapTo(this.player.x, this.player.y);
  }

  startPlaying() {
    document.getElementById('titleScreen').classList.remove('on');
    document.getElementById('pauseScreen').classList.remove('on');
    this.state = 'playing';
    this.hud.show();
    this.audio.ensure();
    if (!this.missions.active && this.missions.completed === 0 && !SHOT) {
      this.hud.showDialogue('MARA SOLIS', 'Dario — you are out. Get to my garage and we will talk work. Green marker, follow it.', 7);
    }
  }

  resume() {
    document.getElementById('pauseScreen').classList.remove('on');
    this.state = 'playing';
  }

  pause() {
    this.state = 'paused';
    const s = this.stats;
    document.getElementById('pauseStats').innerHTML =
      'Cash $' + Math.round(this.player.cash) + ' · Missions ' + this.missions.completed + '/6' +
      ' · Fares ' + s.fares + ' · Earned $' + Math.round(s.earned) +
      ' · Time ' + Math.floor(s.playSeconds / 60) + 'm ' + Math.floor(s.playSeconds % 60) + 's';
    document.getElementById('pauseScreen').classList.add('on');
  }

  respawn(place) {
    const p = this.player;
    if (p.car) p.ejectFromCar(this);
    p.dead = false;
    p.hp = p.maxHp;
    p.x = place.x; p.y = place.y;
    p.invuln = 2;
    this.police.clearHeat();
    this.camera.snapTo(p.x, p.y);
    this.state = 'playing';
  }

  onPlayerDead() {
    this.state = 'dead';
    this.audio.setEngine(0, false);
    this.audio.setSiren(false);
    document.getElementById('deadStats').innerHTML =
      'Missions ' + this.missions.completed + '/6 · Cash $' + Math.round(this.player.cash) +
      ' · The city keeps moving without you.';
    document.getElementById('deadScreen').classList.add('on');
  }

  onPlayerBusted() {
    this.state = 'busted';
    if (this.player.car) this.player.ejectFromCar(this);
    this.audio.setEngine(0, false);
    document.getElementById('bustedStats').innerHTML =
      'Caught by the Solmar PD. Bail is $200 — or start over at the hospital.' +
      ' Cash $' + Math.round(this.player.cash) + '.';
    document.getElementById('bustedScreen').classList.add('on');
  }

  // ---- Queries used by the systems ----
  nearestCar(x, y, range, filter) {
    let best = null, bestD = range * range;
    for (const c of this.cars) {
      if (filter && !filter(c)) continue;
      const d = (c.x - x) * (c.x - x) + (c.y - y) * (c.y - y);
      if (d < bestD) { bestD = d; best = c; }
    }
    return best;
  }

  nearestPed(x, y, range) {
    let best = null, bestD = range * range;
    for (const ped of this.peds) {
      const d = (ped.x - x) * (ped.x - x) + (ped.y - y) * (ped.y - y);
      if (d < bestD) { bestD = d; best = ped; }
    }
    return best;
  }

  // ---- Main update ----
  update(dt) {
    this.time += dt;
    this.stats.playSeconds += dt;
    this.audio.update(dt);

    // Title screen: slow cinematic pan over Downtown.
    if (this.state === 'title') {
      if (this.shotPan) {
        this.camera.x = 1900 + Math.sin(this.time * 0.05) * 300;
        this.camera.y = 1900 + Math.cos(this.time * 0.04) * 200;
      }
      this.updateAmbient(dt);
      return;
    }
    if (this.state !== 'playing') return;

    // Global keys.
    if (this.input.wasPressed('pause')) { this.pause(); return; }
    if (this.input.wasPressed('mute')) {
      this.audio.setMuted(!this.audio.muted);
      this.hud.toast(this.audio.muted ? 'Sound muted' : 'Sound on');
    }

    if (this.autopilot) autopilotUpdate(this, dt);
    else this.player.update(dt, this);

    // Traffic AI + wreck cleanup.
    for (const car of this.cars) {
      if (car.dead) continue;
      if (car.isTraffic) {
        car.trafficUpdate(dt, this);
        car.drive(dt, car.throttle, car.steer, false);
        car.resolveBuildingCollisions(this);
        car.resolveCarCollisions(this);
      } else if (car.driver === 'police') {
        // Police cars are driven by police.js; only resolve collisions here.
      }
    }
    // Keep traffic topped up near the player; drop wrecks and far cars.
    this._trafficTimer -= dt;
    if (this._trafficTimer <= 0) {
      this._trafficTimer = 1;
      const p = this.player;
      this.cars = this.cars.filter((c) => {
        if (c.dead) return false;
        if (c.driver === 'player' || c.driver === 'police' || c.driver === 'rival') return true;
        if (c.driver === null && dist(c.x, c.y, p.x, p.y) > 2400) return false; // parked far away: recycle
        if (c.isTraffic && dist(c.x, c.y, p.x, p.y) > 1600) return false;
        return true;
      });
      const trafficCount = this.cars.filter((c) => c.isTraffic).length;
      for (let i = trafficCount; i < 12; i++) {
        const car = spawnTrafficCar(this, this.rng);
        // Spawn on a road near the player so streets stay busy.
        const rp = this.city.nearestRoadPoint(p.x + (this.rng() < 0.5 ? -1 : 1) * 700, p.y + (this.rng() < 0.5 ? -1 : 1) * 700);
        car.x = rp.x; car.y = rp.y;
        this.cars.push(car);
      }
      const parkedCount = this.cars.filter((c) => c.driver === null && !c.isTraffic).length;
      for (let i = parkedCount; i < 20; i++) {
        const fresh = spawnParkedCars(this, 4, this.rng);
        this.cars.push(...fresh);
        if (fresh.length === 0) break;
      }
    }

    for (const ped of this.peds) ped.update(dt, this);
    this.police.update(dt);
    this.combat.update(dt);
    this.effects.update(dt);
    this.missions.update(dt);
    this.missions.checkRestart();

    // Start the next mission by driving/walking onto the garage marker.
    if (!this.missions.active && !this.missions._restartPending && this.missions.completed < 6) {
      if (dist(this.player.x, this.player.y, PLACES.garage.x, PLACES.garage.y) < 90) {
        this.missions.startNext();
      }
    }

    // Camera: follow the player, lead with velocity, zoom out in a car.
    const p = this.player;
    const velX = p.inCar && p.car ? Math.cos(p.car.angle) * p.car.speed : p.vx;
    const velY = p.inCar && p.car ? Math.sin(p.car.angle) * p.car.speed : p.vy;
    this.camera.update(dt, p.x, p.y, velX, velY, this.shotZoom || (p.inCar ? 0.82 : 1.0));
    this.hud.update();
  }

  // Ambient life on the title screen: traffic and pedestrians keep moving.
  updateAmbient(dt) {
    for (const car of this.cars) {
      if (car.isTraffic && !car.dead) {
        car.trafficUpdate(dt, this);
        car.drive(dt, car.throttle, car.steer, false);
      }
    }
    for (const ped of this.peds) ped.update(dt, this);
    this.effects.update(dt);
  }

  draw() {
    this.renderer.draw();
  }

  frame(now) {
    requestAnimationFrame((t) => this.frame(t));
    const rawDt = Math.min(0.05, (now - this._last) / 1000 || 0.016);
    this._last = now;
    // Hit-stop freezes the simulation (but not the render).
    const dt = this.camera.hitStopTimer > 0 ? 0 : rawDt;
    try {
      this.update(dt);
    } catch (e) {
      window.__solmarError = String(e && e.stack || e);
      console.error(e);
    }
    try {
      this.draw();
    } catch (e) {
      window.__solmarError = String(e && e.stack || e);
      console.error(e);
    }
    this.input.endFrame();
  }

  start() {
    this._last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }
}

const game = new Game();
game.start();

// ---- Headless self-test (?autotest=1): drive the game and report state. ----
if (AUTOTEST) {
  setTimeout(() => {
    try {
      const g = window.__solmar;
      const report = {
        state: g.state,
        player: { x: Math.round(g.player.x), y: Math.round(g.player.y), hp: g.player.hp, inCar: g.player.inCar },
        cars: g.cars.length,
        traffic: g.cars.filter((c) => c.isTraffic).length,
        peds: g.peds.length,
        buildings: g.city.buildings.length,
        wanted: g.police.wanted,
        mission: g.missions.active ? g.missions.active.def.id : null,
        errors: window.__solmarError || null,
      };
      console.log('SOLMAR_AUTOTEST ' + JSON.stringify(report));
      window.__solmarAutotest = report;
    } catch (e) {
      console.log('SOLMAR_AUTOTEST_ERROR ' + String(e));
    }
  }, 4000);
}
