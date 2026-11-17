// save.js — localStorage save slots. One slot, versioned, written on mission
// completion, fare completion and from the pause menu. A corrupt or old save
// is ignored, never fatal.

const KEY = 'solmar-save-v1';

export class Save {
  constructor(game) {
    this.game = game;
  }

  save() {
    try {
      const game = this.game;
      const data = {
        version: 1,
        savedAt: Date.now(),
        cash: Math.round(game.player.cash),
        hp: Math.round(game.player.hp),
        x: Math.round(game.player.x),
        y: Math.round(game.player.y),
        missionsDone: game.missions.completed,
        stats: game.stats,
      };
      localStorage.setItem(KEY, JSON.stringify(data));
      return true;
    } catch (e) { return false; }
  }

  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || data.version !== 1) return null;
      return data;
    } catch (e) { return null; }
  }

  apply(data) {
    const game = this.game;
    game.player.cash = data.cash || 0;
    game.player.hp = data.hp || 100;
    game.player.x = data.x ?? 1500;
    game.player.y = data.y ?? 1900;
    game.missions.completed = data.missionsDone || 0;
    game.stats = { ...game.stats, ...(data.stats || {}) };
    game.camera.snapTo(game.player.x, game.player.y);
  }

  clear() {
    try { localStorage.removeItem(KEY); } catch (e) {}
  }
}
