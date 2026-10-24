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
      <h2 className="text-2xl font-semibold">Your Documents</h2>
      {documents.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {documents.map((doc) => (
            <li key={doc.id} className="border border-white/10 rounded p-3">
              <div className="font-medium">{doc.name}</div>
              <div className="text-sm text-slate-400">Category: {doc.category ?? 'None'}</div>
              <div className="text-xs text-slate-500">Created: {doc.created_at}</div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-slate-400">No documents found.</p>
      )}
    </section>
  );
}
