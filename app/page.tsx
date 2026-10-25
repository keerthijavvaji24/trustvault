import Link from 'next/link';
import {
  LockIcon,
  LogoMark,
  ShieldCheckIcon,
  UsersIcon,
  VaultDial,
} from './_components/icons';

const FEATURES = [
  {
    icon: ShieldCheckIcon,
    title: 'Verify',
    body: 'Check information and establish confidence before you trust it.',
  },
  {
    icon: LockIcon,
    title: 'Protect',
    body: 'Keep important trust information organized and protected.',
  },
  {
    icon: UsersIcon,
    title: 'Share',
    body: 'Share the right proof with the right people when it matters.',
  },
];

export default function Home() {
  return (
    <main className="min-h-screen bg-navy-950 text-white">
      {/* Header */}
      <header className="border-b border-white/10">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <LogoMark className="h-9 w-9" />
            <span className="text-lg font-semibold tracking-tight">
              TrustVault
            </span>
          </div>

          <nav className="hidden items-center gap-8 text-sm text-slate-300 md:flex">
            <a href="#how-it-works" className="transition-colors hover:text-white">
              How it works
            </a>
            <a href="#security" className="transition-colors hover:text-white">
              Security
            </a>
            <a href="#about" className="transition-colors hover:text-white">
              About
            </a>
          </nav>

          <Link
            href="/login"
            className="tv-btn border border-white/20 text-white hover:bg-white/10 focus-visible:ring-offset-navy-950"
          >
            Sign in
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <VaultDial className="pointer-events-none absolute -right-48 top-1/2 hidden h-[40rem] w-[40rem] -translate-y-1/2 text-indigo-300 lg:block" />

        <div className="relative mx-auto max-w-6xl px-6 pb-24 pt-20 sm:pt-28">
          <div className="max-w-2xl">
            <h1 className="text-4xl font-semibold leading-tight tracking-tight sm:text-6xl">
              Build trust with proof, not promises.
            </h1>

            <p className="mt-6 max-w-xl text-lg leading-8 text-slate-300">
              TrustVault helps people verify, organize, and share trustworthy
              information in one secure place.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/login"
                className="tv-btn tv-btn-primary h-11 px-6 focus-visible:ring-offset-navy-950"
              >
                Get started
              </Link>

              <a
                href="#how-it-works"
                className="tv-btn h-11 border border-white/20 px-6 text-slate-100 hover:bg-white/10 focus-visible:ring-offset-navy-950"
              >
                Explore TrustVault
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section
        id="how-it-works"
        className="scroll-mt-4 border-y border-white/10 bg-navy-900"
      >
        <div className="mx-auto grid max-w-6xl gap-px px-6 py-16 md:grid-cols-3 md:gap-10">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <div key={title} className="flex gap-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-white/5 text-violet-300 ring-1 ring-inset ring-white/10">
                <Icon className="h-5 w-5" />
              </span>
              <div>
                <h2 className="text-lg font-semibold">{title}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-400">{body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Security */}
      <section id="security" className="mx-auto max-w-6xl scroll-mt-4 px-6 py-20">
        <div className="rounded-lg border border-white/10 bg-white/[0.03] p-8 sm:p-12">
          <h2 className="max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">
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
