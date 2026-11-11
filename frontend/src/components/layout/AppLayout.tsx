import { Suspense, useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  CalendarCheck,
  CalendarClock,
  ClipboardCheck,
  CreditCard,
  FileClock,
  FileText,
  Flag,
  Home,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  Search,
  Settings,
  ShieldCheck,
  Star,
  Stethoscope,
  User,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import { Logo } from './Logo';
import { Avatar } from '../ui/Misc';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../lib/api';
import type { AppNotification, Conversation, Role } from '../../lib/types';
import { hasAccess, type Access } from '../../lib/permissions';
import { useRealtime } from '../../hooks/useRealtime';
import { useToast } from '../ui/Toast';
import { PageLoader } from '../ui/Feedback';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  badge?: 'messages' | 'notifications';
  /** Hidden from staff without this permission. */
  access?: Access;
}

const ADMIN_NAV: NavItem[] = [
  { to: '/admin', label: 'Overview & Analytics', icon: LayoutDashboard, end: true },
  { to: '/admin/users', label: 'Users & Staff', icon: Users, access: 'users' },
  { to: '/admin/verifications', label: 'Doctor Verification', icon: ShieldCheck, access: 'verifications' },
  { to: '/admin/appointments', label: 'Appointments', icon: ClipboardCheck, access: 'appointments' },
  { to: '/admin/plans', label: 'Plans & Boosts', icon: CreditCard, access: 'plans' },
  { to: '/admin/specialties', label: 'Specialties', icon: Stethoscope, access: 'specialties' },
  { to: '/admin/reviews', label: 'Review Moderation', icon: Flag, access: 'reviews' },
  { to: '/admin/activity', label: 'System Activity', icon: FileClock, access: 'activity' },
  { to: '/admin/settings', label: 'Settings', icon: Settings, access: 'admin' },
  { to: '/admin/notifications', label: 'Notifications', icon: Bell, badge: 'notifications' },
  { to: '/admin/profile', label: 'My Account', icon: User },
];

const NAV: Record<Role, NavItem[]> = {
  patient: [
    { to: '/patient', label: 'Dashboard', icon: LayoutDashboard, end: true },
    { to: '/patient/find-doctors', label: 'Find Doctors', icon: Search },
    { to: '/patient/appointments', label: 'My Appointments', icon: CalendarCheck },
    { to: '/patient/messages', label: 'Messages', icon: MessageSquare, badge: 'messages' },
    { to: '/patient/notifications', label: 'Notifications', icon: Bell, badge: 'notifications' },
    { to: '/patient/reviews', label: 'Reviews', icon: Star },
    { to: '/patient/profile', label: 'Profile', icon: User },
  ],
  doctor: [
    { to: '/doctor', label: 'Dashboard', icon: LayoutDashboard, end: true },
    { to: '/doctor/appointments', label: 'Appointments', icon: CalendarCheck },
    { to: '/doctor/prescriptions', label: 'Prescriptions', icon: FileText }, // 👈 Added here!
    { to: '/doctor/availability', label: 'Schedule', icon: CalendarClock },
    { to: '/doctor/messages', label: 'Messages', icon: MessageSquare, badge: 'messages' },
    { to: '/doctor/notifications', label: 'Notifications', icon: Bell, badge: 'notifications' },
    { to: '/doctor/profile', label: 'Professional Profile', icon: Stethoscope },
  ],
  admin: ADMIN_NAV,
  staff: ADMIN_NAV,
};

export function AppLayout() {
  const { me, signOut } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [location.pathname]);

  const role = me?.role ?? 'patient';
  const usesChat = role === 'patient' || role === 'doctor';
  // Staff and admins share the admin area, so their URLs start with /admin.
  const area = role === 'staff' ? 'admin' : role;
  const unreadNotifications = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: () => api.get<{ unread: number }>('/notifications/unread-count'),
    enabled: Boolean(me),
  });
  const conversations = useQuery({
    queryKey: ['conversations'],
    queryFn: () => api.get<Conversation[]>('/conversations'),
    enabled: Boolean(me) && usesChat,
  });
  const unreadMessages = (conversations.data ?? []).reduce((n, c) => n + c.unread_count, 0);

  // Live updates: notifications for this user and any message in their conversations.
  useRealtime(
    me ? `app:${me.id}` : null,
    [
      { table: 'notifications', filter: me ? `user_id=eq.${me.id}` : undefined },
      ...(usesChat ? [{ table: 'messages', event: 'INSERT' as const }] : []),
      { table: 'appointments' },
    ],
    (payload) => {
      if (payload.table === 'notifications') {
        void queryClient.invalidateQueries({ queryKey: ['notifications'] });
        if (payload.eventType === 'INSERT') {
          const n = payload.new as unknown as AppNotification;
          if (!location.pathname.includes('/messages') || n.type !== 'new_message') toast.info(n.title, n.body);
        }
      } else if (payload.table === 'messages') {
        void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      } else if (payload.table === 'appointments') {
        void queryClient.invalidateQueries({ queryKey: ['appointments'] });
        void queryClient.invalidateQueries({ queryKey: ['appointment'] });
        void queryClient.invalidateQueries({ queryKey: ['admin'] });
      }
    },
    () => {
      for (const key of ['notifications', 'conversations', 'appointments', 'appointment']) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
  );

  const badgeFor = (b?: NavItem['badge']) =>
    b === 'messages' ? unreadMessages : b === 'notifications' ? (unreadNotifications.data?.unread ?? 0) : 0;

  const handleSignOut = async () => {
    await signOut();
    navigate('/login', { replace: true });
  };

  const nav = (
    <nav aria-label="Dashboard" className="flex flex-1 flex-col gap-1 p-3">
      {NAV[role].filter((item) => !item.access || hasAccess(me, item.access)).map((item) => {
        const count = badgeFor(item.badge);
        return (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`
            }
          >
            <item.icon className="h-5 w-5 shrink-0" aria-hidden="true" />
            <span className="flex-1">{item.label}</span>
            {count > 0 && (
              <span className="rounded-full bg-teal-600 px-2 py-0.5 text-xs font-semibold text-white" aria-label={`${count} unread`}>
                {count > 99 ? '99+' : count}
              </span>
            )}
          </NavLink>
        );
      })}
      <div className="mt-auto space-y-1 border-t border-slate-100 pt-3">
        <Link to="/" className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">
          <Home className="h-5 w-5" aria-hidden="true" /> Public site
        </Link>
        <button
          type="button"
          onClick={handleSignOut}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-red-50 hover:text-red-700"
        >
          <LogOut className="h-5 w-5" aria-hidden="true" /> Sign out
        </button>
      </div>
    </nav>
  );

  const notificationsPath = `/${area}/notifications`;
  const profilePath = `/${area}/profile`;

  return (
    <div className="min-h-screen bg-slate-50">
      <a href="#app-main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:p-2">
        Skip to content
      </a>
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-slate-200 bg-white lg:flex">
        <div className="flex h-16 items-center border-b border-slate-100 px-5">
          <Logo to={`/${area}`} />
        </div>
        {nav}
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-white shadow-xl">
            <div className="flex h-16 items-center justify-between border-b border-slate-100 px-4">
              <Logo to={`/${area}`} />
              <button type="button" onClick={() => setOpen(false)} className="rounded-md p-2 text-slate-500 hover:bg-slate-100" aria-label="Close menu">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex flex-1 flex-col overflow-y-auto">{nav}</div>
          </aside>
        </div>
      )}

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 sm:px-6">
          <button
            type="button"
            className="rounded-md p-2 text-slate-600 hover:bg-slate-100 lg:hidden"
            onClick={() => setOpen(true)}
            aria-label="Open menu"
          >
            <Menu className="h-6 w-6" />
          </button>
          <div className="hidden text-sm text-slate-500 sm:block">
            {role === 'doctor' && me?.doctor?.verification_status !== 'verified' ? (
              <Link to="/doctor/profile" className="font-medium text-amber-700 hover:underline">
                Complete verification to start receiving bookings
              </Link>
            ) : (
              <span>Welcome back, {me?.full_name.split(' ')[0]}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Link
              to={notificationsPath}
              className="relative rounded-full p-2 text-slate-600 hover:bg-slate-100"
              aria-label={`Notifications${unreadNotifications.data?.unread ? `, ${unreadNotifications.data.unread} unread` : ''}`}
            >
              <Bell className="h-5 w-5" />
              {(unreadNotifications.data?.unread ?? 0) > 0 && (
                <span className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-teal-500 ring-2 ring-white" />
              )}
            </Link>
            <Link to={profilePath} className="flex items-center gap-2 rounded-full p-1 pr-3 hover:bg-slate-100">
              <Avatar name={me?.full_name ?? ''} url={me?.avatar_url} size="sm" />
              <span className="hidden text-sm font-medium text-slate-700 sm:inline">{me?.full_name}</span>
            </Link>
          </div>
        </header>
        <main id="app-main" className="mx-auto w-full min-w-0 max-w-6xl px-4 py-6 sm:px-6 lg:py-8">
          <Suspense fallback={<PageLoader />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}