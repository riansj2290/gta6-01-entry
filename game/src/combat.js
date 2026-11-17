// combat.js — bullets, explosions and the particle effects that sell them.
// Bullets are simple ray-stepped projectiles; explosions damage everything
// nearby. Effects are pooled particles + floating text (game-feel: every hit
// gets sound, a spark and a little camera shake from the caller).

import { dist, rr } from './utils.js';

export class Combat {
  constructor(game) {
    this.game = game;
    this.bullets = []; // {x,y,vx,vy,life,from}
  }

  fireBullet(x, y, angle, from) {
    const speed = 900;
    this.bullets.push({
      x: x + Math.cos(angle) * 22, y: y + Math.sin(angle) * 22,
      vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      life: 0.9, from,
    });
    this.game.effects.muzzle(x + Math.cos(angle) * 22, y + Math.sin(angle) * 22, angle);
  }

  update(dt) {
    const game = this.game;
    for (const b of this.bullets) {
      b.life -= dt;
      const steps = 3;
      for (let s = 0; s < steps; s++) {
        b.x += (b.vx * dt) / steps;
        b.y += (b.vy * dt) / steps;
        if (game.city.insideBuilding(b.x, b.y)) { b.life = 0; game.effects.hitSpark(b.x, b.y); break; }
        if (b.from === 'player') {
          // Hit a pedestrian?
          const ped = game.nearestPed(b.x, b.y, 14);
          if (ped && ped.state !== 'down') {
            ped.knockDown(game);
            game.police.addHeat(12, 'shooting');
            b.life = 0; break;
          }
          // Hit a cop car or traffic car?
          const car = game.nearestCar(b.x, b.y, 24, (c) => !c.dead);
          if (car) {
            car.damage(22, game);
            if (car.driver === 'police') game.police.addHeat(15, 'shotCop');
            else if (car.driver === 'traffic') game.police.addHeat(10, 'shotCar');
            game.effects.hitSpark(b.x, b.y);
            b.life = 0; break;
          }
          // Hit a foot cop?
          const fc = game.police.footCops.find((f) => dist(f.x, f.y, b.x, b.y) < 14);
          if (fc) {
            fc.hp -= 34;
            game.police.addHeat(18, 'shotCop');
            game.effects.hitSpark(b.x, b.y);
            b.life = 0; break;
          }
        } else {
          // Enemy bullets (reserved for later missions) hit the player.
          const p = game.player;
          if (!p.inCar && dist(p.x, p.y, b.x, b.y) < 14) {
            p.damage(8, game, 'bullet');
            b.life = 0; break;
          }
        }
      }
    }
    this.bullets = this.bullets.filter((b) => b.life > 0);
  }
}

// ---- Effects: particles, floating text, smoke, blood, sparks. ----
export class Effects {
  constructor() {
    this.particles = []; // {x,y,vx,vy,life,maxLife,size,color,grav}
    this.texts = [];     // {x,y,life,text,color}
  }

  spawn(x, y, opts) {
    this.particles.push({
      x, y,
      vx: opts.vx || 0, vy: opts.vy || 0,
      life: opts.life || 0.5, maxLife: opts.life || 0.5,
      size: opts.size || 3, color: opts.color || '#fff', grav: opts.grav || 0,
    });
  }

  burst(x, y, n, color, speed = 160, life = 0.5, size = 3) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = rr(20, speed);
      this.spawn(x, y, { vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rr(life * 0.5, life), size: rr(size * 0.6, size * 1.4), color });
    }
  }

  muzzle(x, y, angle) {
    for (let i = 0; i < 4; i++) {
      const a = angle + rr(-0.4, 0.4);
      this.spawn(x, y, { vx: Math.cos(a) * rr(200, 380), vy: Math.sin(a) * rr(200, 380), life: 0.09, size: 3, color: '#ffd23e' });
    }
  }

  hitSpark(x, y) { this.burst(x, y, 8, '#ffd23e', 200, 0.3, 2.5); }
  blood(x, y) { this.burst(x, y, 12, '#b91c1c', 120, 0.6, 3); }
  crash(x, y) { this.burst(x, y, 10, '#c9ccd4', 180, 0.4, 3); this.burst(x, y, 6, '#ffd23e', 140, 0.25, 2.5); }
  doorSlam(x, y) { this.burst(x, y, 4, '#ffffff', 60, 0.2, 2); }

  explosion(x, y) {
    this.burst(x, y, 34, '#ff7a1e', 320, 0.8, 5);
    this.burst(x, y, 22, '#ffd23e', 260, 0.6, 4);
    this.burst(x, y, 16, '#3a3a3a', 90, 1.4, 7);
    this.texts.push({ x, y: y - 30, life: 1.2, text: 'BOOM', color: '#ff8a5c' });
  }

  smoke(x, y) {
    this.spawn(x, y, { vx: rr(-12, 12), vy: rr(-40, -18), life: rr(0.7, 1.2), size: rr(5, 9), color: 'rgba(60,60,60,0.55)' });
  }

  floatText(x, y, text, color = '#7ee787') {
    this.texts.push({ x, y, life: 1.6, text, color });
  }

  update(dt) {
    for (const p of this.particles) {
      p.life -= dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vy += p.grav * dt;
      p.vx *= Math.pow(0.4, dt); p.vy *= Math.pow(0.4, dt);
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    for (const t of this.texts) { t.life -= dt; t.y -= 34 * dt; }
    this.texts = this.texts.filter((t) => t.life > 0);
  }
}
