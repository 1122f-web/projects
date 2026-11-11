// Seeds FICTIONAL demo accounts for local development and testing.
// Usage: npm run seed:dev   (refuses to run against a non-local Supabase unless --force)
import { serviceClient } from '../lib/supabase.js';
import { config } from '../config.js';

const DEV_PASSWORD = 'DemoPass123';

const isLocal = /127\.0\.0\.1|localhost/.test(config.SUPABASE_URL);
if ((!isLocal || config.NODE_ENV === 'production') && !process.argv.includes('--force')) {
  console.error('Refusing to seed demo accounts outside local development. Pass --force if you really mean it.');
  process.exit(1);
}

interface DemoDoctor {
  email: string;
  name: string;
  specialties: string[];
  fee: number;
  city: string;
  clinic: string;
  years: number;
  bio: string;
  online: boolean;
  inPerson: boolean;
}

const doctors: DemoDoctor[] = [
  {
    email: 'dr.amani@demo.mediconnect.test',
    name: 'Amani Wekesa',
    specialties: ['general-practice', 'internal-medicine'],
    fee: 1500,
    city: 'Embu',
    clinic: 'Embu Family Clinic',
    years: 9,
    bio: 'Family physician focused on preventive care and chronic disease management. (Fictional demo profile.)',
    online: true,
    inPerson: true,
  },
  {
    email: 'dr.otieno@demo.mediconnect.test',
    name: 'Brian Otieno',
    specialties: ['paediatrics'],
    fee: 2000,
    city: 'Nairobi',
    clinic: 'Little Steps Children\'s Clinic',
    years: 12,
    bio: 'Paediatrician caring for newborns, children and teenagers. (Fictional demo profile.)',
    online: true,
    inPerson: true,
  },
  {
    email: 'dr.njeri@demo.mediconnect.test',
    name: 'Grace Njeri',
    specialties: ['dermatology'],
    fee: 2500,
    city: 'Nyeri',
    clinic: 'Clear Skin Centre',
    years: 7,
    bio: 'Dermatologist treating acne, eczema and other skin conditions. (Fictional demo profile.)',
    online: true,
    inPerson: false,
  },
  {
    email: 'dr.kamau@demo.mediconnect.test',
    name: 'David Kamau',
    specialties: ['cardiology', 'internal-medicine'],
    fee: 3500,
    city: 'Nairobi',
    clinic: 'Heartline Cardiac Centre',
    years: 15,
    bio: 'Cardiologist specialising in hypertension and heart rhythm disorders. (Fictional demo profile.)',
    online: false,
    inPerson: true,
  },
];

const patients = [
  { email: 'patient.jane@demo.mediconnect.test', name: 'Jane Mwangi' },
  { email: 'patient.peter@demo.mediconnect.test', name: 'Peter Kiprono' },
];
const admin = { email: 'admin@demo.mediconnect.test', name: 'Demo Administrator' };

async function ensureUser(email: string, fullName: string, role: 'patient' | 'doctor'): Promise<string> {
  const { data, error } = await serviceClient.auth.admin.createUser({
    email,
    password: DEV_PASSWORD,
    email_confirm: true,
    app_metadata: { provisioned: true },
    user_metadata: { full_name: fullName, requested_role: role, timezone: 'Africa/Nairobi' },
  });
  if (!error && data.user) return data.user.id;
  const { data: list } = await serviceClient.auth.admin.listUsers({ perPage: 1000 });
  const existing = list?.users.find((u) => u.email === email);
  if (!existing) throw new Error(`Could not create ${email}: ${error?.message}`);
  return existing.id;
}

async function main() {
  const { data: specialties, error } = await serviceClient.from('specialties').select('id, slug');
  if (error) throw error;
  const bySlug = new Map(specialties.map((s) => [s.slug as string, s.id as string]));

  for (const d of doctors) {
    const id = await ensureUser(d.email, d.name, 'doctor');
    await serviceClient
      .from('doctor_profiles')
      .update({
        bio: d.bio,
        qualifications: 'MBChB (fictional), Registered Medical Practitioner (fictional)',
        years_experience: d.years,
        consultation_fee: d.fee,
        city: d.city,
        clinic_name: d.clinic,
        clinic_address: `${d.clinic}, ${d.city}`,
        offers_online: d.online,
        offers_in_person: d.inPerson,
        languages: ['English', 'Swahili'],
        verification_status: 'verified',
        verified_at: new Date().toISOString(),
      })
      .eq('id', id);
    await serviceClient.from('doctor_specialties').delete().eq('doctor_id', id);
    await serviceClient.from('doctor_specialties').insert(
      d.specialties.map((slug, i) => ({ doctor_id: id, specialty_id: bySlug.get(slug), is_primary: i === 0 })),
    );
    await serviceClient.from('doctor_availability').delete().eq('doctor_id', id);
    const blocks = [1, 2, 3, 4, 5].flatMap((day) => [
      { doctor_id: id, day_of_week: day, start_time: '09:00', end_time: '12:00' },
      { doctor_id: id, day_of_week: day, start_time: '14:00', end_time: '17:00' },
    ]);
    blocks.push({ doctor_id: id, day_of_week: 6, start_time: '09:00', end_time: '13:00' });
    await serviceClient.from('doctor_availability').insert(blocks);
    console.warn(`doctor   ${d.email}`);
  }

  for (const p of patients) {
    await ensureUser(p.email, p.name, 'patient');
    console.warn(`patient  ${p.email}`);
  }

  await ensureUser(admin.email, admin.name, 'patient');
  const { error: adminError } = await serviceClient.rpc('grant_admin_by_email', { p_email: admin.email });
  if (adminError) throw adminError;
  console.warn(`admin    ${admin.email}`);
  console.warn(`\nAll demo accounts use the password: ${DEV_PASSWORD}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
