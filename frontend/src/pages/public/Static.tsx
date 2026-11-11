import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CalendarCheck, ClipboardList, MessageSquare, Search, ShieldCheck, Star, UserPlus, Users } from 'lucide-react';
import { ButtonLink } from '../../components/ui/Button';
import { usePublicSettings } from '../../hooks/useSettings';

function Prose({ title, intro, children }: { title: string; intro?: string; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
      {intro && <p className="mt-3 text-lg text-slate-600">{intro}</p>}
      <div className="mt-8 space-y-6 text-slate-700 [&_h2]:mt-8 [&_h2]:text-xl [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_p]:leading-relaxed [&_ul]:space-y-1">
        {children}
      </div>
    </div>
  );
}

export function AboutPage() {
  return (
    <Prose
      title="About MediConnect"
      intro="MediConnect is a digital healthcare platform that makes it easier for patients to reach doctors, and for doctors to manage their time."
    >
      <p>
        Many patients face long queues, struggle to find an available doctor, book appointments by phone or in person, and have
        little contact with the doctor before a visit. Missed and forgotten appointments waste everyone&apos;s time.
      </p>
      <p>MediConnect brings these steps together in one place:</p>
      <ul>
        <li>Search for doctors by name, specialty, fee and availability.</li>
        <li>Book, reschedule or cancel appointments online, in your own time zone.</li>
        <li>Receive confirmations and reminders in the app and by email.</li>
        <li>Chat securely with your doctor through private, real-time messaging.</li>
        <li>Give doctors a dashboard to manage requests, schedules and patients.</li>
      </ul>
      <h2>Trust and safety</h2>
      <p>
        Doctors join by creating a professional profile and submitting their licence and qualifications. An administrator reviews
        each request before the doctor appears in search results. Access to appointments and conversations is restricted to the
        people involved, and sensitive administrative actions are logged.
      </p>
      <h2>Our goal</h2>
      <p>
        Faster, more convenient and more accessible appointment management, with direct communication between patients and doctors.
      </p>
      <div className="flex flex-wrap gap-3 pt-4">
        <ButtonLink to="/doctors">Find a doctor</ButtonLink>
        <ButtonLink to="/contact" variant="outline">
          Contact us
        </ButtonLink>
      </div>
    </Prose>
  );
}

export function HowItWorksPage() {
  const patientSteps = [
    { icon: UserPlus, title: 'Create your account', text: 'Register as a patient with your name and email. It takes under a minute.' },
    { icon: Search, title: 'Find a doctor', text: 'Filter by specialty, fee, consultation type and the day you want to be seen.' },
    { icon: CalendarCheck, title: 'Pick a time', text: 'Choose an open slot, online or in person, and tell the doctor why you are visiting.' },
    { icon: MessageSquare, title: 'Stay in touch', text: 'Get a confirmation, a reminder before your visit, and chat with your doctor securely.' },
    { icon: Star, title: 'Share feedback', text: 'After a completed appointment you can leave a review to help other patients.' },
  ];
  const doctorSteps = [
    { icon: ClipboardList, title: 'Build your profile', text: 'Add your specialties, qualifications, fee and consultation types.' },
    { icon: ShieldCheck, title: 'Get verified', text: 'Upload your licence and certificates. An administrator reviews them.' },
    { icon: CalendarCheck, title: 'Set your hours', text: 'Define weekly working hours and block time off. Slots are generated automatically.' },
    { icon: Users, title: 'Manage patients', text: 'Accept, reject or reschedule requests, chat with patients and mark visits complete.' },
  ];
  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
      <h1 className="text-center text-3xl font-bold">How MediConnect works</h1>
      <p className="mx-auto mt-3 max-w-2xl text-center text-slate-600">A simple process for patients and doctors.</p>
      {[
        { heading: 'For patients', steps: patientSteps, cta: <ButtonLink to="/register">Create a patient account</ButtonLink> },
        { heading: 'For doctors', steps: doctorSteps, cta: <ButtonLink to="/register?role=doctor" variant="teal">Join as a doctor</ButtonLink> },
      ].map((group) => (
        <section key={group.heading} className="mt-12">
          <h2 className="text-2xl font-semibold">{group.heading}</h2>
          <ol className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {group.steps.map((s, i) => (
              <li key={s.title} className="rounded-xl border border-slate-200 p-5">
                <div className="flex items-center gap-3">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white">{i + 1}</span>
                  <s.icon className="h-5 w-5 text-teal-600" aria-hidden="true" />
                </div>
                <h3 className="mt-3 font-semibold">{s.title}</h3>
                <p className="mt-1 text-sm text-slate-600">{s.text}</p>
              </li>
            ))}
          </ol>
          <div className="mt-6">{group.cta}</div>
        </section>
      ))}
    </div>
  );
}

export function PrivacyPage() {
  const { data } = usePublicSettings();
  return (
    <Prose title="Privacy Policy" intro="How MediConnect collects, uses and protects your information.">
      <p className="text-sm text-slate-500">
        This policy is a starting template for the platform operator. It must be reviewed against the data-protection and health
        laws that apply where the service is offered (for example Kenya&apos;s Data Protection Act, 2019) before public launch.
      </p>
      <h2>Information we collect</h2>
      <ul>
        <li>Account details: name, email address, and optionally phone number, date of birth and gender.</li>
        <li>Appointment details: the doctor, time, consultation type and the reason for the visit that you enter.</li>
        <li>Messages and attachments you exchange with your doctor.</li>
        <li>For doctors: professional details and the verification documents you upload.</li>
      </ul>
      <h2>How we use it</h2>
      <ul>
        <li>To provide bookings, reminders, notifications and messaging.</li>
        <li>To verify doctors and keep the platform safe.</li>
        <li>We do not sell personal data or use it for advertising.</li>
      </ul>
      <h2>Who can see your information</h2>
      <ul>
        <li>Your appointments and messages are visible only to you, the doctor involved and, where necessary for moderation or support, authorised administrators.</li>
        <li>Doctors see only the patient details needed for the appointment.</li>
        <li>Email notifications never include the reason for your visit or the content of your messages.</li>
      </ul>
      <h2>Security</h2>
      <p>
        Passwords are handled by our authentication provider and never stored in plain text. Data is protected by role-based access
        rules enforced in the database, encrypted connections, and audit logs for sensitive administrative actions.
      </p>
      <h2>Your choices</h2>
      <ul>
        <li>You can update your profile and turn email notifications off at any time.</li>
        <li>You can ask us to correct or delete your data by contacting {data?.support_email ?? 'support'}.</li>
      </ul>
      <h2>Contact</h2>
      <p>
        Questions about this policy? <Link className="text-brand-700 underline" to="/contact">Contact us</Link>.
      </p>
    </Prose>
  );
}

export function TermsPage() {
  return (
    <Prose title="Terms and Conditions" intro="The rules for using MediConnect.">
      <p className="text-sm text-slate-500">This is a template and should be reviewed by a qualified legal professional before public launch.</p>
      <h2>Not for emergencies</h2>
      <p>MediConnect is not an emergency service. In a medical emergency, call your local emergency number or go to the nearest hospital.</p>
      <h2>Accounts</h2>
      <ul>
        <li>You must give accurate information and keep your password secure.</li>
        <li>Doctors must hold a valid licence and submit genuine documents for verification. False information leads to suspension.</li>
        <li>We may suspend accounts that misuse the platform.</li>
      </ul>
      <h2>Appointments</h2>
      <ul>
        <li>Booking requests are confirmed by the doctor. A request is not an appointment until it is confirmed.</li>
        <li>Confirmed appointments can be cancelled or rescheduled up to the cancellation window shown when you book.</li>
        <li>Doctors set their own fees. Payment arrangements are between the patient and the doctor unless stated otherwise.</li>
      </ul>
      <h2>Messaging and reviews</h2>
      <ul>
        <li>Be respectful. Do not share content that is abusive, unlawful or unrelated to care.</li>
        <li>Reviews must reflect a genuine completed appointment. Reported reviews may be hidden by administrators.</li>
      </ul>
      <h2>Medical responsibility</h2>
      <p>Doctors are responsible for the medical advice they give. MediConnect provides the platform and does not give medical advice.</p>
    </Prose>
  );
}

export function NotFoundPage() {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center px-4 py-24 text-center">
      <p className="text-6xl font-bold text-brand-600">404</p>
      <h1 className="mt-4 text-2xl font-bold">Page not found</h1>
      <p className="mt-2 text-slate-600">The page you are looking for does not exist or has moved.</p>
      <div className="mt-6 flex gap-3">
        <ButtonLink to="/">Go home</ButtonLink>
        <ButtonLink to="/doctors" variant="outline">
          Find doctors
        </ButtonLink>
      </div>
    </div>
  );
}
