import { expect, test } from '@playwright/test';
import { expectNoHorizontalScroll, login, users, watchErrors } from './helpers';

const publicPages = ['/', '/about', '/how-it-works', '/contact', '/privacy', '/terms', '/doctors', '/login', '/register', '/forgot-password'];
const areas: Record<string, { email: string; pages: string[] }> = {
  patient: { email: users.jane, pages: ['/patient', '/patient/find-doctors', '/patient/book/' + '__FIRST_DOCTOR__', '/patient/appointments', '/patient/messages', '/patient/notifications', '/patient/reviews', '/patient/profile'] },
  doctor: { email: users.amani, pages: ['/doctor', '/doctor/appointments', '/doctor/availability', '/doctor/messages', '/doctor/notifications', '/doctor/profile'] },
  admin: { email: users.admin, pages: ['/admin', '/admin/users', '/admin/verifications', '/admin/appointments', '/admin/specialties', '/admin/reviews', '/admin/activity', '/admin/settings', '/admin/profile'] },
};

test('public pages render without errors or sideways scrolling', async ({ page }) => {
  const errors = watchErrors(page);
  for (const path of publicPages) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('main')).toBeVisible();
    await expectNoHorizontalScroll(page);
  }
  await page.goto('/doctors');
  await page.locator('a[href^="/doctors/"]').first().click();
  await expect(page.getByRole('link', { name: /book/i }).first()).toBeVisible();
  await expectNoHorizontalScroll(page);
  expect(errors).toEqual([]);
});

for (const [role, { email, pages }] of Object.entries(areas)) {
  test(`${role} pages render without errors`, async ({ page }) => {
    const errors = watchErrors(page);
    await login(page, email);
    const doctors = (await (await page.request.get('/api/doctors')).json()) as { items: { id: string }[] };
    for (const path of pages.map((p) => p.replace('__FIRST_DOCTOR__', doctors.items[0]!.id))) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('main')).not.toContainText(/something went wrong/i);
      await expectNoHorizontalScroll(page);
    }
    expect(errors).toEqual([]);
  });
}

test('a patient cannot open admin pages', async ({ page }) => {
  await login(page, users.jane);
  await page.goto('/admin/users');
  await expect(page).toHaveURL(/\/patient$/);
});

test('signed-out visitors are sent to login and returned afterwards', async ({ page }) => {
  await page.goto('/patient/appointments');
  await expect(page).toHaveURL(/\/login\?next=/);
  await page.locator('input[type=email]').fill(users.jane);
  await page.locator('input[type=password]').fill('DemoPass123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/patient\/appointments$/);
});

test('login shows a clear error for a wrong password', async ({ page }) => {
  await page.goto('/login');
  await page.locator('input[type=email]').fill(users.jane);
  await page.locator('input[type=password]').fill('WrongPass123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Incorrect email or password')).toBeVisible();
});
