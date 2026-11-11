import { Check, Sparkles } from 'lucide-react';
import type { PlanKind } from '../lib/types';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { formatDate, formatMoney } from '../lib/format';

interface Props {
  currency?: string;
  proPrice: number;
  featuredPrice: number;
  /** End of the current paid period, if any. */
  proUntil: string | null;
  featuredUntil: string | null;
  /** Plans with a request awaiting payment confirmation. */
  pending: PlanKind[];
  /** Why the plans cannot be bought right now (e.g. not verified yet). */
  disabledReason?: string;
  onSelectPlan: (plan: PlanKind) => void;
}

const isActive = (until: string | null) => Boolean(until && new Date(until) > new Date());

function Feature({ children }: { children: string }) {
  return (
    <li className="flex items-start gap-2">
      <Check className="mt-0.5 h-4 w-4 shrink-0 text-teal-600" aria-hidden="true" />
      <span>{children}</span>
    </li>
  );
}

export function DoctorPricingPlans({ currency, proPrice, featuredPrice, proUntil, featuredUntil, pending, disabledReason, onSelectPlan }: Props) {
  const proActive = isActive(proUntil);
  const featuredActive = isActive(featuredUntil);

  const action = (plan: PlanKind, active: boolean, label: string, variant: 'primary' | 'teal') => {
    if (pending.includes(plan)) {
      return (
        <Button variant="outline" className="w-full" disabled>
          Awaiting payment confirmation
        </Button>
      );
    }
    return (
      <Button variant={variant} className="w-full" disabled={Boolean(disabledReason)} onClick={() => onSelectPlan(plan)}>
        {active ? 'Extend' : label}
      </Button>
    );
  };

  return (
    <div className="space-y-3">
      {disabledReason && <p className="text-sm text-amber-700">{disabledReason}</p>}
      <div className="grid gap-4 md:grid-cols-3">
        <div className="flex flex-col rounded-xl border border-slate-200 p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Default</p>
          <h3 className="mt-1 text-lg font-bold">Basic</h3>
          <p className="my-3 text-3xl font-extrabold">
            {formatMoney(0, currency)} <span className="text-xs font-normal text-slate-500">/ month</span>
          </p>
          <ul className="mb-5 flex-1 space-y-2 text-sm text-slate-600">
            <Feature>Standard search listing</Feature>
            <Feature>Appointment management</Feature>
          </ul>
          <Button variant="outline" className="w-full" disabled>
            {proActive ? 'Included' : 'Current plan'}
          </Button>
        </div>

        <div className="relative flex flex-col rounded-xl border-2 border-brand-500 bg-brand-50/40 p-5">
          <span className="absolute -top-3 right-4">
            <Badge tone="blue">Recommended</Badge>
          </span>
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">Subscription</p>
          <h3 className="mt-1 flex items-center gap-2 text-lg font-bold">
            Pro {proActive && <Badge tone="teal">Active</Badge>}
          </h3>
          <p className="my-3 text-3xl font-extrabold text-brand-700">
            {formatMoney(proPrice, currency)} <span className="text-xs font-normal text-slate-500">/ month</span>
          </p>
          <ul className="mb-5 flex-1 space-y-2 text-sm text-slate-600">
            <Feature>Priority search ranking</Feature>
            <Feature>Pro badge in search results</Feature>
          </ul>
          {proActive && <p className="mb-2 text-xs text-slate-500">Active until {formatDate(proUntil!)}</p>}
          {action('pro', proActive, 'Upgrade to Pro', 'primary')}
        </div>

        <div className="flex flex-col rounded-xl border border-violet-200 bg-violet-50/40 p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-violet-700">Visibility boost</p>
          <h3 className="mt-1 flex items-center gap-2 text-lg font-bold">
            <Sparkles className="h-4 w-4 text-violet-600" aria-hidden="true" /> Featured {featuredActive && <Badge tone="teal">Active</Badge>}
          </h3>
          <p className="my-3 text-3xl font-extrabold text-violet-700">
            {formatMoney(featuredPrice, currency)} <span className="text-xs font-normal text-slate-500">/ week</span>
          </p>
          <ul className="mb-5 flex-1 space-y-2 text-sm text-slate-600">
            <Feature>Pinned to the top of search results</Feature>
            <Feature>Highlighted "Featured" badge</Feature>
          </ul>
          {featuredActive && <p className="mb-2 text-xs text-slate-500">Featured until {formatDate(featuredUntil!)}</p>}
          {action('featured', featuredActive, 'Get Featured', 'teal')}
        </div>
      </div>
    </div>
  );
}
