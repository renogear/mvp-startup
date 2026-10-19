import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "../tests/prototype",
  outputDir: "../test-results/prototype",
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:3089",
    viewport: { width: 1600, height: 1100 },
    launchOptions: {
      executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
      args: ["--no-sandbox"],
    },
  },
  webServer: {
    command:
      "python3 -m http.server 3089 --bind 127.0.0.1 --directory prototype/dist",
    cwd: "..",
    url: "http://127.0.0.1:3089/PermitPilot.html",
    reuseExistingServer: true,
  },
});
