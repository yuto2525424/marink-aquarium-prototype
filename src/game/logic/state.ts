import { CONFIG, GRID, TANK_TYPES, type SpeedOption } from "../config";
import { SPECIES, getSpecies, type Diet, type SpeciesDef } from "../data/species";
import { feedingScore, stepHealth, waterScore } from "./health";
import { applyWaterChange, createInitialWater, stepWater, type WaterQuality } from "./water";

/* ============================================================
 * ゲーム状態（JSONで保存可能な純データ）
 * ============================================================ */

export interface Tank {
  id: string;
  typeId: string;
  name: string;
  gridX: number;
  gridY: number;
  filterLevel: 1 | 2 | 3;
  water: WaterQuality;
  hunger: number; // 0..100 空腹度（高いほど腹ぺこ）
}

export interface Fish {
  id: string;
  speciesId: string;
  tankId: string;
  name: string;
  health: number; // 0..100
}

export interface DayLedger {
  day: number;
  visitors: number;
  admissionIncome: number;
  shopIncome: number;
  feedCost: number;
  waterCost: number;
  electricity: number;
  maintenance: number;
  speciesUpkeep: number;
  capexSpent: number;
  profit: number;
}

export interface GameState {
  version: 1;
  seed: number;
  rngState: number;
  gameMinute: number;
  carryMinutes: number;
  speed: SpeedOption;
  paused: boolean;
  cash: number;
  admissionPrice: number;
  reputation: number; // 0..100
  satisfaction: number; // 0..100 直近の来館者満足度
  lastVisitors: number;
  lastEmergencyDay: number | null;
  nextId: number;
  tanks: Tank[];
  fish: Fish[];
  dexSeen: string[];
  today: DayLedger;
  ledgers: DayLedger[];
  messages: string[];
}

export type FoodId = "pellet" | "frozen";
export type PortionId = "small" | "normal" | "large";
export type WaterChangeId = 10 | 30 | 50;

export interface FoodDef {
  id: FoodId;
  nameJa: string;
  costMultiplier: number;
  acceptance: Record<Diet, number>;
}

export const FOODS: Record<FoodId, FoodDef> = {
  pellet: {
    id: "pellet",
    nameJa: "人工飼料（ペレット）",
    costMultiplier: 1,
    acceptance: { omnivore: 0.9, planktivore: 0.6, carnivore: 0.5, herbivore: 0.4 },
  },
  frozen: {
    id: "frozen",
    nameJa: "冷凍プランクトン",
    costMultiplier: 1.5,
    acceptance: { omnivore: 0.8, planktivore: 0.95, carnivore: 0.85, herbivore: 0.5 },
  },
};

export const PORTION_GRAMS: Record<PortionId, number> = { small: 5, normal: 15, large: 40 };

export const FILTER_POWER: Record<1 | 2 | 3, number> = { 1: 0.5, 2: 0.75, 3: 0.95 };
export const FILTER_UPGRADE_COST: Record<2 | 3, number> = { 2: 30_000, 3: 60_000 };
export const MOVE_TANK_COST = 5_000;
export const FLOW_POWER = 0.5;
export const BIOMASS_PER_UNIT_G = 8; // 1 capacity unit あたりの生体量（簡略）

export interface ActionResult {
  ok: boolean;
  message: string;
  state: GameState;
}

/* ============================================================
 * 乱数（シード付き・決定的）
 * ============================================================ */

export function nextRandom(state: GameState): number {
  // mulberry32
  let t = (state.rngState += 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/* ============================================================
 * 生成
 * ============================================================ */

function emptyLedger(day: number): DayLedger {
  return {
    day,
    visitors: 0,
    admissionIncome: 0,
    shopIncome: 0,
    feedCost: 0,
    waterCost: 0,
    electricity: 0,
    maintenance: 0,
    speciesUpkeep: 0,
    capexSpent: 0,
    profit: 0,
  };
}

export function createNewGame(seed: number = Date.now() >>> 0): GameState {
  const starter: Tank = {
    id: "tank-1",
    typeId: "small",
    name: "1号水槽",
    gridX: 2,
    gridY: 2,
    filterLevel: 1,
    water: createInitialWater(),
    hunger: 0,
  };
  return {
    version: 1,
    seed,
    rngState: seed,
    gameMinute: 0,
    carryMinutes: 0,
    speed: 1,
    paused: false,
    cash: CONFIG.startingCash,
    admissionPrice: CONFIG.startingAdmissionPrice,
    reputation: 50,
    satisfaction: 50,
    lastVisitors: 0,
    lastEmergencyDay: null,
    nextId: 2,
    tanks: [starter],
    fish: [],
    dexSeen: [],
    today: emptyLedger(0),
    ledgers: [],
    messages: ["MARINK AQUARIUMへようこそ。まずは水槽に生き物を導入しましょう。"],
  };
}

/* ============================================================
 * 補助
 * ============================================================ */

function clone(state: GameState): GameState {
  return structuredClone(state);
}

function pushMessage(s: GameState, text: string) {
  s.messages.push(text);
  if (s.messages.length > 50) s.messages.splice(0, s.messages.length - 50);
}

export function tankEnv(tank: Tank) {
  const type = TANK_TYPES.find((t) => t.id === tank.typeId)!;
  return {
    volumeL: type.volumeL,
    filterPower: FILTER_POWER[tank.filterLevel],
    flowPower: FLOW_POWER,
    heaterOn: true,
  };
}

export function fishInTank(s: GameState, tankId: string): Fish[] {
  return s.fish.filter((f) => f.tankId === tankId);
}

export function tankUnitsUsed(s: GameState, tankId: string): number {
  return fishInTank(s, tankId).reduce((sum, f) => sum + (getSpecies(f.speciesId)?.capacityUnits ?? 0), 0);
}

export function visitorFactor(s: GameState): number {
  const uniqueSpecies = new Set(s.fish.map((f) => f.speciesId));
  let popularity = 0;
  uniqueSpecies.forEach((id) => {
    popularity += getSpecies(id)?.popularity ?? 0;
  });
  return 1 + popularity * 0.1 + s.tanks.length * 0.25;
}

export function priceFactor(price: number): number {
  return Math.min(3, Math.max(0.05, (1500 / Math.max(1, price)) ** 1.5));
}

/** 指定位置の占有セル（水槽サイズ分） */
function footprint(gridX: number, gridY: number, typeId: string): { x: number; y: number }[] {
  const type = TANK_TYPES.find((t) => t.id === typeId)!;
  const cells: { x: number; y: number }[] = [];
  for (let dx = 0; dx < type.widthCells; dx++) {
    for (let dy = 0; dy < type.heightCells; dy++) cells.push({ x: gridX + dx, y: gridY + dy });
  }
  return cells;
}

export function canPlaceTank(s: GameState, typeId: string, gx: number, gy: number, ignoreId?: string): string | null {
  const cells = footprint(gx, gy, typeId);
  for (const c of cells) {
    if (c.x < 0 || c.y < 0 || c.x >= GRID.cols || c.y >= GRID.rows) return "館内の範囲外です";
  }
  for (const other of s.tanks) {
    if (other.id === ignoreId) continue;
    const oc = footprint(other.gridX, other.gridY, other.typeId);
    if (oc.some((a) => cells.some((b) => a.x === b.x && a.y === b.y))) return "他の施設と重なっています";
  }
  return null;
}

function spend(s: GameState, amount: number, kind: "capex" | "feed" | "water") {
  s.cash -= amount;
  if (kind === "capex") s.today.capexSpent += amount;
  if (kind === "feed") s.today.feedCost += amount;
  if (kind === "water") s.today.waterCost += amount;
}

/* ============================================================
 * 時間進行（1時間単位の更新・日次決算）
 * ============================================================ */

function hourlyUpdate(s: GameState) {
  for (const tank of s.tanks) {
    const fish = fishInTank(s, tank.id);
    const biomass = fish.reduce((sum, f) => sum + BIOMASS_PER_UNIT_G * (getSpecies(f.speciesId)?.capacityUnits ?? 1), 0);
    tank.water = stepWater(tank.water, tankEnv(tank), { feedGrams: 0, eatenFraction: 1, fishBiomassG: biomass }, 1);

    if (fish.length > 0) {
      tank.hunger = Math.min(100, tank.hunger + CONFIG.health.hungerPerHour);
    } else {
      tank.hunger = 0;
    }

    const feeding = feedingScore(tank.hunger);
    for (const f of fish) {
      const sp = getSpecies(f.speciesId);
      if (!sp) continue;
      f.health = stepHealth(f.health, waterScore(tank.water, sp), feeding, 1);
    }
  }
}

function fishHealthAverage(s: GameState): number {
  if (s.fish.length === 0) return 50;
  return s.fish.reduce((sum, f) => sum + f.health, 0) / s.fish.length;
}

/** 日次決算：来館者・収支を集計し、現金に反映する */
function settleDay(s: GameState, day: number) {
  const e = CONFIG.economy;
  const avgHealth = fishHealthAverage(s);
  const speciesCount = new Set(s.fish.map((f) => f.speciesId)).size;

  // 来館者満足度：健康な生物・展示の種類・施設数で上昇
  s.satisfaction = Math.round(
    Math.min(100, 20 + avgHealth * 0.4 + speciesCount * 4 + s.tanks.length * 3),
  );
  const visitors = Math.round(
    Math.min(
      e.maxVisitorsPerDay,
      e.baseVisitorsPerDay * visitorFactor(s) * (s.reputation / 50) * priceFactor(s.admissionPrice),
    ),
  );
  s.lastVisitors = visitors;

  const ledger = s.today;
  ledger.day = day;
  ledger.visitors = visitors;
  ledger.admissionIncome = visitors * s.admissionPrice;
  ledger.shopIncome = visitors * e.shopSpendPerVisitor;

  let electricity = 0;
  let maintenance = 0;
  for (const tank of s.tanks) {
    const type = TANK_TYPES.find((t) => t.id === tank.typeId)!;
    electricity += type.electricityPerDay;
    maintenance += type.maintenancePerDay;
  }
  ledger.electricity = electricity;
  ledger.maintenance = maintenance;
  ledger.speciesUpkeep = s.fish.reduce((sum, f) => sum + (getSpecies(f.speciesId)?.upkeepPerDay ?? 0), 0);

  const revenue = ledger.admissionIncome + ledger.shopIncome;
  const expenses = ledger.feedCost + ledger.waterCost + ledger.electricity + ledger.maintenance + ledger.speciesUpkeep;
  ledger.profit = revenue - expenses;

  s.cash += revenue - (electricity + maintenance + ledger.speciesUpkeep);
  s.reputation = Math.min(100, Math.max(0, s.reputation + (s.satisfaction - 50) * e.reputationDailyStep));

  s.ledgers.push(ledger);
  if (s.ledgers.length > 30) s.ledgers.splice(0, s.ledgers.length - 30);
  s.today = emptyLedger(day + 1);

  pushMessage(s, `${day}日目の決算：来館者 ${visitors}名、利益 ${ledger.profit.toLocaleString()}円`);

  // 救済措置：資金不足が続かないよう、一定期間ごとに緊急支援
  if (s.cash < 0) {
    const cooldownOk = s.lastEmergencyDay === null || day - s.lastEmergencyDay >= e.emergencyCooldownDays;
    if (cooldownOk) {
      s.cash += e.emergencyGrant;
      s.lastEmergencyDay = day;
      pushMessage(s, `資金不足のため緊急支援 ${e.emergencyGrant.toLocaleString()}円を受けました（${e.emergencyCooldownDays}日に1回）。`);
    } else {
      pushMessage(s, "資金が不足しています。入館料の調整や生物の整理を検討してください。");
    }
  }
}

/**
 * 経過した実時間（ms）分だけゲーム時間を進める。
 * 一時停止中・速度0のときは進まない。ブラウザを閉じている間も進まない（保存時点から再開）。
 */
export function advanceTime(state: GameState, realMs: number): GameState {
  if (state.paused || state.speed === 0 || realMs <= 0) return state;
  const s = clone(state);
  // 呼び出し側（画面の更新ループ）で realMs を上限付きに渡すこと
  const want = (realMs * s.speed) / CONFIG.realMsPerGameMinuteAtX1 + s.carryMinutes;
  const whole = Math.floor(want);
  s.carryMinutes = want - whole;
  if (whole <= 0) return s;

  // 1時間刻みで処理する（まとめて進めても結果が同じになるように境界ごとに更新）
  let minute = s.gameMinute;
  const end = minute + whole;
  while (minute < end) {
    const nextBoundary = Math.min(end, (Math.floor(minute / 60) + 1) * 60);
    const crossedHour = nextBoundary % 60 === 0 && nextBoundary > minute;
    minute = nextBoundary;
    s.gameMinute = minute;
    if (crossedHour) {
      hourlyUpdate(s);
      if (minute % 1440 === 0) settleDay(s, minute / 1440 - 1);
    }
  }
  return s;
}

/* ============================================================
 * プレイヤー操作
 * ============================================================ */

export function setSpeed(state: GameState, speed: SpeedOption): GameState {
  const s = clone(state);
  s.speed = speed;
  s.paused = speed === 0;
  return s;
}

export function togglePause(state: GameState): GameState {
  const s = clone(state);
  s.paused = !s.paused;
  return s;
}

export function setAdmissionPrice(state: GameState, price: number): ActionResult {
  const s = clone(state);
  const p = Math.round(Math.min(10_000, Math.max(0, price)) / 100) * 100;
  s.admissionPrice = p;
  return { ok: true, message: `入館料を${p.toLocaleString()}円に設定しました`, state: s };
}

export function buildTank(state: GameState, typeId: string, gx: number, gy: number): ActionResult {
  const type = TANK_TYPES.find((t) => t.id === typeId);
  if (!type) return fail(state, "不明な水槽です");
  const s = clone(state);
  const err = canPlaceTank(s, typeId, gx, gy);
  if (err) return fail(state, err);
  if (s.cash < type.buildCost) return fail(state, "資金が不足しています");
  spend(s, type.buildCost, "capex");
  const id = `tank-${s.nextId++}`;
  s.tanks.push({
    id,
    typeId,
    name: `${s.tanks.length + 1}号水槽`,
    gridX: gx,
    gridY: gy,
    filterLevel: 1,
    water: createInitialWater(),
    hunger: 0,
  });
  pushMessage(s, `${type.nameJa}を設置しました`);
  return { ok: true, message: `${type.nameJa}を設置しました`, state: s };
}

export function moveTank(state: GameState, tankId: string, gx: number, gy: number): ActionResult {
  const tank = state.tanks.find((t) => t.id === tankId);
  if (!tank) return fail(state, "水槽が見つかりません");
  const s = clone(state);
  const err = canPlaceTank(s, tank.typeId, gx, gy, tankId);
  if (err) return fail(state, err);
  if (s.cash < MOVE_TANK_COST) return fail(state, "資金が不足しています");
  spend(s, MOVE_TANK_COST, "capex");
  const t = s.tanks.find((x) => x.id === tankId)!;
  t.gridX = gx;
  t.gridY = gy;
  return { ok: true, message: "水槽を移動しました", state: s };
}

export function demolishTank(state: GameState, tankId: string): ActionResult {
  const tank = state.tanks.find((t) => t.id === tankId);
  if (!tank) return fail(state, "水槽が見つかりません");
  if (fishInTank(state, tankId).length > 0) return fail(state, "先に水槽内の生物を移してください（移動・売却は未実装）");
  if (state.tanks.length <= 1) return fail(state, "最後の水槽は撤去できません");
  const type = TANK_TYPES.find((t) => t.id === tank.typeId)!;
  const s = clone(state);
  s.tanks = s.tanks.filter((t) => t.id !== tankId);
  const refund = Math.floor(type.buildCost * 0.5);
  s.cash += refund;
  pushMessage(s, `水槽を撤去し、${refund.toLocaleString()}円の返還がありました`);
  return { ok: true, message: `撤去しました（返還 ${refund.toLocaleString()}円）`, state: s };
}

export function upgradeFilter(state: GameState, tankId: string): ActionResult {
  const tank = state.tanks.find((t) => t.id === tankId);
  if (!tank) return fail(state, "水槽が見つかりません");
  if (tank.filterLevel >= 3) return fail(state, "ろ過装置は最大レベルです");
  const next = (tank.filterLevel + 1) as 2 | 3;
  const cost = FILTER_UPGRADE_COST[next];
  if (state.cash < cost) return fail(state, "資金が不足しています");
  const s = clone(state);
  spend(s, cost, "capex");
  s.tanks.find((t) => t.id === tankId)!.filterLevel = next;
  return { ok: true, message: `ろ過装置をレベル${next}に強化しました`, state: s };
}

export function addFish(state: GameState, speciesId: string, tankId: string): ActionResult {
  const sp = getSpecies(speciesId);
  if (!sp) return fail(state, "その生物はまだ導入できません");
  const tank = state.tanks.find((t) => t.id === tankId);
  if (!tank) return fail(state, "水槽が見つかりません");
  const type = TANK_TYPES.find((t) => t.id === tank.typeId)!;
  if (tankUnitsUsed(state, tankId) + sp.capacityUnits > type.capacityUnits) {
    return fail(state, "この水槽の収容上限に達しています");
  }
  if (state.cash < sp.purchasePrice) return fail(state, "資金が不足しています");

  const s = clone(state);
  spend(s, sp.purchasePrice, "capex");
  const id = `fish-${s.nextId++}`;
  const count = s.fish.filter((f) => f.speciesId === speciesId).length + 1;
  s.fish.push({ id, speciesId, tankId, name: `${sp.nameJa} ${count}`, health: 85 });
  if (!s.dexSeen.includes(speciesId)) s.dexSeen.push(speciesId);
  pushMessage(s, `${sp.nameJa}を${tank.name}に導入しました`);
  return { ok: true, message: `${sp.nameJa}を導入しました`, state: s };
}

export function feedTank(state: GameState, tankId: string, foodId: FoodId, portion: PortionId): ActionResult {
  const tank = state.tanks.find((t) => t.id === tankId);
  if (!tank) return fail(state, "水槽が見つかりません");
  const fish = fishInTank(state, tankId);
  if (fish.length === 0) return fail(state, "この水槽に生物がいません");
  const food = FOODS[foodId];
  const grams = PORTION_GRAMS[portion];
  const cost = Math.round(grams * CONFIG.economy.feedCostPerGram * food.costMultiplier);
  if (state.cash < cost) return fail(state, "資金が不足しています");

  const s = clone(state);
  const t = s.tanks.find((x) => x.id === tankId)!;
  const fishList = fishInTank(s, tankId);
  const eatenFraction =
    fishList.reduce((sum, f) => {
      const sp = getSpecies(f.speciesId);
      return sum + (sp ? food.acceptance[sp.diet] : 0);
    }, 0) / fishList.length;
  const biomass = fishList.reduce((sum, f) => sum + BIOMASS_PER_UNIT_G * (getSpecies(f.speciesId)?.capacityUnits ?? 1), 0);

  // 食べ残しはその場で水質へ影響（時間進行 0）
  t.water = stepWater(t.water, tankEnv(t), { feedGrams: grams, eatenFraction, fishBiomassG: biomass }, 0);
  const eatenG = grams * eatenFraction;
  t.hunger = Math.max(0, t.hunger - (eatenG / (fishList.length * 5)) * CONFIG.health.hungerRelief);

  spend(s, cost, "feed");
  return {
    ok: true,
    message: `${food.nameJa}を与えました（食べ残しは水質に影響します）`,
    state: s,
  };
}

export function waterChange(state: GameState, tankId: string, percent: WaterChangeId): ActionResult {
  const tank = state.tanks.find((t) => t.id === tankId);
  if (!tank) return fail(state, "水槽が見つかりません");
  const type = TANK_TYPES.find((t) => t.id === tank.typeId)!;
  const liters = (type.volumeL * percent) / 100;
  const cost = Math.round(liters * CONFIG.economy.waterCostPerLiter);
  if (state.cash < cost) return fail(state, "資金が不足しています");
  const s = clone(state);
  const t = s.tanks.find((x) => x.id === tankId)!;
  t.water = applyWaterChange(t.water, percent / 100);
  spend(s, cost, "water");
  return { ok: true, message: `${percent}%の換水を行いました`, state: s };
}

function fail(state: GameState, message: string): ActionResult {
  return { ok: false, message, state };
}

export function speciesCatalog(): readonly SpeciesDef[] {
  return SPECIES;
}
