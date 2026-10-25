"use client";

import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from "react";
import { Avatar, EmptyState, Spinner } from "../_components/ui";
import {
  AlertIcon,
  CheckIcon,
  ClockIcon,
  DownloadIcon,
  EyeIcon,
  FileIcon,
  InboxIcon,
  KeyIcon,
  PencilIcon,
  RefreshIcon,
  SearchIcon,
  TagIcon,
  TrashIcon,
  UploadIcon,
  UsersIcon,
  VaultIcon,
  XIcon,
} from "../_components/icons";

interface VaultDocument {
  id: string;
  name: string;
  category: string | null;
  owner_id: string;
  created_at: string;
}

type Permission = {
  user_id: string;
  full_name: string;
  can_read: boolean;
  can_edit: boolean;
  created_at: string;
  updated_at: string;
};
type Status = "idle" | "saving" | "error" | "success";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const apiUrl = (path: string) =>
  `${process.env.NEXT_PUBLIC_BASE_URL || ""}${path}`;

const GRID_COLS =
  "md:grid-cols-[minmax(0,2.2fr)_minmax(0,1.1fr)_minmax(0,1fr)_88px_144px]";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

function Notice({
  tone,
  children,
  onDismiss,
}: {
  tone: "success" | "error";
  children: ReactNode;
  onDismiss?: () => void;
}) {
  const styles =
    tone === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : "border-red-200 bg-red-50 text-red-800";
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`flex items-start gap-3 rounded-md border p-3 text-sm ${styles}`}
    >
      {tone === "success" ? (
        <CheckIcon className="mt-0.5 h-4 w-4 shrink-0" />
      ) : (
        <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
      )}
      <span className="min-w-0 flex-1 break-words">{children}</span>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss message"
          className="-m-1 rounded p-1 opacity-70 hover:opacity-100"
        >
          <XIcon className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

function Modal({
  title,
  description,
  onClose,
  children,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 sm:items-center sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="tv-modal-title"
        className="w-full max-w-md rounded-t-xl border border-slate-200 bg-white shadow-xl sm:rounded-lg"
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0">
            <h3
              id="tv-modal-title"
              className="text-base font-semibold text-slate-900"
            >
              {title}
            </h3>
            {description && (
              <p className="mt-0.5 truncate text-sm text-slate-500">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="tv-icon-btn -mr-2 -mt-1"
          >
            <XIcon className="h-5 w-5" />
          </button>
        </div>
        <div className="max-h-[calc(100dvh-8rem)] overflow-y-auto px-5 py-5">
          {children}
        </div>
      </div>
    </div>
  );
}

export default function DocumentList({
  currentUserId,
}: {
  currentUserId?: string;
}) {
  const [documents, setDocuments] = useState<VaultDocument[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const [uploadStatus, setUploadStatus] = useState<
    "idle" | "uploading" | "success" | "error"
  >("idle");
  const [uploadMessage, setUploadMessage] = useState("");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");

  // Edit state
  const [editingDocId, setEditingDocId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editStatus, setEditStatus] = useState<Status>("idle");
  const [editMessage, setEditMessage] = useState("");

  // Permission state
  const [permDocId, setPermDocId] = useState<string | null>(null);
  const [permUserId, setPermUserId] = useState("");
  const [permRead, setPermRead] = useState(false);
  const [permEdit, setPermEdit] = useState(false);
  const [permStatus, setPermStatus] = useState<Status>("idle");
  const [permMessage, setPermMessage] = useState("");
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [permLoading, setPermLoading] = useState(false);

  // Delete state
  const [deletingDocId, setDeletingDocId] = useState<string | null>(null);
  const [deleteMessage, setDeleteMessage] = useState("");
  const [deleteIsError, setDeleteIsError] = useState(false);

  const fetchDocs = async () => {
    try {
      setError(null);

      const res = await fetch(apiUrl("/api/documents"), {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
      });

      if (!res.ok) {
        throw new Error("Failed to fetch documents");
      }

      const data = await res.json();
      setDocuments(data.documents ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDocs();
  }, []);

  const retryFetch = () => {
    setLoading(true);
    fetchDocs();
  };

  /* ---------------------------------------------------------------- */
  /* Upload                                                           */
  /* ---------------------------------------------------------------- */

  const selectFile = (next: File | null) => {
    if (next && next.size > MAX_UPLOAD_BYTES) {
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
      setUploadStatus("error");
      setUploadMessage(
        `${next.name} is ${formatBytes(next.size)}. Files must be 10 MB or smaller.`
      );
      return;
    }
    setFile(next);
    if (uploadStatus !== "uploading") {
      setUploadStatus("idle");
      setUploadMessage("");
    }
  };

  const clearFile = () => {
    setFile(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    if (uploadStatus === "uploading") return;
    selectFile(e.dataTransfer.files?.[0] ?? null);
  };

  const handleUpload = async () => {
    if (!file) {
      setUploadMessage("Please select a file.");
      setUploadStatus("error");
      return;
    }

    setUploadStatus("uploading");
    setUploadMessage("");

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch(apiUrl("/api/documents/upload"), {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(
          errData.error || `Upload failed with status ${res.status}`
        );
      }

      setUploadStatus("success");
      setUploadMessage("Document uploaded successfully.");
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";

      await fetchDocs();
    } catch (err) {
      setUploadStatus("error");
      setUploadMessage(err instanceof Error ? err.message : String(err));
    }
  };

  /* ---------------------------------------------------------------- */
  /* Download                                                         */
  /* ---------------------------------------------------------------- */

  const downloadDoc = async (doc: VaultDocument) => {
    const res = await fetch(apiUrl(`/api/documents/${doc.id}/download`));

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      alert(errData.error || `Download failed with status ${res.status}`);
      return;
    }

    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");

    a.href = url;
    a.download = doc.name;
    a.click();

    window.URL.revokeObjectURL(url);
  };

  /* ---------------------------------------------------------------- */
  /* Edit                                                             */
  /* ---------------------------------------------------------------- */

  const openEdit = (doc: VaultDocument) => {
    setEditingDocId(doc.id);
    setEditName(doc.name);
    setEditCategory(doc.category ?? "");
    setEditMessage("");
    setEditStatus("idle");
  };

  const cancelEdit = () => {
    setEditingDocId(null);
    setEditMessage("");
    setEditStatus("idle");
  };

  const saveEdit = async (docId: string) => {
    setEditStatus("saving");
    setEditMessage("");

    try {
      const res = await fetch(apiUrl(`/api/documents/${docId}`), {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: editName,
          category: editCategory || null,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        const status = res.status;

        let friendly = errData.error || `Update failed with status ${status}`;

        if (status === 401) {
          friendly = "Unauthenticated: please log in.";
        } else if (status === 403) {
          friendly =
            "Forbidden: you do not have permission to edit this document.";
        } else if (status === 404) {
          friendly = "Document not found.";
        }

        throw new Error(friendly);
      }

      setEditStatus("success");
      setEditMessage("Document updated successfully.");

      await fetchDocs();
      setEditingDocId(null);
    } catch (err) {
      setEditStatus("error");
      setEditMessage(err instanceof Error ? err.message : String(err));
    }
  };

  /* ---------------------------------------------------------------- */
  /* Delete                                                           */
  /* ---------------------------------------------------------------- */

  const deleteDoc = async (doc: VaultDocument) => {
    const confirmed = window.confirm(
      `Delete "${doc.name}"? This action will remove the document from your document list.`
    );

    if (!confirmed) return;

    setDeletingDocId(doc.id);
    setDeleteMessage("");
    setDeleteIsError(false);

    try {
      const res = await fetch(apiUrl(`/api/documents/${doc.id}/delete`), {
        method: "DELETE",
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        const status = res.status;

        let friendly = errData.error || `Delete failed with status ${status}`;

        if (status === 401) {
          friendly = "Unauthenticated: please log in.";
        } else if (status === 403) {
          friendly =
            "Forbidden: you do not have permission to delete this document.";
        } else if (status === 404) {
          friendly = "Document not found.";
        }

        throw new Error(friendly);
      }

      setDeleteMessage("Document deleted successfully.");
      await fetchDocs();
    } catch (err) {
      setDeleteIsError(true);
      setDeleteMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setDeletingDocId(null);
    }
  };

  /* ---------------------------------------------------------------- */
  /* Permissions                                                      */
  /* ---------------------------------------------------------------- */

  const fetchPermissions = async (docId: string) => {
    try {
      setPermLoading(true);

      const res = await fetch(apiUrl(`/api/documents/${docId}/permissions`), {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error ?? "Failed to fetch permissions");
      }

      setPermissions(data.permissions ?? []);
    } catch (err) {
      setPermissions([]);
      setPermMessage(err instanceof Error ? err.message : String(err));
      setPermStatus("error");
    } finally {
      setPermLoading(false);
    }
  };

  const openPerm = (docId: string) => {
    setPermDocId(docId);
    setPermUserId("");
    setPermRead(false);
    setPermEdit(false);
    setPermMessage("");
    setPermStatus("idle");
    setPermissions([]);
    fetchPermissions(docId);
  };

  const closePerm = () => {
    setPermDocId(null);
    setPermissions([]);
    setPermMessage("");
    setPermStatus("idle");
  };

  const grantPermission = async (docId: string) => {
    setPermStatus("saving");
    setPermMessage("");

    try {
      const res = await fetch(
        apiUrl(`/api/documents/${docId}/permissions/${permUserId}`),
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            can_read: permRead,
            can_edit: permEdit,
          }),
        }
      );

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        const status = res.status;

        let friendly = errData.error || `Permission update failed ${status}`;

        if (status === 401) {
          friendly = "Unauthenticated: please log in.";
        } else if (status === 403) {
          friendly =
            "Forbidden: you do not have permission to manage permissions.";
        } else if (status === 404) {
          friendly = "Document or user not found.";
        }

        throw new Error(friendly);
      }

      setPermStatus("success");
      setPermMessage("Permissions updated successfully.");
      setPermUserId("");
      setPermRead(false);
      setPermEdit(false);

      await fetchDocs();
      await fetchPermissions(docId);
    } catch (err) {
      setPermStatus("error");
      setPermMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const revokePermission = async (docId: string, userId: string) => {
    setPermStatus("saving");
    setPermMessage("");

    try {
      const res = await fetch(
        apiUrl(`/api/documents/${docId}/permissions/${userId}`),
        {
          method: "DELETE",
        }
      );

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        const status = res.status;

        let friendly = errData.error || `Revoke failed ${status}`;

        if (status === 401) {
          friendly = "Unauthenticated: please log in.";
        } else if (status === 403) {
          friendly =
            "Forbidden: you do not have permission to manage permissions.";
        } else if (status === 404) {
          friendly = "Document or user not found.";
        }

        throw new Error(friendly);
      }

      setPermStatus("success");
      setPermMessage("Permission revoked successfully.");

      await fetchDocs();
      await fetchPermissions(docId);
    } catch (err) {
      setPermStatus("error");
      setPermMessage(err instanceof Error ? err.message : String(err));
    }
  };

  // Toggle an existing user between "Read only" and "Can edit".
  const changePermission = async (docId: string, perm: Permission) => {
    setPermStatus("saving");
    setPermMessage("");

    try {
      const res = await fetch(
        apiUrl(`/api/documents/${docId}/permissions/${perm.user_id}`),
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            can_read: true,
            can_edit: !perm.can_edit,
          }),
        }
      );

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        const status = res.status;

        let friendly = errData.error || `Permission update failed ${status}`;

        if (status === 401) {
          friendly = "Unauthenticated: please log in.";
        } else if (status === 403) {
          friendly =
            "Forbidden: you do not have permission to manage permissions.";
        } else if (status === 404) {
          friendly = "Document or user not found.";
        }

        throw new Error(friendly);
      }

      setPermStatus("success");
      setPermMessage("Permissions updated successfully.");

      await fetchDocs();
      await fetchPermissions(docId);
    } catch (err) {
      setPermStatus("error");
      setPermMessage(err instanceof Error ? err.message : String(err));
    }
  };

  /* ---------------------------------------------------------------- */
  /* Derived data                                                     */
  /* ---------------------------------------------------------------- */

  const normalizedSearch = search.trim().toLowerCase();

  const filteredDocuments = documents.filter((doc) => {
    if (!normalizedSearch) return true;

    return (
      doc.name.toLowerCase().includes(normalizedSearch) ||
      doc.owner_id.toLowerCase().includes(normalizedSearch) ||
      (doc.category ?? "").toLowerCase().includes(normalizedSearch) ||
      doc.created_at.toLowerCase().includes(normalizedSearch)
    );
  });

  const isOwned = (doc: VaultDocument) =>
    !currentUserId || doc.owner_id === currentUserId;

  const allOwned = documents.filter(isOwned);
  const allShared = documents.filter((d) => !isOwned(d));
  const myDocs = filteredDocuments.filter(isOwned);
  const sharedDocs = filteredDocuments.filter((d) => !isOwned(d));

  const categoryCount = new Set(
    documents.map((d) => d.category).filter((c): c is string => !!c)
  ).size;

  const recentDocs = [...documents]
    .sort((a, b) => {
      const ta = new Date(a.created_at).getTime();
      const tb = new Date(b.created_at).getTime();
      if (Number.isNaN(ta) || Number.isNaN(tb)) {
        return b.created_at.localeCompare(a.created_at);
      }
      return tb - ta;
    })
    .slice(0, 5);

  const editingDoc = documents.find((d) => d.id === editingDocId);
  const permDoc = documents.find((d) => d.id === permDocId);

  const accessBadge = (doc: VaultDocument) => {
    if (!currentUserId) {
      return (
        <span className="tv-badge bg-slate-100 text-slate-600 ring-slate-200">
          Member
        </span>
      );
    }
    return doc.owner_id === currentUserId ? (
      <span className="tv-badge bg-indigo-50 text-indigo-700 ring-indigo-200">
        Owner
      </span>
    ) : (
      <span className="tv-badge bg-violet-50 text-violet-700 ring-violet-200">
        Shared
      </span>
    );
  };

  const permAccessPreview = permEdit
    ? { label: "Can edit", style: "bg-indigo-50 text-indigo-700 ring-indigo-200" }
    : permRead
      ? { label: "Can view", style: "bg-slate-100 text-slate-700 ring-slate-200" }
      : { label: "No access", style: "bg-slate-50 text-slate-500 ring-slate-200" };

  /* ---------------------------------------------------------------- */
  /* Rendering helpers                                                */
  /* ---------------------------------------------------------------- */

  const renderRows = (rows: VaultDocument[], label: string) => (
    <div role="table" aria-label={label}>
      <div
        role="row"
        className={`hidden gap-4 border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-xs font-medium text-slate-500 md:grid ${GRID_COLS}`}
      >
        <div role="columnheader">Document</div>
        <div role="columnheader">Owner</div>
        <div role="columnheader">Created</div>
        <div role="columnheader">Access</div>
        <div role="columnheader" className="text-right">
          Actions
        </div>
      </div>

      <div role="rowgroup" className="divide-y divide-slate-200">
        {rows.map((doc) => (
          <div
            role="row"
            key={doc.id}
            className={`grid gap-3 px-4 py-4 transition-colors hover:bg-slate-50/70 md:items-center md:gap-4 ${GRID_COLS}`}
          >
            {/* Document */}
            <div role="cell" className="flex min-w-0 items-start gap-3">
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-indigo-50 text-indigo-600">
                <FileIcon className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p
                  className="truncate text-sm font-medium text-slate-900"
                  title={doc.name}
                >
                  {doc.name}
                </p>
                <p className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
                  <TagIcon className="h-4 w-4 shrink-0 text-slate-400" />
                  <span className="truncate">
                    {doc.category ?? "No category"}
                  </span>
                </p>
              </div>
            </div>

            {/* Owner */}
            <div
              role="cell"
              className="flex min-w-0 items-center justify-between gap-3 text-sm text-slate-600 md:justify-start"
            >
              <span className="text-xs text-slate-500 md:hidden">Owner</span>
              {currentUserId && doc.owner_id === currentUserId ? (
                <span>You</span>
              ) : (
                <span
                  className="truncate font-mono text-xs"
                  title={doc.owner_id}
                >
                  {shortId(doc.owner_id)}
                </span>
              )}
            </div>

            {/* Created */}
            <div
              role="cell"
              className="flex items-center justify-between gap-3 text-sm text-slate-600 md:justify-start"
            >
              <span className="text-xs text-slate-500 md:hidden">Created</span>
              <time dateTime={doc.created_at} title={doc.created_at}>
                {formatDate(doc.created_at)}
              </time>
            </div>

            {/* Access */}
            <div
              role="cell"
              className="flex items-center justify-between gap-3 md:justify-start"
            >
              <span className="text-xs text-slate-500 md:hidden">Access</span>
              {accessBadge(doc)}
            </div>

            {/* Actions */}
            <div
              role="cell"
              className="flex flex-wrap items-center gap-1 border-t border-slate-100 pt-3 md:justify-end md:border-0 md:pt-0"
            >
              <button
                type="button"
                onClick={() => downloadDoc(doc)}
                title="Download"
                className="tv-action"
              >
                <DownloadIcon className="h-5 w-5" />
                <span className="md:sr-only">Download</span>
              </button>

              <button
                type="button"
                onClick={() => openEdit(doc)}
                title="Edit"
                className="tv-action"
              >
                <PencilIcon className="h-5 w-5" />
                <span className="md:sr-only">Edit</span>
              </button>

              <button
                type="button"
                onClick={() => openPerm(doc.id)}
                title="Manage Permissions"
                className="tv-action"
              >
                <KeyIcon className="h-5 w-5" />
                <span className="md:sr-only">Manage Permissions</span>
              </button>

              <button
                type="button"
                onClick={() => deleteDoc(doc)}
                disabled={deletingDocId === doc.id}
                title="Delete"
                className="tv-action tv-action-danger"
              >
                {deletingDocId === doc.id ? (
                  <Spinner className="h-5 w-5" />
                ) : (
                  <TrashIcon className="h-5 w-5" />
                )}
                <span className="md:sr-only">
                  {deletingDocId === doc.id ? "Deleting..." : "Delete"}
                </span>
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const sectionHeader = (
    title: string,
    description: string,
    count: number | null
  ) => (
    <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        {count !== null && (
          <span className="tv-badge bg-slate-100 text-slate-600 ring-slate-200">
            {count}
          </span>
        )}
      </div>
      <p className="text-sm text-slate-500">{description}</p>
    </div>
  );

  const noMatches = (
    <EmptyState
      icon={<SearchIcon className="h-6 w-6" />}
      title="No matching documents"
      description="No documents match your search. Try a different name, owner, category or date."
      action={
        <button
          type="button"
          onClick={() => setSearch("")}
          className="tv-btn tv-btn-secondary"
        >
          Clear search
        </button>
      }
    />
  );

  const chooseFileButton = (
    <button
      type="button"
      onClick={() => inputRef.current?.click()}
      className="tv-btn tv-btn-primary"
    >
      <UploadIcon className="h-4 w-4" />
      Choose file
    </button>
  );

  const metrics = [
    { label: "Total documents", value: documents.length, icon: FileIcon },
    { label: "In My Vault", value: allOwned.length, icon: VaultIcon },
    { label: "Shared with me", value: allShared.length, icon: UsersIcon },
    { label: "Categories", value: categoryCount, icon: TagIcon },
  ];

  /* ---------------------------------------------------------------- */
  /* Render                                                           */
  /* ---------------------------------------------------------------- */

  return (
    <div className="space-y-8">
      {/* Summary metrics */}
      <section aria-label="Summary">
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200 shadow-sm lg:grid-cols-4">
          {metrics.map(({ label, value, icon: Icon }) => (
            <div key={label} className="bg-white p-4 sm:p-5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm text-slate-500">{label}</p>
                <Icon className="h-5 w-5 shrink-0 text-slate-400" />
              </div>
              <p className="mt-2 text-2xl font-semibold tabular-nums text-slate-900">
                {loading ? "–" : value}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Upload */}
      <section id="upload" className="tv-card scroll-mt-24">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-900">
            Upload Document
          </h2>
          <p className="mt-0.5 text-sm text-slate-500">
            Select a file to upload to your secure vault.
          </p>
        </div>

        <div className="p-5">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              if (uploadStatus !== "uploading") setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            className={`flex flex-col items-center rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors sm:px-6 ${
              dragging
                ? "border-indigo-400 bg-indigo-50"
                : "border-slate-300 bg-slate-50"
            }`}
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-indigo-600 shadow-sm ring-1 ring-slate-200">
              <UploadIcon className="h-6 w-6" />
            </span>
            <p className="mt-3 text-sm font-medium text-slate-900">
              Drag and drop a file here
            </p>
            <p className="mt-1 text-sm text-slate-500">or</p>
            <div className="mt-3">
              <input
                ref={inputRef}
                id="vault-file"
                type="file"
                tabIndex={-1}
                disabled={uploadStatus === "uploading"}
                onChange={(e) => selectFile(e.target.files?.[0] ?? null)}
                className="sr-only"
              />
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={uploadStatus === "uploading"}
                className="tv-btn tv-btn-secondary"
              >
                Choose file
              </button>
            </div>
            <p className="mt-4 text-xs text-slate-500">
              Common document and image formats, up to 10 MB per file.
            </p>
          </div>

          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 flex-1">
              {file ? (
                <div className="flex min-w-0 items-center gap-3 rounded-md border border-slate-200 bg-white px-3 py-2">
                  <FileIcon className="h-5 w-5 shrink-0 text-indigo-600" />
                  <div className="min-w-0 flex-1">
                    <p
                      className="truncate text-sm font-medium text-slate-900"
                      title={file.name}
                    >
                      {file.name}
                    </p>
                    <p className="text-xs text-slate-500">
                      {formatBytes(file.size)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={clearFile}
                    disabled={uploadStatus === "uploading"}
                    aria-label="Remove selected file"
                    className="tv-icon-btn h-8 w-8"
                  >
                    <XIcon className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <p className="text-sm text-slate-500">No file selected.</p>
              )}
            </div>

            <button
              type="button"
              onClick={handleUpload}
              disabled={uploadStatus === "uploading"}
              className="tv-btn tv-btn-primary sm:w-32"
            >
              {uploadStatus === "uploading" ? (
                <>
                  <Spinner />
                  Uploading...
                </>
              ) : (
                "Upload"
              )}
            </button>
          </div>

          {uploadStatus === "uploading" && (
            <div
              className="mt-4 h-1.5 overflow-hidden rounded-full bg-slate-100"
              role="progressbar"
              aria-label="Uploading"
            >
              <div className="tv-indeterminate h-full w-1/4 rounded-full bg-indigo-600" />
            </div>
          )}

          {uploadMessage && (
            <div className="mt-4">
              <Notice tone={uploadStatus === "error" ? "error" : "success"}>
                {uploadMessage}
              </Notice>
            </div>
          )}
        </div>
      </section>

      {/* Action feedback */}
      {((editingDocId === null && editMessage) ||
        (permDocId === null && permMessage) ||
        (deletingDocId === null && deleteMessage)) && (
        <div className="space-y-2">
          {editingDocId === null && editMessage && (
            <Notice
              tone={editStatus === "error" ? "error" : "success"}
              onDismiss={() => setEditMessage("")}
            >
              {editMessage}
            </Notice>
          )}
          {permDocId === null && permMessage && (
            <Notice
              tone={permStatus === "error" ? "error" : "success"}
              onDismiss={() => setPermMessage("")}
            >
              {permMessage}
            </Notice>
          )}
          {deletingDocId === null && deleteMessage && (
            <Notice
              tone={deleteIsError ? "error" : "success"}
              onDismiss={() => setDeleteMessage("")}
            >
              {deleteMessage}
            </Notice>
          )}
        </div>
      )}

      {/* Search */}
      <div className="relative max-w-md">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, owner, category, or date"
          aria-label="Search documents"
          className="tv-input pl-9"
        />
      </div>

      {/* My Vault */}
      <section id="vault" className="scroll-mt-24">
        {sectionHeader(
          "My Vault",
          "Documents you own and manage.",
          loading || error ? null : myDocs.length
        )}

        <div className="tv-card overflow-hidden">
          {loading ? (
            <div className="divide-y divide-slate-200" aria-busy="true">
              <span className="sr-only">Loading documents...</span>
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-4">
                  <div className="h-9 w-9 animate-pulse rounded-md bg-slate-100 motion-reduce:animate-none" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 w-1/3 animate-pulse rounded bg-slate-100 motion-reduce:animate-none" />
                    <div className="h-3 w-1/5 animate-pulse rounded bg-slate-100 motion-reduce:animate-none" />
                  </div>
                </div>
              ))}
            </div>
          ) : error ? (
            <EmptyState
              icon={<AlertIcon className="h-6 w-6 text-red-500" />}
              title="Could not load documents"
              description={`Error: ${error}`}
              action={
                <button
                  type="button"
                  onClick={retryFetch}
                  className="tv-btn tv-btn-secondary"
                >
                  <RefreshIcon className="h-4 w-4" />
                  Try again
                </button>
              }
            />
          ) : myDocs.length > 0 ? (
            renderRows(myDocs, "My Vault documents")
          ) : normalizedSearch && allOwned.length > 0 ? (
            noMatches
          ) : (
            <EmptyState
              icon={<InboxIcon className="h-6 w-6" />}
              title="No documents yet"
              description="Upload your first document to start building your vault. Only you and people you grant access to can open it."
              action={chooseFileButton}
            />
          )}
        </div>
      </section>

      {/* Shared with me */}
      {currentUserId && (
        <section id="shared" className="scroll-mt-24">
          {sectionHeader(
            "Shared With Me",
            "Documents other people have given you access to.",
            loading || error ? null : sharedDocs.length
          )}

          <div className="tv-card overflow-hidden">
            {loading || error ? (
              <div className="px-4 py-6 text-sm text-slate-500">
                {loading ? "Loading..." : "Unavailable until documents load."}
              </div>
            ) : sharedDocs.length > 0 ? (
              renderRows(sharedDocs, "Documents shared with me")
            ) : normalizedSearch && allShared.length > 0 ? (
              noMatches
            ) : (
              <EmptyState
                icon={<UsersIcon className="h-6 w-6" />}
                title="Nothing shared with you"
                description="When someone grants you access to a document, it will appear here."
              />
            )}
          </div>
        </section>
      )}

      {/* Recent activity */}
      <section id="activity" className="scroll-mt-24">
        {sectionHeader(
          "Recent activity",
          "The latest documents added to your vault.",
          null
        )}

        <div className="tv-card overflow-hidden">
          {loading || error ? (
            <div className="px-4 py-6 text-sm text-slate-500">
              {loading ? "Loading..." : "Unavailable until documents load."}
            </div>
          ) : recentDocs.length > 0 ? (
            <ul className="divide-y divide-slate-200">
              {recentDocs.map((doc) => (
                <li
                  key={doc.id}
                  className="flex items-center gap-3 px-4 py-3"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                    <ClockIcon className="h-4 w-4" />
                  </span>
                  <p className="min-w-0 flex-1 text-sm text-slate-700">
                    <span className="font-medium text-slate-900">
                      {currentUserId && doc.owner_id === currentUserId
                        ? "You"
                        : shortId(doc.owner_id)}
                    </span>{" "}
                    added{" "}
                    <span className="break-words font-medium text-slate-900">
                      {doc.name}
                    </span>
                  </p>
                  <time
                    dateTime={doc.created_at}
                    className="shrink-0 text-xs text-slate-500"
                    title={doc.created_at}
                  >
                    {formatDate(doc.created_at)}
                  </time>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={<ClockIcon className="h-6 w-6" />}
              title="No recent activity"
              description="New uploads and shared documents will show up here as they happen."
              action={chooseFileButton}
            />
          )}
        </div>
      </section>

      {/* Edit dialog */}
      {editingDocId !== null && (
        <Modal
          title="Edit document"
          description={editingDoc?.name}
          onClose={cancelEdit}
        >
          <div className="space-y-4">
            <div>
              <label htmlFor="edit-name" className="tv-label">
                Document name
              </label>
              <input
                id="edit-name"
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="Document name"
                className="tv-input"
              />
            </div>

            <div>
              <label htmlFor="edit-category" className="tv-label">
                Category
              </label>
              <input
                id="edit-category"
                type="text"
                value={editCategory}
                onChange={(e) => setEditCategory(e.target.value)}
                placeholder="Category"
                className="tv-input"
              />
              <p className="mt-1.5 text-xs text-slate-500">
                Optional. Leave empty to remove the category.
              </p>
            </div>

            {editMessage && (
              <Notice tone={editStatus === "error" ? "error" : "success"}>
                {editMessage}
              </Notice>
            )}
          </div>

          <div className="mt-6 flex justify-end gap-2">
            <button
              type="button"
              onClick={cancelEdit}
              className="tv-btn tv-btn-secondary"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => saveEdit(editingDocId)}
              disabled={editStatus === "saving"}
              className="tv-btn tv-btn-primary"
            >
              {editStatus === "saving" ? "Saving..." : "Save"}
            </button>
          </div>
        </Modal>
      )}

      {/* Permissions dialog */}
      {permDocId !== null && (
        <Modal
          title="Manage access"
          description={permDoc?.name}
          onClose={closePerm}
        >
          <div className="space-y-5">
            {/* Current access */}
            <section aria-labelledby="perm-current-title">
              <h4
                id="perm-current-title"
                className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500"
              >
                Current access
              </h4>

              {permLoading ? (
                <div className="flex items-center gap-2 text-sm text-slate-500">
                  <Spinner className="h-4 w-4" />
                  Loading access...
                </div>
              ) : permissions.length > 0 ? (
                <ul className="space-y-2">
                  {permissions.map((p) => (
                    <li
                      key={p.user_id}
                      className="flex flex-wrap items-center gap-3 rounded-md border border-slate-200 bg-slate-50 p-3"
                    >
                      <Avatar label={p.full_name || p.user_id} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-900">
                          {p.full_name || "Unnamed user"}
                        </p>
                        <p
                          className="truncate font-mono text-xs text-slate-500"
                          title={p.user_id}
                        >
                          {p.user_id}
                        </p>
                      </div>
                      <span
                        className={`tv-badge ${
                          p.can_edit
                            ? "bg-indigo-50 text-indigo-700 ring-indigo-200"
                            : "bg-slate-100 text-slate-700 ring-slate-200"
                        }`}
                      >
                        {p.can_edit ? "Can edit" : "Read only"}
                      </span>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => changePermission(permDocId, p)}
                          disabled={permStatus === "saving"}
                          title={`Switch to ${p.can_edit ? "Read only" : "Can edit"}`}
                          className="tv-btn tv-btn-secondary"
                        >
                          Change
                        </button>
                        <button
                          type="button"
                          onClick={() => revokePermission(permDocId, p.user_id)}
                          disabled={permStatus === "saving"}
                          className="tv-btn tv-btn-danger"
                        >
                          Revoke
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-slate-500">
                  No one else has access to this document yet.
                </p>
              )}
            </section>

            <h4 className="border-t border-slate-200 pt-5 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Grant new access
            </h4>

            <div>
              <label htmlFor="perm-user" className="tv-label">
                User ID
              </label>
              <input
                id="perm-user"
                type="text"
                value={permUserId}
                onChange={(e) => setPermUserId(e.target.value)}
                placeholder="User ID"
                autoComplete="off"
                spellCheck={false}
                className="tv-input font-mono"
              />
              <p className="mt-1.5 text-xs text-slate-500">
                Enter the ID of the person you want to grant access to.
              </p>
            </div>

            {permUserId.trim() && (
              <div className="flex items-center gap-3 rounded-md border border-slate-200 bg-slate-50 p-3">
                <Avatar label={permUserId.trim()} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-900">
                    Selected user
                  </p>
                  <p
                    className="truncate font-mono text-xs text-slate-500"
                    title={permUserId.trim()}
                  >
                    {permUserId.trim()}
                  </p>
                </div>
                <span className={`tv-badge ${permAccessPreview.style}`}>
                  {permAccessPreview.label}
                </span>
              </div>
            )}

            <fieldset>
              <legend className="tv-label">Access level</legend>
              <div className="space-y-2">
                <label className="flex cursor-pointer items-start gap-3 rounded-md border border-slate-200 p-3 has-[:checked]:border-indigo-300 has-[:checked]:bg-indigo-50/50">
                  <input
                    type="checkbox"
                    checked={permRead}
                    onChange={(e) => setPermRead(e.target.checked)}
                    className="mt-0.5 h-4 w-4 accent-indigo-600"
                  />
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 text-sm font-medium text-slate-900">
                      <EyeIcon className="h-4 w-4 text-slate-500" />
                      Can view
                    </span>
                    <span className="mt-0.5 block text-xs text-slate-500">
                      Read access: open and download this document.
                    </span>
                  </span>
                </label>

                <label className="flex cursor-pointer items-start gap-3 rounded-md border border-slate-200 p-3 has-[:checked]:border-indigo-300 has-[:checked]:bg-indigo-50/50">
                  <input
                    type="checkbox"
                    checked={permEdit}
                    onChange={(e) => setPermEdit(e.target.checked)}
                    className="mt-0.5 h-4 w-4 accent-indigo-600"
                  />
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 text-sm font-medium text-slate-900">
                      <PencilIcon className="h-4 w-4 text-slate-500" />
                      Can edit
                    </span>
                    <span className="mt-0.5 block text-xs text-slate-500">
                      Edit access: change this document&apos;s details.
                    </span>
                  </span>
                </label>
              </div>
            </fieldset>

            {permMessage && (
              <Notice tone={permStatus === "error" ? "error" : "success"}>
                {permMessage}
              </Notice>
            )}
          </div>

          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <button
                type="button"
                onClick={closePerm}
                className="tv-btn tv-btn-secondary"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => grantPermission(permDocId)}
                disabled={permStatus === "saving"}
                className="tv-btn tv-btn-primary"
              >
                {permStatus === "saving" ? "Saving..." : "Grant Access"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
