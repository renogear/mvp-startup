import { requestAuthority, workbenchOrigin } from "./plan/environment";

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const authority = requestAuthority(request);
  if (!authority || request.headers.get("sec-fetch-site") === "cross-site")
    throw new Error("Cross-origin request rejected");
  const expected =
    workbenchOrigin(request) ||
    `${new URL(request.url).protocol}//${authority}`;
  if (origin && origin !== expected)
    throw new Error("Cross-origin request rejected");
}

/** Bound request bodies before JSON parsing; reject cross-origin browser mutations. */
export async function readJson(request: Request): Promise<unknown> {
  assertSameOrigin(request);
  const limit = 1024 * 1024;
  if (Number(request.headers.get("content-length")) > limit)
    throw new Error("Request too large");
  if (!request.body) throw new Error("Request body required");
  const reader = request.body.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new Error("Request too large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}
