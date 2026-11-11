import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarCheck, MessageSquare, Search, ShieldCheck, Stethoscope, BellRing } from 'lucide-react';
import { Button, ButtonLink } from '../../components/ui/Button';
import { useSpecialties } from '../../hooks/useSettings';

export function HomePage() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const specialties = useSpecialties();

  return (
    <>
      <section className="relative overflow-hidden bg-gradient-to-b from-brand-50 to-white">
        <div className="mx-auto grid max-w-7xl items-center gap-10 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:py-24">
          <div>
            <p className="mb-3 inline-flex items-center gap-2 rounded-full bg-teal-50 px-3 py-1 text-sm font-medium text-teal-700">
              <ShieldCheck className="h-4 w-4" aria-hidden="true" /> Every doctor is verified by our team
            </p>
            <h1 className="text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
              See the right doctor, <span className="text-brand-600">without the queue.</span>
            </h1>
            <p className="mt-4 max-w-xl text-lg text-slate-600">
              Find doctors by specialty, book a time that suits you, and chat securely with your doctor before and after your visit.
            </p>
            <form
              className="mt-8 flex max-w-xl flex-col gap-2 sm:flex-row"
              onSubmit={(e) => {
                e.preventDefault();
                navigate(`/doctors${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`);
              }}
              role="search"
            >
              <label htmlFor="home-search" className="sr-only">
                Search doctors by name, specialty or city
              </label>
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                <input
                  id="home-search"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Doctor name, specialty or city"
                  className="h-12 w-full rounded-lg border border-slate-300 bg-white pl-10 pr-3 text-base shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
                />
              </div>
              <Button type="submit" size="lg">
                Find doctors
              </Button>
            </form>
            {specialties.data && (
              <div className="mt-4 flex flex-wrap gap-2">
                {specialties.data.slice(0, 6).map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => navigate(`/doctors?specialty=${s.id}`)}
                    className="rounded-full border border-slate-200 bg-white px-3 py-1 text-sm text-slate-600 hover:border-brand-300 hover:text-brand-700"
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="relative hidden lg:block" aria-hidden="true">
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-teal-500 font-bold text-white">AW</div>
                <div>
                  <p className="font-semibold">Dr. Amani Wekesa</p>
                  <p className="text-sm text-slate-500">General Practice · Embu</p>
                </div>
              </div>
              <div className="mt-5 grid grid-cols-3 gap-2">
                {['09:00', '09:30', '10:00', '11:30', '14:00', '15:30'].map((t, i) => (
                  <div key={t} className={`rounded-lg border px-3 py-2 text-center text-sm ${i === 2 ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-200'}`}>
                    {t}
                  </div>
                ))}
              </div>
              <div className="mt-5 rounded-lg bg-teal-50 p-3 text-sm text-teal-800">Appointment confirmed for Tuesday at 10:00</div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
        <h2 className="text-center text-3xl font-bold">Everything you need for your next visit</h2>
        <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { icon: Stethoscope, title: 'Verified doctors', text: 'Doctors submit their licence and qualifications, and an administrator checks them before they can take bookings.' },
            { icon: CalendarCheck, title: 'Real-time availability', text: 'See open slots in your own time zone and book in a few taps. Double-bookings are impossible.' },
            { icon: MessageSquare, title: 'Secure messaging', text: 'Chat privately with your doctor. Only the two of you can read the conversation.' },
            { icon: BellRing, title: 'Reminders', text: 'Get confirmations, changes and reminders in the app and by email.' },
          ].map((f) => (
            <div key={f.title} className="rounded-xl border border-slate-200 p-6">
              <div className="mb-4 inline-flex rounded-lg bg-brand-50 p-2.5 text-brand-600">
                <f.icon className="h-6 w-6" aria-hidden="true" />
              </div>
              <h3 className="font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm text-slate-600">{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-brand-700">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-6 px-4 py-12 text-center sm:px-6 lg:flex-row lg:text-left">
          <div>
            <h2 className="text-2xl font-bold text-white">Are you a doctor?</h2>
            <p className="mt-1 text-brand-100">Create a professional profile, set your hours and start receiving bookings once verified.</p>
          </div>
          <div className="flex gap-3">
            <ButtonLink to="/register?role=doctor" variant="teal" size="lg">
              Join as a doctor
            </ButtonLink>
            <ButtonLink to="/how-it-works" variant="outline" size="lg">
              How it works
            </ButtonLink>
          </div>
        </div>
      </section>
    </>
  );
}
