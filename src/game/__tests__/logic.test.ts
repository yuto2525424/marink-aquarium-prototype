import { describe, expect, it } from "vitest";
import { applyWaterChange, createInitialWater, stepWater, IDEAL_RANGES, type WaterEnv } from "../logic/water";
import { feedingScore, stepHealth, waterScore } from "../logic/health";
import { BEHAVIOR_PARAMS, createMotion, stepMotion, type Rng } from "../logic/behavior";
import {
  addFish,
  advanceTime,
  buildTank,
  createNewGame,
  feedTank,
  moveTank,
  demolishTank,
  priceFactor,
  setAdmissionPrice,
  setSpeed,
  upgradeFilter,
  visitorFactor,
  waterChange,
} from "../logic/state";
import { getSpecies, SPECIES } from "../data/species";
import { parseSave, serializeSave, validateState } from "../save/save";
import { CONFIG, TANK_TYPES } from "../config";

const env: WaterEnv = { volumeL: 60, filterPower: 0.75, flowPower: 0.5, heaterOn: true };

function seededRng(seed: number): Rng {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe("水質モデル", () => {
  it("初期水質は理想範囲内", () => {
    const w = createInitialWater();
    expect(w.tempC).toBeGreaterThanOrEqual(IDEAL_RANGES.tempC[0]);
    expect(w.tempC).toBeLessThanOrEqual(IDEAL_RANGES.tempC[1]);
    expect(w.nh3N).toBe(0);
  });

  it("給餌の食べ残しでアンモニアが増える（食べ残しが多いほど増える）", () => {
    const base = createInitialWater();
    const eatenAll = stepWater(base, env, { feedGrams: 20, eatenFraction: 1, fishBiomassG: 50 }, 0);
    const eatenHalf = stepWater(base, env, { feedGrams: 20, eatenFraction: 0.5, fishBiomassG: 50 }, 0);
    expect(eatenHalf.nh3N).toBeGreaterThan(eatenAll.nh3N);
    expect(eatenHalf.nh3N).toBeGreaterThan(0);
  });

  it("ろ過能力が高いほどアンモニアが減りやすい", () => {
    const dirty = { ...createInitialWater(), nh3N: 0.5 };
    const weak = stepWater(dirty, { ...env, filterPower: 0.1 }, { feedGrams: 0, eatenFraction: 1, fishBiomassG: 0 }, 1);
    const strong = stepWater(dirty, { ...env, filterPower: 0.9 }, { feedGrams: 0, eatenFraction: 1, fishBiomassG: 0 }, 1);
    expect(strong.nh3N).toBeLessThan(weak.nh3N);
    expect(strong.no3N).toBeGreaterThan(weak.no3N);
  });

  it("換水でアンモニア・亜硝酸・硝酸が減り、塩分が標準に近づく", () => {
    const dirty = { ...createInitialWater(), nh3N: 0.4, no2N: 0.3, no3N: 60, salinityPsu: 40 };
    const after = applyWaterChange(dirty, 0.5);
    expect(after.nh3N).toBeCloseTo(0.2);
    expect(after.no2N).toBeCloseTo(0.15);
    expect(after.no3N).toBeCloseTo(30);
    expect(after.salinityPsu).toBeLessThan(40);
  });

  it("水質の数値は有限で、DOは0以上飽和以下", () => {
    let w = createInitialWater();
    for (let i = 0; i < 500; i++) {
      w = stepWater(w, env, { feedGrams: 2, eatenFraction: 0.8, fishBiomassG: 100 }, 1);
    }
    for (const v of Object.values(w)) expect(Number.isFinite(v)).toBe(true);
    expect(w.doMgL).toBeGreaterThanOrEqual(0);
    expect(w.doMgL).toBeLessThanOrEqual(CONFIG.water.saturationDO);
  });
});

describe("健康度", () => {
  it("理想水質の方が水質スコアが高い", () => {
    const sp = getSpecies("amphiprion_ocellaris")!;
    const good = createInitialWater();
    const bad = { ...good, nh3N: 1, no2N: 2, doMgL: 1 };
    expect(waterScore(good, sp)).toBeGreaterThan(waterScore(bad, sp));
    expect(waterScore(good, sp)).toBeGreaterThan(90);
  });

  it("感受性の高い種は同じ水質で低くなる", () => {
    const bad = { ...createInitialWater(), nh3N: 0.05 };
    const normal = { ...getSpecies("amphiprion_ocellaris")!, sensitivity: 1.0 };
    const sensitive = { ...normal, sensitivity: 2.0 };
    expect(waterScore(bad, sensitive)).toBeLessThan(waterScore(bad, normal));
  });

  it("健康度は急変せず、目標に向かって徐々に変化する", () => {
    const next = stepHealth(80, 0, 0, 1);
    expect(next).toBeLessThan(80);
    expect(next).toBeGreaterThan(70);
  });

  it("空腹度が高いと給餌スコアが下がる", () => {
    expect(feedingScore(0)).toBe(100);
    expect(feedingScore(80)).toBe(20);
  });
});

describe("行動ロジック", () => {
  it("全種の行動パラメータが定義されている", () => {
    for (const sp of SPECIES) expect(BEHAVIOR_PARAMS[sp.behavior]).toBeDefined();
  });

  it("ヤシャハゼは砂底付近に留まり、驚くと巣穴へ戻る", () => {
    const rng = seededRng(7);
    let m = createMotion("bottom_burrower", rng);
    for (let i = 0; i < 200; i++) m = stepMotion("bottom_burrower", m, 0.1, rng);
    expect(m.y).toBeGreaterThan(0.7);
    m = stepMotion("bottom_burrower", m, 0.1, rng, { disturbed: true });
    expect(m.mode).toBe("return");
    for (let i = 0; i < 400; i++) m = stepMotion("bottom_burrower", m, 0.1, rng);
    expect(Math.hypot(m.x - BEHAVIOR_PARAMS.bottom_burrower.burrowSpot!.x, m.y - BEHAVIOR_PARAMS.bottom_burrower.burrowSpot!.y)).toBeLessThan(0.1);
  });

  it("位置は常に0..1の範囲内に収まる", () => {
    const rng = seededRng(3);
    let m = createMotion("schooling", rng);
    for (let i = 0; i < 2000; i++) {
      m = stepMotion("schooling", m, 0.05, rng, { flockCenter: { x: 0.5, y: 0.3 } });
      expect(m.x).toBeGreaterThanOrEqual(0);
      expect(m.x).toBeLessThanOrEqual(1);
      expect(m.y).toBeGreaterThanOrEqual(0);
      expect(m.y).toBeLessThanOrEqual(1);
    }
  });
});

describe("ゲーム状態と経営", () => {
  it("新規ゲームは開始資金と初期水槽を持つ", () => {
    const g = createNewGame(1);
    expect(g.cash).toBe(CONFIG.startingCash);
    expect(g.tanks).toHaveLength(1);
    expect(g.fish).toHaveLength(0);
  });

  it("水槽設置は資金を減らし、重なりと資金不足を拒否する", () => {
    const g = createNewGame(2);
    const ok = buildTank(g, "small", 5, 0);
    expect(ok.ok).toBe(true);
    expect(ok.state.cash).toBe(g.cash - TANK_TYPES[0].buildCost);
    const overlap = buildTank(g, "small", 2, 2);
    expect(overlap.ok).toBe(false);
    const poor = { ...g, cash: 0 };
    expect(buildTank(poor, "small", 5, 0).ok).toBe(false);
  });

  it("水槽の移動と撤去（生物入りは撤去不可）", () => {
    let g = createNewGame(3);
    g = buildTank(g, "small", 5, 0).state;
    const tankId = g.tanks[1].id;
    const moved = moveTank(g, tankId, 5, 3);
    expect(moved.ok).toBe(true);
    expect(moved.state.tanks[1].gridY).toBe(3);

    const withFish = addFish(g, "chromis_viridis", tankId);
    expect(withFish.ok).toBe(true);
    expect(demolishTank(withFish.state, tankId).ok).toBe(false);
    const empty = demolishTank(g, tankId);
    expect(empty.ok).toBe(true);
    expect(empty.state.tanks).toHaveLength(1);
  });

  it("生物導入は収容上限と資金を守る", () => {
    let g = createNewGame(4);
    const tankId = g.tanks[0].id;
    for (let i = 0; i < 6; i++) {
      const r = addFish(g, "chromis_viridis", tankId);
      expect(r.ok).toBe(true);
      g = r.state;
    }
    expect(addFish(g, "chromis_viridis", tankId).ok).toBe(false);
    expect(addFish(g, "unknown_species", tankId).ok).toBe(false);
  });

  it("給餌後は空腹度が下がり、食べ残しで水質が悪化する", () => {
    let g = createNewGame(5);
    g = addFish(g, "chromis_viridis", g.tanks[0].id).state;
    g = advanceTime(g, 60_000); // 1ゲーム時間(60分)進める（x1で60秒）
    const tankBefore = g.tanks[0];
    const r = feedTank(g, tankBefore.id, "pellet", "large");
    expect(r.ok).toBe(true);
    expect(r.state.tanks[0].water.nh3N).toBeGreaterThan(tankBefore.water.nh3N);
    expect(r.state.tanks[0].hunger).toBeLessThanOrEqual(tankBefore.hunger);
    expect(r.state.cash).toBeLessThan(g.cash);
  });

  it("普通量の給餌で一時的にアンモニアが上がっても、ろ過で数時間のうちに回復する（即死級にならない）", () => {
    const base = createInitialWater();
    // 60L・ろ過レベル1相当、中程度の食べ残し（15g中約5g）
    const fed = stepWater(base, env, { feedGrams: 15, eatenFraction: 0.65, fishBiomassG: 32 }, 0);
    expect(fed.nh3N).toBeGreaterThan(0.02);
    expect(fed.nh3N).toBeLessThan(0.3);
    let w = fed;
    for (let h = 0; h < 12; h++) w = stepWater(w, { ...env, filterPower: 0.5 }, { feedGrams: 0, eatenFraction: 1, fishBiomassG: 32 }, 1);
    expect(w.nh3N).toBeLessThan(fed.nh3N * 0.5);
  });

  it("換水で水質が改善し、費用がかかる", () => {
    let g = createNewGame(6);
    g = { ...g, tanks: [{ ...g.tanks[0], water: { ...g.tanks[0].water, no3N: 60, nh3N: 0.3 } }] };
    const r = waterChange(g, g.tanks[0].id, 50);
    expect(r.ok).toBe(true);
    expect(r.state.tanks[0].water.no3N).toBeLessThan(60);
    expect(r.state.cash).toBeLessThan(g.cash);
  });

  it("フィルター強化は資金を消費し、レベルを上げる", () => {
    const g = createNewGame(7);
    const r = upgradeFilter(g, g.tanks[0].id);
    expect(r.ok).toBe(true);
    expect(r.state.tanks[0].filterLevel).toBe(2);
  });

  it("時間を進めると日次決算が行われ、現金・収支・来館者が更新される", () => {
    let g = createNewGame(8);
    g = addFish(g, "amphiprion_ocellaris", g.tanks[0].id).state;
    const cashBefore = g.cash;
    // 1日 = 1440ゲーム分 = x1 で 1440秒。余裕を見て 1,500 秒進める
    g = advanceTime(g, 1_440_000 + 100);
    expect(g.gameMinute).toBeGreaterThanOrEqual(1440);
    expect(g.ledgers.length).toBe(1);
    expect(g.lastVisitors).toBeGreaterThan(0);
    expect(g.cash).not.toBe(cashBefore);
    const l = g.ledgers[0];
    expect(l.admissionIncome).toBe(l.visitors * g.admissionPrice);
  });

  it("一時停止・速度0では時間が進まない", () => {
    const g = createNewGame(9);
    const paused = setSpeed(g, 0);
    expect(advanceTime(paused, 100_000).gameMinute).toBe(0);
    expect(advanceTime(setSpeed(g, 2), 1000).gameMinute).toBeGreaterThan(0);
  });

  it("入館料が高いと来館者数が減る（需要の変化）", () => {
    let g = createNewGame(10);
    g = advanceTime(g, 0);
    const cheap = setAdmissionPrice(g, 800).state;
    const expensive = setAdmissionPrice(g, 4000).state;
    // 日次決算の来館者式を直接比較
    expect(visitorFactor(cheap)).toBe(visitorFactor(expensive));
    const v1 = CONFIG.economy.baseVisitorsPerDay * visitorFactor(cheap) * (cheap.reputation / 50) * priceFactor(cheap.admissionPrice);
    const v2 = CONFIG.economy.baseVisitorsPerDay * visitorFactor(expensive) * (expensive.reputation / 50) * priceFactor(expensive.admissionPrice);
    expect(v1).toBeGreaterThan(v2);
  });

  it("資金が尽きても緊急支援で進行不能にならない", () => {
    let g = { ...createNewGame(11), cash: -1_000_000 };
    g = advanceTime(g, 1_440_000 + 100);
    expect(g.cash).toBeGreaterThan(-1_000_000);
    expect(g.lastEmergencyDay).not.toBeNull();
  });
});

describe("セーブ", () => {
  it("保存→読み込みで状態が一致する", () => {
    const g = createNewGame(12);
    const env2 = serializeSave(g, new Date(0));
    const json = JSON.parse(JSON.stringify(env2));
    const parsed = parseSave(json);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.state).toEqual(g);
  });

  it("壊れたデータ・別バージョンは拒否する", () => {
    expect(parseSave(null).ok).toBe(false);
    expect(parseSave({ format: "x" }).ok).toBe(false);
    const g = createNewGame(13);
    expect(parseSave({ ...serializeSave(g), version: 999 }).ok).toBe(false);
    expect(validateState({ ...g, tanks: [] } as typeof g)).not.toBeNull();
  });

  it("生物データは種のデータベースに存在する", () => {
    const ids = new Set(SPECIES.map((s) => s.id));
    expect(ids.size).toBe(SPECIES.length);
    expect(SPECIES.length).toBeGreaterThanOrEqual(4);
  });

  it("日次決算後も状態が正しく保存・復元できる", () => {
    let g = createNewGame(14);
    g = advanceTime(g, 1_440_000 + 100);
    const parsed = parseSave(JSON.parse(JSON.stringify(serializeSave(g))));
    expect(parsed.ok).toBe(true);
  });

  it("価格設定の範囲外の値は補正される", () => {
    const g = createNewGame(15);
    expect(setAdmissionPrice(g, -500).state.admissionPrice).toBe(0);
    expect(setAdmissionPrice(g, 99999).state.admissionPrice).toBe(10000);
  });
});
