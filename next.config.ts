import type { NextConfig } from "next";

// GitHub Pages（プロジェクトページ）で配信するときだけ、リポジトリ名のパスを付ける
const pagesBase = process.env.GITHUB_ACTIONS ? "/marink-aquarium-prototype" : "";

const nextConfig: NextConfig = {
  /* 静的書き出し：out/ フォルダを任意のWebサーバーで配信できる */
  output: "export",
  basePath: pagesBase,
  assetPrefix: pagesBase || undefined,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
