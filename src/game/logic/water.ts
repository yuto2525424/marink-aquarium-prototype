import { CONFIG } from "../config";

/**
 * 水質モデル（教育・遊びやすさのための簡略化）
 * 単位：水温 °C / 塩分 psu / DO mg/L / 各窒素 mg-N/L
 */
export interface WaterQuality {
  tempC: number;
  salinityPsu: number;
  pH: number;
  doMgL: number;
  nh3N: number;
  no2N: number;
  no3N: number;
}

export interface WaterEnv {
  volumeL: number;
  filterPower: number; // 0..1
  flowPower: number; // 0..1
  heaterOn: boolean;
}

export interface WaterInput {
  feedGrams: number; // この時間ステップで与えた餌(g)
  eatenFraction: number; // 食べられた割合 0..1
  fishBiomassG: number; // 生体総重量(g)
}

export const IDEAL_RANGES = {
  tempC: [24, 28],
  salinityPsu: [32, 36],
  pH: [7.9, 8.4],
  doMgL: [5, Infinity],
  nh3N: [0, 0.02],
  no2N: [0, 0.1],
  no3N: [0, 30],
} as const;

export function createInitialWater(): WaterQuality {
  return {
    tempC: CONFIG.water.setpointTempC,
    salinityPsu: CONFIG.water.freshSeawaterSalinity,
    pH: CONFIG.water.phTargetBase,
    doMgL: CONFIG.water.saturationDO,
    nh3N: 0,
    no2N: 0,
    no3N: CONFIG.water.nitrateBaseline,
  };
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** 1時間（hours）分の水質変化を計算する純粋関数 */
export function stepWater(
  w: WaterQuality,
  env: WaterEnv,
  input: WaterInput,
  hours: number,
): WaterQuality {
  const c = CONFIG.water;
  const vol = Math.max(1, env.volumeL);

  // 水温：ヒーターがあれば設定温度へ緩やかに近づく
  const tempTarget = env.heaterOn ? c.setpointTempC : c.setpointTempC - 4;
  const tempC = w.tempC + (tempTarget - w.tempC) * clamp(c.tempRelaxPerHour * hours, 0, 1);

  // 塩分：蒸発で少しずつ上昇
  const salinityPsu = w.salinityPsu + c.salinityDriftPerHour * hours;

  // アンモニア発生：排泄 + 食べ残し
  // 単位：mg-N。食べ残し1gあたり feedNH3PerGram mg-N（簡略係数）、排泄は生体量に比例
  const uneaten = input.feedGrams * (1 - clamp(input.eatenFraction, 0, 1));
  const nh3Generated =
    (input.fishBiomassG * c.excretionNH3PerGramPerHour * hours + uneaten * c.feedNH3PerGram) / vol;

  // 硝化：NH3→NO2、NO2→NO3（フィルター能力に依存）
  const nitrifyCap = env.filterPower * c.nitrificationPerFilterHour * hours;
  const nh3Converted = Math.min(w.nh3N + nh3Generated, nitrifyCap);
  const nh3N = Math.max(0, w.nh3N + nh3Generated - nh3Converted);
  const no2Oxidation = env.filterPower * c.no2OxidationPerFilterHour * hours;
  const no2Converted = Math.min(w.no2N + nh3Converted, no2Oxidation);
  const no2N = Math.max(0, w.no2N + nh3Converted - no2Converted);
  const no3N = w.no3N + no2Converted;

  // 溶存酸素：生体の消費と流水による回復
  const doUse = (input.fishBiomassG * c.doUsePerGramPerHour * hours) / vol * 10;
  const doRecovery = env.flowPower * c.doRecoveryPerFlowHour * hours * (c.saturationDO - w.doMgL);
  const doMgL = clamp(w.doMgL - doUse + doRecovery, 0, c.saturationDO);

  // pH：硝酸態窒素が多いと低下、ゆっくり基準値へ戻る
  const phTarget = c.phTargetBase - Math.max(0, no3N - 20) * 0.005;
  const pH = w.pH + (phTarget - w.pH) * clamp(0.05 * hours, 0, 1);

  return { tempC, salinityPsu, pH, doMgL, nh3N, no2N, no3N };
}

/** 換水：割合 ratio (0..1) だけ新鮮な人工海水に置き換える */
export function applyWaterChange(w: WaterQuality, ratio: number): WaterQuality {
  const r = clamp(ratio, 0, 1);
  const keep = 1 - r;
  const fresh = CONFIG.water.freshSeawaterSalinity;
  return {
    tempC: w.tempC,
    salinityPsu: w.salinityPsu * keep + fresh * r,
    pH: w.pH * keep + CONFIG.water.phTargetBase * r,
    doMgL: Math.min(CONFIG.water.saturationDO, w.doMgL * keep + CONFIG.water.saturationDO * r),
    nh3N: w.nh3N * keep,
    no2N: w.no2N * keep,
    no3N: w.no3N * keep,
  };
}
