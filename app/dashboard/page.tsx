import { redirect } from 'next/navigation'
import { getCurrentUserWithProfile } from '@/lib/auth/roles'
import DocumentList from './DocumentList'
import LogoutButton from './LogoutButton'
import AdminActivity from './AdminActivity'

export const instant = false

export default async function DashboardPage() {
  const authResult = await getCurrentUserWithProfile()

  if (authResult.status === 'unauthenticated') {
    redirect('/login')
  }

  const { user, profile, status, error: authError } = authResult

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      {/* Header */}
      <header className="border-b border-white/10">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600 font-bold text-sm">
              T
            </div>
            <span className="text-lg font-semibold tracking-tight">
              TrustVault
            </span>
          </div>

          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-xs font-medium text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              Authenticated
            </span>
            <LogoutButton />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <section className="mx-auto max-w-6xl px-6 py-12">
        <div className="max-w-2xl">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Dashboard
          </h1>

          <p className="mt-2 text-slate-400">
            Protected area with server-side role resolution from public.profiles.
          </p>

          {/* User & Role Information Card */}
          <div className="mt-8 rounded-2xl border border-white/10 bg-slate-900/50 p-6 space-y-6">
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Authenticated Account
              </h2>

              <p className="mt-1.5 text-xl font-medium text-white">
                {user.email || 'No email associated'}
              </p>

              <p className="mt-1 text-xs text-slate-500">
                User ID:{' '}
                <span className="font-mono text-slate-400">
                  {user.id}
                </span>
              </p>
            </div>

            <div className="border-t border-white/10 pt-5">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Application Role
              </h2>

              {status === 'success' && profile && (
                <div className="mt-2 flex items-center gap-3">
                  <span
                    className={`inline-flex items-center rounded-lg px-3 py-1 text-xs font-semibold uppercase tracking-wide ${
                      profile.role === 'admin'
                        ? 'border border-purple-400/30 bg-purple-500/10 text-purple-300'
                        : profile.role === 'owner'
                          ? 'border border-blue-400/30 bg-blue-500/10 text-blue-300'
                          : 'border border-slate-400/30 bg-slate-500/10 text-slate-300'
                    }`}
                  >
                    {profile.role}
                  </span>

                  {profile.fullName && (
                    <span className="text-sm text-slate-300">
                      ({profile.fullName})
                    </span>
                  )}
                </div>
              )}

              {status === 'profile_not_found' && (
                <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 text-sm text-amber-200">
                  <p className="font-semibold">Profile Not Found</p>

                  <p className="mt-1 text-xs leading-relaxed text-amber-300/90">
                    No profile record was found in{' '}
                    <code className="font-mono">public.profiles</code> for this
                    user ID. Access is restricted; no role is assumed.
                  </p>

                  {authError && (
                    <p className="mt-2 text-xs font-mono text-amber-400/80">
                      Details: {authError}
                    </p>
                  )}
                </div>
              )}

              {status === 'invalid_role' && (
                <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3.5 text-sm text-red-200">
                  <p className="font-semibold">Invalid Role Detected</p>

                  <p className="mt-1 text-xs leading-relaxed text-red-300/90">
                    The role stored in the database is not recognized. Expected
                    one of:{' '}
                    <code className="font-mono">admin</code>,{' '}
                    <code className="font-mono">owner</code>, or{' '}
                    <code className="font-mono">viewer</code>. No permissions
                    are granted.
                  </p>

                  {authError && (
                    <p className="mt-2 text-xs font-mono text-red-400/80">
                      Details: {authError}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="mt-6 rounded-xl border border-blue-500/20 bg-blue-500/5 p-4 text-sm leading-relaxed text-blue-300">
            The role displayed above is verified on the server directly from
            the database using your authenticated user ID. Client state,
            request parameters, and headers cannot override or manipulate this
            role.
          </div>
        </div>

        {/* Documents */}
        <DocumentList />

        {/* Admin-only activity */}
        {status === 'success' && profile?.role === 'admin' && (
          <AdminActivity />
        )}
      </section>
    </main>
  )
}