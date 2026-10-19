/** Private evaluation modes only; neither mode is a production auth adapter. */
type Environment = Record<string, string | undefined>;
export type WorkbenchMode =
  "disabled" | "local-workstation" | "private-codespace";

export function configuredCodespaceHost(env: Environment = process.env) {
  if (
    env.NODE_ENV === "production" ||
    env.PERMITPILOT_CODESPACES_REVIEW !== "1" ||
    env.CODESPACES !== "true" ||
    !/^[a-z0-9][a-z0-9-]{0,62}$/.test(env.CODESPACE_NAME || "") ||
    env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN !== "app.github.dev"
  )
    return null;
  return `${env.CODESPACE_NAME}-3000.${env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}`;
}

export function codespaceHostname(env: Environment = process.env) {
  return env.PERMITPILOT_CODESPACES_PRIVATE_CONFIRMED === "1"
    ? configuredCodespaceHost(env)
    : null;
}

/** Reject authority syntax that URL parsing might silently normalize. */
export function requestAuthority(request: Request) {
  const raw = request.headers.get("host") || new URL(request.url).host;
  if (!/^(?:\[::1\]|[a-z0-9-]+(?:\.[a-z0-9-]+)*)(?::[0-9]{1,5})?$/i.test(raw))
    return null;
  try {
    new URL(`http://${raw}`);
    return raw.toLowerCase();
  } catch {
    return null;
  }
}

export function localHost(request: Request) {
  const authority = requestAuthority(request);
  if (!authority) return false;
  return ["localhost", "127.0.0.1", "[::1]"].includes(
    new URL(`http://${authority}`).hostname,
  );
}

function codespaceRequest(request: Request, expected: string) {
  const host = requestAuthority(request);
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto");
  if (forwardedHost !== null && forwardedHost !== expected) return false;
  if (forwardedProto !== null && forwardedProto !== "https") return false;
  // Some forwarding proxies retain Host; others rewrite it to loopback.
  return (
    host === expected ||
    (localHost(request) &&
      forwardedHost === expected &&
      forwardedProto === "https")
  );
}

export function workbenchAccess(
  request: Request,
  env: Environment = process.env,
) {
  const configuredHost = configuredCodespaceHost(env);
  const mode: WorkbenchMode = configuredHost
    ? "private-codespace"
    : env.NODE_ENV !== "production" && env.PERMITPILOT_LOCAL_REVIEW === "1"
      ? "local-workstation"
      : "disabled";
  const expected = codespaceHostname(env);
  const enabled =
    mode === "private-codespace"
      ? Boolean(expected && codespaceRequest(request, expected))
      : mode === "local-workstation" &&
        localHost(request) &&
        (!request.headers.has("x-forwarded-host") ||
          request.headers.get("x-forwarded-host") ===
            requestAuthority(request));
  return { mode, enabled, secure: mode === "private-codespace" };
}

export function workbenchOrigin(
  request: Request,
  env: Environment = process.env,
) {
  const host = codespaceHostname(env);
  return host && codespaceRequest(request, host) ? `https://${host}` : null;
}
