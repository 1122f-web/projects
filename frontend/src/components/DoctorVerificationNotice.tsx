import { Info } from 'lucide-react';
import { Button } from './ui/Button';
import { formatMoney } from '../lib/format';

/** Shown to unverified or rejected doctors above the verification form. */
export function DoctorVerificationNotice({
  fee,
  currency,
  paymentInstructions,
  onRequestVerification,
}: {
  fee: number;
  currency?: string;
  paymentInstructions?: string;
  onRequestVerification: () => void;
}) {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <div className="shrink-0 rounded-full bg-amber-100 p-2 text-amber-700">
          <Info className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-amber-900">Licence verification required</h3>
          <p className="mt-1 text-sm text-amber-800">
            Before patients can find and book you, an administrator reviews your licence, qualifications and supporting documents.
          </p>
          {fee > 0 && (
            <>
              <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm">
                <span className="font-medium text-slate-700">One-time verification fee</span>
                <span className="font-bold text-amber-900">{formatMoney(fee, currency)}</span>
              </div>
              {paymentInstructions && <p className="mt-2 text-xs text-amber-800">{paymentInstructions}</p>}
            </>
          )}
          <Button size="sm" className="mt-3" onClick={onRequestVerification}>
            Proceed to verification
          </Button>
        </div>
      </div>
    </div>
  );
}
