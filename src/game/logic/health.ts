import { IDEAL_RANGES, type WaterQuality } from "./water";
import { CONFIG } from "../config";
import type { SpeciesDef } from "../data/species";

/** 各パラメータを 0..100 で採点。理想範囲内=100、範囲外は許容幅の外で0へ線形低下 */
function scoreRange(value: number, [min, max]: readonly [number, number], tolerance: number): number {
  if (value >= min && value <= max) return 100;
  const dist = value < min ? min - value : value - max;
  return Math.max(0, 100 * (1 - dist / tolerance));
}

export function waterScore(w: WaterQuality, species: SpeciesDef): number {
  const s = species.sensitivity;
  const parts = [
    scoreRange(w.tempC, IDEAL_RANGES.tempC, 4 / s),
    scoreRange(w.salinityPsu, IDEAL_RANGES.salinityPsu, 4 / s),
    scoreRange(w.pH, IDEAL_RANGES.pH, 0.6 / s),
    w.doMgL >= 5 ? 100 : Math.max(0, 100 * (w.doMgL / 5) ** (2 * s)),
    scoreRange(w.nh3N, [0, 0.02], 0.1 / s),
    scoreRange(w.no2N, [0, 0.1], 0.5 / s),
    scoreRange(w.no3N, [0, 30], 60 / s),
  ];
  // 最弱点の影響を重視（平均だけだと1項目の悪化が隠れる）
  const avg = parts.reduce((a, b) => a + b, 0) / parts.length;
  const min = Math.min(...parts);
  return avg * 0.6 + min * 0.4;
}

/** 餌の満足度（空腹度 0..100 から 0..100 の満足スコア） */
export function feedingScore(hunger: number): number {
  return Math.max(0, 100 - hunger);
}

/**
 * 健康度を1時間分更新する。
 * 目標値 = 水質 60% + 給餌 40%。急変せず、徐々に目標へ近づく（突然死は発生させない）。
 */
export function stepHealth(
  health: number,
  water: number,
  feeding: number,
  hours: number,
): number {
  const target = water * 0.6 + feeding * 0.4;
  const rate = CONFIG.health.recoveryRatePerHour * hours;
  const next = health + (target - health) * Math.min(1, rate);
  return Math.min(100, Math.max(0, next));
}

export function healthLabel(health: number): "良好" | "注意" | "体調不良" {
  if (health >= 70) return "良好";
  if (health >= 40) return "注意";
  return "体調不良";
}
