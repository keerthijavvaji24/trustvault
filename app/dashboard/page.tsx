import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export const instant = false

export default async function DashboardPage() {
  const supabase = await createClient()

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    redirect('/login')
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      {/* Header */}
      <header className="border-b border-white/10">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600 font-bold text-sm">
              T
            </div>
            <span className="text-lg font-semibold tracking-tight">TrustVault</span>
          </div>

          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-xs font-medium text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              Authenticated
            </span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <section className="mx-auto max-w-6xl px-6 py-12">
        <div className="max-w-2xl">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Dashboard</h1>
          <p className="mt-2 text-slate-400">
            Protected area verified on the server via Supabase Auth.
          </p>

          <div className="mt-8 rounded-2xl border border-white/10 bg-slate-900/50 p-6">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Authenticated Account
            </h2>
            <p className="mt-2 text-xl font-medium text-white">
              {user.email}
            </p>
            <p className="mt-4 text-xs text-slate-500">
              User ID: <span className="font-mono text-slate-400">{user.id}</span>
            </p>
          </div>

          <div className="mt-6 rounded-xl border border-blue-500/20 bg-blue-500/5 p-4 text-sm text-blue-300">
            This is a protected placeholder. Documents, permissions, roles, and secure storage will be implemented in subsequent steps.
          </div>
        </div>
      </section>
    </main>
  )
}
