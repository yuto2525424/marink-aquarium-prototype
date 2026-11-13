"use client";

import { useMemo, useState, type ReactNode } from "react";
import TankView from "./TankView";
import { CONFIG, GRID, TANK_TYPES } from "@/game/config";
import { SPECIES, getSpecies, type SpeciesDef } from "@/game/data/species";
import {
  FILTER_UPGRADE_COST,
  FOODS,
  PORTION_GRAMS,
  addFish,
  buildTank,
  canPlaceTank,
  demolishTank,
  feedTank,
  fishInTank,
  moveTank,
  priceFactor,
  setAdmissionPrice,
  tankUnitsUsed,
  upgradeFilter,
  waterChange,
  type ActionResult,
  type FoodId,
  type GameState,
  type PortionId,
  type Tank,
  type WaterChangeId,
} from "@/game/logic/state";
import { IDEAL_RANGES, type WaterQuality } from "@/game/logic/water";
import { healthLabel, waterScore } from "@/game/logic/health";
import type { Screen } from "./GameApp";

export interface ScreenProps {
  game: GameState;
  act: (fn: (g: GameState) => ActionResult) => boolean;
  go: (s: Screen) => void;
  selectedTankId: string | null;
  setSelectedTankId: (id: string | null) => void;
}

const yen = (n: number) => `${Math.round(n).toLocaleString("ja-JP")}円`;

function gameClock(minute: number) {
  const day = Math.floor(minute / 1440) + 1;
  const h = Math.floor((minute % 1440) / 60);
  const m = minute % 60;
  return `${day}日目 ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

const glass =
  "rounded-3xl border-2 border-white/60 bg-gradient-to-b from-[#2b7fb8]/70 to-[#14507f]/80 p-5 shadow-[0_10px_0_#0a2f4d,0_22px_30px_rgba(0,0,0,0.35)]";
const btn =
  "rounded-2xl border-2 border-white/70 bg-gradient-to-b from-[#7ef0c4] to-[#38c2a0] px-5 py-3 text-base font-bold text-[#06302a] shadow-[0_5px_0_#1f8a70] transition active:translate-y-[5px] active:shadow-none hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40";
const btnPrimary =
  "rounded-2xl border-2 border-white bg-gradient-to-b from-[#ffd76a] to-[#ff9f5a] px-5 py-3 text-base font-bold text-[#2a1a05] shadow-[0_5px_0_#c46a1f] transition active:translate-y-[5px] active:shadow-none hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40";

function Stars({ n, max = 5 }: { n: number; max?: number }) {
  return <span className="text-[#ffd76a]">{"★".repeat(n)}<span className="text-white/25">{"★".repeat(max - n)}</span></span>;
}

function selectedTankOf(game: GameState, id: string | null): Tank | undefined {
  return game.tanks.find((t) => t.id === id) ?? game.tanks[0];
}

/* ============================================================
 * タイトル
 * ============================================================ */
export function TitleScreen(props: {
  hasSave: boolean;
  savedAt: string | null;
  loadError: string | null;
  onNew: () => void;
  onContinue: () => void;
  onSettings: () => void;
}) {
  return (
    <div className="flex min-h-[80vh] flex-col items-center justify-center gap-8 text-center">
      <div>
        <p className="text-sm tracking-[0.4em] text-[#a6e6f2]">AQUARIUM MANAGEMENT</p>
        <h1 className="mt-3 text-5xl font-bold tracking-wide md:text-7xl">MARINK AQUARIUM</h1>
        <p className="mt-4 text-lg text-white/80">自分だけの水族館を制作しよう！</p>
        <p className="mt-2 text-sm text-white/60">見た目はゆるふわ。中身は本格的。</p>
      </div>
      <div className="flex w-full max-w-xs flex-col gap-3">
        <button className={btnPrimary} onClick={props.onNew}>
          新規ゲーム
        </button>
        <button className={btn} onClick={props.onContinue} disabled={!props.hasSave}>
          続きから
        </button>
        <button className={btn} onClick={props.onSettings}>
          設定
        </button>
      </div>
      {props.hasSave && props.savedAt && <p className="text-xs text-white/50">最終保存：{props.savedAt}</p>}
      {props.loadError && <p className="max-w-md rounded-xl bg-[#a33a3a]/60 px-4 py-2 text-sm">{props.loadError}</p>}
      <p className="text-xs text-white/40">ブラウザを閉じている間、ゲーム時間は進みません。</p>
    </div>
  );
}

/* ============================================================
 * 水族館全体（館内マップ）
 * ============================================================ */
type MapMode = { kind: "idle" } | { kind: "build"; typeId: string } | { kind: "move"; tankId: string };

export function AquariumHome({ game, act, go, selectedTankId, setSelectedTankId }: ScreenProps) {
  const [mode, setMode] = useState<MapMode>({ kind: "idle" });
  const selected = selectedTankOf(game, selectedTankId);
  const species = new Set(game.fish.map((f) => f.speciesId)).size;
  const visitorsDisplay = game.lastVisitors;

  const placeAt = (gx: number, gy: number) => {
    if (mode.kind === "build") {
      const ok = act((g) => buildTank(g, mode.typeId, gx, gy));
      if (ok) setMode({ kind: "idle" });
    } else if (mode.kind === "move") {
      const ok = act((g) => moveTank(g, mode.tankId, gx, gy));
      if (ok) setMode({ kind: "idle" });
    }
  };

  const cellW = 100 / GRID.cols;
  const cellH = 100 / GRID.rows;

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
      <section className="space-y-5">
        <div className={`${glass} grid grid-cols-2 gap-4 md:grid-cols-4`}>
          <Kpi label="館内の日付" value={gameClock(game.gameMinute)} />
          <Kpi label="昨日の来館者" value={`${visitorsDisplay}名`} />
          <Kpi label="来館者満足度" value={`${game.satisfaction} / 100`} />
          <Kpi label="評判" value={`${Math.round(game.reputation)} / 100`} />
          <Kpi label="導入種数" value={`${species} 種`} />
          <Kpi label="水槽数" value={`${game.tanks.length} 基`} />
          <Kpi label="入館料" value={yen(game.admissionPrice)} />
          <div className="flex flex-wrap items-center gap-2">
            <button className={btn} onClick={() => act((g) => setAdmissionPrice(g, g.admissionPrice - 500))}>
              −500
            </button>
            <button className={btn} onClick={() => act((g) => setAdmissionPrice(g, g.admissionPrice + 500))}>
              +500
            </button>
          </div>
        </div>

        <div className={glass}>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h2 className="mr-auto text-xl font-bold">水族館のマップ</h2>
            {mode.kind === "idle" ? (
              TANK_TYPES.map((t) => (
                <button key={t.id} className={btn} onClick={() => setMode({ kind: "build", typeId: t.id })}>
                  {t.nameJa}を置く（{yen(t.buildCost)}）
                </button>
              ))
            ) : (
              <>
                <span className="rounded-full bg-[#7fd6e8]/20 px-3 py-1 text-sm text-[#a6e6f2]">
                  {mode.kind === "build" ? "設置場所をタップしてください" : "移動先をタップしてください"}
                </span>
                <button className={btn} onClick={() => setMode({ kind: "idle" })}>
                  キャンセル
                </button>
              </>
            )}
          </div>

          <div
            className="overflow-visible rounded-3xl border-2 border-[#ffd76a]/40 bg-gradient-to-b from-[#1d6fa5] via-[#14507f] to-[#0c3560] px-4 py-10 md:px-10"
            style={{ perspective: "1200px" }}
          >
          <div
            className="relative mx-auto w-full"
            style={{
              aspectRatio: `${GRID.cols} / ${GRID.rows}`,
              maxWidth: 720,
              transform: "rotateX(40deg) rotateZ(-4deg)",
              transformStyle: "preserve-3d",
            }}
          >
            {/* 床（厚みのある板） */}
            <div
              className="absolute inset-0 rounded-3xl border-4 border-white/80 bg-[#7fd6e8]"
              style={{ transform: "translateZ(-6px)", boxShadow: "0 16px 0 #2a8fb5, 0 40px 60px rgba(0,0,0,0.35)" }}
            />
            {Array.from({ length: GRID.rows }).map((_, y) =>
              Array.from({ length: GRID.cols }).map((__, x) => {
                const movingTank = mode.kind === "move" ? game.tanks.find((t) => t.id === mode.tankId) : undefined;
                const typeId = mode.kind === "build" ? mode.typeId : movingTank?.typeId;
                let ok = false;
                if (typeId && mode.kind !== "idle") {
                  ok = canPlaceTank(game, typeId, x, y, movingTank?.id) === null;
                }
                return (
                  <button
                    key={`${x}-${y}`}
                    aria-label={`マス ${x},${y}`}
                    onClick={() => (mode.kind !== "idle" ? placeAt(x, y) : undefined)}
                    className={`absolute border border-white/5 transition ${
                      mode.kind !== "idle" ? (ok ? "bg-[#7fd6e8]/25 hover:bg-[#7fd6e8]/45" : "bg-[#a33a3a]/15") : "pointer-events-none"
                    }`}
                    style={{ left: `${x * cellW}%`, top: `${y * cellH}%`, width: `${cellW}%`, height: `${cellH}%` }}
                  />
                );
              }),
            )}
            {game.tanks.map((t) => {
              const type = TANK_TYPES.find((tt) => tt.id === t.typeId)!;
              const count = fishInTank(game, t.id).length;
              const isSel = selectedTankId === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => {
                    if (mode.kind !== "idle") return;
                    setSelectedTankId(t.id);
                  }}
                  disabled={mode.kind !== "idle"}
                  className={`absolute flex flex-col items-center justify-center rounded-2xl border p-2 text-center shadow-lg transition ${
                    isSel ? "border-white bg-gradient-to-br from-[#ffd76a] to-[#ff9f5a] text-[#2a1a05]" : "border-white/80 bg-gradient-to-br from-[#7ef0c4] to-[#38c2a0] text-[#06302a] hover:brightness-110"
                  } ${mode.kind !== "idle" ? "pointer-events-none opacity-60" : ""}`}
                  style={{
                    left: `${t.gridX * cellW + 0.4}%`,
                    top: `${t.gridY * cellH + 0.4}%`,
                    width: `${type.widthCells * cellW - 0.8}%`,
                    height: `${type.heightCells * cellH - 0.8}%`,
                    transform: `translateZ(${isSel ? 30 : 18}px)`,
                    transformStyle: "preserve-3d",
                    boxShadow: `0 10px 0 ${isSel ? "#e0a526" : "#ff8fab"}, 0 22px 30px rgba(0,0,0,0.3)`,
                  }}
                >
                  <span className="text-sm font-semibold">{t.name}</span>
                  <span className="hidden text-xs text-white/80 sm:block">
                    {type.volumeL}L ・ 生物 {count}匹 ・ フィルターLv{t.filterLevel}
                  </span>
                </button>
              );
            })}
          </div>
          </div>
          <p className="mt-2 text-xs text-white/50">
            水槽をタップすると、下で操作できます。
          </p>
        </div>
      </section>

      <aside className="space-y-5">
        <div className={glass}>
          <h3 className="mb-2 font-semibold">選択中の水槽</h3>
          {selected ? (
            <div className="space-y-3 text-sm">
              <p className="text-lg font-semibold">{selected.name}</p>
              <p className="text-white/70">
                {TANK_TYPES.find((t) => t.id === selected.typeId)?.nameJa} ・ 収容 {tankUnitsUsed(game, selected.id)}/
                {TANK_TYPES.find((t) => t.id === selected.typeId)?.capacityUnits} 枠
              </p>
              <button className={`${btnPrimary} w-full`} onClick={() => go("tank")}>
                水槽を観察・給餌する
              </button>
              <button className={`${btn} w-full`} onClick={() => setMode({ kind: "move", tankId: selected.id })} disabled={mode.kind !== "idle"}>
                移動する（{yen(5000)}）
              </button>
              <button
                className={`${btn} w-full`}
                onClick={() => {
                  if (window.confirm(`${selected.name}を撤去しますか？（建設費の50%が返還されます）`)) {
                    act((g) => demolishTank(g, selected.id));
                    setSelectedTankId(null);
                  }
                }}
              >
                撤去する
              </button>
            </div>
          ) : (
            <p className="text-sm text-white/60">水槽がありません</p>
          )}
        </div>

        <div className={glass}>
          <h3 className="mb-2 font-semibold">最近の出来事</h3>
          <ul className="space-y-1 text-xs text-white/75">
            {game.messages.slice(-6).reverse().map((m, i) => (
              <li key={i} className="rounded-lg bg-white/5 px-2 py-1">
                {m}
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-white/60">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  );
}

/* ============================================================
 * 水槽観察・給餌
 * ============================================================ */
const WATER_LABELS: { key: keyof WaterQuality; label: string; unit: string; digits: number }[] = [
  { key: "tempC", label: "水温", unit: "°C", digits: 1 },
  { key: "salinityPsu", label: "塩分", unit: "psu", digits: 1 },
  { key: "pH", label: "pH", unit: "", digits: 2 },
  { key: "doMgL", label: "溶存酸素", unit: "mg/L", digits: 2 },
  { key: "nh3N", label: "アンモニア態窒素 (NH₃-N)", unit: "mg-N/L", digits: 3 },
  { key: "no2N", label: "亜硝酸態窒素 (NO₂-N)", unit: "mg-N/L", digits: 3 },
  { key: "no3N", label: "硝酸態窒素 (NO₃-N)", unit: "mg-N/L", digits: 1 },
];

/** 表示用の判定。理想範囲の外でも「注意」の帯を設け、一時的な食べ残しで即「要対応」にしない */
function waterStatus(key: keyof WaterQuality, v: number): "ok" | "warn" | "bad" {
  if (key === "doMgL") return v >= 5 ? "ok" : v >= 3 ? "warn" : "bad";
  if (key === "nh3N") return v <= 0.02 ? "ok" : v <= 0.1 ? "warn" : "bad";
  if (key === "no2N") return v <= 0.1 ? "ok" : v <= 0.3 ? "warn" : "bad";
  const r = IDEAL_RANGES[key as keyof typeof IDEAL_RANGES];
  if (!r) return "ok";
  const [min, max] = r;
  if (v >= min && v <= max) return "ok";
  const tol = (max - min) || 1;
  const dist = v < min ? min - v : v - max;
  return dist <= tol * 0.5 ? "warn" : "bad";
}

const STATUS_CLASS = { ok: "text-[#8ef0b0]", warn: "text-[#ffd76a]", bad: "text-[#ff9b9b]" } as const;
const STATUS_LABEL = { ok: "良好", warn: "注意", bad: "要対応" } as const;

export function TankScreen({ game, act, go, selectedTankId, setSelectedTankId }: ScreenProps) {
  const tank = selectedTankOf(game, selectedTankId);
  const [foodId, setFoodId] = useState<FoodId>("pellet");
  const [portion, setPortion] = useState<PortionId>("normal");
  const [wcPercent, setWcPercent] = useState<WaterChangeId>(30);
  const [feedNonce, setFeedNonce] = useState(0);
  const [fishId, setFishId] = useState<string | null>(null);

  const fish = tank ? fishInTank(game, tank.id) : [];
  const viewData = useMemo(
    () =>
      tank
        ? {
            tankId: tank.id,
            water: { nh3N: tank.water.nh3N, no2N: tank.water.no2N, doMgL: tank.water.doMgL, no3N: tank.water.no3N },
            fish: fish.map((f) => ({ id: f.id, speciesId: f.speciesId, health: f.health })),
            feedNonce,
          }
        : null,
    // fish の内容は game 更新で変わるため game を依存に含める
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tank, game, feedNonce],
  );

  if (!tank || !viewData) {
    return <p className="text-white/70">水槽がありません。館内から水槽を設置してください。</p>;
  }
  const type = TANK_TYPES.find((t) => t.id === tank.typeId)!;
  const selectedFish = fish.find((f) => f.id === fishId) ?? null;
  const selectedSpecies = selectedFish ? getSpecies(selectedFish.speciesId) : undefined;
  const score = fish.length ? Math.round(waterScore(tank.water, getSpecies(fish[0].speciesId) ?? SPECIES[0])) : null;

  const feed = () => {
    const ok = act((g) => feedTank(g, tank.id, foodId, portion));
    if (ok) setFeedNonce((n) => n + 1);
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
      <section className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="水槽を選択"
            className="rounded-full bg-white/15 px-4 py-2 text-sm"
            value={tank.id}
            onChange={(e) => {
              setSelectedTankId(e.target.value);
              setFishId(null);
            }}
          >
            {game.tanks.map((t) => (
              <option key={t.id} value={t.id} className="text-black">
                {t.name}
              </option>
            ))}
          </select>
          <span className="text-sm text-white/70">{type.nameJa} ・ 生物 {fish.length}匹</span>
          {score !== null && <span className="text-sm text-white/70">水質スコア（代表値） {score}</span>}
        </div>

        <TankView data={viewData} onFishTap={(id) => setFishId(id)} />
        <p className="text-xs text-white/60">
          魚をタップすると詳細を表示し、驚かせることができます。健康マーク：
          <span className="text-[#7dd3a0]">●</span>良好 / <span className="text-[#f3d27a]">●</span>注意 / <span className="text-[#ef7a7a]">●</span>体調不良
        </p>

        {selectedFish && selectedSpecies && (
          <div className={glass}>
            <div className="flex flex-wrap items-baseline gap-3">
              <h3 className="text-xl font-semibold">{selectedSpecies.nameJa}</h3>
              <span className="text-sm italic text-white/70">{selectedSpecies.scientificName}</span>
              <span className="ml-auto text-sm">健康：{healthLabel(selectedFish.health)}（{Math.round(selectedFish.health)}）</span>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-3">
              <Info label="分類" value={selectedSpecies.family} />
              <Info label="生息環境" value={selectedSpecies.environment} />
              <Info label="食性" value={dietLabel(selectedSpecies.diet)} />
              <Info label="遊泳様式" value={selectedSpecies.swimStyle} />
              <Info label="社会性" value={selectedSpecies.social} />
              <Info label="飼育難易度" value={<Stars n={selectedSpecies.difficulty} />} />
            </dl>
            <p className="mt-3 text-sm text-white/80">{selectedSpecies.zukanText}</p>
            <p className="mt-2 text-xs text-white/50">{selectedSpecies.sourceNote}</p>
          </div>
        )}
      </section>

      <aside className="space-y-4">
        <div className={glass}>
          <h3 className="mb-3 font-semibold">給餌</h3>
          {fish.length === 0 ? (
            <p className="text-sm text-white/60">生物がいません。「生物導入」から導入してください。</p>
          ) : (
            <div className="space-y-3 text-sm">
              <label className="block">
                餌の種類
                <select className="mt-1 w-full rounded-xl bg-white/15 px-3 py-2" value={foodId} onChange={(e) => setFoodId(e.target.value as FoodId)}>
                  {Object.values(FOODS).map((f) => (
                    <option key={f.id} value={f.id} className="text-black">
                      {f.nameJa}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                量
                <select className="mt-1 w-full rounded-xl bg-white/15 px-3 py-2" value={portion} onChange={(e) => setPortion(e.target.value as PortionId)}>
                  <option value="small" className="text-black">少なめ（{PORTION_GRAMS.small}g）</option>
                  <option value="normal" className="text-black">普通（{PORTION_GRAMS.normal}g）</option>
                  <option value="large" className="text-black">多め（{PORTION_GRAMS.large}g）</option>
                </select>
              </label>
              <p className="text-xs text-white/60">食べ残しは水質（アンモニア）を悪化させます。多すぎる給餌は避けましょう。</p>
              <button className={`${btnPrimary} w-full`} onClick={feed}>
                給餌する
              </button>
            </div>
          )}
        </div>

        <div className={glass}>
          <h3 className="mb-3 font-semibold">水質管理</h3>
          <div className="mb-3 space-y-1 text-sm">
            {WATER_LABELS.map((w) => {
              const v = tank.water[w.key];
              const st = waterStatus(w.key, v);
              return (
                <div key={w.key} className="flex items-baseline justify-between gap-2">
                  <span className="text-white/75">{w.label}</span>
                  <span className="whitespace-nowrap">
                    <span className="font-mono">{v.toFixed(w.digits)}</span> {w.unit}{" "}
                    <span className={`text-xs ${STATUS_CLASS[st]}`}>{STATUS_LABEL[st]}</span>
                  </span>
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select className="rounded-xl bg-white/15 px-3 py-2 text-sm" value={wcPercent} onChange={(e) => setWcPercent(Number(e.target.value) as WaterChangeId)}>
              <option value={10} className="text-black">10%</option>
              <option value={30} className="text-black">30%</option>
              <option value={50} className="text-black">50%</option>
            </select>
            <button className={btn} onClick={() => act((g) => waterChange(g, tank.id, wcPercent))}>
              換水する
            </button>
          </div>
        </div>

        <div className={glass}>
          <h3 className="mb-3 font-semibold">設備</h3>
          <p className="text-sm">ろ過装置：レベル {tank.filterLevel}</p>
          <button
            className={`${btn} mt-2 w-full`}
            disabled={tank.filterLevel >= 3}
            onClick={() => act((g) => upgradeFilter(g, tank.id))}
          >
            {tank.filterLevel >= 3 ? "最大レベルです" : `ろ過装置を強化（${yen(FILTER_UPGRADE_COST[(tank.filterLevel + 1) as 2 | 3])}）`}
          </button>
          <button className={`${btnPrimary} mt-2 w-full`} onClick={() => go("introduce")}>
            この水槽に生物を導入
          </button>
        </div>
      </aside>
    </div>
  );
}

function Info({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-white/55">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function dietLabel(d: SpeciesDef["diet"]) {
  return { omnivore: "雑食", planktivore: "動物プランクトン食", carnivore: "肉食", herbivore: "草食" }[d];
}

/* ============================================================
 * 生物導入
 * ============================================================ */
export function IntroduceScreen({ game, act, selectedTankId, setSelectedTankId }: ScreenProps) {
  const tank = selectedTankOf(game, selectedTankId);
  const [q, setQ] = useState("");
  const filtered = SPECIES.filter((s) => {
    const k = q.trim();
    if (!k) return true;
    return [s.nameJa, s.scientificName, s.family, s.environment].some((x) => x.includes(k));
  });

  if (!tank) return <p className="text-white/70">水槽がありません。</p>;
  const type = TANK_TYPES.find((t) => t.id === tank.typeId)!;
  const used = tankUnitsUsed(game, tank.id);

  return (
    <div className="space-y-5">
      <div className={`${glass} flex flex-wrap items-center gap-3`}>
        <label className="text-sm">
          導入先水槽：
          <select
            className="ml-2 rounded-full bg-white/15 px-3 py-1.5"
            value={tank.id}
            onChange={(e) => setSelectedTankId(e.target.value)}
          >
            {game.tanks.map((t) => (
              <option key={t.id} value={t.id} className="text-black">
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <span className="text-sm text-white/70">
          収容 {used}/{type.capacityUnits} 枠 ・ 資金 {yen(game.cash)}
        </span>
        <input
          aria-label="生物を検索"
          placeholder="和名・学名・科で検索"
          className="ml-auto min-w-[220px] rounded-full bg-white/15 px-4 py-2 text-sm placeholder:text-white/50"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {filtered.map((sp) => {
          const capOk = used + sp.capacityUnits <= type.capacityUnits;
          const cashOk = game.cash >= sp.purchasePrice;
          const blocked = !capOk ? "収容枠が足りません" : !cashOk ? "資金が不足しています" : null;
          return (
            <article key={sp.id} className={glass}>
              <div className="flex items-baseline gap-2">
                <h3 className="text-lg font-semibold">{sp.nameJa}</h3>
                <span className="text-sm italic text-white/70">{sp.scientificName}</span>
              </div>
              <p className="mt-1 text-sm text-white/75">{sp.environment}</p>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                <Info label="食性" value={dietLabel(sp.diet)} />
                <Info label="社会性" value={sp.social} />
                <Info label="飼育難易度" value={<Stars n={sp.difficulty} />} />
                <Info label="展示人気度" value={<Stars n={sp.popularity} />} />
                <Info label="導入費" value={yen(sp.purchasePrice)} />
                <Info label="維持費" value={`${yen(sp.upkeepPerDay)}/日`} />
              </dl>
              <div className="mt-4 flex items-center justify-between gap-2">
                <span className="text-xs text-[#ffd76a]">{blocked ?? ""}</span>
                <button
                  className={btnPrimary}
                  disabled={!!blocked}
                  onClick={() => act((g) => addFish(g, sp.id, tank.id))}
                >
                  導入する
                </button>
              </div>
            </article>
          );
        })}
        {filtered.length === 0 && <p className="text-white/60">該当する生物がありません。</p>}
      </div>
      <p className="text-xs text-white/50">
        現在導入できるのは収録済みの{SPECIES.length}種です。収録数は今後拡充されます。
      </p>
    </div>
  );
}

/* ============================================================
 * 飼育管理
 * ============================================================ */
export function ManagementScreen({ game, act, selectedTankId, setSelectedTankId }: ScreenProps) {
  const tank = selectedTankOf(game, selectedTankId);
  if (!tank) return <p className="text-white/70">水槽がありません。</p>;
  const type = TANK_TYPES.find((t) => t.id === tank.typeId)!;
  const fish = fishInTank(game, tank.id);
  const hungerPct = Math.round(tank.hunger);

  return (
    <div className="space-y-5">
      <div className={`${glass} flex flex-wrap items-center gap-3`}>
        <select className="rounded-full bg-white/15 px-3 py-1.5 text-sm" value={tank.id} onChange={(e) => setSelectedTankId(e.target.value)}>
          {game.tanks.map((t) => (
            <option key={t.id} value={t.id} className="text-black">
              {t.name}
            </option>
          ))}
        </select>
        <span className="text-sm text-white/70">{type.nameJa} ・ 空腹度 {hungerPct}/100</span>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className={glass}>
          <h3 className="mb-3 font-semibold">水質（単位つき）</h3>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-white/55">
              <tr>
                <th className="py-1">項目</th>
                <th>値</th>
                <th>目安</th>
                <th>判定</th>
              </tr>
            </thead>
            <tbody>
              {WATER_LABELS.map((w) => {
                const v = tank.water[w.key];
                const st = waterStatus(w.key, v);
                const r = IDEAL_RANGES[w.key as keyof typeof IDEAL_RANGES];
                return (
                  <tr key={w.key} className="border-t border-white/10">
                    <td className="py-1.5">{w.label}</td>
                    <td className="font-mono">
                      {v.toFixed(w.digits)} {w.unit}
                    </td>
                    <td className="text-xs text-white/60">
                      {r ? (Number.isFinite(r[1]) ? `${r[0]}〜${r[1]}` : `${r[0]}以上`) : ""}
                    </td>
                    <td className={STATUS_CLASS[st]}>{STATUS_LABEL[st]}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-white/50">
            目安値は遊びやすさのための簡略化した値です。現実の飼育管理にそのまま使えるものではありません。
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {([10, 30, 50] as WaterChangeId[]).map((p) => (
              <button key={p} className={btn} onClick={() => act((g) => waterChange(g, tank.id, p))}>
                換水 {p}%
              </button>
            ))}
            <button
              className={btn}
              disabled={tank.filterLevel >= 3}
              onClick={() => act((g) => upgradeFilter(g, tank.id))}
            >
              ろ過装置を強化（Lv{tank.filterLevel}）
            </button>
          </div>
        </section>

        <section className={glass}>
          <h3 className="mb-3 font-semibold">生物の健康状態</h3>
          {fish.length === 0 ? (
            <p className="text-sm text-white/60">この水槽に生物はいません。</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {fish.map((f) => {
                const sp = getSpecies(f.speciesId);
                return (
                  <li key={f.id} className="flex items-center justify-between rounded-xl bg-white/5 px-3 py-2">
                    <span>{f.name}</span>
                    <span>
                      {healthLabel(f.health)}（{Math.round(f.health)}） {sp && <span className="text-xs text-white/50">水質感受性 {sp.sensitivity.toFixed(1)}</span>}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-3 text-xs text-white/55">
            健康度は水質と給餌状況に応じて徐々に変化します。急に失われることはありません。給餌は水槽画面から行えます。
          </p>
        </section>
      </div>
    </div>
  );
}

/* ============================================================
 * 経営
 * ============================================================ */
export function FinanceScreen({ game, act }: Pick<ScreenProps, "game" | "act">) {
  const t = game.today;
  const revenueToday = t.admissionIncome + t.shopIncome;
  const expenseToday = t.feedCost + t.waterCost + t.electricity + t.maintenance + t.speciesUpkeep;
  const priceF = priceFactor(game.admissionPrice);

  return (
    <div className="space-y-5">
      <div className={`${glass} grid gap-4 md:grid-cols-4`}>
        <Kpi label="現金残高" value={yen(game.cash)} />
        <Kpi label="本日の来館者（決算まで）" value={`${game.lastVisitors}名（前日）`} />
        <Kpi label="入館料" value={yen(game.admissionPrice)} />
        <div className="flex items-center gap-2">
          <button className={btn} onClick={() => act((g) => setAdmissionPrice(g, g.admissionPrice - 500))}>−500</button>
          <button className={btn} onClick={() => act((g) => setAdmissionPrice(g, g.admissionPrice + 500))}>+500</button>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className={glass}>
          <h3 className="mb-3 font-semibold">本日の収支（決算前・途中経過）</h3>
          <table className="w-full text-sm">
            <tbody>
              <Row label="入館料収入" value={t.admissionIncome} />
              <Row label="売店売上" value={t.shopIncome} />
              <Row label="飼料費" value={-t.feedCost} />
              <Row label="水道代（換水）" value={-t.waterCost} />
              <Row label="電気代（決算時）" value={0} note="決算時に計上" />
              <Row label="設備維持費（決算時）" value={0} note="決算時に計上" />
              <Row label="生物維持費（決算時）" value={0} note="決算時に計上" />
              <Row label="建設・導入（資本支出）" value={-t.capexSpent} note="現金のみ減少" />
            </tbody>
          </table>
          <p className="mt-3 text-xs text-white/55">
            本日の営業収入 {yen(revenueToday)} ／ 営業費用（確定分） {yen(expenseToday)}。
            入館料は想定来館者数 × 入館料（需要係数 {priceF.toFixed(2)}）で日次決算されます。
          </p>
        </section>

        <section className={glass}>
          <h3 className="mb-3 font-semibold">直近の決算（最大30日）</h3>
          {game.ledgers.length === 0 ? (
            <p className="text-sm text-white/60">まだ決算がありません。時間を進めてください。</p>
          ) : (
            <div className="max-h-[420px] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-[#13315c] text-left text-xs text-white/60">
                  <tr>
                    <th className="py-1">日</th>
                    <th>来館者</th>
                    <th>売上</th>
                    <th>利益</th>
                  </tr>
                </thead>
                <tbody>
                  {[...game.ledgers].reverse().map((l) => (
                    <tr key={l.day} className="border-t border-white/10">
                      <td className="py-1">{l.day + 1}日目</td>
                      <td>{l.visitors}名</td>
                      <td>{yen(l.admissionIncome + l.shopIncome)}</td>
                      <td className={l.profit >= 0 ? "text-[#8ef0b0]" : "text-[#ff9b9b]"}>{yen(l.profit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function Row({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <tr className="border-t border-white/10">
      <td className="py-1.5">{label}</td>
      <td className={`text-right font-mono ${value < 0 ? "text-[#ff9b9b]" : ""}`}>{value === 0 && note ? "" : yen(value)}</td>
      <td className="pl-3 text-xs text-white/50">{note ?? ""}</td>
    </tr>
  );
}

/* ============================================================
 * 生物図鑑
 * ============================================================ */
export function DexScreen({ game }: { game: GameState }) {
  const seen = new Set(game.dexSeen);
  return (
    <div className="space-y-5">
      <div className={glass}>
        <h2 className="text-lg font-semibold">生物図鑑　{seen.size} / {SPECIES.length} 登録</h2>
        <p className="mt-1 text-xs text-white/60">
          生物を導入すると登録されます。図鑑の情報は導入前に確認できる一般的な概要です。分類・学名は一次情報源での照合を進めています。
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {SPECIES.map((sp) =>
          seen.has(sp.id) ? (
            <article key={sp.id} className={glass}>
              <h3 className="text-lg font-semibold">{sp.nameJa}</h3>
              <p className="italic text-white/70">{sp.scientificName}</p>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                <Info label="分類" value={sp.family} />
                <Info label="生息域" value={sp.habitat} />
                <Info label="生息環境" value={sp.environment} />
                <Info label="食性" value={dietLabel(sp.diet)} />
                <Info label="遊泳様式" value={sp.swimStyle} />
                <Info label="社会性" value={sp.social} />
                <Info label="最大体長" value={sp.maxLengthCm ? `${sp.maxLengthCm}cm` : "未確認"} />
              </dl>
              <p className="mt-3 text-sm text-white/85">{sp.zukanText}</p>
              <p className="mt-2 text-xs text-white/50">{sp.sourceNote}</p>
            </article>
          ) : (
            <article key={sp.id} className={`${glass} opacity-70`}>
              <h3 className="text-lg font-semibold">？？？</h3>
              <p className="text-sm text-white/60">未導入の生物です。導入すると図鑑に登録されます。</p>
            </article>
          ),
        )}
      </div>
    </div>
  );
}

/* ============================================================
 * 設定
 * ============================================================ */
export function SettingsScreen(props: {
  game: GameState | null;
  savedAt: string | null;
  hasSave: boolean;
  onSave: () => void;
  onDelete: () => void;
  onBack: () => void;
}) {
  return (
    <div className="mx-auto max-w-xl space-y-5">
      <div className={`${glass} space-y-4`}>
        <h2 className="text-lg font-semibold">セーブ</h2>
        <p className="text-sm text-white/75">
          保存先：このブラウザ内（IndexedDB）。自動保存は{CONFIG.autosaveIntervalMs / 1000}秒ごとと、画面を離れたときに行われます。
        </p>
        <p className="text-sm text-white/60">最終保存：{props.savedAt ?? "なし"}</p>
        <div className="flex flex-wrap gap-2">
          <button className={btnPrimary} onClick={props.onSave} disabled={!props.game}>
            手動セーブ
          </button>
          <button className={btn} onClick={props.onDelete} disabled={!props.hasSave}>
            セーブデータを削除
          </button>
        </div>
      </div>

      <div className={`${glass} space-y-2 text-sm text-white/75`}>
        <h2 className="text-lg font-semibold text-white">ゲームについて</h2>
        <p>ゲーム時間はブラウザを閉じている間は進みません。速度変更・一時停止は館内画面の上部から行えます。</p>
        <p>
          現時点で未実装：従業員の採用・育成、研究機能、来館者の歩行アニメーション、イベント、難易度選択、効果音・BGM、クラウドセーブ。
        </p>
      </div>

      <button className={btn} onClick={props.onBack}>
        戻る
      </button>
    </div>
  );
}
