import type { ReactNode } from "react";

/* Small presentational primitives shared by the dashboard and admin console. */

export function initialsFrom(value: string): string {
  const cleaned = value.trim();
  if (!cleaned) return "?";
  const base = cleaned.includes("@") ? cleaned.split("@")[0] : cleaned;
  const parts = base.split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return base.slice(0, 2).toUpperCase() || "?";
}

const TINTS = [
  "bg-indigo-100 text-indigo-700",
  "bg-violet-100 text-violet-700",
  "bg-sky-100 text-sky-700",
  "bg-slate-200 text-slate-700",
];

const SIZES = {
  sm: "h-7 w-7 text-xs",
  md: "h-9 w-9 text-sm",
  lg: "h-10 w-10 text-sm",
};

export function Avatar({
  label,
  size = "md",
  onDark = false,
}: {
  label: string;
  size?: keyof typeof SIZES;
  onDark?: boolean;
}) {
  const hash = Array.from(label).reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  const tint = onDark ? "bg-white/10 text-white" : TINTS[hash % TINTS.length];

  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold ${SIZES[size]} ${tint}`}
    >
      {initialsFrom(label)}
    </span>
  );
}

const ROLE_STYLES: Record<string, string> = {
  admin: "bg-violet-50 text-violet-700 ring-violet-200",
  owner: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  viewer: "bg-slate-100 text-slate-600 ring-slate-200",
};

export function RoleBadge({ role }: { role: string }) {
  return (
    <span
      className={`tv-badge capitalize ${ROLE_STYLES[role] ?? "bg-slate-100 text-slate-600 ring-slate-200"}`}
    >
      {role}
    </span>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-500">
        {icon}
      </span>
      <h3 className="mt-4 text-sm font-semibold text-slate-900">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-slate-500">{description}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={`animate-spin motion-reduce:animate-none ${className}`}
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="3"
      />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
