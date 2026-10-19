import { afterEach, it, expect, vi } from "vitest";
import { assertSameOrigin, readJson } from "../src/lib/request";
afterEach(() => vi.unstubAllEnvs());
it("accepts same-origin structured input", async () =>
  expect(
    await readJson(
      new Request("https://permitpilot.test/api/projects", {
        method: "POST",
        headers: { origin: "https://permitpilot.test" },
        body: '{"name":"Project"}',
      }),
    ),
  ).toEqual({ name: "Project" }));
it("rejects cross-origin mutations", async () =>
  expect(
    readJson(
      new Request("https://permitpilot.test/api/projects", {
        method: "POST",
        headers: { origin: "https://attacker.test" },
        body: "{}",
      }),
    ),
  ).rejects.toThrow("Cross-origin"));
it("bounds streamed bodies even without content-length", async () =>
  expect(
    readJson(
      new Request("https://permitpilot.test/api/projects", {
        method: "POST",
        body: "x".repeat(1024 * 1024 + 1),
      }),
    ),
  ).rejects.toThrow("too large"));
it("rejects malformed JSON", async () =>
  expect(
    readJson(
      new Request("https://permitpilot.test/api/projects", {
        method: "POST",
        body: "not json",
      }),
    ),
  ).rejects.toThrow());
it("accepts the browser host when the server binds to all interfaces", async () =>
  expect(
    await readJson(
      new Request("http://0.0.0.0:3000/api/report", {
        method: "POST",
        headers: { origin: "http://localhost:3000", host: "localhost:3000" },
        body: "{}",
      }),
    ),
  ).toEqual({}));

it("rejects a matching host with a different browser protocol", () => {
  expect(() =>
    assertSameOrigin(
      new Request("https://permitpilot.test/api/report", {
        headers: { origin: "http://permitpilot.test" },
      }),
    ),
  ).toThrow("Cross-origin");
});

it("rejects cross-site browser requests even if their Origin claims to match", () => {
  expect(() =>
    assertSameOrigin(
      new Request("https://permitpilot.test/api/report", {
        headers: {
          origin: "https://permitpilot.test",
          "sec-fetch-site": "cross-site",
        },
      }),
    ),
  ).toThrow("Cross-origin");
});

function privateCodespace() {
  for (const [key, value] of Object.entries({
    NODE_ENV: "development",
    CODESPACES: "true",
    CODESPACE_NAME: "permitpilot-test",
    GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: "app.github.dev",
    PERMITPILOT_CODESPACES_REVIEW: "1",
    PERMITPILOT_CODESPACES_PRIVATE_CONFIRMED: "1",
  }))
    vi.stubEnv(key, value);
}

it("accepts the exact HTTPS Codespaces browser origin behind a loopback proxy", async () => {
  privateCodespace();
  expect(
    await readJson(
      new Request("http://127.0.0.1:3000/api/plans/session", {
        method: "POST",
        headers: {
          origin: "https://permitpilot-test-3000.app.github.dev",
          "x-forwarded-host": "permitpilot-test-3000.app.github.dev",
          "x-forwarded-proto": "https",
        },
        body: "{}",
      }),
    ),
  ).toEqual({});
});

it.each([
  "http://permitpilot-test-3000.app.github.dev",
  "https://other-3000.app.github.dev",
  "https://permitpilot-test-3000.app.github.dev.attacker.test",
])("rejects Codespaces mutations from the wrong origin %s", (origin) => {
  privateCodespace();
  expect(() =>
    assertSameOrigin(
      new Request("http://127.0.0.1:3000/api/plans/session", {
        headers: {
          origin,
          "x-forwarded-host": "permitpilot-test-3000.app.github.dev",
          "x-forwarded-proto": "https",
        },
      }),
    ),
  ).toThrow("Cross-origin");
});

it("does not trust forwarded Host for ordinary application origins", () => {
  expect(() =>
    assertSameOrigin(
      new Request("https://permitpilot.test/api/report", {
        headers: {
          origin: "https://attacker.test",
          "x-forwarded-host": "attacker.test",
          "x-forwarded-proto": "https",
        },
      }),
    ),
  ).toThrow("Cross-origin");
});

it("rejects an oversized declared body before parsing", async () => {
  await expect(
    readJson(
      new Request("https://permitpilot.test/api/report", {
        method: "POST",
        headers: { "content-length": String(1024 * 1024 + 1) },
        body: "{}",
      }),
    ),
  ).rejects.toThrow("Request too large");
});

it("rejects mutations with no request body", async () => {
  await expect(
    readJson(
      new Request("https://permitpilot.test/api/report", { method: "POST" }),
    ),
  ).rejects.toThrow("Request body required");
});
