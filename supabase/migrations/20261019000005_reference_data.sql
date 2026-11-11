-- =============================================================================
-- MediConnect: reference data (medical specialties). Safe to run in production;
-- administrators can edit or deactivate these from the Specialty Management page.
-- =============================================================================
insert into public.specialties (name, slug, description) values
  ('General Practice', 'general-practice', 'Primary care for common illnesses, check-ups and referrals.'),
  ('Paediatrics', 'paediatrics', 'Health care for infants, children and adolescents.'),
  ('Cardiology', 'cardiology', 'Heart and blood vessel conditions.'),
  ('Dermatology', 'dermatology', 'Skin, hair and nail conditions.'),
  ('Obstetrics & Gynaecology', 'obstetrics-gynaecology', 'Pregnancy, childbirth and women''s reproductive health.'),
  ('Orthopaedics', 'orthopaedics', 'Bones, joints, ligaments and muscles.'),
  ('Psychiatry', 'psychiatry', 'Mental health assessment and treatment.'),
  ('Neurology', 'neurology', 'Brain, spinal cord and nerve disorders.'),
  ('Ophthalmology', 'ophthalmology', 'Eye health and vision.'),
  ('ENT', 'ent', 'Ear, nose and throat conditions.'),
  ('Dentistry', 'dentistry', 'Oral and dental health.'),
  ('Internal Medicine', 'internal-medicine', 'Diagnosis and management of adult diseases.')
on conflict (slug) do nothing;
