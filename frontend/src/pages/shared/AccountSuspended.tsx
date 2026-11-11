import { ShieldAlert } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { Button, ButtonLink } from '../../components/ui/Button';

export function AccountSuspended() {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <ShieldAlert className="mx-auto h-12 w-12 text-amber-500" aria-hidden="true" />
        <h1 className="mt-4 text-xl font-bold">Your account is suspended</h1>
        <p className="mt-2 text-sm text-slate-600">
          An administrator has suspended this account, so you cannot use the dashboard right now. If you think this is a mistake, please contact support.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <ButtonLink to="/contact" variant="outline">
            Contact support
          </ButtonLink>
          <Button
            onClick={async () => {
              await signOut();
              navigate('/', { replace: true });
            }}
          >
            Sign out
          </Button>
        </div>
      </div>
    </div>
  );
}
