"use client";

import { useEffect, useState } from "react";

interface Document {
  id: string;
  name: string;
  category: string | null;
  owner_id: string;
  created_at: string;
}

export default function DocumentList() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [search, setSearch] = useState<string>("");
  const [file, setFile] = useState<File | null>(null);
  const [uploadStatus, setUploadStatus] = useState<
    "idle" | "uploading" | "success" | "error"
  >("idle");
  const [uploadMessage, setUploadMessage] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [editingDocId, setEditingDocId] = useState<string | null>(null);
  const [editName, setEditName] = useState<string>("");
  const [editCategory, setEditCategory] = useState<string>("");
  const [editStatus, setEditStatus] = useState<
    "idle" | "saving" | "error" | "success"
  >("idle");
  const [editMessage, setEditMessage] = useState<string>("");

  const [permDocId, setPermDocId] = useState<string | null>(null);
  const [permUserId, setPermUserId] = useState<string>("");
  const [permRead, setPermRead] = useState<boolean>(false);
  const [permEdit, setPermEdit] = useState<boolean>(false);
  const [permStatus, setPermStatus] = useState<
    "idle" | "saving" | "error" | "success"
  >("idle");
  const [permMessage, setPermMessage] = useState<string>("");

  const fetchDocs = async () => {
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_BASE_URL || ""}/api/documents`,
        {
          method: "GET",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
        }
      );

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

  if (loading) {
    return <p className="mt-4 text-slate-400">Loading documents...</p>;
  }

  if (error) {
    return <p className="mt-4 text-red-400">Error: {error}</p>;
  }

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

  return (
    <section className="mx-auto max-w-6xl px-6 py-12">
      {/* Upload Document Section */}
      <div className="mb-6">
        <h2 className="mb-2 text-xl font-semibold">Upload Document</h2>

        <input
          type="file"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="mb-2 block w-full text-sm text-slate-300 file:mr-4 file:rounded file:border-0 file:bg-blue-600 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-blue-700"
        />

        <button
          onClick={async () => {
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

              const res = await fetch(
                `${process.env.NEXT_PUBLIC_BASE_URL || ""}/api/documents/upload`,
                {
                  method: "POST",
                  body: formData,
                }
              );

              if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(
                  errData.error || `Upload failed with status ${res.status}`
                );
              }

              setUploadStatus("success");
              setUploadMessage("Document uploaded successfully.");

              setTimeout(() => {
                window.location.reload();
              }, 1000);
            } catch (err) {
              setUploadStatus("error");
              setUploadMessage(
                err instanceof Error ? err.message : String(err)
              );
            }
          }}
          disabled={uploadStatus === "uploading"}
          className="rounded bg-emerald-600 px-4 py-2 text-white disabled:opacity-50"
        >
          {uploadStatus === "uploading" ? "Uploading..." : "Upload"}
        </button>

        {uploadMessage && (
          <p
            className={`mt-2 ${
              uploadStatus === "error" ? "text-red-400" : "text-green-400"
            }`}
          >
            {uploadMessage}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-2xl font-semibold">Your Documents</h2>

        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, owner, category, or date"
          className="w-full rounded border border-white/10 bg-slate-800 px-3 py-2 text-sm text-white placeholder:text-slate-500 sm:w-80"
        />
      </div>

      {filteredDocuments.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {filteredDocuments.map((doc) => (
            <li
              key={doc.id}
              className="rounded border border-white/10 p-3"
            >
              <div className="font-medium">{doc.name}</div>

              <div className="text-sm text-slate-400">
                Category: {doc.category ?? "None"}
              </div>

              <div className="text-xs text-slate-500">
                Owner: {doc.owner_id}
              </div>

              <div className="text-xs text-slate-500">
                Created: {doc.created_at}
              </div>

              <button
                onClick={async () => {
                  const res = await fetch(
                    `${process.env.NEXT_PUBLIC_BASE_URL || ""}/api/documents/${doc.id}/download`
                  );

                  if (!res.ok) {
                    const errData = await res.json().catch(() => ({}));
                    alert(
                      errData.error ||
                        `Download failed with status ${res.status}`
                    );
                    return;
                  }

                  const blob = await res.blob();
                  const url = window.URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = doc.name;
                  a.click();
                  window.URL.revokeObjectURL(url);
                }}
                className="mt-2 rounded bg-blue-600 px-3 py-1 text-sm text-white"
              >
                Download
              </button>

              {/* Edit */}
              {editingDocId === doc.id ? (
                <div className="mt-2 space-y-2">
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    placeholder="Document name"
                    className="w-full rounded border bg-slate-800 p-1 text-sm text-white"
                  />

                  <input
                    type="text"
                    value={editCategory}
                    onChange={(e) => setEditCategory(e.target.value)}
                    placeholder="Category"
                    className="w-full rounded border bg-slate-800 p-1 text-sm text-white"
                  />

                  <div className="flex gap-2">
                    <button
                      onClick={async () => {
                        setEditStatus("saving");
                        setEditMessage("");

                        try {
                          const res = await fetch(
                            `${process.env.NEXT_PUBLIC_BASE_URL || ""}/api/documents/${doc.id}`,
                            {
                              method: "PATCH",
                              headers: {
                                "Content-Type": "application/json",
                              },
                              body: JSON.stringify({
                                name: editName,
                                category: editCategory || null,
                              }),
                            }
                          );

                          if (!res.ok) {
                            const errData = await res.json().catch(() => ({}));
                            const status = res.status;

                            let friendly =
                              errData.error ||
                              `Update failed with status ${status}`;

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
                          setEditMessage(
                            err instanceof Error ? err.message : String(err)
                          );
                        }
                      }}
                      disabled={editStatus === "saving"}
                      className="rounded bg-emerald-600 px-3 py-1 text-white disabled:opacity-50"
                    >
                      {editStatus === "saving" ? "Saving..." : "Save"}
                    </button>

                    <button
                      onClick={() => {
                        setEditingDocId(null);
                        setEditMessage("");
                        setEditStatus("idle");
                      }}
                      className="rounded bg-slate-600 px-3 py-1 text-white"
                    >
                      Cancel
                    </button>
                  </div>

                  {editMessage && (
                    <p
                      className={`text-sm ${
                        editStatus === "error"
                          ? "text-red-400"
                          : "text-green-400"
                      }`}
                    >
                      {editMessage}
                    </p>
                  )}
                </div>
              ) : (
                <button
                  onClick={() => {
                    setEditingDocId(doc.id);
                    setEditName(doc.name);
                    setEditCategory(doc.category ?? "");
                    setEditMessage("");
                    setEditStatus("idle");
                  }}
                  className="mt-2 ml-2 rounded bg-amber-600 px-3 py-1 text-sm text-white"
                >
                  Edit
                </button>
              )}

              {/* Permission Management */}
              {permDocId === doc.id ? (
                <div className="mt-2 space-y-2">
                  <input
                    type="text"
                    value={permUserId}
                    onChange={(e) => setPermUserId(e.target.value)}
                    placeholder="User ID"
                    className="w-full rounded border bg-slate-800 p-1 text-sm text-white"
                  />

                  <label className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      checked={permRead}
                      onChange={(e) => setPermRead(e.target.checked)}
                      className="form-checkbox h-4 w-4 text-emerald-600"
                    />
                    <span className="text-white">Read</span>
                  </label>

                  <label className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      checked={permEdit}
                      onChange={(e) => setPermEdit(e.target.checked)}
                      className="form-checkbox h-4 w-4 text-emerald-600"
                    />
                    <span className="text-white">Edit</span>
                  </label>

                  <div className="flex gap-2">
                    <button
                      onClick={async () => {
                        setPermStatus("saving");
                        setPermMessage("");

                        try {
                          const res = await fetch(
                            `${process.env.NEXT_PUBLIC_BASE_URL || ""}/api/documents/${doc.id}/permissions/${permUserId}`,
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

                            let friendly =
                              errData.error ||
                              `Permission update failed ${status}`;

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
                          setPermDocId(null);
                        } catch (err) {
                          setPermStatus("error");
                          setPermMessage(
                            err instanceof Error ? err.message : String(err)
                          );
                        }
                      }}
                      disabled={permStatus === "saving"}
                      className="rounded bg-emerald-600 px-3 py-1 text-white disabled:opacity-50"
                    >
                      Grant/Update
                    </button>

                    <button
                      onClick={async () => {
                        setPermStatus("saving");
                        setPermMessage("");

                        try {
                          const res = await fetch(
                            `${process.env.NEXT_PUBLIC_BASE_URL || ""}/api/documents/${doc.id}/permissions/${permUserId}`,
                            { method: "DELETE" }
                          );

                          if (!res.ok) {
                            const errData = await res.json().catch(() => ({}));
                            const status = res.status;

                            let friendly =
                              errData.error ||
                              `Revoke failed ${status}`;

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
                          setPermDocId(null);
                        } catch (err) {
                          setPermStatus("error");
                          setPermMessage(
                            err instanceof Error ? err.message : String(err)
                          );
                        }
                      }}
                      disabled={permStatus === "saving"}
                      className="rounded bg-red-600 px-3 py-1 text-white disabled:opacity-50"
                    >
                      Revoke
                    </button>
                  </div>

                  {permMessage && (
                    <p
                      className={`text-sm ${
                        permStatus === "error"
                          ? "text-red-400"
                          : "text-green-400"
                      }`}
                    >
                      {permMessage}
                    </p>
                  )}
                </div>
              ) : (
                <button
                  onClick={() => {
                    setPermDocId(doc.id);
                    setPermUserId("");
                    setPermRead(false);
                    setPermEdit(false);
                    setPermMessage("");
                    setPermStatus("idle");
                  }}
                  className="mt-2 ml-2 rounded bg-indigo-600 px-3 py-1 text-sm text-white"
                >
                  Manage Permissions
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-slate-400">
          {search.trim()
            ? "No documents match your search."
            : "No documents found."}
        </p>
      )}
    </section>
  );
}