import { expect, type Browser, type Page } from '@playwright/test';

export const DEMO_PASSWORD = 'DemoPass123';
export const users = {
  jane: 'patient.jane@demo.mediconnect.test',
  peter: 'patient.peter@demo.mediconnect.test',
  amani: 'dr.amani@demo.mediconnect.test',
  admin: 'admin@demo.mediconnect.test',
};

/** Collects browser errors and failed API calls so tests can assert there were none. */
export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`);
  });
  page.on('response', (r) => {
    if (r.url().includes('/api/') && r.status() >= 500) errors.push(`${r.status()} ${r.url()}`);
  });
  return errors;
}

export async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.locator('input[type=email]').fill(email);
  await page.locator('input[type=password]').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

export async function newSession(browser: Browser, email: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page, email);
  return page;
}

/**
 * Fails if the page scrolls sideways or if any element sticks out past the
 * viewport (content that is merely clipped would otherwise go unnoticed).
 * Children of horizontal scrollers, such as the date strip, are allowed.
 */
export async function expectNoHorizontalScroll(page: Page) {
  const offenders = await page.evaluate(() => {
    const width = window.innerWidth;
    const scrolls = (el: Element) => ['auto', 'scroll'].includes(getComputedStyle(el).overflowX);
    const bad: string[] = [];
    if (document.documentElement.scrollWidth > width + 1) bad.push(`page scrollWidth ${document.documentElement.scrollWidth}`);
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.right <= width + 1) continue;
      let parent = el.parentElement;
      let inScroller = false;
      while (parent && !inScroller) {
        inScroller = scrolls(parent) && parent.getBoundingClientRect().right <= width + 1;
        parent = parent.parentElement;
      }
      if (!inScroller && getComputedStyle(el).position !== 'fixed') bad.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} right=${Math.round(r.right)}`);
    }
    return bad.slice(0, 5);
  });
  expect(offenders).toEqual([]);
}
