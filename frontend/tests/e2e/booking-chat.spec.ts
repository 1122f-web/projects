import { expect, test } from '@playwright/test';
import { newSession, users, watchErrors } from './helpers';

// One full journey: book, block the same slot for others, confirm, chat live, cancel.
test('patient books, doctor confirms, they chat in real time, patient cancels', async ({ browser }) => {
  test.slow();
  const jane = await newSession(browser, users.jane);
  const errors = watchErrors(jane);

  await jane.goto('/patient/find-doctors');
  await jane.getByRole('link', { name: /Amani/ }).first().click();
  await jane.getByRole('link', { name: /book/i }).first().click();
  await expect(jane).toHaveURL(/\/patient\/book\//);
  const bookUrl = jane.url();

  // A day a few days out, so earlier runs and other tests do not collide.
  await jane.locator('button:has-text("times")').nth(3).click();
  const slot = jane.locator('button', { hasText: /^\d\d:\d\d$/ }).first();
  const time = await slot.innerText();
  await slot.click();
  await jane.getByText('Online', { exact: true }).click();
  await jane.locator('textarea').fill('E2E fictional test visit');
  await jane.getByRole('button', { name: 'Review and confirm' }).click();
  await jane.getByRole('button', { name: 'Book appointment' }).click();
  await expect(jane).toHaveURL(/\/patient\/appointments\/[0-9a-f-]{36}$/);
  const appointmentId = jane.url().split('/').pop()!;

  // The slot is gone for another patient.
  const peter = await newSession(browser, users.peter);
  await peter.goto(bookUrl);
  await peter.locator('button:has-text("times")').nth(3).click();
  await expect(peter.locator('button', { hasText: /^\d\d:\d\d$/ }).first()).not.toHaveText(time);

  // Doctor confirms; the patient's page updates without a reload.
  const doctor = await newSession(browser, users.amani);
  await doctor.goto(`/doctor/appointments/${appointmentId}`);
  await doctor.getByRole('button', { name: 'Confirm appointment' }).click();
  await doctor.locator('dialog[open]').getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(jane.locator('main')).toContainText('Confirmed', { timeout: 10_000 });

  // Live chat both ways with a read receipt.
  await jane.getByRole('link', { name: 'Message doctor' }).click();
  await expect(jane).toHaveURL(/\/patient\/messages\//);
  await doctor.goto(new URL(jane.url()).pathname.replace('/patient/', '/doctor/'));
  await expect(doctor.getByText('Live')).toBeVisible();
  const text = `Hello doctor ${Date.now()}`;
  await jane.locator('#message-input').fill(text);
  await jane.keyboard.press('Enter');
  await expect(doctor.getByLabel('Message history').getByText(text)).toBeVisible({ timeout: 10_000 });
  await doctor.locator('#message-input').fill('Received, see you then.');
  await doctor.getByRole('button', { name: 'Send message' }).click();
  await expect(jane.getByLabel('Message history').getByText('Received, see you then.').last()).toBeVisible({ timeout: 10_000 });
  await expect(jane.getByLabel('Read').last()).toBeVisible({ timeout: 10_000 });

  // A file that is not really a PDF is refused with a clear message.
  await jane.locator('input[type=file]').setInputFiles({ name: 'fake.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not a pdf') });
  await jane.getByRole('button', { name: 'Send message' }).click();
  await expect(jane.getByText(/Unsupported file type/)).toBeVisible();

  // Cancel so the slot is free for the next run.
  await jane.goto(`/patient/appointments/${appointmentId}`);
  await jane.getByRole('button', { name: 'Cancel appointment' }).click();
  await jane.locator('dialog[open]').getByRole('button', { name: 'Cancel appointment' }).click();
  await expect(jane.locator('main')).toContainText('Cancelled');

  expect(errors).toEqual([]);
});
