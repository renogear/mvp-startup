import type { NextConfig } from "next";
import { configuredCodespaceHost } from "./src/lib/plan/environment";

const codespaceHost = configuredCodespaceHost();

const nextConfig: NextConfig = {
  devIndicators: false,
  allowedDevOrigins: codespaceHost ? [codespaceHost] : [],
  outputFileTracingExcludes: {
    "/api/plans": [
      "./.permitpilot/**/*",
      "./artifacts/**/*",
      "./fixtures/**/*",
    ],
    "/api/plans/**/*": [
      "./.permitpilot/**/*",
      "./artifacts/**/*",
      "./fixtures/**/*",
    ],
  },
  cacheComponents: true,
  partialPrefetching: true,
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
