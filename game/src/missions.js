// missions.js — the story: six jobs from fixer Mara Solis, plus a repeatable
// taxi side-gig. Each mission is a small step machine (go / pick up / deliver /
// steal / lose the heat / race / rob); the manager owns the marker, the timer
// and the dialogue. Completing a job pays cash and unlocks the next.

import { dist, randRange, pick } from './utils.js';
import { Car, CAR_COLORS } from './vehicles.js';

// Named places in Solmar (road intersections, so cars can reach them).
export const PLACES = {
  garage: { x: 700, y: 700, name: "Mara's Garage" },
  docks: { x: 300, y: 3100, name: 'Solmar Docks' },
  safehouse: { x: 2700, y: 300, name: 'Safehouse' },
  bank: { x: 1900, y: 1500, name: 'Solmar National Bank' },
  hideout: { x: 300, y: 300, name: 'Hideout' },
  hospital: { x: 1100, y: 2700, name: 'St. Solmar Hospital' },
  beach: { x: 3300, y: 2700, name: 'Marina Beach' },
  oldTown: { x: 2700, y: 2700, name: 'Old Town' },
  raceStart: { x: 700, y: 2300, name: 'Race Start' },
};

const DROP_POINTS = [
  { x: 2300, y: 700, name: 'Downtown Lofts' },
  { x: 1100, y: 3100, name: 'Warehouse 9' },
  { x: 3100, y: 1900, name: 'Marina Penthouse' },
];

const RACE_CHECKPOINTS = [
  { x: 700, y: 1500 }, { x: 1500, y: 1500 }, { x: 1500, y: 700 },
  { x: 2700, y: 700 }, { x: 2700, y: 2300 }, { x: 1500, y: 3100 },
];

export const MISSIONS = [
  {
    id: 'first-wheels', title: '1 — FIRST WHEELS', reward: 300,
    brief: "Dario. You're out, you're broke, and I need a driver. Steal any car — any car, baby — and bring it to my garage. The yellow marker is me.",
    steps: [
      { type: 'inCar', text: 'Steal any car (walk up to one and press E)' },
      { type: 'goto', at: PLACES.garage, text: "Drive to Mara's Garage" },
    ],
  },
  {
    id: 'package-run', title: '2 — PACKAGE RUN', reward: 500,
    brief: 'A package is waiting at the docks. Pick it up, hit all three drops before the clock runs out. Drive like the rent is due — because it is.',
    steps: [
      { type: 'goto', at: PLACES.docks, text: 'Pick up the package at the Docks' },
      { type: 'goto', at: DROP_POINTS[0], text: 'Deliver to Downtown Lofts', timer: 150 },
      { type: 'goto', at: DROP_POINTS[1], text: 'Deliver to Warehouse 9' },
      { type: 'goto', at: DROP_POINTS[2], text: 'Deliver to the Marina Penthouse' },
    ],
  },
  {
    id: 'heat-check', title: '3 — HEAT CHECK', reward: 400,
    brief: "The crew needs to know you can shake a tail. I've tipped the PD — they think you lifted a cruiser. Lose them, then get to the safehouse. Don't get pinched.",
    steps: [
      { type: 'setWanted', stars: 2, text: 'The PD is coming — get moving!' },
      { type: 'loseHeat', at: PLACES.safehouse, text: 'Lose the cops, then reach the Safehouse' },
    ],
  },
  {
    id: 'repo-job', title: '4 — REPO JOB', reward: 700,
    brief: "A gold Comet is parked in Old Town. Owner stopped paying. Take it, bring it to my garage — and bring it back in one piece, or the job pays half.",
    steps: [
      { type: 'stealMarked', at: PLACES.oldTown, text: 'Steal the gold Comet in Old Town' },
      { type: 'goto', at: PLACES.garage, text: "Deliver the Comet to Mara's Garage", keepCar: true },
    ],
  },
  {
    id: 'street-race', title: '5 — STREET RACE', reward: 900,
    brief: "Vex thinks he's the fastest wheel in Solmar. Prove him wrong: six checkpoints, first one through the last gate takes the pot. Don't let him win.",
    steps: [
      { type: 'race', text: 'Beat Vex through all 6 checkpoints' },
    ],
  },
  {
    id: 'big-score', title: '6 — THE BIG SCORE', reward: 2500,
    brief: "This is the one, Dario. Solmar National Bank, Friday, shift change. Get inside, hold the door eight seconds, then run — every cop in the city will be on you. Bring it home.",
    steps: [
      { type: 'goto', at: PLACES.bank, text: 'Reach Solmar National Bank' },
      { type: 'hold', at: PLACES.bank, seconds: 8, text: 'Hold the bank door — 8 seconds' },
      { type: 'escape', at: PLACES.hideout, text: 'Escape to the Hideout with the money' },
    ],
  },
];

export class MissionManager {
  constructor(game) {
    this.game = game;
    this.completed = 0;          // missions finished
    this.active = null;          // {def, step, timer, ...}
    this.marker = null;          // {x, y, color, label} drawn on map + minimap
    this.markedCar = null;       // the repo-job target car
    this.race = null;            // race state
    this.taxi = null;            // {phase, pickup, dest, fare, timer}
    this.taxiCooldown = 20;
    this.holdProgress = 0;
    this._briefShown = false;
  }

  get currentDef() { return MISSIONS[this.completed] || null; }

  startNext() {
    const def = this.currentDef;
    if (!def) return;
    this.active = { def, step: 0, timer: 0, startedAt: this.game.time };
    this._briefShown = false;
    this.game.audio.phone();
    this.game.hud.showDialogue('MARA SOLIS', def.brief, 7);
    this.game.audio.duckMusic(true);
    setTimeout(() => this.game.audio.duckMusic(false), 7000);
    this.applyStep();
  }

  applyStep() {
    const game = this.game;
    const step = this.active.def.steps[this.active.step];
    if (!step) { this.completeMission(); return; }
    this.active.timer = step.timer || 0;
    this.holdProgress = 0;
    if (step.type === 'setWanted') {
      game.police.heat = step.stars * 100 + 10;
      game.police.wanted = step.stars;
      game.police.addHeat(0, 'setup');
      this.advance();
      return;
    }
    if (step.type === 'stealMarked') {
      // Spawn the gold Comet at the marker.
      const car = new Car(step.at.x + 40, step.at.y + 40, 0, { color: '#e8b13d', name: 'Comet GT', maxSpeed: 580 });
      car.driver = null;
      game.cars.push(car);
      this.markedCar = car;
    }
    if (step.type === 'race') this.startRace();
    this.marker = step.at ? { x: step.at.x, y: step.at.y, color: '#ffd23e', label: step.text } : null;
  }

  advance() {
    this.active.step++;
    this.applyStep();
  }

  update(dt) {
    const game = this.game;
    // --- Taxi side-gig: a fare appears when free-roaming in a car. ---
    this.taxiCooldown -= dt;
    if (!this.taxi && this.taxiCooldown <= 0 && game.player.inCar && !game.player.dead) {
      this.spawnTaxi();
    }
    if (this.taxi) this.updateTaxi(dt);

    if (!this.active) return;
    const step = this.active.def.steps[this.active.step];
    if (!step) return;
    const p = game.player;
    if (this.active.timer > 0) {
      this.active.timer -= dt;
      if (this.active.timer <= 0) { this.failMission('Out of time.'); return; }
    }
    switch (step.type) {
      case 'inCar':
        if (p.inCar) { game.hud.toast('Got wheels. Go!'); this.advance(); }
        break;
      case 'goto': {
        const at = step.at;
        if (dist(p.x, p.y, at.x, at.y) < (p.inCar ? 90 : 60)) {
          if (step.keepCar && this.markedCar && this.markedCar.hp < 40) {
            this.failMission('The Comet is wrecked — Mara pays nothing for scrap.');
            return;
          }
          game.audio.pickup();
          game.effects.floatText(p.x, p.y - 30, step.text + ' — done!');
          this.advance();
        }
        break;
      }
      case 'loseHeat':
        if (game.police.wanted === 0 && dist(p.x, p.y, step.at.x, step.at.y) < 90) {
          this.advance();
        }
        break;
      case 'stealMarked':
        if (this.markedCar && p.car === this.markedCar) {
          game.police.addHeat(60, 'repo');
          game.hud.toast('Got the Comet! Get it to the garage.');
          this.advance();
        }
        break;
      case 'race':
        this.updateRace(dt);
        break;
      case 'hold': {
        if (dist(p.x, p.y, step.at.x, step.at.y) < 110) {
          this.holdProgress += dt;
          if (this.holdProgress >= step.seconds) {
            game.police.addHeat(400, 'bankRobbery');
            game.player.addCash(0);
            game.hud.toast('VAULT OPEN — $2,500! RUN!');
            game.audio.missionGood();
            this.advance();
          }
        } else this.holdProgress = Math.max(0, this.holdProgress - dt * 2);
        break;
      }
      case 'escape':
        if (dist(p.x, p.y, step.at.x, step.at.y) < 100) {
          if (game.police.wanted > 0) { game.hud.toast('Still hot — lose them first!'); }
          else this.advance();
        }
        break;
      default: break;
    }
  }

  startRace() {
    const game = this.game;
    const start = PLACES.raceStart;
    // Meet at the start line: player and rival line up together.
    const p = game.player;
    p.x = start.x; p.y = start.y; p.angle = 0;
    if (p.car) { p.car.x = start.x; p.car.y = start.y; p.car.angle = 0; p.car.speed = 0; }
    game.camera.snapTo(p.x, p.y);
    // Rival Vex spawns beside the player at the start line.
    const rival = new Car(start.x + 60, start.y, 0, { color: '#8a5fd9', name: 'Vex GT', maxSpeed: 540 });
    rival.driver = 'rival';
    rival.isTraffic = false;
    game.cars.push(rival);
    this.race = {
      checkpoints: RACE_CHECKPOINTS,
      playerIdx: 0, rivalIdx: 0, rival,
      timer: 150, rivalPath: null, rivalPathIdx: 0,
    };
    this.marker = { x: RACE_CHECKPOINTS[0].x, y: RACE_CHECKPOINTS[0].y, color: '#ffd23e', label: 'Checkpoint 1/6' };
    game.hud.showDialogue('VEX', "Hope you brought a fast car, Cruz. Loser buys the drinks.", 4);
  }

  updateRace(dt) {
    const game = this.game;
    const r = this.race;
    if (!r) return;
    r.timer -= dt;
    if (r.timer <= 0) { this.failMission('Vex took the pot. Too slow.'); return; }
    const p = game.player;
    // Player checkpoint.
    if (r.playerIdx < r.checkpoints.length) {
      const cp = r.checkpoints[r.playerIdx];
      if (dist(p.x, p.y, cp.x, cp.y) < 100) {
        r.playerIdx++;
        game.audio.pickup();
        game.effects.floatText(p.x, p.y - 30, 'Checkpoint ' + r.playerIdx + '/6');
        if (r.playerIdx < r.checkpoints.length) {
          this.marker = { x: r.checkpoints[r.playerIdx].x, y: r.checkpoints[r.playerIdx].y, color: '#ffd23e', label: 'Checkpoint ' + (r.playerIdx + 1) + '/6' };
        }
      }
    }
    // Rival drives the checkpoint route on the road graph.
    const rival = r.rival;
    if (r.rivalIdx < r.checkpoints.length && !rival.dead) {
      const cp = r.checkpoints[r.rivalIdx];
      if (dist(rival.x, rival.y, cp.x, cp.y) < 100) r.rivalIdx++;
      const targetNode = game.city.nearestNode(cp.x, cp.y);
      const curNode = game.city.nearestNode(rival.x, rival.y);
      if (!r.rivalPath) {
        r.rivalPath = game.city.findPath(curNode, targetNode) || [targetNode];
        r.rivalPathIdx = 0;
      }
      let waypoint = cp;
      if (r.rivalPathIdx < r.rivalPath.length) {
        const node = game.city.nodes[r.rivalPath[r.rivalPathIdx]];
        if (dist(rival.x, rival.y, node.x, node.y) < 40) r.rivalPathIdx++;
        else waypoint = node;
      }
      const wantAngle = Math.atan2(waypoint.y - rival.y, waypoint.x - rival.x);
      let diff = wantAngle - rival.angle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      rival.drive(dt, 1, Math.max(-1, Math.min(1, diff * 2.4)), false);
      rival.resolveBuildingCollisions(game);
      rival.resolveCarCollisions(game);
    }
    if (r.playerIdx >= r.checkpoints.length) {
      if (r.rivalIdx >= r.checkpoints.length) { this.failMission('Photo finish — Vex edged you out.'); return; }
      game.hud.toast('YOU WIN THE RACE!');
      rival.dead = true;
      this.advance();
    } else if (r.rivalIdx >= r.checkpoints.length) {
      this.failMission('Vex finished first. The pot is his.');
    }
  }

  completeMission() {
    const game = this.game;
    const def = this.active.def;
    this.completed++;
    this.active = null;
    this.marker = null;
    this.markedCar = null;
    this.race = null;
    game.player.addCash(def.reward);
    game.stats.missionsDone++;
    game.stats.earned += def.reward;
    game.audio.missionGood();
    game.hud.toast('MISSION COMPLETE — +' + '$' + def.reward);
    game.effects.floatText(game.player.x, game.player.y - 40, '+$' + def.reward, '#7ee787');
    game.save.save();
    if (this.completed >= MISSIONS.length) {
      game.hud.showDialogue('MARA SOLIS', "That's the whole board, Dario. Solmar is yours now — every crew in the city knows your name. Free roam, take fares, cause chaos. You earned it.", 9);
    } else {
      game.hud.showDialogue('MARA SOLIS', 'Job done. ' + MISSIONS[this.completed].title + ' is next — press the marker when you are ready. Or take a taxi fare and stack some cash first.', 7);
    }
  }

  failMission(reason) {
    const game = this.game;
    this.active = null;
    this.marker = null;
    this.markedCar = null;
    this.race = null;
    game.audio.missionFail();
    game.hud.showDialogue('MARA SOLIS', 'Job blown: ' + reason + ' Come back to the garage marker and we run it again.', 6);
    // Restart the same mission on next approach: put a restart marker at the garage.
    this.marker = { x: PLACES.garage.x, y: PLACES.garage.y, color: '#7ee787', label: 'Restart mission' };
    this._restartPending = true;
  }

  // Standing on the restart marker re-starts the failed mission.
  checkRestart() {
    if (!this._restartPending) return;
    const p = this.game.player;
    if (dist(p.x, p.y, PLACES.garage.x, PLACES.garage.y) < 90) {
      this._restartPending = false;
      this.marker = null;
      this.startNext();
    }
  }

  // ---- Taxi side-gig ----
  spawnTaxi() {
    const game = this.game;
    const p = game.player;
    const rp = game.city.nearestRoadPoint(p.x + (Math.random() < 0.5 ? -1 : 1) * 420, p.y + (Math.random() < 0.5 ? -1 : 1) * 420);
    const dest = pick(game.rng, [PLACES.beach, PLACES.bank, PLACES.hospital, PLACES.oldTown, PLACES.docks, PLACES.safehouse]);
    this.taxi = {
      phase: 'pickup',
      pickup: { x: rp.x, y: rp.y },
      dest: { x: dest.x, y: dest.y, name: dest.name },
      fare: 80 + Math.floor(game.rng() * 90),
      timer: 90,
    };
    this.taxiCooldown = 9999; // one fare at a time
    game.hud.toast('TAXI FARE — pick up the passenger (blue marker)');
  }

  updateTaxi(dt) {
    const game = this.game;
    const t = this.taxi;
    const p = game.player;
    t.timer -= dt;
    if (t.timer <= 0) { game.hud.toast('Fare cancelled — too slow.'); this.taxi = null; this.taxiCooldown = 25; return; }
    if (t.phase === 'pickup') {
      if (p.inCar && dist(p.x, p.y, t.pickup.x, t.pickup.y) < 80) {
        t.phase = 'dropoff';
        game.audio.pickup();
        game.hud.toast('Passenger in! Take them to ' + t.dest.name);
      }
    } else if (dist(p.x, p.y, t.dest.x, t.dest.y) < 90) {
      game.player.addCash(t.fare);
      game.stats.earned += t.fare;
      game.stats.fares++;
      game.audio.missionGood();
      game.effects.floatText(p.x, p.y - 30, '+$' + t.fare + ' fare');
      game.hud.toast('Fare complete — +$' + t.fare);
      this.taxi = null;
      this.taxiCooldown = 30;
      game.save.save();
    }
  }

  objectiveText() {
    if (this.active) {
      const step = this.active.def.steps[this.active.step];
      if (step) return { title: this.active.def.title, text: step.text, timer: this.active.timer > 0 ? this.active.timer : (this.race ? this.race.timer : 0) };
    }
    if (this._restartPending) return { title: 'MISSION FAILED', text: 'Return to the garage to retry', timer: 0 };
    if (this.taxi) {
      return { title: 'TAXI FARE — $' + this.taxi.fare, text: this.taxi.phase === 'pickup' ? 'Pick up the passenger (blue marker)' : 'Drop off at ' + this.taxi.dest.name, timer: this.taxi.timer };
    }
    if (this.completed >= MISSIONS.length) return { title: 'SOLMAR IS YOURS', text: 'Free roam — fares, chaos, or just cruise the Marina', timer: 0 };
    return { title: 'NEXT JOB: ' + this.currentDef.title, text: 'Drive to the garage marker to start — or take a taxi fare', timer: 0 };
  }

  // The "start next mission" marker when idle: at the garage.
  idleMarker() {
    if (this.active || this._restartPending || this.completed >= MISSIONS.length) return null;
    return { x: PLACES.garage.x, y: PLACES.garage.y, color: '#7ee787', label: 'Start: ' + this.currentDef.title };
  }
}
