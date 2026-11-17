// player.js — Dario Cruz on foot and behind the wheel.
// On foot: WASD run, Shift sprint, F punch, mouse aim + click to shoot.
// In a car: the car IS the player; E gets in and out. Health, cash and the
// heat the player carries live here.

import { clamp, dist, angleTo, turnToward } from './utils.js';

export class Player {
  constructor(x, y) {
    this.x = x; this.y = y;
    this.angle = -Math.PI / 2;        // facing
    this.vx = 0; this.vy = 0;
    this.r = 13;
    this.hp = 100; this.maxHp = 100;
    this.cash = 0;
    this.car = null;                   // Car instance when driving
    this.aimAngle = 0;
    this.punchTimer = 0;
    this.punchCooldown = 0;
    this.shootCooldown = 0;
    this.dead = false;
    this.speed = 0;
    this.walkPhase = 0;
    this.invuln = 0;                   // brief grace after respawn / bust
  }

  get inCar() { return this.car !== null; }

  update(dt, game) {
    const input = game.input;
    if (this.invuln > 0) this.invuln -= dt;
    if (this.punchCooldown > 0) this.punchCooldown -= dt;
    if (this.shootCooldown > 0) this.shootCooldown -= dt;
    if (this.punchTimer > 0) this.punchTimer -= dt;

    if (this.dead) return;

    if (this.car) {
      this.updateDriving(dt, game);
      return;
    }

    // --- On foot ---
    const mv = input.moveVector();
    const sprint = input.isDown('sprint') ? 1.55 : 1;
    const speed = 235 * sprint;
    const tx = mv.x * speed, ty = mv.y * speed;
    // Snappy accel, quick stop: the character answers the keys.
    this.vx += (tx - this.vx) * Math.min(1, dt * 14);
    this.vy += (ty - this.vy) * Math.min(1, dt * 14);
    const nx = this.x + this.vx * dt;
    const ny = this.y + this.vy * dt;
    const res = game.city.collideCircle(nx, ny, this.r);
    this.x = res.x; this.y = res.y;
    this.speed = Math.hypot(this.vx, this.vy);
    if (this.speed > 20) {
      this.angle = Math.atan2(this.vy, this.vx);
      this.walkPhase += dt * this.speed * 0.055;
    }
    // Aim follows the mouse (screen -> world via the camera).
    const worldMouse = game.camera.screenToWorld(input.mouseX, input.mouseY);
    this.aimAngle = angleTo(this.x, this.y, worldMouse.x, worldMouse.y);

    // Punch: short-range, knocks a ped down, annoys the law a little.
    if (input.wasPressed('punch') && this.punchCooldown <= 0) {
      this.punchCooldown = 0.45;
      this.punchTimer = 0.18;
      game.audio.punch();
      const px = this.x + Math.cos(this.aimAngle) * 26;
      const py = this.y + Math.sin(this.aimAngle) * 26;
      const ped = game.nearestPed(px, py, 30);
      if (ped) {
        ped.knockDown(game);
        game.police.addHeat(8, 'assault');
        game.effects.hitSpark(px, py);
        game.camera.addTrauma(0.25);
      }
    }
    // Shoot toward the mouse; bullets live in combat.js.
    if ((input.mouseDown || input.isDown('shoot')) && this.shootCooldown <= 0) {
      this.shootCooldown = 0.22;
      game.combat.fireBullet(this.x, this.y, this.aimAngle, 'player');
      game.audio.shoot();
      game.camera.addTrauma(0.12);
    }
    // Enter the nearest car.
    if (input.buffered('enterCar')) {
      const car = game.nearestCar(this.x, this.y, 64);
      if (car && !car.dead) {
        input.consumeBuffer('enterCar');
        this.enterCar(car, game);
      }
    }
    // Slow health regen when the heat is off.
    if (game.police.wanted === 0 && this.hp < this.maxHp) this.hp = Math.min(this.maxHp, this.hp + 4 * dt);
  }

  updateDriving(dt, game) {
    const input = game.input;
    const car = this.car;
    const mv = input.moveVector();
    // W/S (or up/down) is throttle/brake; A/D steers; Space is the handbrake.
    const throttle = mv.y < 0 ? 1 : mv.y > 0 ? -1 : 0;
    const steer = mv.x;
    car.drive(dt, throttle, steer, input.isDown('handbrake'));
    this.x = car.x; this.y = car.y;
    this.angle = car.angle;
    this.speed = Math.abs(car.speed);
    car.resolveBuildingCollisions(game);
    car.resolveCarCollisions(game);
    // Mow down pedestrians at speed: it is a crime, and the law notices.
    for (const ped of game.peds) {
      if (ped.state === 'down') continue;
      if (dist(this.x, this.y, ped.x, ped.y) < 30 && Math.abs(car.speed) > 140) {
        ped.knockDown(game);
        game.police.addHeat(10, 'hitPed');
        game.camera.addTrauma(0.3);
        game.audio.crash();
        game.effects.blood(ped.x, ped.y);
      } else if (dist(this.x, this.y, ped.x, ped.y) < 90 && Math.abs(car.speed) > 60) {
        ped.scare(this.x, this.y, game);
      }
    }
    // Exit the car.
    if (input.buffered('enterCar')) {
      input.consumeBuffer('enterCar');
      this.exitCar(game);
    }
    // Drive-by: shoot out the window toward the mouse.
    if ((input.mouseDown || input.isDown('shoot')) && this.shootCooldown <= 0) {
      this.shootCooldown = 0.3;
      const worldMouse = game.camera.screenToWorld(input.mouseX, input.mouseY);
      game.combat.fireBullet(this.x, this.y, angleTo(this.x, this.y, worldMouse.x, worldMouse.y), 'player');
      game.audio.shoot();
    }
    game.audio.setEngine(Math.abs(car.speed) / car.maxSpeed, true);
  }

  enterCar(car, game) {
    if (car.driver === 'traffic') {
      // Carjacking a moving car: the driver bails, the law notices.
      game.police.addHeat(14, 'carjack');
      game.hud.toast('Carjacked the ' + car.name + '!');
      car.isTraffic = false;
    } else if (car.driver === 'police') {
      game.police.addHeat(20, 'stoleCopCar');
      game.hud.toast('You stole a POLICE cruiser!');
    } else if (car.driver === null) {
      game.police.addHeat(8, 'theft');
      game.hud.toast('Stole the ' + car.name + ' — nice wheels.');
    }
    car.driver = 'player';
    this.car = car;
    game.audio.blip(520);
    game.effects.doorSlam(car.x, car.y);
  }

  exitCar(game) {
    const car = this.car;
    if (!car) return;
    car.driver = null;
    this.car = null;
    // Step out to the car's left side, clear of traffic.
    const side = car.angle + Math.PI / 2;
    this.x = car.x + Math.cos(side) * 34;
    this.y = car.y + Math.sin(side) * 34;
    const res = game.city.collideCircle(this.x, this.y, this.r);
    this.x = res.x; this.y = res.y;
    this.vx = 0; this.vy = 0;
    game.audio.setEngine(0, false);
  }

  // Forced out (car exploded / busted): the player is on foot, car is gone.
  ejectFromCar(game) {
    if (!this.car) return;
    const car = this.car;
    this.car = null;
    this.x = car.x + 40; this.y = car.y + 40;
    game.audio.setEngine(0, false);
  }

  damage(amount, game, source) {
    if (this.dead || this.invuln > 0) return;
    this.hp -= amount;
    game.camera.addTrauma(0.35);
    game.hud.flashHealth();
    if (this.hp <= 0) {
      this.hp = 0;
      this.dead = true;
      game.onPlayerDead();
    }
  }

  heal(amount) { this.hp = clamp(this.hp + amount, 0, this.maxHp); }
  addCash(n) { this.cash += n; }
}
