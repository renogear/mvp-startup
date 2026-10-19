import { Compass } from "lucide-react";

export function Logo() {
  return (
    <div className="logo">
      <span>
        <Compass size={23} />
      </span>
      PermitPilot<span className="logo-period">.</span>
    </div>
  );
}
export function Empty({
  icon,
  title,
  text,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{text}</p>
      {children}
    </div>
  );
}
