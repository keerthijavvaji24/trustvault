"use client";

import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import { LogoutIcon } from '../_components/icons';

export default function LogoutButton({
  variant = 'sidebar',
}: {
  variant?: 'sidebar' | 'header';
}) {
  const router = useRouter();
  const supabase = createClient();

  const handleLogout = async () => {
    try {
      await supabase.auth.signOut();
      router.push('/login');
    } catch (error) {
      console.error('Logout failed', error);
      alert('Logout failed');
    }
  };

  if (variant === 'header') {
    return (
      <button
        type="button"
        onClick={handleLogout}
        title="Sign out"
        aria-label="Sign out"
        className="tv-icon-btn"
      >
        <LogoutIcon className="h-5 w-5" />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      className="tv-btn h-9 w-full border border-white/15 text-slate-200 hover:bg-white/10 hover:text-white focus-visible:ring-offset-navy-950"
    >
      <LogoutIcon className="h-4 w-4" />
      Logout
    </button>
  );
}
