'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import {
  AlertIcon,
  AuditIcon,
  LockIcon,
  LogoMark,
  ShieldCheckIcon,
  UsersIcon,
  VaultDial,
} from '../_components/icons'
import { Spinner } from '../_components/ui'

const POINTS = [
  {
    icon: UsersIcon,
    title: 'Role-based access',
    body: 'Admins, owners and viewers each see only what they are permitted to.',
  },
  {
    icon: AuditIcon,
    title: 'Every action is audited',
    body: 'Allowed and denied requests are recorded for administrators to review.',
  },
  {
    icon: ShieldCheckIcon,
    title: 'Server-verified identity',
    body: 'Your role is resolved on the server, never from the browser.',
  },
]

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  async function handleLogin(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()

    if (isLoading) return

    const trimmedEmail = email.trim()
    if (!trimmedEmail || !password) {
      setErrorMessage('Please enter both your email and password.')
      return
    }

    setIsLoading(true)
    setErrorMessage(null)

    try {
      const supabase = createClient()
      const { error } = await supabase.auth.signInWithPassword({
        email: trimmedEmail,
        password,
      })

      if (error) {
        // Generic error message to prevent account enumeration attacks
        setErrorMessage('Invalid email or password. Please try again.')
        setIsLoading(false)
        return
      }

      // Successful login - redirect to dashboard and refresh router
      router.push('/dashboard')
      router.refresh()
    } catch {
      setErrorMessage('An unexpected error occurred. Please try again.')
      setIsLoading(false)
    }
  }

  return (
    <main className="flex min-h-screen bg-white">
      {/* Brand panel (desktop) */}
      <aside className="relative hidden w-[46%] max-w-2xl shrink-0 overflow-hidden bg-navy-950 text-white lg:flex lg:flex-col lg:justify-between lg:p-12 xl:p-16">
        <VaultDial className="pointer-events-none absolute -bottom-40 -right-40 h-[34rem] w-[34rem] text-indigo-300" />

        <Link href="/" className="relative inline-flex items-center gap-3">
          <LogoMark className="h-9 w-9" />
          <span className="text-lg font-semibold tracking-tight">TrustVault</span>
        </Link>

        <div className="relative max-w-md">
          <h2 className="text-4xl font-semibold leading-tight tracking-tight">
            Documents stay private. Access stays accountable.
          </h2>
          <p className="mt-4 text-base leading-7 text-slate-300">
            A secure vault for the files that matter, with permissions you
            control and a complete record of who did what.
          </p>

          <ul className="mt-10 space-y-6">
            {POINTS.map(({ icon: Icon, title, body }) => (
              <li key={title} className="flex gap-4">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-white/5 text-violet-300 ring-1 ring-inset ring-white/10">
                  <Icon className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-white">{title}</p>
                  <p className="mt-0.5 text-sm leading-6 text-slate-400">{body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-sm text-slate-500">
          &copy; 2026 TrustVault
        </p>
      </aside>

      {/* Authentication */}
      <section className="flex min-h-screen flex-1 flex-col items-center justify-center bg-slate-50 px-4 py-12 sm:px-6">
        <div className="w-full max-w-sm">
          <Link
            href="/"
            className="mb-8 inline-flex items-center gap-3 lg:hidden"
          >
            <LogoMark className="h-9 w-9" />
            <span className="text-lg font-semibold tracking-tight text-slate-900">
              TrustVault
            </span>
          </Link>

          <div className="tv-card p-6 sm:p-8">
            <div className="hidden lg:block">
              <LogoMark className="h-10 w-10" />
            </div>

            <h1 className="text-2xl font-semibold tracking-tight text-slate-900 lg:mt-5">
              Welcome back
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Sign in to your vault to access your protected documents.
            </p>

            {errorMessage && (
              <div
                role="alert"
                className="mt-6 flex gap-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"
              >
                <AlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                <span>{errorMessage}</span>
              </div>
            )}

            <form onSubmit={handleLogin} noValidate className="mt-6 space-y-5">
              <div>
                <label htmlFor="email" className="tv-label">
                  Email address
                </label>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  disabled={isLoading}
                  aria-invalid={errorMessage ? true : undefined}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  className="tv-input"
                />
              </div>

              <div>
                <label htmlFor="password" className="tv-label">
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  disabled={isLoading}
                  aria-invalid={errorMessage ? true : undefined}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="tv-input"
                />
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="tv-btn tv-btn-primary h-10 w-full"
              >
                {isLoading ? (
                  <>
                    <Spinner />
                    Signing in...
                  </>
                ) : (
                  'Sign in'
                )}
              </button>
            </form>
          </div>

          <p className="mt-6 flex items-center justify-center gap-2 text-xs text-slate-500">
            <LockIcon className="h-4 w-4" />
            Protected by server-side access control
          </p>
          <div className="mt-3 text-center text-sm">
            <Link
              href="/"
              className="text-slate-500 transition-colors hover:text-slate-900"
            >
              Back to TrustVault
            </Link>
          </div>
        </div>
      </section>
    </main>
  )
}
