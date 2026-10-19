import { cookies } from "next/headers";
import { sessionOwner } from "./local-store";
import { workbenchAccess } from "./environment";
export async function planOwner(request: Request) {
  if (!workbenchAccess(request).enabled)
    throw new Error("Plan workbench access is disabled for this origin.");
  const jar = await cookies();
  const owner = sessionOwner(jar.get("pp_plan_workstation")?.value || "");
  if (!owner) throw new Error("Open a private workbench session first.");
  return owner;
}
export function planError(error: unknown) {
  const message =
    error instanceof Error ? error.message : "Plan operation failed";
  const safe = [
    "Review unavailable",
    "Element unavailable",
    "Open a private workbench session first.",
    "Plan workbench access is disabled for this origin.",
  ];
  return {
    error: safe.includes(message)
      ? message
      : "Plan operation failed. Check the file, selected page, and processor logs.",
  };
}
