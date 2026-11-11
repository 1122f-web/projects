export type Role = 'patient' | 'doctor' | 'admin' | 'staff';
/** Admin areas a staff account can be granted. Administrators hold all of them. */
export type Permission = 'users' | 'verifications' | 'appointments' | 'reviews' | 'specialties' | 'plans' | 'activity';
export type PlanKind = 'pro' | 'featured';
export type AppointmentStatus = 'pending' | 'confirmed' | 'rejected' | 'cancelled' | 'completed' | 'rescheduled';
export type ConsultationType = 'online' | 'in_person';
export type VerificationStatus = 'unverified' | 'pending' | 'verified' | 'rejected';

export interface Me {
  id: string;
  email: string | null;
  role: Role;
  account_status: 'active' | 'suspended';
  permissions: Permission[];
  can_send_messages: boolean;
  can_post_reviews: boolean;
  can_book_appointments: boolean;
  full_name: string;
  phone: string | null;
  date_of_birth: string | null;
  gender: 'female' | 'male' | 'other' | 'prefer_not_to_say' | null;
  avatar_url: string | null;
  timezone: string;
  email_notifications: boolean;
  created_at: string;
  doctor: { verification_status: VerificationStatus; verified_at: string | null; is_accepting_patients: boolean } | null;
}

export interface Specialty {
  id: string;
  name: string;
  slug?: string;
  description?: string | null;
  is_primary?: boolean;
}

export interface DoctorSummary {
  id: string;
  full_name: string;
  title: string;
  avatar_url: string | null;
  latitude?: number | null;
  longitude?: number | null;
  distance_km?: number | null;
  clinic_address?: string | null;
  city: string | null;
  clinic_name: string | null;
  years_experience: number | null;
  consultation_fee: number;
  offers_online: boolean;
  offers_in_person: boolean;
  is_accepting_patients: boolean;
  rating_avg: number;
  rating_count: number;
  languages: string[];
  timezone: string;
  is_featured?: boolean;
  is_pro?: boolean;
  specialties: Specialty[];
}

export interface DoctorPublic extends DoctorSummary {
  bio: string | null;
  qualifications: string | null;
  clinic_address: string | null;
  slot_duration_minutes: number;
  verified_at: string | null;
  availability: { day_of_week: number; start_time: string; end_time: string }[];
  reviews: { id: string; rating: number; comment: string | null; created_at: string; patient_name: string }[];
}

export interface Slot {
  starts_at: string;
  ends_at: string;
}

export interface Appointment {
  id: string;
  patient_id: string;
  doctor_id: string;
  starts_at: string;
  ends_at: string;
  consultation_type: ConsultationType;
  reason: string;
  status: AppointmentStatus;
  fee: number;
  service_fee: number;
  doctor_notes: string | null;
  status_note: string | null;
  cancelled_by: string | null;
  rescheduled_by: string | null;
  previous_starts_at: string | null;
  created_at: string;
  updated_at: string;
  patient: { id: string; full_name: string; avatar_url: string | null; timezone: string } | null;
  doctor: {
    id: string;
    title: string;
    clinic_name: string | null;
    clinic_address: string | null;
    city: string | null;
    profile: { full_name: string; avatar_url: string | null; timezone: string } | null;
  } | null;
  review: { id: string; rating: number; comment: string | null; status: string; created_at: string } | null;
}

export interface AppointmentDetail extends Appointment {
  patient_details: { phone: string | null; date_of_birth: string | null; gender: string | null } | null;
  conversation_id: string | null;
}

export interface Paged<T> {
  total: number;
  items: T[];
}

export interface Conversation {
  conversation_id: string;
  other_user_id: string;
  other_name: string;
  other_avatar_url: string | null;
  other_role: Role;
  other_last_read_at: string | null;
  my_last_read_at: string | null;
  last_message_body: string | null;
  last_message_has_attachment: boolean;
  last_message_sender_id: string | null;
  last_message_at: string | null;
  unread_count: number;
  created_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string | null;
  attachment_path: string | null;
  attachment_name: string | null;
  attachment_mime: string | null;
  attachment_size: number | null;
  created_at: string;
}

export interface AppNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  data: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PublicSettings {
  platform_name?: string;
  support_email?: string;
  currency?: string;
  cancellation_window_hours?: number;
  max_booking_days_ahead?: number;
  min_booking_notice_hours?: number;
  allow_registrations?: boolean;
  platform_service_fee?: number;
  doctor_verification_fee?: number;
  pro_plan_monthly_price?: number;
  featured_boost_weekly_price?: number;
  payment_instructions?: string;
}
