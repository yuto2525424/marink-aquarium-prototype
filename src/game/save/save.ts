import { CONFIG } from "../config";
import type { GameState } from "../logic/state";

/**
 * セーブデータ形式。format/version を持ち、読み込み時に検証する。
 * 検証に失敗したデータは上書きせず、呼び出し側に通知する。
 */
export interface SaveEnvelope {
  format: typeof CONFIG.saveFormatName;
  version: number;
  savedAt: string;
  state: GameState;
}

export function serializeSave(state: GameState, now: Date = new Date()): SaveEnvelope {
  return {
    format: CONFIG.saveFormatName,
    version: CONFIG.saveFormatVersion,
    savedAt: now.toISOString(),
    state,
  };
}

export type ParseResult =
  | { ok: true; state: GameState; savedAt: string }
  | { ok: false; reason: string };

export function parseSave(raw: unknown): ParseResult {
  if (!raw || typeof raw !== "object") return { ok: false, reason: "データ形式が不正です" };
  const env = raw as Partial<SaveEnvelope>;
  if (env.format !== CONFIG.saveFormatName) return { ok: false, reason: "別形式のデータです" };
  if (env.version !== CONFIG.saveFormatVersion) {
    return { ok: false, reason: `未対応のセーブバージョンです (${String(env.version)})` };
  }
  const st = env.state as GameState | undefined;
  const problem = validateState(st);
  if (problem) return { ok: false, reason: problem };
  return { ok: true, state: st as GameState, savedAt: String(env.savedAt ?? "") };
}

/** 必須項目と型の最低限の検証（壊れたデータでゲームが落ちないように） */
export function validateState(st: GameState | undefined): string | null {
  if (!st || typeof st !== "object") return "状態データがありません";
  if (st.version !== 1) return "状態バージョンが不正です";
  if (!Number.isFinite(st.cash) || !Number.isFinite(st.gameMinute)) return "数値データが不正です";
  if (!Array.isArray(st.tanks) || st.tanks.length === 0) return "水槽データが不正です";
  if (!Array.isArray(st.fish)) return "生物データが不正です";
  if (!Array.isArray(st.dexSeen) || !Array.isArray(st.ledgers) || !Array.isArray(st.messages)) {
    return "記録データが不正です";
  }
  for (const t of st.tanks) {
    if (!t || typeof t.id !== "string" || !t.water || typeof t.water.doMgL !== "number") {
      return "水槽データが不正です";
    }
  }
  return null;
}
