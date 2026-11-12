import Phaser from "phaser";
import { getSpecies, type SpeciesDef } from "../data/species";
import { createMotion, stepMotion, BEHAVIOR_PARAMS, type FishMotion } from "../logic/behavior";

/**
 * 水槽の描画シーン。
 * - 描画ロジックのみを担当し、生物の状態・水質は React 側（ゲームロジック）から受け取る。
 * - 魚の見た目は現状「仮素材（手続き描画）」。正式イラストは drawFish を差し替えて入れ替える。
 */

export const VIEW_W = 960;
export const VIEW_H = 540;
const TANK_X = 40;
const TANK_Y = 36;
const TANK_W = 880;
const TANK_H = 430;

export interface TankViewFish {
  id: string;
  speciesId: string;
  health: number;
}

export interface TankViewData {
  tankId: string;
  water: { nh3N: number; no2N: number; doMgL: number; no3N: number };
  fish: TankViewFish[];
  feedNonce: number;
}

interface FishSprite {
  id: string;
  species: SpeciesDef;
  motion: FishMotion;
  container: Phaser.GameObjects.Container;
  tail: Phaser.GameObjects.Graphics;
  healthDot: Phaser.GameObjects.Graphics;
  length: number;
  health: number;
  disturbNext: boolean;
}

const SIZE_SCALE: Record<string, number> = {
  amphiprion_ocellaris: 1.0,
  chromis_viridis: 0.85,
  nemateleotris_magnifica: 0.95,
  stonogobiops_yasha: 0.8,
};

const BASE_LENGTH = 62;

const FEED_POINT = { x: 0.5, y: 0.08 };
const FEED_DURATION_MS = 4000;

export function tankToScreen(x: number, y: number) {
  return { px: TANK_X + x * TANK_W, py: TANK_Y + y * TANK_H };
}

export class TankScene extends Phaser.Scene {
  private sprites = new Map<string, FishSprite>();
  private current: TankViewData | null = null;
  private lastFeedNonce = -1;
  private feedUntil = 0;
  private murk!: Phaser.GameObjects.Rectangle;
  private bubbles: { g: Phaser.GameObjects.Graphics; speed: number; x: number; y: number; r: number }[] = [];
  private pellets: { g: Phaser.GameObjects.Graphics; vy: number; life: number }[] = [];

  constructor() {
    super("tank");
  }

  create() {
    this.drawBackground();
    this.murk = this.add.rectangle(TANK_X, TANK_Y, TANK_W, TANK_H, 0x3d5a2c, 0).setOrigin(0, 0);
    this.drawFrame();
    this.drawFurniture();

    this.game.events.on("tank-data", this.onData, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off("tank-data", this.onData, this);
    });
    this.onData();
  }

  private onData = () => {
    const data = (this.game.registry.get("tankData") as TankViewData | undefined) ?? null;
    if (!data) return;
    const previousTank = this.current?.tankId;
    this.current = data;

    if (previousTank !== undefined && previousTank !== data.tankId) {
      this.clearFish();
    }

    const liveIds = new Set(data.fish.map((f) => f.id));
    for (const [id, sprite] of this.sprites) {
      if (!liveIds.has(id)) {
        sprite.container.destroy();
        this.sprites.delete(id);
      }
    }
    for (const f of data.fish) {
      const species = getSpecies(f.speciesId);
      if (!species) continue;
      const existing = this.sprites.get(f.id);
      if (existing) {
        existing.health = f.health;
        this.drawHealthDot(existing);
      } else {
        this.spawnSprite(f.id, species, f.health);
      }
    }

    if (data.feedNonce !== this.lastFeedNonce) {
      this.lastFeedNonce = data.feedNonce;
      if (this.lastFeedNonce >= 0) {
        this.feedUntil = this.time.now + FEED_DURATION_MS;
        this.spawnPellets();
      }
    }
    this.updateMurk(data);
  };

  private clearFish() {
    for (const s of this.sprites.values()) s.container.destroy();
    this.sprites.clear();
  }

  private spawnSprite(id: string, species: SpeciesDef, health: number) {
    const length = BASE_LENGTH * (SIZE_SCALE[species.id] ?? 1);
    const motion = createMotion(species.behavior, Math.random);
    const tail = this.add.graphics();
    const body = this.add.graphics();
    const healthDot = this.add.graphics();
    drawFish(body, tail, species, length);

    const container = this.add.container(0, 0, [tail, body, healthDot]);
    container.setSize(length * 1.2, length);
    container.setInteractive(
      new Phaser.Geom.Rectangle(-length * 0.6, -length * 0.5, length * 1.2, length),
      Phaser.Geom.Rectangle.Contains,
    );
    container.on("pointerdown", () => {
      const sprite = this.sprites.get(id);
      if (sprite) sprite.disturbNext = true;
      this.game.registry.get("onFishTap")?.(id);
    });
    container.setDepth(10);

    const sprite: FishSprite = {
      id,
      species,
      motion,
      container,
      tail,
      healthDot,
      length,
      health,
      disturbNext: false,
    };
    this.sprites.set(id, sprite);
    this.drawHealthDot(sprite);
  }

  private drawHealthDot(s: FishSprite) {
    const color = s.health >= 70 ? 0x7dd3a0 : s.health >= 40 ? 0xf3d27a : 0xef7a7a;
    s.healthDot.clear();
    s.healthDot.fillStyle(0x0b1f2e, 0.6);
    s.healthDot.fillCircle(0, -s.length * 0.62, 6);
    s.healthDot.fillStyle(color, 1);
    s.healthDot.fillCircle(0, -s.length * 0.62, 4);
  }

  private updateMurk(data: TankViewData) {
    const murky = Math.min(
      0.45,
      data.water.nh3N / 0.1 + data.water.no2N / 0.3 + Math.max(0, 5 - data.water.doMgL) / 12 + Math.max(0, data.water.no3N - 30) / 200,
    );
    this.murk.setAlpha(Math.max(0, murky) * 0.6);
  }

  private spawnPellets() {
    for (let i = 0; i < 8; i++) {
      const g = this.add.graphics();
      g.fillStyle(0xd9b26a, 0.9);
      g.fillCircle(0, 0, 2.5 + Math.random() * 1.5);
      const p = tankToScreen(FEED_POINT.x + (Math.random() - 0.5) * 0.2, FEED_POINT.y);
      g.setPosition(p.px, p.py).setDepth(8);
      this.pellets.push({ g, vy: 40 + Math.random() * 30, life: 3 });
    }
  }

  update(time: number, delta: number) {
    const dt = Math.min(delta, 100) / 1000;
    this.updateBubbles(dt);
    this.updatePellets(dt);
    if (!this.current) return;

    const feeding = this.time.now < this.feedUntil;
    const schooling = [...this.sprites.values()].filter((s) => s.species.behavior === "schooling");
    const flock = schooling.length
      ? {
          x: schooling.reduce((a, s) => a + s.motion.x, 0) / schooling.length,
          y: schooling.reduce((a, s) => a + s.motion.y, 0) / schooling.length,
        }
      : undefined;

    for (const s of this.sprites.values()) {
      if (feeding) {
        const m = s.motion;
        m.homeX = FEED_POINT.x + (Math.random() - 0.5) * 0.1;
        m.homeY = FEED_POINT.y + 0.05;
        if (m.mode === "rest" || m.mode === "hover") m.mode = "swim";
        m.modeTimer = Math.max(m.modeTimer, 0.5);
      }
      const disturbed = s.disturbNext;
      s.disturbNext = false;
      s.motion = stepMotion(s.species.behavior, s.motion, dt, Math.random, { disturbed, flockCenter: flock });

      const { px, py } = tankToScreen(s.motion.x, s.motion.y);
      s.container.setPosition(px, py);
      s.container.setScale(s.motion.facing, 1);
      s.tail.rotation = Math.sin(time * 0.012 + s.length) * 0.25;
    }
  }

  private updateBubbles(dt: number) {
    if (this.bubbles.length < 14 && Math.random() < 0.05) {
      const g = this.add.graphics().setDepth(4);
      const x = TANK_X + Math.random() * TANK_W;
      this.bubbles.push({ g, speed: 30 + Math.random() * 30, x, y: TANK_Y + TANK_H, r: 2 + Math.random() * 3 });
    }
    this.bubbles = this.bubbles.filter((b) => {
      b.y -= b.speed * dt;
      b.g.clear();
      b.g.lineStyle(1, 0xffffff, 0.5);
      b.g.strokeCircle(b.x, b.y, b.r);
      if (b.y < TANK_Y) {
        b.g.destroy();
        return false;
      }
      return true;
    });
  }

  private updatePellets(dt: number) {
    this.pellets = this.pellets.filter((p) => {
      p.life -= dt;
      p.g.y += p.vy * dt;
      p.g.alpha = Math.max(0, p.life / 3);
      if (p.life <= 0 || p.g.y > TANK_Y + TANK_H - 10) {
        p.g.destroy();
        return false;
      }
      return true;
    });
  }

  private drawBackground() {
    const bands = 24;
    const top = 0x2b7fa6;
    const bottom = 0x0c3a5c;
    const bg = this.add.graphics().setDepth(0);
    for (let i = 0; i < bands; i++) {
      const t = i / (bands - 1);
      bg.fillStyle(lerpColor(top, bottom, t), 1);
      bg.fillRect(0, (VIEW_H * i) / bands, VIEW_W, VIEW_H / bands + 1);
    }

    // 水中光（ゆっくり揺れる）
    for (let i = 0; i < 5; i++) {
      const ray = this.add.graphics().setDepth(1).setAlpha(0.09);
      const x = 120 + i * 170;
      ray.fillStyle(0xbfeaff, 1);
      ray.fillPoints(
        [
          new Phaser.Math.Vector2(x, TANK_Y),
          new Phaser.Math.Vector2(x + 60, TANK_Y),
          new Phaser.Math.Vector2(x + 180, TANK_Y + TANK_H),
          new Phaser.Math.Vector2(x + 90, TANK_Y + TANK_H),
        ],
        true,
      );
      this.tweens.add({ targets: ray, alpha: { from: 0.04, to: 0.13 }, duration: 3000 + i * 400, yoyo: true, repeat: -1 });
    }

    // 砂底
    const sand = this.add.graphics().setDepth(2);
    sand.fillStyle(0xe8d3a6, 1);
    sand.fillEllipse(TANK_X + TANK_W / 2, TANK_Y + TANK_H + 10, TANK_W * 1.1, 110);
  }

  private drawFrame() {
    const g = this.add.graphics().setDepth(30);
    g.lineStyle(10, 0xdff3ff, 0.55);
    g.strokeRoundedRect(TANK_X - 4, TANK_Y - 4, TANK_W + 8, TANK_H + 8, 18);
    g.lineStyle(2, 0xffffff, 0.35);
    g.strokeRoundedRect(TANK_X, TANK_Y, TANK_W, TANK_H, 14);
  }

  private drawFurniture() {
    const g = this.add.graphics().setDepth(3);
    // 岩場（右寄り：ハタタテハゼの隠れ場所）
    const rock = (x: number, y: number, w: number, h: number, c: number) => {
      g.fillStyle(c, 1);
      g.fillEllipse(x, y, w, h);
      g.fillStyle(0xffffff, 0.08);
      g.fillEllipse(x - w * 0.12, y - h * 0.15, w * 0.5, h * 0.4);
    };
    const hide = tankToScreen(0.8, 0.82);
    rock(hide.px, hide.py + 10, 150, 90, 0x4b6470);
    rock(TANK_X + TANK_W * 0.9, TANK_Y + TANK_H - 30, 110, 60, 0x5e7a86);

    // ヤシャハゼの巣穴（砂の中の暗い穴）
    const burrow = tankToScreen(0.25, 0.9);
    g.fillStyle(0x6a5036, 1);
    g.fillEllipse(burrow.px, burrow.py + 6, 46, 22);
    g.fillStyle(0x2a1f16, 1);
    g.fillEllipse(burrow.px, burrow.py + 4, 30, 12);

    // イソギンチャク（カクレクマノミの住処）
    const ane = tankToScreen(0.52, 0.66);
    g.lineStyle(3, 0xc86bb0, 0.9);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI - Math.PI / 2;
      g.lineBetween(ane.px, ane.py + 40, ane.px + Math.cos(a) * 46, ane.py + 40 + Math.sin(a) * 40);
    }
    g.fillStyle(0xb85aa8, 1);
    g.fillEllipse(ane.px, ane.py + 44, 90, 36);
    g.fillStyle(0xf0a6dc, 0.9);
    g.fillEllipse(ane.px, ane.py + 40, 56, 22);
  }
}

function lerpColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  const r = Math.round(ar + (br - ar) * t);
  const gg = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (gg << 8) | bl;
}

/**
 * 仮素材の魚描画（種ごとの体色・模様を反映）。
 * 正式素材へ差し替える場合は、この関数を種IDごとの画像描画に置き換える。
 */
function drawFish(body: Phaser.GameObjects.Graphics, tail: Phaser.GameObjects.Graphics, sp: SpeciesDef, L: number) {
  const h = L * 0.42;
  const p = sp.palette;

  tail.clear();
  tail.fillStyle(p.fin, 0.95);
  tail.fillTriangle(-L * 0.36, 0, -L * 0.62, -h * 0.55, -L * 0.62, h * 0.55);

  body.clear();
  // 背びれ
  body.fillStyle(p.fin, 0.9);
  body.fillTriangle(-L * 0.2, -h * 0.4, L * 0.12, -h * 0.4, -L * 0.05, -h * 0.85);
  if (sp.id === "nemateleotris_magnifica") {
    // 長く伸びる背びれの先端（ハタタテハゼの特徴）
    body.fillStyle(p.accent, 1);
    body.fillTriangle(L * 0.12, -h * 0.45, L * 0.32, -h * 0.45, L * 0.3, -h * 1.15);
  }
  // 胸びれ
  body.fillStyle(p.fin, 0.8);
  body.fillEllipse(L * 0.08, h * 0.1, L * 0.22, h * 0.42);
  // 体
  body.fillStyle(p.body, 1);
  body.fillEllipse(0, 0, L * 0.82, h);
  // 腹側の明るい部分
  body.fillStyle(0xffffff, 0.12);
  body.fillEllipse(0, h * 0.18, L * 0.7, h * 0.4);

  if (p.pattern === "clownfish_bands") {
    body.fillStyle(p.accent, 0.95);
    for (const x of [L * 0.16, -L * 0.02, -L * 0.2]) body.fillEllipse(x, 0, L * 0.08, h * 1.02);
  }
  if (sp.id === "stonogobiops_yasha") {
    body.fillStyle(p.accent, 0.55);
    for (const [x, y] of [[-0.1, -0.1], [0.1, 0.1], [-0.25, 0.08], [0.22, -0.12]]) {
      body.fillCircle(L * x, h * y, L * 0.035);
    }
  }
  // 目
  body.fillStyle(0xffffff, 1);
  body.fillCircle(L * 0.27, -h * 0.1, L * 0.05);
  body.fillStyle(0x0b1f2e, 1);
  body.fillCircle(L * 0.29, -h * 0.1, L * 0.025);
}

export { BEHAVIOR_PARAMS };
