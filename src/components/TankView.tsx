"use client";

import { useEffect, useRef } from "react";
import type Phaser from "phaser";
import type { TankViewData } from "@/game/render/TankScene";

interface Props {
  data: TankViewData;
  onFishTap: (fishId: string) => void;
}

/**
 * Phaser の水槽描画を React に載せるラッパー。
 * ゲームの状態は React/ロジック側が持ち、このコンポーネントは描画データを受け取るだけ。
 */
export default function TankView({ data, onFishTap }: Props) {
  const parentRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  // 非同期の初期化でも最新の値を使えるように ref に保持
  const latestRef = useRef({ data, onFishTap });
  useEffect(() => {
    latestRef.current = { data, onFishTap };
  });

  // 初回マウントで Phaser を起動（クライアントのみ）
  useEffect(() => {
    let cancelled = false;
    let game: Phaser.Game | null = null;

    (async () => {
      const PhaserMod = (await import("phaser")).default;
      const { TankScene, VIEW_W, VIEW_H } = await import("@/game/render/TankScene");
      if (cancelled || !parentRef.current) return;
      game = new PhaserMod.Game({
        type: PhaserMod.AUTO,
        parent: parentRef.current,
        width: VIEW_W,
        height: VIEW_H,
        backgroundColor: "#0c3a5c",
        audio: { noAudio: true },
        scale: {
          mode: PhaserMod.Scale.FIT,
          autoCenter: PhaserMod.Scale.CENTER_BOTH,
        },
        scene: [TankScene],
      });
      game.registry.set("tankData", latestRef.current.data);
      game.registry.set("onFishTap", latestRef.current.onFishTap);
      gameRef.current = game;
    })();

    return () => {
      cancelled = true;
      game?.destroy(true);
      gameRef.current = null;
    };
    // 初回のみ生成（以後は registry 経由で更新）
  }, []);

  // 描画データの更新
  useEffect(() => {
    const g = gameRef.current;
    if (!g) return;
    g.registry.set("tankData", data);
    g.registry.set("onFishTap", onFishTap);
    g.events.emit("tank-data");
  }, [data, onFishTap]);

  return (
    <div
      ref={parentRef}
      className="w-full aspect-[16/9] overflow-hidden rounded-3xl border border-white/20 bg-[#0c3a5c] shadow-xl"
    />
  );
}
