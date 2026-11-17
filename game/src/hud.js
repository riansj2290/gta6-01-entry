// hud.js — the DOM HUD and the minimap (game-ui-ux skill: HUD driven by
// events, anchored to screen corners, safe-area inset by CSS). The minimap is
// a small canvas redrawn each frame from the same world data the game uses.

import { WORLD, ROAD_LINES } from './city.js';
import { money, fmtTime } from './utils.js';

export class HUD {
  constructor(game) {
    this.game = game;
    this.el = {
      hud: document.getElementById('hud'),
      wanted: document.getElementById('wanted'),
      healthfill: document.getElementById('healthfill'),
      cash: document.getElementById('cash'),
      speedo: document.getElementById('speedo'),
      minimap: document.getElementById('minimap'),
      objTitle: document.getElementById('objTitle'),
      objText: document.getElementById('objText'),
      objTimer: document.getElementById('objTimer'),
      hint: document.getElementById('hint'),
      toast: document.getElementById('toast'),
      dialogue: document.getElementById('dialogue'),
      dlgWho: document.getElementById('dlgWho'),
      dlgLine: document.getElementById('dlgLine'),
      crosshair: document.getElementById('crosshair'),
      status: document.getElementById('status'),
    };
    this._toastTimer = null;
    this._dlgTimer = null;
    this._flashTimer = 0;
  }

  show() { this.el.hud.classList.add('on'); }
  hide() { this.el.hud.classList.remove('on'); }

  toast(text, ms = 2600) {
    this.el.toast.textContent = text;
    this.el.toast.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => this.el.toast.classList.remove('show'), ms);
    this.el.status.textContent = text;
  }

  showDialogue(who, line, seconds = 6) {
    this.el.dlgWho.textContent = who;
    this.el.dlgLine.textContent = line;
    this.el.dialogue.classList.add('show');
    clearTimeout(this._dlgTimer);
    this._dlgTimer = setTimeout(() => this.el.dialogue.classList.remove('show'), seconds * 1000);
  }

  hideDialogue() {
    clearTimeout(this._dlgTimer);
    this.el.dialogue.classList.remove('show');
  }

  flashHealth() {
    this.el.healthfill.style.boxShadow = '0 0 12px #ef4444';
    setTimeout(() => { this.el.healthfill.style.boxShadow = ''; }, 250);
  }

  flashWanted() {
    this.el.wanted.style.transform = 'scale(1.25)';
    setTimeout(() => { this.el.wanted.style.transform = ''; }, 200);
  }

  update() {
    const game = this.game;
    const p = game.player;
    const police = game.police;
    // Wanted stars: filled gold up to the level, dim after.
    let stars = '';
    for (let i = 1; i <= 5; i++) {
      stars += i <= police.wanted ? '★' : '<span class="off">★</span>';
    }
    this.el.wanted.innerHTML = stars;
    this.el.healthfill.style.width = Math.max(0, p.hp) + '%';
    this.el.healthfill.classList.toggle('low', p.hp < 35);
    this.el.cash.innerHTML = money(p.cash) + ' <small>· ' + game.city.districtName(p.x, p.y).toUpperCase() + '</small>';
    if (p.inCar && p.car) {
      const kmh = Math.round(Math.abs(p.car.speed) * 0.32);
      this.el.speedo.textContent = p.car.name + ' — ' + kmh + ' km/h' + (p.car.hp < 55 ? ' · SMOKING' : '');
    } else {
      this.el.speedo.textContent = 'On foot — press E near a car to steal it';
    }
    // Objective panel.
    const obj = game.missions.objectiveText();
    this.el.objTitle.textContent = obj.title;
    this.el.objText.textContent = obj.text;
    this.el.objTimer.textContent = obj.timer > 0 ? '⏱ ' + fmtTime(obj.timer) : '';
    // Context hint.
    this.el.hint.innerHTML = p.inCar
      ? '<b>W/S</b> drive &nbsp;<b>A/D</b> steer &nbsp;<b>Space</b> handbrake &nbsp;<b>E</b> exit &nbsp;<b>Click</b> drive-by &nbsp;<b>Esc</b> pause'
      : '<b>WASD</b> move &nbsp;<b>Shift</b> sprint &nbsp;<b>E</b> steal car &nbsp;<b>F</b> punch &nbsp;<b>Click</b> shoot &nbsp;<b>Esc</b> pause';
    // Crosshair follows the mouse while on foot.
    const ch = this.el.crosshair;
    if (!p.inCar && game.state === 'playing') {
      ch.style.display = 'block';
      ch.style.left = game.input.mouseX + 'px';
      ch.style.top = game.input.mouseY + 'px';
    } else ch.style.display = 'none';
    this.drawMinimap();
  }

  drawMinimap() {
    const game = this.game;
    const c = this.el.minimap;
    const ctx = c.getContext('2d');
    const S = c.width, k = S / WORLD;
    ctx.clearRect(0, 0, S, S);
    // Ground first, then the beach strip and the sea on the east edge —
    // painting the sea first would bury it under the ground fill.
    ctx.fillStyle = '#b8a06a'; ctx.fillRect(0, 0, S, S);
    ctx.fillStyle = '#ecd9a0'; ctx.fillRect(3300 * k, 0, 300 * k, S);
    ctx.fillStyle = '#2f7fb8'; ctx.fillRect(3520 * k, 0, 80 * k, S);
    // Park.
    ctx.fillStyle = '#5da24a'; ctx.fillRect(1548 * k, 1548 * k, 304 * k, 304 * k);
    // Roads.
    ctx.fillStyle = '#3d4148';
    for (const lx of ROAD_LINES) {
      ctx.fillRect(lx * k - 2, 0, 4, S);
      ctx.fillRect(0, lx * k - 2, S, 4);
    }
    // Buildings (tiny).
    ctx.fillStyle = 'rgba(60,70,90,0.8)';
    for (const b of game.city.buildings) ctx.fillRect(b.x * k, b.y * k, Math.max(1.5, b.w * k), Math.max(1.5, b.h * k));
    // Mission marker.
    const mark = (m, color) => {
      const pulse = 3 + Math.sin(game.time * 5) * 1.5;
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(m.x * k, m.y * k, pulse, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(m.x * k, m.y * k, pulse + 2.5, 0, Math.PI * 2); ctx.stroke();
    };
    if (game.missions.marker) mark(game.missions.marker, game.missions.marker.color);
    const idle = game.missions.idleMarker();
    if (idle) mark(idle, idle.color);
    if (game.missions.taxi) {
      const t = game.missions.taxi;
      mark(t.phase === 'pickup' ? t.pickup : t.dest, '#4fc9ff');
    }
    // Police blips.
    ctx.fillStyle = '#5da9ff';
    for (const cop of game.police.cops) { ctx.beginPath(); ctx.arc(cop.car.x * k, cop.car.y * k, 2.5, 0, Math.PI * 2); ctx.fill(); }
    // Player arrow (rotates with facing).
    const p = game.player;
    ctx.save();
    ctx.translate(p.x * k, p.y * k);
    ctx.rotate(p.angle);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#14100a'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(7, 0); ctx.lineTo(-5, -4.5); ctx.lineTo(-5, 4.5); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
    // Viewport rectangle.
    const cam = game.camera;
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 1;
    ctx.strokeRect(
      (cam.x - c.width / 2 / cam.zoom) * k, (cam.y - c.height / 2 / cam.zoom) * k,
      (c.width / cam.zoom) * k, (c.height / cam.zoom) * k);
  }
}
