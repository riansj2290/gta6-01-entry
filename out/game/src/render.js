// render.js — camera and drawing. Top-down sun-soaked Solmar: golden-hour
// light, long shadows, coloured rooftops. Camera follows with exponential
// smoothing (camera-systems skill), a deadzone, velocity look-ahead, and a
// trauma-based shake offset (game-feel skill) added last, on top of follow.

import { clamp, lerp, smoothFactor } from './utils.js';
import { WORLD, ROAD_W, ROAD_LINES, ROAD_STEP } from './city.js';

export class Camera {
  constructor(canvas) {
    this.canvas = canvas;
    this.x = 0; this.y = 0;           // view centre in world coords
    this.zoom = 1;
    this._focusX = 0; this._focusY = 0;
    this._leadX = 0; this._leadY = 0;
    this.trauma = 0;
    this._shakeT = 0;
    this.hitStopTimer = 0;
    this.timeScale = 1;
    this._hitStopId = 0;
  }

  snapTo(x, y) {
    this.x = x; this.y = y; this._focusX = x; this._focusY = y;
    this._leadX = 0; this._leadY = 0;
  }

  addTrauma(amount) { this.trauma = clamp(this.trauma + amount, 0, 1); }

  // Hit-stop: freeze the world briefly on big impacts; newest call owns restore.
  hitStop(duration = 0.08) {
    const id = ++this._hitStopId;
    this.hitStopTimer = duration;
    setTimeout(() => { if (id === this._hitStopId) this.hitStopTimer = 0; }, duration * 1000);
  }

  update(dt, targetX, targetY, velX, velY, zoomTarget) {
    // Deadzone: the focus only moves once the target leaves a small box.
    const dz = 42;
    const dx = targetX - this._focusX, dy = targetY - this._focusY;
    if (Math.abs(dx) > dz) this._focusX += (Math.abs(dx) - dz) * Math.sign(dx);
    if (Math.abs(dy) > dz) this._focusY += (Math.abs(dy) - dz) * Math.sign(dy);
    // Look-ahead eases toward the velocity direction so turns don't whip.
    const leadDist = 70;
    const spd = Math.hypot(velX, velY);
    const wantLeadX = spd > 30 ? (velX / spd) * leadDist : 0;
    const wantLeadY = spd > 30 ? (velY / spd) * leadDist : 0;
    const lt = smoothFactor(2.5, dt);
    this._leadX = lerp(this._leadX, wantLeadX, lt);
    this._leadY = lerp(this._leadY, wantLeadY, lt);
    // Exponential follow: same lag at any frame rate.
    const t = smoothFactor(7, dt);
    this.x = lerp(this.x, this._focusX + this._leadX, t);
    this.y = lerp(this.y, this._focusY + this._leadY, t);
    this.zoom = lerp(this.zoom, zoomTarget, smoothFactor(3, dt));
    // Clamp the VIEW (not the centre) to the world.
    const vw = this.canvas.width / this.zoom / 2, vh = this.canvas.height / this.zoom / 2;
    this.x = clamp(this.x, Math.min(vw, WORLD - vw) || WORLD / 2, Math.max(vw, WORLD - vw) || WORLD / 2);
    if (WORLD < vw * 2) this.x = WORLD / 2;
    this.y = clamp(this.y, Math.min(vh, WORLD - vh) || WORLD / 2, Math.max(vh, WORLD - vh) || WORLD / 2);
    if (WORLD < vh * 2) this.y = WORLD / 2;
    // Trauma shake decays in real time and rides on top of follow.
    this.trauma = Math.max(0, this.trauma - 1.4 * dt);
    this._shakeT += dt * 32;
  }

  shakeOffset() {
    const s = this.trauma * this.trauma;
    return {
      x: 13 * s * Math.sin(this._shakeT * 1.7),
      y: 9 * s * Math.sin(this._shakeT * 2.3),
    };
  }

  screenToWorld(sx, sy) {
    const sh = this.shakeOffset();
    return {
      x: (sx - this.canvas.width / 2) / this.zoom + this.x + sh.x,
      y: (sy - this.canvas.height / 2) / this.zoom + this.y + sh.y,
    };
  }

  worldToScreen(wx, wy) {
    const sh = this.shakeOffset();
    return {
      x: (wx - this.x - sh.x) * this.zoom + this.canvas.width / 2,
      y: (wy - this.y - sh.y) * this.zoom + this.canvas.height / 2,
    };
  }
}

export class Renderer {
  constructor(game) {
    this.game = game;
    this.canvas = game.canvas;
    this.ctx = game.canvas.getContext('2d');
    this.timeOfDay = 1; // 0 = noon, 1 = golden hour, 2 = dusk
  }

  resize() {
    // Logical size in CSS pixels; the canvas backing store matches 1:1.
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
    this.canvas.style.width = window.innerWidth + 'px';
    this.canvas.style.height = window.innerHeight + 'px';
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  draw() {
    const game = this.game;
    const ctx = this.ctx;
    const cam = game.camera;
    const W = this.canvas.width, H = this.canvas.height;
    const sh = cam.shakeOffset();
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(cam.zoom, cam.zoom);
    ctx.translate(-cam.x - sh.x, -cam.y - sh.y);

    const view = {
      x0: cam.x - W / cam.zoom / 2 - 60, y0: cam.y - H / cam.zoom / 2 - 60,
      x1: cam.x + W / cam.zoom / 2 + 60, y1: cam.y + H / cam.zoom / 2 + 60,
    };
    this.drawGround(ctx, view);
    this.drawRoads(ctx, view);
    this.drawParkAndBeach(ctx, view);
    this.drawBuildings(ctx, view);
    this.drawProps(ctx, view);
    this.drawMarkers(ctx);
    this.drawCars(ctx, view);
    this.drawPeds(ctx, view);
    this.drawCops(ctx);
    this.drawPlayer(ctx);
    this.drawBullets(ctx);
    this.drawEffects(ctx);
    ctx.restore();
    this.drawLighting(ctx, W, H);
  }

  drawGround(ctx, view) {
    // Base ground: warm dry grass / dirt.
    ctx.fillStyle = '#b8a06a';
    ctx.fillRect(view.x0, view.y0, view.x1 - view.x0, view.y1 - view.y0);
    // Subtle block tint variation.
    ctx.fillStyle = 'rgba(0,0,0,0.04)';
    for (let bx = 0; bx < 8; bx++) for (let by = 0; by < 8; by++) {
      if ((bx + by) % 2 === 0) {
        const x0 = ROAD_LINES[bx] + ROAD_W / 2, y0 = ROAD_LINES[by] + ROAD_W / 2;
        ctx.fillRect(x0, y0, ROAD_STEP - ROAD_W, ROAD_STEP - ROAD_W);
      }
    }
  }

  drawRoads(ctx, view) {
    ctx.fillStyle = '#3d4148';
    for (const lx of ROAD_LINES) ctx.fillRect(lx - ROAD_W / 2, 0, ROAD_W, WORLD);
    for (const ly of ROAD_LINES) ctx.fillRect(0, ly - ROAD_W / 2, WORLD, ROAD_W);
    // Sidewalks: lighter strips along each road.
    ctx.fillStyle = '#8d8578';
    for (const lx of ROAD_LINES) {
      ctx.fillRect(lx - ROAD_W / 2 - 14, 0, 14, WORLD);
      ctx.fillRect(lx + ROAD_W / 2, 0, 14, WORLD);
    }
    for (const ly of ROAD_LINES) {
      ctx.fillRect(0, ly - ROAD_W / 2 - 14, WORLD, 14);
      ctx.fillRect(0, ly + ROAD_W / 2, WORLD, 14);
    }
    // Dashed centre lines.
    ctx.fillStyle = '#e8d44d';
    for (const lx of ROAD_LINES) {
      for (let y = 0; y < WORLD; y += 64) {
        if (this.onIntersection(lx, y)) continue;
        ctx.fillRect(lx - 2, y, 4, 30);
      }
    }
    for (const ly of ROAD_LINES) {
      for (let x = 0; x < WORLD; x += 64) {
        if (this.onIntersection(x, ly)) continue;
        ctx.fillRect(x, ly - 2, 30, 4);
      }
    }
    // Crosswalks at intersections.
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    for (const lx of ROAD_LINES) for (const ly of ROAD_LINES) {
      for (let i = -3; i <= 3; i++) {
        ctx.fillRect(lx + i * 12 - 4, ly - ROAD_W / 2 + 6, 8, 16);
        ctx.fillRect(lx + i * 12 - 4, ly + ROAD_W / 2 - 22, 8, 16);
      }
    }
  }

  onIntersection(x, y) {
    for (const ly of ROAD_LINES) if (Math.abs(y - ly) < ROAD_W) return true;
    for (const lx of ROAD_LINES) if (Math.abs(x - lx) < ROAD_W) return true;
    return false;
  }

  drawParkAndBeach(ctx, view) {
    const city = this.game.city;
    // Central park.
    for (const p of city.parks) {
      ctx.fillStyle = '#5da24a';
      ctx.fillRect(p.x, p.y, p.w, p.h);
      ctx.fillStyle = '#6fb457';
      ctx.beginPath(); ctx.arc(p.x + p.w / 2, p.y + p.h / 2, 60, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#7ec8e8';
      ctx.beginPath(); ctx.arc(p.x + p.w / 2, p.y + p.h / 2, 34, 0, Math.PI * 2); ctx.fill();
    }
    // Beach + sea on the east edge.
    ctx.fillStyle = '#ecd9a0';
    ctx.fillRect(city.beach.x0, 0, city.beach.x1 - city.beach.x0, WORLD);
    ctx.fillStyle = '#2f7fb8';
    ctx.fillRect(3520, 0, 80, WORLD);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    for (let y = 0; y < WORLD; y += 160) ctx.fillRect(3508, y, 14, 40);
    // Pier.
    ctx.fillStyle = '#8a6a48';
    ctx.fillRect(city.pier.x, city.pier.y, city.pier.w, city.pier.h);
  }

  drawBuildings(ctx, view) {
    const sun = { x: 10, y: 14 }; // long golden-hour shadows
    for (const b of this.game.city.buildings) {
      if (b.x > view.x1 || b.x + b.w < view.x0 || b.y > view.y1 || b.y + b.h < view.y0) continue;
      // Shadow.
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.fillRect(b.x + sun.x, b.y + sun.y, b.w, b.h);
      // Walls (side) then roof.
      ctx.fillStyle = this.shade(b.color, -18);
      ctx.fillRect(b.x, b.y + 6, b.w, b.h);
      ctx.fillStyle = b.color;
      ctx.fillRect(b.x, b.y, b.w, b.h);
      // Roof inset + windows grid.
      ctx.fillStyle = b.roof;
      ctx.fillRect(b.x + 6, b.y + 6, b.w - 12, b.h - 12);
      ctx.fillStyle = 'rgba(255,240,180,0.85)';
      const cols = Math.max(1, Math.floor(b.w / 34)), rows = Math.max(1, Math.floor(b.h / 34));
      for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
        if ((i * 7 + j * 3 + b.hgt) % 3 === 0) continue;
        ctx.fillRect(b.x + 12 + i * ((b.w - 24) / Math.max(1, cols)), b.y + 12 + j * ((b.h - 24) / Math.max(1, rows)), 10, 8);
      }
      // Height marker: taller buildings get a brighter roof edge.
      if (b.hgt >= 6) {
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = 2;
        ctx.strokeRect(b.x + 3, b.y + 3, b.w - 6, b.h - 6);
      }
    }
  }

  shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const r = clamp((n >> 16) + amt, 0, 255), g = clamp(((n >> 8) & 255) + amt, 0, 255), b = clamp((n & 255) + amt, 0, 255);
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

  drawProps(ctx, view) {
    const city = this.game.city;
    for (const t of city.trees) {
      if (t.x < view.x0 || t.x > view.x1 || t.y < view.y0 || t.y > view.y1) continue;
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.beginPath(); ctx.ellipse(t.x + 5, t.y + 6, t.r, t.r * 0.7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = t.palm ? '#3f9e4d' : '#2f7d3a';
      ctx.beginPath(); ctx.arc(t.x, t.y, t.r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#57b368';
      ctx.beginPath(); ctx.arc(t.x - 3, t.y - 3, t.r * 0.55, 0, Math.PI * 2); ctx.fill();
    }
    // Street lamps (small dots with a warm glow at dusk).
    ctx.fillStyle = '#2b2b30';
    for (const l of city.lamps) {
      if (l.x < view.x0 || l.x > view.x1 || l.y < view.y0 || l.y > view.y1) continue;
      ctx.beginPath(); ctx.arc(l.x, l.y, 3, 0, Math.PI * 2); ctx.fill();
    }
  }

  drawMarkers(ctx) {
    const game = this.game;
    const markers = [];
    if (game.missions.marker) markers.push(game.missions.marker);
    const idle = game.missions.idleMarker();
    if (idle) markers.push(idle);
    if (game.missions.taxi) {
      const t = game.missions.taxi;
      markers.push(t.phase === 'pickup'
        ? { x: t.pickup.x, y: t.pickup.y, color: '#4fc9ff', label: 'TAXI' }
        : { x: t.dest.x, y: t.dest.y, color: '#4fc9ff', label: 'DROP OFF' });
    }
    const pulse = 1 + Math.sin(game.time * 5) * 0.18;
    for (const m of markers) {
      // Ground ring + bouncing pin.
      ctx.strokeStyle = m.color;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(m.x, m.y, 26 * pulse, 0, Math.PI * 2); ctx.stroke();
      const bob = Math.sin(game.time * 4) * 8;
      ctx.fillStyle = m.color;
      ctx.beginPath();
      ctx.moveTo(m.x, m.y - 52 + bob);
      ctx.lineTo(m.x - 12, m.y - 30 + bob);
      ctx.lineTo(m.x + 12, m.y - 30 + bob);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#14100a';
      ctx.beginPath(); ctx.arc(m.x, m.y - 38 + bob, 5, 0, Math.PI * 2); ctx.fill();
      if (m.label) {
        ctx.font = 'bold 13px "Segoe UI", Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(0,0,0,0.65)';
        const w = ctx.measureText(m.label).width + 14;
        ctx.fillRect(m.x - w / 2, m.y - 82 + bob, w, 20);
        ctx.fillStyle = '#fff';
        ctx.fillText(m.label, m.x, m.y - 68 + bob);
      }
    }
    // Hold-progress ring for the bank robbery.
    const mm = game.missions;
    if (mm.active && mm.active.def.steps[mm.active.step]?.type === 'hold' && mm.holdProgress > 0) {
      const p = game.player;
      ctx.strokeStyle = '#ffd23e'; ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 46, -Math.PI / 2, -Math.PI / 2 + (mm.holdProgress / 8) * Math.PI * 2);
      ctx.stroke();
    }
  }

  drawCarShape(ctx, car) {
    ctx.save();
    ctx.translate(car.x, car.y);
    ctx.rotate(car.angle);
    // Shadow.
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(-car.w / 2 + 4, -car.h / 2 + 5, car.w, car.h);
    // Body.
    ctx.fillStyle = car.color;
    const r = 7;
    ctx.beginPath();
    ctx.roundRect(-car.w / 2, -car.h / 2, car.w, car.h, r);
    ctx.fill();
    // Cabin + windshield.
    ctx.fillStyle = 'rgba(20,28,40,0.85)';
    ctx.fillRect(-6, -car.h / 2 + 3, 16, car.h - 6);
    ctx.fillStyle = 'rgba(180,220,255,0.7)';
    ctx.fillRect(8, -car.h / 2 + 4, 5, car.h - 8);
    // Headlights.
    ctx.fillStyle = '#ffe9a8';
    ctx.fillRect(car.w / 2 - 2, -car.h / 2 + 2, 3, 4);
    ctx.fillRect(car.w / 2 - 2, car.h / 2 - 6, 3, 4);
    // Police light bar + livery.
    if (car.isPolice) {
      ctx.fillStyle = '#fff';
      ctx.fillRect(-car.w / 2 + 4, -car.h / 2 + 2, car.w - 8, 3);
      const blink = Math.floor(this.game.time * 6) % 2 === 0;
      ctx.fillStyle = blink ? '#ff3b30' : '#2f7bff';
      ctx.fillRect(-4, -car.h / 2 - 2, 8, 5);
      ctx.fillStyle = blink ? '#2f7bff' : '#ff3b30';
      ctx.fillRect(4, -car.h / 2 - 2, 8, 5);
    }
    // Repo target: gold shimmer.
    if (this.game.missions.markedCar === car) {
      ctx.strokeStyle = '#ffd23e'; ctx.lineWidth = 2;
      ctx.strokeRect(-car.w / 2 - 3, -car.h / 2 - 3, car.w + 6, car.h + 6);
    }
    // Smoke when wrecked / damaged.
    if (car.smoking && Math.random() < 0.3) {
      this.game.effects.smoke(car.x - Math.cos(car.angle) * 14, car.y - Math.sin(car.angle) * 14);
    }
    ctx.restore();
    if (car.dead) {
      ctx.fillStyle = 'rgba(20,20,20,0.85)';
      ctx.beginPath(); ctx.arc(car.x, car.y, 22, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ff7a1e';
      ctx.font = 'bold 11px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('WRECK', car.x, car.y + 4);
    }
  }

  drawCars(ctx, view) {
    for (const car of this.game.cars) {
      if (car.x < view.x0 - 80 || car.x > view.x1 + 80 || car.y < view.y0 - 80 || car.y > view.y1 + 80) continue;
      this.drawCarShape(ctx, car);
    }
  }

  drawPeds(ctx, view) {
    for (const ped of this.game.peds) {
      if (ped.x < view.x0 || ped.x > view.x1 || ped.y < view.y0 || ped.y > view.y1) continue;
      const bob = ped.state === 'walk' ? Math.sin(ped.walkPhase) * 2 : 0;
      ctx.save();
      ctx.translate(ped.x, ped.y);
      if (ped.state === 'down') {
        ctx.rotate(1.4);
        ctx.fillStyle = ped.shirt;
        ctx.beginPath(); ctx.ellipse(0, 0, 13, 8, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = ped.skin;
        ctx.beginPath(); ctx.arc(14, 0, 6, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        continue;
      }
      ctx.rotate(ped.angle);
      // Shadow + body (top-down walker: shoulders + head).
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      ctx.beginPath(); ctx.ellipse(2, 3, 11, 9, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = ped.shirt;
      ctx.beginPath(); ctx.ellipse(0, 0, 11, 9, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = ped.skin;
      ctx.beginPath(); ctx.arc(0, 0, 5.5, 0, Math.PI * 2); ctx.fill();
      // Walking feet.
      ctx.fillStyle = '#2b2b30';
      ctx.fillRect(-8, -9 + bob, 5, 4);
      ctx.fillRect(-8, 5 - bob, 5, 4);
      ctx.restore();
      if (ped.panic > 0) {
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 14px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('!', ped.x, ped.y - 18);
      }
    }
  }

  drawCops(ctx) {
    for (const fc of this.game.police.footCops) {
      ctx.save();
      ctx.translate(fc.x, fc.y);
      ctx.rotate(fc.angle);
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      ctx.beginPath(); ctx.ellipse(2, 3, 12, 10, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#1c2733';
      ctx.beginPath(); ctx.ellipse(0, 0, 12, 10, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffd23e';
      ctx.fillRect(8, -2, 5, 4); // badge glint
      ctx.fillStyle = '#f2c89b';
      ctx.beginPath(); ctx.arc(0, 0, 5.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#1c2733';
      ctx.beginPath(); ctx.arc(0, -1, 6.5, Math.PI, 0); ctx.fill(); // cap
      ctx.restore();
    }
  }

  drawPlayer(ctx) {
    const game = this.game;
    const p = game.player;
    if (p.dead || p.inCar) return;
    const bob = p.speed > 20 ? Math.sin(p.walkPhase) * 2.5 : 0;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.ellipse(3, 4, 12, 10, 0, 0, Math.PI * 2); ctx.fill();
    // Dario: red jacket, dark jeans.
    ctx.fillStyle = '#c22f2f';
    ctx.beginPath(); ctx.ellipse(0, 0, 12, 10, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#f2c89b';
    ctx.beginPath(); ctx.arc(0, 0, 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#2b2b30';
    ctx.beginPath(); ctx.arc(0, -1.5, 7, Math.PI, 0); ctx.fill(); // hair
    // Gun in hand when aiming (mouse held).
    if (game.input.mouseDown) {
      ctx.fillStyle = '#222';
      ctx.fillRect(10, -2, 10, 3);
    }
    // Punch flash.
    if (p.punchTimer > 0) {
      ctx.fillStyle = '#ffd23e';
      ctx.beginPath(); ctx.arc(20, 0, 7, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = '#2b2b30';
    ctx.fillRect(-9, -11 + bob, 5, 4);
    ctx.fillRect(-9, 7 - bob, 5, 4);
    ctx.restore();
    // Aim line (subtle) when on foot.
    if (!p.inCar && game.state === 'playing') {
      const mx = p.x + Math.cos(p.aimAngle) * 46, my = p.y + Math.sin(p.aimAngle) * 46;
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 6]);
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(mx, my); ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  drawBullets(ctx) {
    ctx.fillStyle = '#ffe9a8';
    for (const b of this.game.combat.bullets) {
      ctx.beginPath(); ctx.arc(b.x, b.y, 3, 0, Math.PI * 2); ctx.fill();
    }
  }

  drawEffects(ctx) {
    for (const pt of this.game.effects.particles) {
      ctx.globalAlpha = Math.max(0, pt.life / pt.maxLife);
      ctx.fillStyle = pt.color;
      ctx.beginPath(); ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.font = 'bold 15px "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'center';
    for (const t of this.game.effects.texts) {
      ctx.globalAlpha = Math.min(1, t.life);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x, t.y);
    }
    ctx.globalAlpha = 1;
  }

  // Golden-hour grade: warm tint + vignette, stronger at dusk.
  drawLighting(ctx, W, H) {
    if (this.timeOfDay === 0) return;
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
    if (this.timeOfDay === 1) {
      g.addColorStop(0, 'rgba(255,170,60,0.05)');
      g.addColorStop(1, 'rgba(120,40,90,0.20)');
    } else {
      g.addColorStop(0, 'rgba(80,60,160,0.10)');
      g.addColorStop(1, 'rgba(10,10,50,0.38)');
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
}
