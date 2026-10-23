import Link from 'next/link';

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-950 text-white">
      {/* Header */}
      <header className="border-b border-white/10">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 font-bold text-lg">
              T
            </div>
            <span className="text-xl font-semibold tracking-tight">
              TrustVault
            </span>
          </div>

          <nav className="hidden items-center gap-8 text-sm text-slate-300 md:flex">
            <a href="#how-it-works" className="hover:text-white">
              How it works
            </a>
            <a href="#security" className="hover:text-white">
              Security
            </a>
            <a href="#about" className="hover:text-white">
              About
            </a>
          </nav>

                    <Link href="/login"><button className="rounded-lg border border-white/15 px-4 py-2 text-sm font-medium hover:bg-white/10">Sign in</button></Link>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-6 pb-24 pt-24">
        <div className="max-w-3xl">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-blue-400/20 bg-blue-400/10 px-4 py-2 text-sm text-blue-300">
            <span className="h-2 w-2 rounded-full bg-blue-400" />
            Trust, verified
          </div>

          <h1 className="text-5xl font-bold leading-tight tracking-tight sm:text-6xl">
            Build trust with
            <span className="block text-blue-400">proof, not promises.</span>
          </h1>

          <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-400">
            TrustVault helps people verify, organize, and share trustworthy
            information in one secure place.
          </p>

          <div className="mt-8 flex flex-col gap-4 sm:flex-row">
            <button className="rounded-xl bg-blue-600 px-6 py-3 font-semibold hover:bg-blue-500">
              Get started
            </button>

            <button className="rounded-xl border border-white/15 px-6 py-3 font-semibold text-slate-200 hover:bg-white/10">
              Explore TrustVault
            </button>
          </div>
        </div>
      </section>

      {/* Trust cards */}
      <section
        id="how-it-works"
        className="border-y border-white/10 bg-slate-900/50"
      >
        <div className="mx-auto grid max-w-6xl gap-6 px-6 py-16 md:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
            <div className="mb-5 text-2xl">✓</div>
            <h2 className="text-xl font-semibold">Verify</h2>
            <p className="mt-3 leading-7 text-slate-400">
              Check information and establish confidence before you trust it.
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
            <div className="mb-5 text-2xl">🔐</div>
            <h2 className="text-xl font-semibold">Protect</h2>
            <p className="mt-3 leading-7 text-slate-400">
              Keep important trust information organized and protected.
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
            <div className="mb-5 text-2xl">↗</div>
            <h2 className="text-xl font-semibold">Share</h2>
            <p className="mt-3 leading-7 text-slate-400">
              Share the right proof with the right people when it matters.
            </p>
          </div>
        </div>
      </section>

      {/* Security */}
      <section id="security" className="mx-auto max-w-6xl px-6 py-20">
        <div className="rounded-3xl border border-blue-400/10 bg-blue-500/5 p-8 sm:p-12">
          <p className="text-sm font-semibold uppercase tracking-widest text-blue-400">
            TrustVault
          </p>

          <h2 className="mt-4 max-w-2xl text-3xl font-bold tracking-tight sm:text-4xl">
            One place for the information you need to trust.
          </h2>

          <p className="mt-5 max-w-2xl leading-7 text-slate-400">
            Designed around clarity, verification, and control — so trust
            becomes something you can understand and act on.
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer
        id="about"
        className="border-t border-white/10 px-6 py-8 text-center text-sm text-slate-500"
      >
        © 2026 TrustVault. Built for trustworthy decisions.
      </footer>
    </main>
  );
}