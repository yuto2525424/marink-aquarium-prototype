import type { BehaviorKind } from "../data/species";

/**
 * 魚の動きの純粋ロジック（描画に依存しない）。
 * 座標は 0..1 の正規化された水槽内座標。
 * 種ごとの違いは BehaviorKind の「パラメータ」で表現し、個別の関数は書かない。
 */
export interface FishMotion {
  x: number;
  y: number;
  vx: number;
  vy: number;
  mode: "swim" | "hover" | "rest" | "hide" | "return";
  modeTimer: number; // 残り秒
  homeX: number;
  homeY: number;
  facing: 1 | -1;
}

export interface BehaviorParams {
  cruiseSpeed: number; // 正規化座標/秒
  wanderRadius: number;
  homeY: [number, number]; // 生活する高さ範囲（0=上,1=底）
  cohesion: number; // 群れ行動の強さ（0..1）
  hideChance: number; // 驚きで隠れる確率（秒あたり）
  hideSpot?: { x: number; y: number }; // 隠れ場所
  burrowSpot?: { x: number; y: number }; // 巣穴
}

export const BEHAVIOR_PARAMS: Record<BehaviorKind, BehaviorParams> = {
  anemone_guard: {
    cruiseSpeed: 0.06,
    wanderRadius: 0.07,
    homeY: [0.55, 0.75],
    cohesion: 0,
    hideChance: 0.02,
  },
  schooling: {
    cruiseSpeed: 0.11,
    wanderRadius: 0.4,
    homeY: [0.12, 0.45],
    cohesion: 0.6,
    hideChance: 0,
  },
  mid_hover_hider: {
    cruiseSpeed: 0.05,
    wanderRadius: 0.12,
    homeY: [0.35, 0.5],
    cohesion: 0,
    hideChance: 0.05,
    hideSpot: { x: 0.8, y: 0.8 },
  },
  bottom_burrower: {
    cruiseSpeed: 0.03,
    wanderRadius: 0.08,
    homeY: [0.82, 0.9],
    cohesion: 0,
    hideChance: 0.04,
    burrowSpot: { x: 0.25, y: 0.9 },
  },
};

/** 乱数源を注入できるようにして、テストで決定的に動かせる */
export type Rng = () => number;

export function createMotion(kind: BehaviorKind, rng: Rng, seedX?: number): FishMotion {
  const p = BEHAVIOR_PARAMS[kind];
  const x = seedX ?? 0.2 + rng() * 0.6;
  const y = p.homeY[0] + rng() * (p.homeY[1] - p.homeY[0]);
  return {
    x,
    y,
    vx: 0,
    vy: 0,
    mode: "swim",
    modeTimer: 2 + rng() * 4,
    homeX: x,
    homeY: y,
    facing: rng() < 0.5 ? 1 : -1,
  };
}

/**
 * 1ステップ（dt秒）の動きを進める。
 * disturbed=true で驚き（隠れる/巣穴へ戻る）を発生させる。
 */
export function stepMotion(
  kind: BehaviorKind,
  m: FishMotion,
  dt: number,
  rng: Rng,
  opts: { disturbed?: boolean; flockCenter?: { x: number; y: number } } = {},
): FishMotion {
  const p = BEHAVIOR_PARAMS[kind];
  let mode = m.mode;
  let modeTimer = m.modeTimer - dt;
  let homeX = m.homeX;
  let homeY = m.homeY;

  if (opts.disturbed && mode !== "hide" && mode !== "return") {
    if (p.burrowSpot) mode = "return";
    else if (p.hideSpot) mode = "hide";
    modeTimer = 3 + rng() * 2;
  }

  // 目標点の決定
  let tx = homeX;
  let ty = homeY;
  let speed = p.cruiseSpeed;

  if (mode === "hide" && p.hideSpot) {
    tx = p.hideSpot.x;
    ty = p.hideSpot.y;
    speed = p.cruiseSpeed * 2.5;
  } else if (mode === "return" && p.burrowSpot) {
    tx = p.burrowSpot.x;
    ty = p.burrowSpot.y;
    speed = p.cruiseSpeed * 3;
  } else if (mode === "rest") {
    speed = 0;
  } else {
    // 通常遊泳：ホームの周りをさまよう
    if (modeTimer <= 0) {
      homeX = clamp01(m.x + (rng() - 0.5) * p.wanderRadius * 2);
      homeY = clamp(p.homeY[0] + rng() * (p.homeY[1] - p.homeY[0]), p.homeY[0], p.homeY[1]);
      const r = rng();
      mode = r < 0.2 ? "hover" : r < 0.3 ? "rest" : "swim";
      modeTimer = 2 + rng() * 5;
    }
    tx = homeX;
    ty = homeY;
    if (mode === "hover") speed *= 0.2;
    if (p.cohesion > 0 && opts.flockCenter) {
      tx = tx * (1 - p.cohesion) + opts.flockCenter.x * p.cohesion;
      ty = ty * (1 - p.cohesion) + opts.flockCenter.y * p.cohesion;
    }
  }

  if (mode === "hide" || mode === "return") {
    if (modeTimer <= 0 && mode === "hide") mode = "swim";
    if (modeTimer <= 0 && mode === "return") mode = "hover";
    if (mode === "return" && distance(m.x, m.y, tx, ty) < 0.02) {
      mode = "hover";
      modeTimer = 3 + rng() * 3;
    }
  }

  // 目標へ向かう加速度（滑らかな速度変化）
  const dx = tx - m.x;
  const dy = ty - m.y;
  const d = Math.hypot(dx, dy) || 1;
  const desiredVx = (dx / d) * speed;
  const desiredVy = (dy / d) * speed;
  const accel = 1.5;
  const vx = m.vx + (desiredVx - m.vx) * Math.min(1, accel * dt);
  let vy = m.vy + (desiredVy - m.vy) * Math.min(1, accel * dt);
  // 小さなゆらぎ（自然な泳ぎの揺れ）
  vy += (rng() - 0.5) * 0.002;

  const x = clamp01(m.x + vx * dt);
  const y = clamp(m.y + vy * dt, 0.05, 0.92);
  let facing = m.facing;
  if (Math.abs(vx) > 0.005) facing = vx > 0 ? 1 : -1;

  return { x, y, vx, vy, mode, modeTimer, homeX, homeY, facing };
}

export function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function distance(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}
