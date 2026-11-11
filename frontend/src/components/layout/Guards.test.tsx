import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Me } from '../../lib/types';

const authState: { session: unknown; me: Partial<Me> | null; loading: boolean; recovering: boolean } = {
  session: null,
  me: null,
  loading: false,
  recovering: false,
};

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ ...authState, signOut: vi.fn() }),
  safeNext: (n: string | null) => (n && n.startsWith('/') && !n.startsWith('//') ? n : null),
  homePathFor: (role?: string) => (role === 'admin' ? '/admin' : role === 'doctor' ? '/doctor' : '/patient'),
}));
vi.mock('../../lib/supabase', () => ({ supabase: { auth: {} } }));

const { RequirePermission, RequireRole } = await import('./Guards');

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/login" element={<p>login page</p>} />
        <Route path="/patient" element={<p>patient home</p>} />
        <Route path="/admin/users" element={<RequireRole roles={['admin']}><p>admin users</p></RequireRole>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('RequireRole', () => {
  it('sends signed-out visitors to login', () => {
    Object.assign(authState, { session: null, me: null });
    renderAt('/admin/users');
    expect(screen.getByText('login page')).toBeInTheDocument();
  });

  it('sends a patient away from admin pages', () => {
    Object.assign(authState, { session: {}, me: { role: 'patient', account_status: 'active' } });
    renderAt('/admin/users');
    expect(screen.getByText('patient home')).toBeInTheDocument();
    expect(screen.queryByText('admin users')).not.toBeInTheDocument();
  });

  it('shows the page to an admin', () => {
    Object.assign(authState, { session: {}, me: { role: 'admin', account_status: 'active' } });
    renderAt('/admin/users');
    expect(screen.getByText('admin users')).toBeInTheDocument();
  });

  it('shows the suspension notice instead of the page to a suspended admin', () => {
    Object.assign(authState, { session: {}, me: { role: 'admin', account_status: 'suspended', full_name: 'A' } });
    renderAt('/admin/users');
    expect(screen.queryByText('admin users')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Your account is suspended' })).toBeInTheDocument();
  });
});

describe('RequirePermission', () => {
  const renderPage = (access: 'users' | 'admin') =>
    render(
      <MemoryRouter>
        <RequirePermission access={access}>
          <p>protected page</p>
        </RequirePermission>
      </MemoryRouter>,
    );

  it('shows the page to staff holding the permission', () => {
    Object.assign(authState, { session: {}, me: { role: 'staff', account_status: 'active', permissions: ['users'] } });
    renderPage('users');
    expect(screen.getByText('protected page')).toBeInTheDocument();
  });

  it('blocks staff without the permission', () => {
    Object.assign(authState, { session: {}, me: { role: 'staff', account_status: 'active', permissions: ['reviews'] } });
    renderPage('users');
    expect(screen.queryByText('protected page')).not.toBeInTheDocument();
    expect(screen.getByText('You do not have access to this page')).toBeInTheDocument();
  });

  it('keeps administrator-only pages from staff with every permission', () => {
    Object.assign(authState, {
      session: {},
      me: { role: 'staff', account_status: 'active', permissions: ['users', 'verifications', 'appointments', 'reviews', 'specialties', 'plans', 'activity'] },
    });
    renderPage('admin');
    expect(screen.queryByText('protected page')).not.toBeInTheDocument();
  });

  it('shows every page to an admin', () => {
    Object.assign(authState, { session: {}, me: { role: 'admin', account_status: 'active', permissions: [] } });
    renderPage('admin');
    expect(screen.getByText('protected page')).toBeInTheDocument();
  });
});
