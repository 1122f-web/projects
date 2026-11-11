import { Link } from 'react-router-dom';

export function Logo({ to = '/' }: { to?: string }) {
  return (
    <Link to={to} className="flex items-center gap-2 font-bold text-slate-900" aria-label="MediConnect home">
      <svg viewBox="0 0 32 32" className="h-8 w-8" aria-hidden="true">
        <rect width="32" height="32" rx="8" fill="#0b6bcb" />
        <path d="M13 7h6v6h6v6h-6v6h-6v-6H7v-6h6z" fill="#fff" />
        <circle cx="24" cy="24" r="4" fill="#14b8a6" />
      </svg>
      <span className="text-lg">
        Medi<span className="text-teal-600">Connect</span>
      </span>
    </Link>
  );
}
