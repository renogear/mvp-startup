import type { AnchorHTMLAttributes } from "react";
/** The standalone workbench uses same-page navigation rather than a Next router. */
export default function Link(props: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a {...props} />;
}
