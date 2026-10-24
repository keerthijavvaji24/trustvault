"use client";

import { useEffect, useState } from 'react';

interface Document {
  id: string;
  name: string;
  category: string | null;
  created_at: string;
}

export default function DocumentList() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'uploading' | 'success' | 'error'>('idle');
  const [uploadMessage, setUploadMessage] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  // Editing state variables
  const [editingDocId, setEditingDocId] = useState<string | null>(null);
  const [editName, setEditName] = useState<string>('');
  const [editCategory, setEditCategory] = useState<string>('');
  const [editStatus, setEditStatus] = useState<'idle' | 'saving' | 'error' | 'success'>('idle');
  const [editMessage, setEditMessage] = useState<string>('');
  // Permission management state
  const [permDocId, setPermDocId] = useState<string | null>(null);
  const [permUserId, setPermUserId] = useState<string>('');
  const [permRead, setPermRead] = useState<boolean>(false);
  const [permEdit, setPermEdit] = useState<boolean>(false);
  const [permStatus, setPermStatus] = useState<'idle' | 'saving' | 'error' | 'success'>('idle');
  const [permMessage, setPermMessage] = useState<string>('');

  const fetchDocs = async () => {
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || ''}/api/documents`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
      });
      if (!res.ok) {
        throw new Error('Failed to fetch documents');
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

  return (
    <section className="mx-auto max-w-6xl px-6 py-12">
      {/* Upload Document Section */}
      <div className="mb-6">
        <h2 className="text-xl font-semibold mb-2">Upload Document</h2>
        <input
          type="file"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="mb-2 block w-full text-sm text-slate-300 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-blue-600 file:text-white hover:file:bg-blue-700"
        />
        <button
          onClick={async () => {
            if (!file) {
              setUploadMessage('Please select a file.');
              setUploadStatus('error');
              return;
            }
            setUploadStatus('uploading');
            setUploadMessage('');
            try {
              const formData = new FormData();
              formData.append('file', file);
              const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || ''}/api/documents/upload`, {
                method: 'POST',
                body: formData,
              });
              if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.error || `Upload failed with status ${res.status}`);
              }
              setUploadStatus('success');
              setUploadMessage('Document uploaded successfully.');
              setTimeout(() => {
                window.location.reload();
              }, 1000);
            } catch (err) {
              setUploadStatus('error');
              setUploadMessage(err instanceof Error ? err.message : String(err));
            }
          }}
          disabled={uploadStatus === 'uploading'}
          className="px-4 py-2 bg-emerald-600 text-white rounded disabled:opacity-50"
        >
          {uploadStatus === 'uploading' ? 'Uploading...' : 'Upload'}
        </button>
        {uploadMessage && (
          <p className={`mt-2 ${uploadStatus === 'error' ? 'text-red-400' : 'text-green-400'}`}>{uploadMessage}</p>
        )}
      </div>
      <h2 className="text-2xl font-semibold">Your Documents</h2>
      {documents.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {documents.map((doc) => (
            <li key={doc.id} className="border border-white/10 rounded p-3">
              <div className="font-medium">{doc.name}</div>
              <div className="text-sm text-slate-400">Category: {doc.category ?? 'None'}</div>
              <div className="text-xs text-slate-500">Created: {doc.created_at}</div>
              <button
                onClick={async () => {
                  const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || ''}/api/documents/${doc.id}/download`);
                  if (!res.ok) {
                    const errData = await res.json().catch(() => ({}));
                    alert(errData.error || `Download failed with status ${res.status}`);
                    return;
                  }
                  const blob = await res.blob();
                  const url = window.URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = doc.name;
                  a.click();
                  window.URL.revokeObjectURL(url);
                }}
                className="mt-2 px-3 py-1 bg-blue-600 text-white rounded text-sm"
              >
                Download
              </button>
                {/* Edit Button / Form */}
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
                          setEditStatus('saving');
                          setEditMessage('');
                          try {
                            const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || ''}/api/documents/${doc.id}`, {
                              method: 'PATCH',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ name: editName, category: editCategory || null }),
                            });
                            if (!res.ok) {
                              const errData = await res.json().catch(() => ({}));
                              const status = res.status;
                              let friendly = errData.error || `Update failed with status ${status}`;
                              if (status === 401) friendly = 'Unauthenticated: please log in.';
                              else if (status === 403) friendly = 'Forbidden: you do not have permission to edit this document.';
                              else if (status === 404) friendly = 'Document not found.';
                              throw new Error(friendly);
                            }
                            setEditStatus('success');
                            setEditMessage('Document updated successfully.');
                            await fetchDocs();
                            setEditingDocId(null);
                          } catch (err) {
                            setEditStatus('error');
                            setEditMessage(err instanceof Error ? err.message : String(err));
                          }
                        }}
                        disabled={editStatus === 'saving'}
                        className="px-3 py-1 bg-emerald-600 text-white rounded disabled:opacity-50"
                      >
                        {editStatus === 'saving' ? 'Saving...' : 'Save'}
                      </button>
                      <button
                        onClick={() => {
                          setEditingDocId(null);
                          setEditMessage('');
                          setEditStatus('idle');
                        }}
                        className="px-3 py-1 bg-slate-600 text-white rounded"
                      >
                        Cancel
                      </button>
                    </div>
                    {editMessage && (
                      <p className={`text-sm ${editStatus === 'error' ? 'text-red-400' : 'text-green-400'}`}>
                        {editMessage}
                      </p>
                    )}
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      setEditingDocId(doc.id);
                      setEditName(doc.name);
                      setEditCategory(doc.category ?? '');
                      setEditMessage('');
                      setEditStatus('idle');
                    }}
                    className="mt-2 ml-2 px-3 py-1 bg-amber-600 text-white rounded text-sm"
                  >
                    Edit
                  </button>
                )}
                {/* Permission Management UI */}
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
                          setPermStatus('saving');
                          setPermMessage('');
                          try {
                            const res = await fetch(
                              `${process.env.NEXT_PUBLIC_BASE_URL || ''}/api/documents/${doc.id}/permissions/${permUserId}`,
                              {
                                method: 'PUT',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ can_read: permRead, can_edit: permEdit }),
                              }
                            );
                            if (!res.ok) {
                              const errData = await res.json().catch(() => ({}));
                              const status = res.status;
                              let friendly = errData.error || `Permission update failed ${status}`;
                              if (status === 401) friendly = 'Unauthenticated: please log in.';
                              else if (status === 403) friendly = 'Forbidden: you do not have permission to manage permissions.';
                              else if (status === 404) friendly = 'Document or user not found.';
                              throw new Error(friendly);
                            }
                            setPermStatus('success');
                            setPermMessage('Permissions updated successfully.');
                            await fetchDocs();
                            setPermDocId(null);
                          } catch (err) {
                            setPermStatus('error');
                            setPermMessage(err instanceof Error ? err.message : String(err));
                          }
                        }}
                        disabled={permStatus === 'saving'}
                        className="px-3 py-1 bg-emerald-600 text-white rounded disabled:opacity-50"
                      >
                        {permStatus === 'saving' ? 'Grant/Update' : 'Grant/Update'}
                      </button>
                      <button
                        onClick={async () => {
                          setPermStatus('saving');
                          setPermMessage('');
                          try {
                            const res = await fetch(
                              `${process.env.NEXT_PUBLIC_BASE_URL || ''}/api/documents/${doc.id}/permissions/${permUserId}`,
                              { method: 'DELETE' }
                            );
                            if (!res.ok) {
                              const errData = await res.json().catch(() => ({}));
                              const status = res.status;
                              let friendly = errData.error || `Revoke failed ${status}`;
                              if (status === 401) friendly = 'Unauthenticated: please log in.';
                              else if (status === 403) friendly = 'Forbidden: you do not have permission to manage permissions.';
                              else if (status === 404) friendly = 'Document or user not found.';
                              throw new Error(friendly);
                            }
                            setPermStatus('success');
                            setPermMessage('Permission revoked successfully.');
                            await fetchDocs();
                            setPermDocId(null);
                          } catch (err) {
                            setPermStatus('error');
                            setPermMessage(err instanceof Error ? err.message : String(err));
                          }
                        }}
                        disabled={permStatus === 'saving'}
                        className="px-3 py-1 bg-red-600 text-white rounded disabled:opacity-50"
                      >
                        Revoke
                      </button>
                    </div>
                    {permMessage && (
                      <p className={`text-sm ${permStatus === 'error' ? 'text-red-400' : 'text-green-400'}`}>
                        {permMessage}
                      </p>
                    )}
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      setPermDocId(doc.id);
                      setPermUserId('');
                      setPermRead(false);
                      setPermEdit(false);
                      setPermMessage('');
                      setPermStatus('idle');
                    }}
                    className="mt-2 ml-2 px-3 py-1 bg-indigo-600 text-white rounded text-sm"
                  >
                    Manage Permissions
                  </button>
                )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-slate-400">No documents found.</p>
      )}
    </section>
  );
}
