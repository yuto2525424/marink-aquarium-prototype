"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  advanceTime,
  createNewGame,
  setSpeed,
  type ActionResult,
  type GameState,
} from "@/game/logic/state";
import { serializeSave, parseSave } from "@/game/save/save";
import { deleteSlot, readSlot, writeSlot } from "@/game/save/storage";
import { CONFIG, type SpeedOption } from "@/game/config";
import {
  AquariumHome,
  DexScreen,
  FinanceScreen,
  IntroduceScreen,
  ManagementScreen,
  SettingsScreen,
  TankScreen,
  TitleScreen,
} from "./screens";

export type Screen =
  | "title"
  | "home"
  | "tank"
  | "introduce"
  | "management"
  | "finance"
  | "dex"
  | "settings";

interface Notice {
  text: string;
  tone: "ok" | "err";
}

const NAV: { id: Screen; label: string }[] = [
  { id: "home", label: "館内" },
  { id: "tank", label: "水槽" },
  { id: "introduce", label: "生物導入" },
  { id: "management", label: "飼育管理" },
  { id: "finance", label: "経営" },
  { id: "dex", label: "図鑑" },
  { id: "settings", label: "設定" },
];

type SlotResult = Awaited<ReturnType<typeof readSlot>>;

/** 保存領域の読み取り結果を画面表示用の情報に変換する */
function summarizeSlot(r: SlotResult): { hasSave: boolean; savedAt: string | null; loadError: string | null } {
  if (!r.ok) return { hasSave: false, savedAt: null, loadError: `セーブを読めません：${r.error}` };
  if (r.data == null) return { hasSave: false, savedAt: null, loadError: null };
  const parsed = parseSave(r.data);
  if (!parsed.ok) return { hasSave: false, savedAt: null, loadError: `セーブデータに問題があります：${parsed.reason}` };
  return {
    hasSave: true,
    savedAt: parsed.savedAt ? new Date(parsed.savedAt).toLocaleString("ja-JP") : null,
    loadError: null,
  };
}

export default function GameApp() {
  const [screen, setScreen] = useState<Screen>("title");
  const [game, setGame] = useState<GameState | null>(null);
  const gameRef = useRef<GameState | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [saveInfo, setSaveInfo] = useState<{ hasSave: boolean; savedAt: string | null; loadError: string | null }>({
    hasSave: false,
    savedAt: null,
    loadError: null,
  });
  const [selectedTankId, setSelectedTankId] = useState<string | null>(null);

  const commit = useCallback((next: GameState) => {
    gameRef.current = next;
    setGame(next);
  }, []);

  const flash = useCallback((text: string, tone: "ok" | "err" = "ok") => {
    setNotice({ text, tone });
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 2800);
  }, []);

  /* ---------- 保存・読み込み ---------- */

  const saveNow = useCallback(
    async (silent = false): Promise<boolean> => {
      const g = gameRef.current;
      if (!g) return false;
      const now = new Date();
      const res = await writeSlot(serializeSave(g, now));
      if (res.ok) {
        setSaveInfo((prev) => ({ ...prev, hasSave: true, savedAt: now.toLocaleString("ja-JP"), loadError: null }));
        if (!silent) flash("保存しました");
      } else if (!silent) {
        flash(`保存に失敗しました：${res.error ?? "不明なエラー"}`, "err");
      }
      return res.ok;
    },
    [flash],
  );

  const refreshSaveInfo = useCallback(() => {
    return readSlot().then((r) => setSaveInfo(summarizeSlot(r)));
  }, []);

  useEffect(() => {
    // 初回表示時にセーブの有無を確認（非同期読み込みの完了後に反映）
    let cancelled = false;
    readSlot().then((r) => {
      if (!cancelled) setSaveInfo(summarizeSlot(r));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const newGame = useCallback(() => {
    const g = createNewGame();
    commit(g);
    setSelectedTankId(g.tanks[0]?.id ?? null);
    setScreen("home");
    void saveNow(true);
    flash("新しい水族館を開館準備しています。まずは生物を導入しましょう。");
  }, [commit, flash, saveNow]);

  const continueGame = useCallback(async () => {
    const r = await readSlot();
    if (!r.ok || r.data == null) {
      flash("続きから遊べるセーブがありません", "err");
      return;
    }
    const parsed = parseSave(r.data);
    if (!parsed.ok) {
      flash(`読み込みに失敗しました：${parsed.reason}`, "err");
      return;
    }
    commit(parsed.state);
    setSelectedTankId(parsed.state.tanks[0]?.id ?? null);
    setScreen("home");
    flash("続きから再開しました。ゲーム時間は保存時点から進みます。");
  }, [commit, flash]);

  const returnToTitle = useCallback(async () => {
    if (gameRef.current) await saveNow(true);
    gameRef.current = null;
    setGame(null);
    setScreen("title");
    void refreshSaveInfo();
  }, [refreshSaveInfo, saveNow]);

  const deleteSave = useCallback(async () => {
    const res = await deleteSlot();
    if (res.ok) {
      flash("セーブデータを削除しました");
      void refreshSaveInfo();
    } else {
      flash(`削除に失敗しました：${res.error}`, "err");
    }
  }, [flash, refreshSaveInfo]);

  /* ---------- 時間進行（ゲームループ） ---------- */

  useEffect(() => {
    let last = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      // タブ非表示などで大きく空いた場合も、1秒分までしか進めない（想定外の一括進行を防ぐ）
      const elapsed = Math.min(now - last, 1000);
      last = now;
      const g = gameRef.current;
      if (!g) return;
      const next = advanceTime(g, elapsed);
      if (next !== g) commit(next);
    }, 250);
    return () => clearInterval(id);
  }, [commit]);

  // 自動セーブ（一定間隔と、画面を離れたとき）
  useEffect(() => {
    const id = setInterval(() => {
      if (gameRef.current) void saveNow(true);
    }, CONFIG.autosaveIntervalMs);
    const onHide = () => {
      if (document.visibilityState === "hidden" && gameRef.current) void saveNow(true);
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onHide);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onHide);
    };
  }, [saveNow]);

  /* ---------- 操作の橋渡し ---------- */

  const act = useCallback(
    (fn: (g: GameState) => ActionResult): boolean => {
      const g = gameRef.current;
      if (!g) return false;
      const r = fn(g);
      if (r.ok) commit(r.state);
      flash(r.message, r.ok ? "ok" : "err");
      return r.ok;
    },
    [commit, flash],
  );

  const changeSpeed = (speed: SpeedOption) => {
    const g = gameRef.current;
    if (g) commit(setSpeed(g, speed));
  };

  const go = (s: Screen) => setScreen(s);

  /* ---------- 描画 ---------- */

  const inGame = game !== null && screen !== "title";

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#0b2545] via-[#13315c] to-[#1b6a8a] text-white">
      {inGame && game && (
        <header className="sticky top-0 z-20 border-b border-white/15 bg-[#0b2545]/70 backdrop-blur-md">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-4 py-2">
            <span className="mr-2 text-lg font-bold tracking-wide">MARINK</span>
            <nav className="flex flex-wrap gap-1">
              {NAV.map((n) => (
                <button
                  key={n.id}
                  onClick={() => go(n.id)}
                  className={`rounded-full px-3 py-1 text-sm transition ${
                    screen === n.id ? "bg-white text-[#0b2545]" : "bg-white/10 hover:bg-white/20"
                  }`}
                >
                  {n.label}
                </button>
              ))}
            </nav>
            <div className="ml-auto flex items-center gap-2 text-sm">
              <span className="rounded-full bg-white/10 px-3 py-1">{game.cash.toLocaleString("ja-JP")}円</span>
              <div className="flex overflow-hidden rounded-full border border-white/20">
                {CONFIG.speedOptions.map((s) => (
                  <button
                    key={s}
                    onClick={() => changeSpeed(s)}
                    className={`px-2.5 py-1 text-xs ${
                      (s === 0 && game.paused) || (s !== 0 && !game.paused && game.speed === s)
                        ? "bg-white text-[#0b2545]"
                        : "bg-white/5 hover:bg-white/15"
                    }`}
                  >
                    {s === 0 ? "停止" : `x${s}`}
                  </button>
                ))}
              </div>
              <button onClick={() => void returnToTitle()} className="rounded-full bg-white/10 px-3 py-1 text-xs hover:bg-white/20">
                タイトル
              </button>
            </div>
          </div>
        </header>
      )}

      <main className="mx-auto max-w-6xl px-4 py-6">
        {screen === "title" && (
          <TitleScreen
            hasSave={saveInfo.hasSave}
            savedAt={saveInfo.savedAt}
            loadError={saveInfo.loadError}
            onNew={newGame}
            onContinue={() => void continueGame()}
            onSettings={() => setScreen("settings")}
          />
        )}

        {inGame && game && screen === "home" && (
          <AquariumHome
            game={game}
            act={act}
            go={go}
            selectedTankId={selectedTankId}
            setSelectedTankId={setSelectedTankId}
          />
        )}
        {inGame && game && screen === "tank" && (
          <TankScreen game={game} act={act} go={go} selectedTankId={selectedTankId} setSelectedTankId={setSelectedTankId} />
        )}
        {inGame && game && screen === "introduce" && (
          <IntroduceScreen game={game} act={act} go={go} selectedTankId={selectedTankId} setSelectedTankId={setSelectedTankId} />
        )}
        {inGame && game && screen === "management" && (
          <ManagementScreen game={game} act={act} go={go} selectedTankId={selectedTankId} setSelectedTankId={setSelectedTankId} />
        )}
        {inGame && game && screen === "finance" && <FinanceScreen game={game} act={act} />}
        {inGame && game && screen === "dex" && <DexScreen game={game} />}
        {screen === "settings" && (
          <SettingsScreen
            game={game}
            savedAt={saveInfo.savedAt}
            hasSave={saveInfo.hasSave}
            onSave={() => saveNow(false)}
            onDelete={() => void deleteSave()}
            onBack={() => (game ? go("home") : setScreen("title"))}
          />
        )}
      </main>

      {notice && (
        <div
          role="status"
          className={`fixed bottom-4 left-1/2 z-50 max-w-[90vw] -translate-x-1/2 rounded-2xl px-4 py-2 text-sm shadow-lg backdrop-blur ${
            notice.tone === "ok" ? "bg-white/90 text-[#0b2545]" : "bg-[#a33a3a]/95 text-white"
          }`}
        >
          {notice.text}
        </div>
      )}
    </div>
  );
}
