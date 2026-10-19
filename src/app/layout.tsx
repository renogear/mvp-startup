import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "PermitPilot — Residential plan review",
  description:
    "Traceable floor-plan evidence, human review, and carefully scoped regulatory checks.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
