import { redirect } from 'next/navigation'
import { getCurrentUserWithProfile } from '@/lib/auth/roles'
import AppShell from './AppShell'
import DocumentList from './DocumentList'
import AdminActivity from './AdminActivity'
import { AlertIcon, ShieldCheckIcon } from '../_components/icons'
import { RoleBadge } from '../_components/ui'

export const instant = false

export default async function DashboardPage() {
  const authResult = await getCurrentUserWithProfile()

  if (authResult.status === 'unauthenticated') {
    redirect('/login')
  }

  const { user, profile, status, error: authError } = authResult

  const hasProfile = status === 'success' && !!profile
  const role: string | null = hasProfile ? profile.role : null
  const fullName: string | null = hasProfile ? (profile.fullName ?? null) : null
  const isAdmin = status === 'success' && profile?.role === 'admin'

  return (
    <AppShell
      email={user.email ?? ''}
      fullName={fullName}
      role={role}
      isAdmin={isAdmin}
    >
      <div className="mx-auto w-full max-w-6xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
        {/* Page heading */}
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
            Dashboard
          </h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">
            Upload, share and review the documents in your vault. Every request
            is checked against your role on the server.
          </p>
        </div>

        {/* Role resolution problems */}
        {status === 'profile_not_found' && (
          <div
            role="alert"
            className="flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
          >
            <AlertIcon className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <div className="min-w-0">
              <p className="font-semibold">Profile Not Found</p>
              <p className="mt-1 leading-6 text-amber-800">
                No profile record was found in{' '}
                <code className="font-mono text-xs">public.profiles</code> for
                this user ID. Access is restricted; no role is assumed.
              </p>
              {authError && (
                <p className="mt-2 break-words font-mono text-xs text-amber-700">
                  Details: {authError}
                </p>
              )}
            </div>
          </div>
        )}

        {status === 'invalid_role' && (
          <div
            role="alert"
            className="flex gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900"
          >
            <AlertIcon className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
            <div className="min-w-0">
              <p className="font-semibold">Invalid Role Detected</p>
              <p className="mt-1 leading-6 text-red-800">
                The role stored in the database is not recognized. Expected one
                of: <code className="font-mono text-xs">admin</code>,{' '}
                <code className="font-mono text-xs">owner</code>, or{' '}
                <code className="font-mono text-xs">viewer</code>. No
                permissions are granted.
              </p>
              {authError && (
                <p className="mt-2 break-words font-mono text-xs text-red-700">
                  Details: {authError}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Metrics, upload, documents, shared, recent activity */}
        <DocumentList currentUserId={user.id} />

        {/* Admin-only activity */}
        {isAdmin && <AdminActivity />}

        {/* Session details */}
        <section className="tv-card" aria-labelledby="session-heading">
          <div className="flex items-center gap-3 border-b border-slate-200 px-5 py-4">
            <span className="flex h-9 w-9 items-center justify-center rounded-md bg-indigo-50 text-indigo-600">
              <ShieldCheckIcon className="h-5 w-5" />
            </span>
            <div>
              <h2
                id="session-heading"
                className="text-base font-semibold text-slate-900"
              >
                Session and access
              </h2>
              <p className="text-sm text-slate-500">
                Details of the account signed in on this device.
              </p>
            </div>
          </div>

          <dl className="grid gap-x-8 gap-y-5 px-5 py-5 sm:grid-cols-2">
            <div className="min-w-0">
              <dt className="text-sm font-medium text-slate-500">
                Authenticated Account
              </dt>
              <dd className="mt-1 break-words text-sm font-medium text-slate-900">
                {user.email || 'No email associated'}
              </dd>
              <dd className="mt-1 break-all text-xs text-slate-500">
                User ID:{' '}
                <span className="font-mono text-slate-600">{user.id}</span>
              </dd>
            </div>

            <div>
              <dt className="text-sm font-medium text-slate-500">
                Application Role
              </dt>
              <dd className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                {role ? (
                  <>
                    <RoleBadge role={role} />
                    {fullName && (
                      <span className="text-slate-600">({fullName})</span>
                    )}
                  </>
                ) : (
                  <span className="text-slate-500">No role assigned</span>
                )}
              </dd>
            </div>
          </dl>

          <p className="border-t border-slate-200 bg-slate-50 px-5 py-3 text-sm leading-6 text-slate-600">
            The role shown here is verified on the server directly from the
            database using your authenticated user ID. Client state, request
            parameters, and headers cannot override or manipulate it.
          </p>
        </section>
      </div>
    </AppShell>
  )
}
