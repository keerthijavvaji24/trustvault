"use client";

import { useEffect, useState, type ReactNode } from "react";
import LogoutButton from "./LogoutButton";
import {
  ActivityIcon,
  AuditIcon,
  ChevronRightIcon,
  LockIcon,
  LogoMark,
  MenuIcon,
  UsersIcon,
  VaultIcon,
  XIcon,
} from "../_components/icons";
import { Avatar, RoleBadge } from "../_components/ui";

type AppShellProps = {
  email: string;
  fullName: string | null;
  role: string | null;
  isAdmin: boolean;
  children: ReactNode;
};

const NAV = [
  { id: "vault", label: "My Vault", icon: VaultIcon, adminOnly: false },
  { id: "shared", label: "Shared With Me", icon: UsersIcon, adminOnly: false },
  { id: "activity", label: "Activity", icon: ActivityIcon, adminOnly: false },
  {
    id: "admin-activity",
    label: "Admin Activity",
    icon: AuditIcon,
    adminOnly: true,
  },
];

export default function AppShell({
  email,
  fullName,
  role,
  isAdmin,
  children,
}: AppShellProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState("vault");

  const displayName = fullName || email || "Account";
  const items = NAV.filter((item) => !item.adminOnly || isAdmin);

  // Highlight the section currently in view.
  useEffect(() => {
    const els = NAV.filter((item) => !item.adminOnly || isAdmin)
      .map((item) => document.getElementById(item.id))
      .filter((el): el is HTMLElement => el !== null);

    if (els.length === 0 || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-80px 0px -60% 0px" }
    );

    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [isAdmin]);

  // Close the mobile drawer with Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const activeLabel = items.find((item) => item.id === active)?.label;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:shadow-md"
      >
        Skip to content
      </a>

      {/* Mobile drawer backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-30 bg-slate-900/50 lg:hidden"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <aside
        id="app-sidebar"
        aria-label="Primary"
        className={`fixed inset-y-0 left-0 z-40 flex w-60 flex-col bg-navy-950 text-slate-300 transition-transform duration-200 motion-reduce:transition-none lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-white/10 px-5">
          <div className="flex items-center gap-3">
            <LogoMark className="h-8 w-8" />
            <span className="text-base font-semibold tracking-tight text-white">
              TrustVault
            </span>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close navigation"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-400 hover:bg-white/10 hover:text-white lg:hidden"
          >
            <XIcon className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {items.map(({ id, label, icon: Icon }) => {
            const isActive = active === id;
            return (
              <a
                key={id}
                href={`#${id}`}
                aria-current={isActive ? "location" : undefined}
                onClick={() => {
                  setActive(id);
                  setOpen(false);
                }}
                className={`relative flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-white/10 text-white before:absolute before:bottom-2 before:left-0 before:top-2 before:w-0.5 before:rounded-full before:bg-violet-400"
                    : "text-slate-400 hover:bg-white/5 hover:text-white"
                }`}
              >
                <Icon className="h-5 w-5 shrink-0" />
                {label}
              </a>
            );
          })}
        </nav>

        <div className="shrink-0 border-t border-white/10 p-4">
          <div className="flex items-center gap-3">
            <Avatar label={displayName} onDark />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-white">
                {displayName}
              </p>
              {fullName && email ? (
                <p className="truncate text-xs text-slate-400">{email}</p>
              ) : null}
            </div>
          </div>
          <div className="mt-4">
            <LogoutButton />
          </div>
        </div>
      </aside>

      {/* Content column */}
      <div className="min-w-0 lg:pl-60">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-4 border-b border-slate-200 bg-white/90 px-4 backdrop-blur sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-label="Open navigation"
              aria-controls="app-sidebar"
              aria-expanded={open}
              className="tv-icon-btn -ml-2 lg:hidden"
            >
              <MenuIcon className="h-5 w-5" />
            </button>

            <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2 text-sm">
              <span className="hidden text-slate-500 sm:inline">TrustVault</span>
              <ChevronRightIcon className="hidden h-4 w-4 text-slate-400 sm:inline" />
              <span className="truncate font-medium text-slate-900">
                Dashboard
              </span>
              {activeLabel ? (
                <>
                  <ChevronRightIcon className="hidden h-4 w-4 text-slate-400 md:inline" />
                  <span className="hidden truncate text-slate-500 md:inline">
                    {activeLabel}
                  </span>
                </>
              ) : null}
            </nav>
          </div>

          <div className="flex shrink-0 items-center gap-3">
            <span className="hidden items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200 md:inline-flex">
              <LockIcon className="h-4 w-4" />
              Secure session
            </span>

            <div className="flex items-center gap-3 border-l border-slate-200 pl-3">
              <Avatar label={displayName} size="sm" />
              <div className="hidden min-w-0 sm:block">
                <p className="max-w-[10rem] truncate text-sm font-medium leading-5 text-slate-900">
                  {displayName}
                </p>
              </div>
              {role ? <RoleBadge role={role} /> : null}
            </div>

            <LogoutButton variant="header" />
          </div>
        </header>

        <main id="main" className="min-w-0">
          {children}
        </main>
      </div>
    </div>
  );
}
