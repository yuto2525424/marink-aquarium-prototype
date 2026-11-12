/**
 * ゲーム調整用の数値設定。
 * 値はすべて「教育・遊びやすさのための簡略化モデル」の係数であり、
 * 現実の飼育管理にそのまま使える精度は保証しない。
 */
export const CONFIG = {
  saveFormatVersion: 1,
  saveFormatName: "marink-aquarium-save",

  startingCash: 300_000,
  startingAdmissionPrice: 1500,

  // 実時間ms あたりのゲーム内分。x1 のとき 1000ms で 1ゲーム内分
  realMsPerGameMinuteAtX1: 1000,
  speedOptions: [0, 1, 2, 4] as const,
  // 1フレームで進めるゲーム内分の上限（タブ切替などで一気に進むのを防ぐ）
  maxGameMinutesPerStep: 60,

  autosaveIntervalMs: 60_000,

  // 水質モデル係数（1ゲーム内時間あたり）
  water: {
    setpointTempC: 26,
    tempRelaxPerHour: 0.2,
    salinityDriftPerHour: 0.01,
    freshSeawaterSalinity: 34.5,
    saturationDO: 8.0,
    doRecoveryPerFlowHour: 0.2,
    doUsePerGramPerHour: 0.02, // mg/L を 1L あたり、生体量(g)に比例
    excretionNH3PerGramPerHour: 0.004, // mg-N（生体1gあたり/時間）
    feedNH3PerGram: 1.2, // 食べ残し1gあたりの mg-N（簡略係数：15g中5g食べ残しで約0.1mg-N/L）
    nitrificationPerFilterHour: 0.05, // mg/L/時間（NH3→NO2 の最大能力）
    no2OxidationPerFilterHour: 0.05, // mg/L/時間（NO2→NO3）
    nitrateBaseline: 5,
    phTargetBase: 8.2,
  },

  // 施設・経済係数
  economy: {
    baseVisitorsPerDay: 6,
    visitorsPerSpecies: 0.15,
    visitorsPerTank: 0.2,
    maxVisitorsPerDay: 600,
    shopSpendPerVisitor: 120,
    feedCostPerGram: 0.8,
    waterCostPerLiter: 0.5,
    emergencyGrant: 100_000,
    emergencyCooldownDays: 30,
    reputationDailyStep: 0.05,
  },

  // 行動・健康
  health: {
    recoveryRatePerHour: 0.05,
    hungerPerHour: 2,
    hungerRelief: 60,
  },
} as const;

export type SpeedOption = (typeof CONFIG.speedOptions)[number];

export interface TankType {
  id: string;
  nameJa: string;
  volumeL: number;
  widthCells: number;
  heightCells: number;
  buildCost: number;
  maintenancePerDay: number;
  electricityPerDay: number;
  capacityUnits: number;
}

export const TANK_TYPES: readonly TankType[] = [
  {
    id: "small",
    nameJa: "小型水槽 (60L)",
    volumeL: 60,
    widthCells: 2,
    heightCells: 1,
    buildCost: 80_000,
    maintenancePerDay: 1200,
    electricityPerDay: 600,
    capacityUnits: 6,
  },
  {
    id: "medium",
    nameJa: "中型水槽 (200L)",
    volumeL: 200,
    widthCells: 3,
    heightCells: 2,
    buildCost: 220_000,
    maintenancePerDay: 3000,
    electricityPerDay: 1400,
    capacityUnits: 20,
  },
];

export const GRID = { cols: 8, rows: 6 } as const;
