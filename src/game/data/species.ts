/**
 * 生物データベース。新種は配列に追加するだけで図鑑・導入画面に反映される。
 *
 * 注意：分類・学名・生態情報は WoRMS 等の一次情報源での照合が必要。
 * `verified` が false のものは「未照合」として扱い、UI でも明示する。
 * 最大体長など確認できていない数値は null とし、推測値を入れない。
 */

export type BehaviorKind =
  | "anemone_guard" // イソギンチャク付近で生活（カクレクマノミ型）
  | "schooling" // 群れで中層を泳ぐ（デバスズメダイ型）
  | "mid_hover_hider" // 中層でホバリングし、驚くと隠れる（ハタタテハゼ型）
  | "bottom_burrower"; // 砂底付近でホバリングし巣穴へ退避（ヤシャハゼ型）

export type Diet = "omnivore" | "planktivore" | "carnivore" | "herbivore";

export interface SpeciesPalette {
  body: number;
  accent: number;
  fin: number;
  pattern?: "clownfish_bands" | "none";
}

export interface SpeciesDef {
  id: string;
  nameJa: string;
  scientificName: string;
  family: string;
  habitat: string;
  environment: string;
  maxLengthCm: number | null;
  diet: Diet;
  swimStyle: string;
  behavior: BehaviorKind;
  social: string;
  difficulty: 1 | 2 | 3;
  popularity: number; // 1-5
  purchasePrice: number;
  upkeepPerDay: number;
  capacityUnits: number;
  sensitivity: number; // 水質変化への感受性（1.0 が標準）
  zukanText: string;
  palette: SpeciesPalette;
  verified: boolean;
  sourceNote: string;
}

export const SPECIES: readonly SpeciesDef[] = [
  {
    id: "amphiprion_ocellaris",
    nameJa: "カクレクマノミ",
    scientificName: "Amphiprion ocellaris",
    family: "スズメダイ科",
    habitat: "インド・太平洋",
    environment: "サンゴ礁、イソギンチャクに共生",
    maxLengthCm: null,
    diet: "omnivore",
    swimStyle: "胸鰭を使ったゆったりした遊泳",
    behavior: "anemone_guard",
    social: "つがい単位で縄張りを持つ",
    difficulty: 1,
    popularity: 5,
    purchasePrice: 4_000,
    upkeepPerDay: 60,
    capacityUnits: 1,
    sensitivity: 1.0,
    zukanText:
      "オレンジ色に白い帯が特徴のスズメダイ科の魚。イソギンチャクの触手の間で暮らすことで知られる。",
    palette: { body: 0xf26a21, accent: 0xffffff, fin: 0xf7a25a, pattern: "clownfish_bands" },
    verified: false,
    sourceNote: "分類・生態はWoRMS等で要照合",
  },
  {
    id: "chromis_viridis",
    nameJa: "デバスズメダイ",
    scientificName: "Chromis viridis",
    family: "スズメダイ科",
    habitat: "インド・太平洋",
    environment: "サンゴ礁の上部、枝状サンゴ周辺",
    maxLengthCm: null,
    diet: "planktivore",
    swimStyle: "群れで中層を泳ぐ",
    behavior: "schooling",
    social: "群れを作る",
    difficulty: 1,
    popularity: 3,
    purchasePrice: 1_500,
    upkeepPerDay: 40,
    capacityUnits: 1,
    sensitivity: 0.9,
    zukanText: "緑がかった青色の小型スズメダイ。群れでプランクトンを食べながら泳ぐ。",
    palette: { body: 0x3fb6a8, accent: 0x9be3d4, fin: 0x2c8c7e },
    verified: false,
    sourceNote: "分類・生態はWoRMS等で要照合",
  },
  {
    id: "nemateleotris_magnifica",
    nameJa: "ハタタテハゼ",
    scientificName: "Nemateleotris magnifica",
    family: "ネモエレオトリス科（ハゼ亜目）",
    habitat: "インド・太平洋",
    environment: "サンゴ礁、砂地の上の中層",
    maxLengthCm: null,
    diet: "planktivore",
    swimStyle: "中層でのホバリング、素早いダッシュ",
    behavior: "mid_hover_hider",
    social: "単独または小規模",
    difficulty: 2,
    popularity: 4,
    purchasePrice: 5_000,
    upkeepPerDay: 80,
    capacityUnits: 1,
    sensitivity: 1.2,
    zukanText: "白い体に赤い背びれの先が長く伸びる。驚くと隠れ場所へ素早く退避する。",
    palette: { body: 0xf4f0e8, accent: 0xe0432b, fin: 0xd8371e },
    verified: false,
    sourceNote: "分類・生態はWoRMS等で要照合",
  },
  {
    id: "stonogobiops_yasha",
    nameJa: "ヤシャハゼ",
    scientificName: "Stonogobiops yasha",
    family: "ハゼ科",
    habitat: "インド・太平洋",
    environment: "砂底、巣穴周辺",
    maxLengthCm: null,
    diet: "carnivore",
    swimStyle: "砂底付近でのホバリング",
    behavior: "bottom_burrower",
    social: "単独またはペア",
    difficulty: 2,
    popularity: 3,
    purchasePrice: 3_500,
    upkeepPerDay: 70,
    capacityUnits: 1,
    sensitivity: 1.1,
    zukanText: "砂底の近くにとどまり、危険を感じると巣穴へ戻る。",
    palette: { body: 0xc9a27e, accent: 0x6b4a33, fin: 0xe2c6a2 },
    verified: false,
    sourceNote: "分類・生態はWoRMS等で要照合",
  },
];

export function getSpecies(id: string): SpeciesDef | undefined {
  return SPECIES.find((s) => s.id === id);
}
