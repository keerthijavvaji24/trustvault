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

  useEffect(() => {
    async function fetchDocs() {
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
    }
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
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-slate-400">No documents found.</p>
      )}
    </section>
  );
}
