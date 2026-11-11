import { formatMoney } from '../lib/format';

/** Itemised price of a booking: the doctor's consultation fee plus the platform service fee. */
export function BookingFeeSummary({
  consultationFee,
  serviceFee,
  currency,
}: {
  consultationFee: number;
  serviceFee: number;
  currency?: string;
}) {
  return (
    <dl className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
      <div className="flex justify-between gap-2">
        <dt className="text-slate-500">Consultation fee</dt>
        <dd className="font-medium">{formatMoney(consultationFee, currency)}</dd>
      </div>
      <div className="flex justify-between gap-2">
        <dt className="text-slate-500">Platform service fee</dt>
        <dd className="font-medium">{formatMoney(serviceFee, currency)}</dd>
      </div>
      <div className="flex justify-between gap-2 border-t border-slate-200 pt-2 text-base">
        <dt className="font-semibold text-slate-900">Total</dt>
        <dd className="font-bold text-teal-700">{formatMoney(consultationFee + serviceFee, currency)}</dd>
      </div>
    </dl>
  );
}
