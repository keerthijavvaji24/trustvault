"use client";

import { useEffect, useState } from "react";
import { EmptyState, RoleBadge } from "../_components/ui";
import {
  AlertIcon,
  AuditIcon,
  CheckIcon,
  RefreshIcon,
  SearchIcon,
  XIcon,
} from "../_components/icons";

type AuditLog = {
  id: string;
  actor_id: string;
  actor_role: "admin" | "owner" | "viewer" | "unauthenticated";
  action: string;
  outcome: "allowed" | "denied" | "error";
  document_id: string | null;
  target_user_id: string | null;
  reason: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
};

type OutcomeFilter = "all" | AuditLog["outcome"];

const FILTERS: { value: OutcomeFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "allowed", label: "Allowed" },
  { value: "denied", label: "Denied" },
  { value: "error", label: "Error" },
];

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function OutcomeBadge({ outcome }: { outcome: AuditLog["outcome"] }) {
  if (outcome === "allowed") {
    return (
      <span className="tv-badge bg-emerald-50 text-emerald-700 ring-emerald-200">
        <CheckIcon className="h-3.5 w-3.5" />
        allowed
      </span>
    );
  }
  if (outcome === "denied") {
    return (
      <span className="tv-badge bg-red-50 text-red-700 ring-red-200">
        <XIcon className="h-3.5 w-3.5" />
        denied
      </span>
    );
  }
  return (
    <span className="tv-badge bg-amber-50 text-amber-800 ring-amber-200">
      <AlertIcon className="h-3.5 w-3.5" />
      error
    </span>
  );
}

function Mono({ value }: { value: string | null }) {
  if (!value) return <span className="text-slate-400">—</span>;
  return (
    <span
      className="block max-w-[11rem] truncate font-mono text-xs text-slate-600"
      title={value}
    >
      {value}
    </span>
  );
}

export default function AdminActivity() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [outcomeFilter, setOutcomeFilter] = useState<OutcomeFilter>("all");

  async function loadLogs() {
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/admin/audit-logs");

      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(body.error || `Request failed with status ${response.status}`);
      }

      setLogs(body.logs ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load audit activity.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadLogs();
  }, []);

  const counts = {
    allowed: logs.filter((l) => l.outcome === "allowed").length,
    denied: logs.filter((l) => l.outcome === "denied").length,
    error: logs.filter((l) => l.outcome === "error").length,
  };

  const normalizedQuery = query.trim().toLowerCase();
  const visibleLogs = logs.filter((log) => {
    if (outcomeFilter !== "all" && log.outcome !== outcomeFilter) return false;
    if (!normalizedQuery) return true;

    return [
      log.action,
      log.actor_id,
      log.actor_role,
      log.document_id,
      log.target_user_id,
      log.reason,
      log.outcome,
    ].some((field) => (field ?? "").toLowerCase().includes(normalizedQuery));
  });

  const filtersActive = outcomeFilter !== "all" || normalizedQuery !== "";

  return (
    <section id="admin-activity" className="scroll-mt-24">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Admin Activity</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            Recent document and permission activity.
          </p>
        </div>

        <button
          type="button"
          onClick={loadLogs}
          disabled={loading}
          className="tv-btn tv-btn-secondary"
        >
          <RefreshIcon
            className={`h-4 w-4 ${loading ? "animate-spin motion-reduce:animate-none" : ""}`}
          />
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>

      <div className="tv-card overflow-hidden">
        {/* Toolbar */}
        <div className="flex flex-col gap-3 border-b border-slate-200 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative w-full lg:max-w-sm">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search action, actor, document, reason"
              aria-label="Search audit events"
              className="tv-input pl-9"
            />
          </div>

          <div
            role="group"
            aria-label="Filter by outcome"
            className="flex flex-wrap gap-1 rounded-md bg-slate-100 p-1"
          >
            {FILTERS.map(({ value, label }) => {
              const selected = outcomeFilter === value;
              const count = value === "all" ? logs.length : counts[value];
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setOutcomeFilter(value)}
                  className={`inline-flex h-8 items-center gap-1.5 rounded px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                    selected
                      ? "bg-white text-slate-900 shadow-sm"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  {label}
                  <span className="text-xs tabular-nums text-slate-500">
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {error && (
          <div className="p-4">
            <div
              role="alert"
              className="flex items-start gap-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"
            >
              <AlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
              <span className="min-w-0 flex-1 break-words">{error}</span>
              <button
                type="button"
                onClick={loadLogs}
                className="shrink-0 font-medium underline underline-offset-2"
              >
                Try again
              </button>
            </div>
          </div>
        )}

        {loading && logs.length === 0 && !error && (
          <div className="divide-y divide-slate-200" aria-busy="true">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-4">
                <div className="h-3 w-28 animate-pulse rounded bg-slate-100 motion-reduce:animate-none" />
                <div className="h-5 w-16 animate-pulse rounded-full bg-slate-100 motion-reduce:animate-none" />
                <div className="h-3 flex-1 animate-pulse rounded bg-slate-100 motion-reduce:animate-none" />
              </div>
            ))}
          </div>
        )}

        {!loading && !error && logs.length === 0 && (
          <EmptyState
            icon={<AuditIcon className="h-6 w-6" />}
            title="No recent activity"
            description="No audit activity found. Document and permission events will appear here as they happen."
            action={
              <button
                type="button"
                onClick={loadLogs}
                className="tv-btn tv-btn-secondary"
              >
                <RefreshIcon className="h-4 w-4" />
                Refresh
              </button>
            }
          />
        )}

        {logs.length > 0 && visibleLogs.length === 0 && (
          <EmptyState
            icon={<SearchIcon className="h-6 w-6" />}
            title="No matching events"
            description="No audit events match the current search and filter."
            action={
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setOutcomeFilter("all");
                }}
                className="tv-btn tv-btn-secondary"
              >
                Clear filters
              </button>
            }
          />
        )}

        {visibleLogs.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[60rem] text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                <tr>
                  <th scope="col" className="whitespace-nowrap px-4 py-2.5">Time</th>
                  <th scope="col" className="px-4 py-2.5">Outcome</th>
                  <th scope="col" className="px-4 py-2.5">Action</th>
                  <th scope="col" className="px-4 py-2.5">Actor</th>
                  <th scope="col" className="px-4 py-2.5">Role</th>
                  <th scope="col" className="px-4 py-2.5">Document</th>
                  <th scope="col" className="px-4 py-2.5">Target User</th>
                  <th scope="col" className="px-4 py-2.5">Reason</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-200">
                {visibleLogs.map((log) => (
                  <tr
                    key={log.id}
                    className={
                      log.outcome === "denied"
                        ? "bg-red-50/40 hover:bg-red-50/70"
                        : "hover:bg-slate-50/70"
                    }
                  >
                    <td
                      className="whitespace-nowrap px-4 py-3 text-slate-600"
                      title={log.created_at}
                    >
                      {formatTimestamp(log.created_at)}
                    </td>

                    <td className="px-4 py-3">
                      <OutcomeBadge outcome={log.outcome} />
                    </td>

                    <td className="px-4 py-3 font-medium text-slate-900">
                      {log.action}
                    </td>

                    <td className="px-4 py-3">
                      <Mono value={log.actor_id} />
                    </td>

                    <td className="px-4 py-3">
                      <RoleBadge role={log.actor_role} />
                    </td>

                    <td className="px-4 py-3">
                      <Mono value={log.document_id} />
                    </td>

                    <td className="px-4 py-3">
                      <Mono value={log.target_user_id} />
                    </td>

                    <td className="max-w-xs px-4 py-3 text-slate-600">
                      {log.reason ? (
                        <span className="line-clamp-2" title={log.reason}>
                          {log.reason}
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {logs.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-4 py-2.5 text-xs text-slate-500">
            <span>
              Showing {visibleLogs.length} of {logs.length} events
              {filtersActive ? " (filtered)" : ""}
            </span>
            <span>
              {counts.allowed} allowed, {counts.denied} denied, {counts.error}{" "}
              errors
            </span>
          </div>
        )}
      </div>
    </section>
  );
}
