// input.js — named actions over raw keys (input-systems skill).
// Gameplay reads actions ("drive", "enterCar", "shoot"), never key codes, so a
// rebind is data. Edge presses are buffered briefly so an early E still fires.

export const ACTIONS = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  handbrake: ['Space'],
  enterCar: ['KeyE'],
  punch: ['KeyF'],
  shoot: ['Mouse0'],
  pause: ['Escape'],
  mute: ['KeyM'],
};

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.held = new Set();       // action names currently held
    this.pressed = new Set();    // action names pressed this frame (edge)
    this._buffer = new Map();    // action -> game time of latest press
    this.mouseX = 0; this.mouseY = 0;
    this.mouseDown = false;
    this._codeToAction = new Map();
    for (const [action, codes] of Object.entries(ACTIONS)) {
      for (const code of codes) this._codeToAction.set(code, action);
    }
    this._onKeyDown = (e) => this._key(e, true);
    this._onKeyUp = (e) => this._key(e, false);
    this._onMouseMove = (e) => {
      const r = canvas.getBoundingClientRect();
      this.mouseX = e.clientX - r.left;
      this.mouseY = e.clientY - r.top;
    };
    this._onMouseDown = (e) => {
      if (e.button === 0) { this.mouseDown = true; this._press('shoot'); }
    };
    this._onMouseUp = (e) => { if (e.button === 0) this.mouseDown = false; };
    this._onBlur = () => { this.held.clear(); this.mouseDown = false; };
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    window.addEventListener('blur', this._onBlur);
  }

  _key(e, down) {
    const action = this._codeToAction.get(e.code);
    if (!action) return;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    if (down) {
      if (!this.held.has(action)) this._press(action);
      this.held.add(action);
    } else {
      this.held.delete(action);
    }
  }

  _press(action) {
    this.pressed.add(action);
    this._buffer.set(action, performance.now() / 1000);
  }

  isDown(action) { return this.held.has(action); }
  // Edge: true only on the frame the press landed.
  wasPressed(action) { return this.pressed.has(action); }
  // Buffered edge: a press within the last `windowSec` still counts (0.15 s).
  buffered(action, windowSec = 0.15) {
    const t = this._buffer.get(action);
    if (t === undefined) return false;
    return performance.now() / 1000 - t <= windowSec;
  }
  consumeBuffer(action) { this._buffer.delete(action); }

  // Normalised move vector from the four move actions (diagonals not faster).
  moveVector() {
    let x = 0, y = 0;
    if (this.isDown('left')) x -= 1;
    if (this.isDown('right')) x += 1;
    if (this.isDown('up')) y -= 1;
    if (this.isDown('down')) y += 1;
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    return { x, y };
  }

  endFrame() { this.pressed.clear(); }
}
