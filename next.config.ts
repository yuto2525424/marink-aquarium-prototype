import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* 静的書き出し：out/ フォルダを任意のWebサーバーで配信できる */
  output: "export",
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
