import { StrictMode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const auth = {
  verifyOtp: vi.fn(),
  initialize: vi.fn(async () => ({ error: null })),
  getSession: vi.fn(async () => ({ data: { session: null } })),
  setSession: vi.fn(),
  updateUser: vi.fn(),
  signOut: vi.fn(),
  onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
};
vi.mock('../../lib/supabase', () => ({ supabase: { auth } }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({}), homePathFor: () => '/', safeNext: () => null }));
vi.mock('../../components/ui/Toast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }) }));

async function renderWithLink(search: string) {
  vi.resetModules(); // the verification result is cached per page load
  window.history.replaceState(null, '', `/reset-password${search}`);
  const { ResetPasswordPage } = await import('./Auth');
  render(
    <StrictMode>
      <MemoryRouter>
        <ResetPasswordPage />
      </MemoryRouter>
    </StrictMode>,
  );
}

describe('ResetPasswordPage with a token_hash link', () => {
  beforeEach(() => vi.clearAllMocks());

  it('verifies the single-use token once, even when effects run twice, then shows the form', async () => {
    auth.verifyOtp.mockResolvedValue({ data: { session: { access_token: 't' } }, error: null });
    await renderWithLink('?token_hash=abc&type=recovery');
    expect(await screen.findByLabelText(/^New password/)).toBeInTheDocument();
    expect(auth.verifyOtp).toHaveBeenCalledTimes(1);
    expect(auth.verifyOtp).toHaveBeenCalledWith({ type: 'recovery', token_hash: 'abc' });
    expect(window.location.search).toBe('');
  });

  it('explains an expired or used link and offers a new one', async () => {
    auth.verifyOtp.mockResolvedValue({ data: { session: null }, error: { message: 'Email link is invalid or has expired' } });
    await renderWithLink('?token_hash=old&type=recovery');
    expect(await screen.findByText('Reset link has expired or is invalid. Please request a new one.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Request a new reset link' })).toHaveAttribute('href', '/forgot-password');
    expect(screen.queryByLabelText(/^New password/)).not.toBeInTheDocument();
  });
});
