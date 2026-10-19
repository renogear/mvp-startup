import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  codespaceHostname,
  configuredCodespaceHost,
  localHost,
  requestAuthority,
  workbenchAccess,
  workbenchOrigin,
} from "../src/lib/plan/environment";

const mocks = vi.hoisted(() => ({
  cookieGet: vi.fn(),
  createSession: vi.fn(),
  sessionOwner: vi.fn(),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: mocks.cookieGet }),
}));
vi.mock("@/lib/plan/local-store", () => ({
  createSession: mocks.createSession,
  sessionOwner: mocks.sessionOwner,
}));
import { GET, POST } from "../src/app/api/plans/session/route";

const host = "permitpilot-test-3000.app.github.dev";
const remoteEnv = {
  NODE_ENV: "development",
  PERMITPILOT_CODESPACES_REVIEW: "1",
  PERMITPILOT_CODESPACES_PRIVATE_CONFIRMED: "1",
  CODESPACES: "true",
  CODESPACE_NAME: "permitpilot-test",
  GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: "app.github.dev",
};
const localEnv = {
  NODE_ENV: "development",
  PERMITPILOT_LOCAL_REVIEW: "1",
};

function remoteRequest(headers: Record<string, string> = {}) {
  return new Request(`https://${host}/api/plans/session`, { headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of [
    ...Object.keys(remoteEnv),
    "PERMITPILOT_LOCAL_REVIEW",
    "NEXT_PUBLIC_SUPABASE_URL",
    "PERMITPILOT_OPENAI_KEY",
    "OPENAI_API_KEY",
  ])
    vi.stubEnv(key, undefined);
  vi.stubEnv("NODE_ENV", "development");
  mocks.cookieGet.mockReturnValue(undefined);
  mocks.sessionOwner.mockReturnValue(null);
  mocks.createSession.mockReturnValue({ token: "opaque-owner-token" });
});
afterEach(() => vi.unstubAllEnvs());

function enableRemote() {
  for (const [key, value] of Object.entries(remoteEnv)) vi.stubEnv(key, value);
}

describe("private workbench environment gates", () => {
  it("derives only the configured provider host, with a private-port receipt", () => {
    expect(configuredCodespaceHost(remoteEnv)).toBe(host);
    expect(codespaceHostname(remoteEnv)).toBe(host);
    expect(workbenchAccess(remoteRequest(), remoteEnv)).toEqual({
      mode: "private-codespace",
      enabled: true,
      secure: true,
    });
    expect(workbenchOrigin(remoteRequest(), remoteEnv)).toBe(`https://${host}`);
  });

  it.each([
    ["NODE_ENV", "production"],
    ["PERMITPILOT_CODESPACES_REVIEW", "0"],
    ["CODESPACES", "false"],
    ["CODESPACE_NAME", ""],
    ["CODESPACE_NAME", "other.app.github.dev"],
    ["CODESPACE_NAME", "../permitpilot"],
    ["CODESPACE_NAME", "NAME"],
    ["CODESPACE_NAME", "a".repeat(64)],
    ["GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN", "attacker.test"],
    [
      "GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN",
      "app.github.dev.attacker.test",
    ],
    ["GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN", "app.github.dev:443"],
  ])("rejects invalid provider configuration %s=%s", (key, value) => {
    const env = { ...remoteEnv, [key]: value };
    expect(configuredCodespaceHost(env)).toBeNull();
    expect(workbenchAccess(remoteRequest(), env).enabled).toBe(false);
  });

  it("does not enable a remote session while port privacy is unconfirmed", () => {
    const env = { ...remoteEnv, PERMITPILOT_CODESPACES_PRIVATE_CONFIRMED: "0" };
    expect(configuredCodespaceHost(env)).toBe(host);
    expect(codespaceHostname(env)).toBeNull();
    expect(workbenchAccess(remoteRequest(), env)).toEqual({
      mode: "private-codespace",
      enabled: false,
      secure: true,
    });
    expect(workbenchOrigin(remoteRequest(), env)).toBeNull();
  });

  it.each([
    `other-3000.app.github.dev`,
    `${host}:3000`,
    `${host}.attacker.test`,
    `attacker.test`,
    `${host}@attacker.test`,
    `${host}/path`,
    `${host}, attacker.test`,
    `${host}:99999`,
  ])("does not accept a different or malformed Host: %s", (value) => {
    expect(
      workbenchAccess(remoteRequest({ host: value }), remoteEnv).enabled,
    ).toBe(false);
  });

  it("accepts an exact provider forwarding pair when Host is loopback", () => {
    const request = new Request("http://127.0.0.1:3000/api/plans/session", {
      headers: { "x-forwarded-host": host, "x-forwarded-proto": "https" },
    });
    expect(workbenchAccess(request, remoteEnv).enabled).toBe(true);
    expect(workbenchOrigin(request, remoteEnv)).toBe(`https://${host}`);
  });

  it.each<Record<string, string>>([
    { "x-forwarded-host": host },
    { "x-forwarded-proto": "https" },
    { "x-forwarded-host": host, "x-forwarded-proto": "http" },
    {
      "x-forwarded-host": "other-3000.app.github.dev",
      "x-forwarded-proto": "https",
    },
    {
      "x-forwarded-host": `${host}, attacker.test`,
      "x-forwarded-proto": "https",
    },
  ])("rejects incomplete or spoofed loopback forwarding %o", (headers) => {
    const request = new Request("http://127.0.0.1:3000/api/plans/session", {
      headers,
    });
    expect(workbenchAccess(request, remoteEnv).enabled).toBe(false);
  });

  it("rejects contradictory forwarding headers even when Host matches", () => {
    expect(
      workbenchAccess(
        remoteRequest({ "x-forwarded-host": "attacker.test" }),
        remoteEnv,
      ).enabled,
    ).toBe(false);
    expect(
      workbenchAccess(remoteRequest({ "x-forwarded-proto": "http" }), remoteEnv)
        .enabled,
    ).toBe(false);
  });

  it.each(["localhost:3000", "127.0.0.1:3000", "[::1]:3000"])(
    "supports loopback authority %s without enabling remote access",
    (authority) => {
      const request = new Request(`http://${authority}/api/plans/session`);
      expect(requestAuthority(request)).toBe(authority);
      expect(localHost(request)).toBe(true);
      expect(workbenchAccess(request, localEnv)).toEqual({
        mode: "local-workstation",
        enabled: true,
        secure: false,
      });
      expect(workbenchAccess(request, {}).enabled).toBe(false);
      expect(
        workbenchAccess(request, { ...localEnv, NODE_ENV: "production" })
          .enabled,
      ).toBe(false);
    },
  );

  it("does not permit a forwarded remote hostname through local-only mode", () => {
    expect(workbenchAccess(remoteRequest(), localEnv).enabled).toBe(false);
    const request = new Request("http://localhost:3000/api/plans/session", {
      headers: { "x-forwarded-host": host, "x-forwarded-proto": "https" },
    });
    expect(workbenchAccess(request, localEnv).enabled).toBe(false);
  });
});

describe("workbench session API", () => {
  it("reports a session only when both the origin gate and owner cookie are valid", async () => {
    enableRemote();
    mocks.cookieGet.mockReturnValue({ value: "existing-owner-token" });
    mocks.sessionOwner.mockReturnValue("owner-id");
    const response = await GET(remoteRequest());
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      mode: "private-codespace",
      enabled: true,
      authenticated: true,
    });
    expect(mocks.sessionOwner).toHaveBeenCalledWith("existing-owner-token");
  });

  it("does not authenticate a valid cookie on a disallowed host", async () => {
    enableRemote();
    mocks.cookieGet.mockReturnValue({ value: "existing-owner-token" });
    mocks.sessionOwner.mockReturnValue("owner-id");
    const response = await GET(remoteRequest({ host: "attacker.test" }));
    expect(await response.json()).toMatchObject({
      enabled: false,
      authenticated: false,
    });
    expect(mocks.sessionOwner).not.toHaveBeenCalled();
  });

  it("does not treat an expired or unknown cookie as authenticated", async () => {
    enableRemote();
    mocks.cookieGet.mockReturnValue({ value: "expired-token" });
    const response = await GET(remoteRequest());
    expect(await response.json()).toMatchObject({
      enabled: true,
      authenticated: false,
    });
  });

  it("creates an HTTPS-only, HttpOnly, Strict session cookie in a private Codespace", async () => {
    enableRemote();
    const response = await POST(
      new Request(`https://${host}/api/plans/session`, {
        method: "POST",
        headers: { origin: `https://${host}` },
        body: "{}",
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(mocks.createSession).toHaveBeenCalledOnce();
    expect(response.cookies.get("pp_plan_workstation")).toMatchObject({
      value: "opaque-owner-token",
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/",
      maxAge: 604800,
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("keeps local HTTP development usable without a Secure cookie", async () => {
    vi.stubEnv("PERMITPILOT_LOCAL_REVIEW", "1");
    const response = await POST(
      new Request("http://[::1]:3000/api/plans/session", {
        method: "POST",
        headers: { origin: "http://[::1]:3000" },
        body: "{}",
      }),
    );
    expect(response.status).toBe(200);
    expect(response.cookies.get("pp_plan_workstation")?.secure).toBe(false);
    expect(response.headers.get("set-cookie")).not.toMatch(/; Secure(?:;|$)/);
  });

  it.each([
    "http://permitpilot-test-3000.app.github.dev",
    "https://attacker.test",
  ])("does not create a session for mismatched Origin %s", async (origin) => {
    enableRemote();
    const response = await POST(
      new Request(`https://${host}/api/plans/session`, {
        method: "POST",
        headers: { origin },
        body: "{}",
      }),
    );
    expect(response.status).toBe(400);
    expect(mocks.createSession).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("rejects session creation until startup confirms the forwarded port is private", async () => {
    enableRemote();
    vi.stubEnv("PERMITPILOT_CODESPACES_PRIVATE_CONFIRMED", "0");
    const response = await POST(
      new Request(`https://${host}/api/plans/session`, {
        method: "POST",
        body: "{}",
      }),
    );
    expect(response.status).toBe(403);
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it("rejects malformed session input without creating an owner", async () => {
    enableRemote();
    const response = await POST(
      new Request(`https://${host}/api/plans/session`, {
        method: "POST",
        body: "invalid",
      }),
    );
    expect(response.status).toBe(400);
    expect(mocks.createSession).not.toHaveBeenCalled();
  });
});
