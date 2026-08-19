'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';

const LINKS = [
  { href: '/', label: 'Fleet' },
  { href: '/incidents', label: 'Incidents' },
  { href: '/audit', label: 'Audit' },
];

function ThemeToggle() {
  // null until the user toggles: avoids reading the DOM during render/hydration.
  const [theme, setTheme] = useState<string | null>(null);

  const toggle = () => {
    const current =
      document.documentElement.getAttribute('data-theme') ??
      (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem('sm-theme', next);
    } catch {
      // private mode
    }
    setTheme(next);
  };

  return (
    <button
      onClick={toggle}
      className="rounded-md border px-2 py-1 text-sm"
      style={{ borderColor: 'var(--border)', color: 'var(--ink-2)' }}
      aria-label="Toggle theme"
    >
      {theme === null ? 'Theme' : theme === 'dark' ? 'Light' : 'Dark'}
    </button>
  );
}

export function Nav() {
  const pathname = usePathname();
  const router = useRouter();

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  };

  return (
    <header
      className="sticky top-0 z-10 border-b"
      style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
    >
      <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <span
            className="inline-block h-3 w-3 rounded-sm"
            style={{ background: 'var(--accent-bg)' }}
            aria-hidden
          />
          SimpleX Monitor
        </Link>
        <nav className="flex gap-4 text-sm">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="rounded-md px-2 py-1"
              style={
                pathname === l.href
                  ? { color: 'var(--ink)', fontWeight: 600 }
                  : { color: 'var(--ink-muted)' }
              }
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          <button
            onClick={logout}
            className="rounded-md border px-2 py-1 text-sm"
            style={{ borderColor: 'var(--border)', color: 'var(--ink-2)' }}
          >
            Log out
          </button>
        </div>
      </div>
    </header>
  );
}
