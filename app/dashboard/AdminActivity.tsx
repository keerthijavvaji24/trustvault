"use client";

import { useEffect, useState } from "react";

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

export default function AdminActivity() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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

  return (
    <section className="mt-10">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold">Admin Activity</h2>
          <p className="mt-1 text-sm text-slate-400">
            Recent document and permission activity.
          </p>
        </div>

        <button
          onClick={loadLogs}
          disabled={loading}
          className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50"
        >
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-red-900 bg-red-950/40 p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {!loading && !error && logs.length === 0 && (
        <div className="mt-4 rounded-lg border border-slate-800 bg-slate-900 p-4 text-sm text-slate-400">
          No audit activity found.
        </div>
      )}

      {logs.length > 0 && (
        <div className="mt-4 overflow-x-auto rounded-xl border border-slate-800">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-900 text-slate-300">
              <tr>
                <th className="px-4 py-3">Time</th>
                <th className="px-4 py-3">Actor</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Action</th>
                <th className="px-4 py-3">Outcome</th>
                <th className="px-4 py-3">Document</th>
                <th className="px-4 py-3">Target User</th>
              </tr>
            </thead>

            <tbody>
              {logs.map((log) => (
                <tr
                  key={log.id}
                  className="border-t border-slate-800 bg-slate-950"
                >
                  <td className="whitespace-nowrap px-4 py-3 text-slate-400">
                    {log.created_at}
                  </td>

                  <td className="px-4 py-3">
                    <span className="font-mono text-xs text-slate-300">
                      {log.actor_id}
                    </span>
                  </td>

                  <td className="px-4 py-3">
                    <span className="rounded-full bg-slate-800 px-2 py-1 text-xs text-slate-300">
                      {log.actor_role}
                    </span>
                  </td>

                  <td className="px-4 py-3 font-medium text-white">
                    {log.action}
                  </td>

                  <td className="px-4 py-3">
                    <span
                      className={
                        log.outcome === "allowed"
                          ? "rounded-full bg-emerald-950 px-2 py-1 text-xs text-emerald-300"
                          : log.outcome === "denied"
                            ? "rounded-full bg-red-950 px-2 py-1 text-xs text-red-300"
                            : "rounded-full bg-amber-950 px-2 py-1 text-xs text-amber-300"
                      }
                    >
                      {log.outcome}
                    </span>
                  </td>

                  <td className="px-4 py-3">
                    <span className="font-mono text-xs text-slate-400">
                      {log.document_id ?? "—"}
                    </span>
                  </td>

                  <td className="px-4 py-3">
                    <span className="font-mono text-xs text-slate-400">
                      {log.target_user_id ?? "—"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}