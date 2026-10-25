import type { ReactNode, SVGProps } from "react";

/*
  TrustVault icon set.
  One stroke weight and one visual grid (24x24). Sizes used across the product:
    h-4 w-4  inline with text (buttons, badges)
    h-5 w-5  navigation, header, row icons
    h-6 w-6  empty states and feature highlights
*/

type IconProps = SVGProps<SVGSVGElement>;

function Base({ className = "h-4 w-4", children, ...rest }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      {...rest}
    >
      {children}
    </svg>
  );
}

const make = (paths: ReactNode) =>
  function Icon(props: IconProps) {
    return <Base {...props}>{paths}</Base>;
  };

export const MenuIcon = make(<path d="M4 6h16M4 12h16M4 18h16" />);
export const XIcon = make(<path d="M18 6 6 18M6 6l12 12" />);
export const ChevronRightIcon = make(<path d="m9 6 6 6-6 6" />);
export const CheckIcon = make(<path d="m5 12 4.5 4.5L19 7" />);
export const SearchIcon = make(
  <>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </>
);
export const DownloadIcon = make(<path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14" />);
export const UploadIcon = make(<path d="M12 16V5m0 0L8 9m4-4 4 4M5 20h14" />);
export const PencilIcon = make(
  <>
    <path d="M4 20h4L19 9l-4-4L4 16v4Z" />
    <path d="m13.5 6.5 4 4" />
  </>
);
export const TrashIcon = make(
  <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
);
export const KeyIcon = make(
  <>
    <circle cx="8" cy="15" r="4" />
    <path d="M10.8 12.2 20 3m-3 3 3 3" />
  </>
);
export const LogoutIcon = make(
  <path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3M16 8l4 4-4 4M20 12H9" />
);
export const FileIcon = make(
  <>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" />
    <path d="M14 3v5h5" />
  </>
);
export const VaultIcon = make(
  <>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
    <circle cx="12" cy="12" r="3.5" />
    <path d="M12 8.5V9.5M12 14.5v1M8.5 12h1M14.5 12h1" />
  </>
);
export const UsersIcon = make(
  <>
    <circle cx="9.5" cy="8" r="3.5" />
    <path d="M3.5 20v-1a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v1" />
    <path d="M16 4.3a3.5 3.5 0 0 1 0 6.4M20.5 20v-1a4 4 0 0 0-3-3.9" />
  </>
);
export const ActivityIcon = make(<path d="M3 12h4l3-8 4 16 3-8h4" />);
export const AuditIcon = make(
  <>
    <rect x="5.5" y="4" width="13" height="17" rx="2" />
    <path d="M9 4V3h6v1M9 11h6M9 15h4" />
  </>
);
export const AlertIcon = make(
  <>
    <path d="M12 4 3 20h18L12 4Z" />
    <path d="M12 10v4M12 17.5v.01" />
  </>
);
export const RefreshIcon = make(<path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6" />);
export const InboxIcon = make(
  <>
    <path d="M4 13 6 5h12l2 8v6H4v-6Z" />
    <path d="M4 13h5l1 2h4l1-2h5" />
  </>
);
export const ClockIcon = make(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </>
);
export const LockIcon = make(
  <>
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </>
);
export const EyeIcon = make(
  <>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
    <circle cx="12" cy="12" r="3" />
  </>
);
export const TagIcon = make(
  <>
    <path d="M3 12V4h8l9 9-8 8-9-9Z" />
    <circle cx="7.5" cy="8.5" r="1" />
  </>
);
export const ShieldCheckIcon = make(
  <>
    <path d="M12 3 4.5 6v5.5c0 4.5 3.2 7.8 7.5 9.5 4.3-1.7 7.5-5 7.5-9.5V6L12 3Z" />
    <path d="m9 12 2 2 4-4" />
  </>
);

/** TrustVault mark: a shield with a vault keyhole. */
export function LogoMark({ className = "h-9 w-9" }: { className?: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-white ${className}`}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="h-[58%] w-[58%]"
      >
        <path d="M12 3 4.5 6v5.5c0 4.5 3.2 7.8 7.5 9.5 4.3-1.7 7.5-5 7.5-9.5V6L12 3Z" />
        <circle cx="12" cy="11" r="2.2" />
        <path d="M12 13.2V16" />
      </svg>
    </span>
  );
}

/** Abstract vault dial used as a quiet background motif. */
export function VaultDial({ className = "" }: { className?: string }) {
  const count = 60;
  const ticks = Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * Math.PI * 2;
    const long = i % 5 === 0;
    const outer = 188;
    const inner = long ? 168 : 178;
    const fmt = (n: number) => (200 + n).toFixed(2);
    return {
      key: i,
      x1: fmt(Math.cos(angle) * outer),
      y1: fmt(Math.sin(angle) * outer),
      x2: fmt(Math.cos(angle) * inner),
      y2: fmt(Math.sin(angle) * inner),
      long,
    };
  });

  return (
    <svg
      viewBox="0 0 400 400"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <circle cx="200" cy="200" r="196" stroke="currentColor" strokeOpacity="0.18" />
      <circle cx="200" cy="200" r="150" stroke="currentColor" strokeOpacity="0.14" />
      <circle cx="200" cy="200" r="104" stroke="currentColor" strokeOpacity="0.12" />
      <circle cx="200" cy="200" r="56" stroke="currentColor" strokeOpacity="0.16" />
      <circle cx="200" cy="200" r="8" fill="currentColor" fillOpacity="0.25" />
      {ticks.map((t) => (
        <line
          key={t.key}
          x1={t.x1}
          y1={t.y1}
          x2={t.x2}
          y2={t.y2}
          stroke="currentColor"
          strokeOpacity={t.long ? 0.3 : 0.14}
          strokeWidth={t.long ? 1.5 : 1}
        />
      ))}
      <path
        d="M200 200 L200 96"
        stroke="currentColor"
        strokeOpacity="0.3"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
