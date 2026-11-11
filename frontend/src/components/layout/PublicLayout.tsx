import { useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { useEffect } from 'react';
import { Logo } from './Logo';
import { ButtonLink } from '../ui/Button';
import { homePathFor, useAuth } from '../../context/AuthContext';

const links = [
  { to: '/', label: 'Home', end: true },
  { to: '/doctors', label: 'Find Doctors' },
  { to: '/how-it-works', label: 'How It Works' },
  { to: '/about', label: 'About Us' },
  { to: '/contact', label: 'Contact Us' },
];

export function PublicLayout() {
  const { me, session } = useAuth();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);

  const navCls = ({ isActive }: { isActive: boolean }) =>
    `rounded-md px-3 py-2 text-sm font-medium ${isActive ? 'text-brand-700 bg-brand-50' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'}`;

  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:p-2">
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
          <Logo />
          <nav aria-label="Main" className="hidden items-center gap-1 lg:flex">
            {links.map((l) => (
              <NavLink key={l.to} to={l.to} end={l.end} className={navCls}>
                {l.label}
              </NavLink>
            ))}
          </nav>
          <div className="hidden items-center gap-2 lg:flex">
            {session && me ? (
              <ButtonLink to={homePathFor(me.role)}>My dashboard</ButtonLink>
            ) : (
              <>
                <ButtonLink to="/login" variant="ghost">
                  Log in
                </ButtonLink>
                <ButtonLink to="/register">Create account</ButtonLink>
              </>
            )}
          </div>
          <button
            type="button"
            className="rounded-md p-2 text-slate-600 hover:bg-slate-100 lg:hidden"
            aria-expanded={open}
            aria-controls="mobile-nav"
            aria-label={open ? 'Close menu' : 'Open menu'}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>
        {open && (
          <nav id="mobile-nav" aria-label="Mobile" className="border-t border-slate-200 bg-white px-4 py-3 lg:hidden">
            <div className="flex flex-col gap-1">
              {links.map((l) => (
                <NavLink key={l.to} to={l.to} end={l.end} className={navCls}>
                  {l.label}
                </NavLink>
              ))}
            </div>
            <div className="mt-3 flex gap-2 border-t border-slate-100 pt-3">
              {session && me ? (
                <ButtonLink to={homePathFor(me.role)} className="flex-1">
                  My dashboard
                </ButtonLink>
              ) : (
                <>
                  <ButtonLink to="/login" variant="outline" className="flex-1">
                    Log in
                  </ButtonLink>
                  <ButtonLink to="/register" className="flex-1">
                    Create account
                  </ButtonLink>
                </>
              )}
            </div>
          </nav>
        )}
      </header>
      <main id="main" className="flex-1">
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}

export function Footer() {
  return (
    <footer className="border-t border-slate-200 bg-slate-50">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
        <div className="space-y-3">
          <Logo />
          <p className="text-sm text-slate-500">Connecting patients with verified doctors for appointments and secure conversations.</p>
        </div>
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Patients</h3>
          <ul className="mt-3 space-y-2 text-sm text-slate-600">
            <li><Link className="hover:text-brand-700" to="/doctors">Find a doctor</Link></li>
            <li><Link className="hover:text-brand-700" to="/how-it-works">How it works</Link></li>
            <li><Link className="hover:text-brand-700" to="/register">Create an account</Link></li>
          </ul>
        </div>
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Doctors</h3>
          <ul className="mt-3 space-y-2 text-sm text-slate-600">
            <li><Link className="hover:text-brand-700" to="/register?role=doctor">Join as a doctor</Link></li>
            <li><Link className="hover:text-brand-700" to="/login">Doctor login</Link></li>
          </ul>
        </div>
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Company</h3>
          <ul className="mt-3 space-y-2 text-sm text-slate-600">
            <li><Link className="hover:text-brand-700" to="/about">About us</Link></li>
            <li><Link className="hover:text-brand-700" to="/contact">Contact us</Link></li>
            <li><Link className="hover:text-brand-700" to="/privacy">Privacy policy</Link></li>
            <li><Link className="hover:text-brand-700" to="/terms">Terms and conditions</Link></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-slate-200 py-4 text-center text-xs text-slate-500">
        © {new Date().getFullYear()} MediConnect. Not for medical emergencies: call your local emergency number.
      </div>
    </footer>
  );
}
