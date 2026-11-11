import { lazy } from 'react';
import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import { PublicLayout } from './components/layout/PublicLayout';
import { AppLayout } from './components/layout/AppLayout';
import { GuestOnly, RequirePermission, RequireRole, RoleHomeRedirect } from './components/layout/Guards';
import { HomePage } from './pages/public/Home';
import { AboutPage, HowItWorksPage, NotFoundPage, PrivacyPage, TermsPage } from './pages/public/Static';
import { ContactPage } from './pages/public/Contact';
import { ForgotPasswordPage, LoginPage, RegisterPage, ResetPasswordPage } from './pages/public/Auth';
import { FindDoctorsPage } from './pages/public/FindDoctors';
import { DoctorDetailsPage } from './pages/public/DoctorDetails';

// Signed-in areas load on demand
const PatientDashboard = lazy(() => import('./pages/patient/PatientPages').then((m) => ({ default: m.PatientDashboard })));
const PatientProfilePage = lazy(() => import('./pages/patient/PatientPages').then((m) => ({ default: m.PatientProfilePage })));
const PatientReviewsPage = lazy(() => import('./pages/patient/PatientPages').then((m) => ({ default: m.PatientReviewsPage })));
const BookAppointmentPage = lazy(() => import('./pages/patient/BookAppointment').then((m) => ({ default: m.BookAppointmentPage })));
const AppointmentsPage = lazy(() => import('./pages/shared/AppointmentsPage').then((m) => ({ default: m.AppointmentsPage })));
const AppointmentDetailPage = lazy(() => import('./pages/shared/AppointmentDetailPage').then((m) => ({ default: m.AppointmentDetailPage })));
const MessagesPage = lazy(() => import('./pages/shared/MessagesPage').then((m) => ({ default: m.MessagesPage })));
const NotificationsPage = lazy(() => import('./pages/shared/NotificationsPage').then((m) => ({ default: m.NotificationsPage })));

// New Map-Enabled Doctor Finder Component
const PatientDoctorFinder = lazy(() => import('./pages/patient/PatientDoctorFinder').then((m) => ({ default: m.default })));

// Doctor Pages
const DoctorDashboard = lazy(() => import('./pages/doctor/DoctorDashboard').then((m) => ({ default: m.DoctorDashboard })));
const DoctorProfilePage = lazy(() => import('./pages/doctor/DoctorProfile').then((m) => ({ default: m.DoctorProfilePage })));
const AvailabilityPage = lazy(() => import('./pages/doctor/Availability').then((m) => ({ default: m.AvailabilityPage })));
const PrescriptionWriter = lazy(() => import('./components/PrescriptionWriter').then((m) => ({ default: m.default })));

// Admin Pages
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard').then((m) => ({ default: m.AdminDashboard })));
const AdminUsersPage = lazy(() => import('./pages/admin/AdminUsers').then((m) => ({ default: m.AdminUsersPage })));
const AdminVerificationsPage = lazy(() => import('./pages/admin/AdminVerifications').then((m) => ({ default: m.AdminVerificationsPage })));
const AdminAppointmentsPage = lazy(() => import('./pages/admin/AdminAppointments').then((m) => ({ default: m.AdminAppointmentsPage })));
const AdminSpecialtiesPage = lazy(() => import('./pages/admin/AdminSpecialties').then((m) => ({ default: m.AdminSpecialtiesPage })));
const AdminReviewsPage = lazy(() => import('./pages/admin/AdminReviews').then((m) => ({ default: m.AdminReviewsPage })));
const AdminActivityPage = lazy(() => import('./pages/admin/AdminActivity').then((m) => ({ default: m.AdminActivityPage })));
const AdminPlansPage = lazy(() => import('./pages/admin/AdminPlans').then((m) => ({ default: m.AdminPlansPage })));
const AdminSettingsPage = lazy(() => import('./pages/admin/AdminSettings').then((m) => ({ default: m.AdminSettingsPage })));
const AccountPage = lazy(() => import('./pages/patient/PatientPages').then((m) => ({ default: m.PatientProfilePage })));

function PatientDoctorRedirect() {
  const { id } = useParams();
  return <Navigate to={`/patient/map-doctors/${id}`} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route element={<PublicLayout />}>
        <Route index element={<HomePage />} />
        <Route path="about" element={<AboutPage />} />
        <Route path="how-it-works" element={<HowItWorksPage />} />
        <Route path="contact" element={<ContactPage />} />
        <Route path="privacy" element={<PrivacyPage />} />
        <Route path="terms" element={<TermsPage />} />
        <Route path="doctors" element={<FindDoctorsPage />} />
        <Route path="doctors/:id" element={<DoctorDetailsPage />} />
        <Route path="login" element={<GuestOnly><LoginPage /></GuestOnly>} />
        <Route path="register" element={<GuestOnly><RegisterPage /></GuestOnly>} />
        <Route path="forgot-password" element={<ForgotPasswordPage />} />
        <Route path="reset-password" element={<ResetPasswordPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>

      <Route path="dashboard" element={<RoleHomeRedirect />} />

      <Route path="patient" element={<RequireRole roles={['patient']}><AppLayout /></RequireRole>}>
        <Route index element={<PatientDashboard />} />
        <Route path="find-doctors" element={<FindDoctorsPage basePath="/patient/find-doctors" embedded />} />
        
        {/* Our new Google Maps & Live Routing Finder component */}
        <Route path="map-doctors" element={<PatientDoctorFinder />} />

        <Route path="find-doctors/:id" element={<DoctorDetailsPage backTo="/patient/find-doctors" />} />
        <Route path="doctors/:id" element={<PatientDoctorRedirect />} />
        <Route path="book/:doctorId" element={<BookAppointmentPage />} />
        <Route path="appointments" element={<AppointmentsPage viewer="patient" />} />
        <Route path="appointments/:id" element={<AppointmentDetailPage viewer="patient" />} />
        <Route path="messages" element={<MessagesPage viewer="patient" />} />
        <Route path="messages/:conversationId" element={<MessagesPage viewer="patient" />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="reviews" element={<PatientReviewsPage />} />
        <Route path="profile" element={<PatientProfilePage />} />
        <Route path="*" element={<Navigate to="/patient" replace />} />
      </Route>

      <Route path="doctor" element={<RequireRole roles={['doctor']}><AppLayout /></RequireRole>}>
        <Route index element={<DoctorDashboard />} />
        <Route path="dashboard" element={<Navigate to="/doctor" replace />} />
        <Route path="appointments" element={<AppointmentsPage viewer="doctor" />} />
        <Route path="appointments/:id" element={<AppointmentDetailPage viewer="doctor" />} />
        
        {/* Prescription Routes */}
        <Route path="prescriptions/appointment/:appointmentId" element={<PrescriptionWriter />} />
        <Route path="prescriptions/:patientName" element={<PrescriptionWriter />} />
        <Route path="prescriptions" element={<PrescriptionWriter />} />

        <Route path="availability" element={<AvailabilityPage />} />
        <Route path="messages" element={<MessagesPage viewer="doctor" />} />
        <Route path="messages/:conversationId" element={<MessagesPage viewer="doctor" />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="profile" element={<DoctorProfilePage />} />
        <Route path="*" element={<Navigate to="/doctor" replace />} />
      </Route>

      <Route path="admin" element={<RequireRole roles={['admin', 'staff']}><AppLayout /></RequireRole>}>
        <Route index element={<AdminDashboard />} />
        <Route path="users" element={<RequirePermission access="users"><AdminUsersPage /></RequirePermission>} />
        <Route path="verifications" element={<RequirePermission access="verifications"><AdminVerificationsPage /></RequirePermission>} />
        <Route path="appointments" element={<RequirePermission access="appointments"><AdminAppointmentsPage /></RequirePermission>} />
        <Route path="specialties" element={<RequirePermission access="specialties"><AdminSpecialtiesPage /></RequirePermission>} />
        <Route path="reviews" element={<RequirePermission access="reviews"><AdminReviewsPage /></RequirePermission>} />
        <Route path="plans" element={<RequirePermission access="plans"><AdminPlansPage /></RequirePermission>} />
        <Route path="activity" element={<RequirePermission access="activity"><AdminActivityPage /></RequirePermission>} />
        <Route path="settings" element={<RequirePermission access="admin"><AdminSettingsPage /></RequirePermission>} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="profile" element={<AccountPage />} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Route>
    </Routes>
  );
}