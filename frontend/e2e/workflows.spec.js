import { expect, test } from '@playwright/test';

// Runs against the real backend + dataset; asserts on live values rather than fixtures.

const consoleErrors = [];
test.beforeEach(async ({ page }) => {
  consoleErrors.length = 0;
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
});
test.afterEach(() => {
  expect(consoleErrors, 'browser console errors').toEqual([]);
});

test('dashboard shows live KPIs and charts from the backend', async ({ page, request }) => {
  const summary = await (await request.get('/api/analytics/summary')).json();
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Operations overview' })).toBeVisible();
  const expected = new Intl.NumberFormat('en-US').format(summary.data.collections.shipments);
  await expect(page.getByText(expected, { exact: true }).first()).toBeVisible();
  await expect(page.getByText('API online')).toBeVisible();
  await expect(page.locator('.recharts-surface').first()).toBeVisible();
});

test('global search opens a shipment with its timeline and ETA history', async ({ page, request }) => {
  const list = await (await request.get('/api/shipments?limit=1&status=DELIVERED')).json();
  const id = list.data[0].shipmentId;
  await page.goto('/');
  await page.getByLabel('Search shipments by ID').fill(id);
  await page.getByLabel('Search shipments by ID').press('Enter');
  await expect(page).toHaveURL(new RegExp(`/shipments/${id}$`));
  await expect(page.getByRole('heading', { name: id })).toBeVisible();
  await expect(page.getByText('Tracking timeline')).toBeVisible();
  await expect(page.getByText('Picked up').first()).toBeVisible();
  await expect(page.getByText('Evaluation (ground truth)')).toBeVisible();
});

test('shipments table paginates on the server and keeps state in the URL', async ({ page }) => {
  await page.goto('/shipments');
  const firstRowLink = page.locator('tbody tr').first().getByRole('link').first();
  await expect(firstRowLink).toHaveText('SHP-2026-000001');
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(firstRowLink).toHaveText('SHP-2026-000026');
  await page.getByLabel('Status', { exact: true }).selectOption('EXCEPTION');
  await expect(page).toHaveURL(/status=EXCEPTION/);
  await expect(page).not.toHaveURL(/page=2/);
  await expect(page.locator('tbody tr').first()).toContainText('Exception');
});

test('tracking explorer isolates late-arriving events (ingestion vs event time)', async ({ page }) => {
  await page.goto('/tracking');
  await page.getByLabel('Late arrivals only').check();
  await expect(page).toHaveURL(/late=true/);
  await expect(page.locator('tbody tr').first()).toContainText('SHP-2026-9');
  await expect(page.locator('tbody').getByText(/^\+\d+d \d+h$/).first()).toBeVisible();
});

test('data quality page shows the latest real validation run', async ({ page, request }) => {
  const dq = await (await request.get('/api/analytics/data-quality')).json();
  await page.goto('/data-quality');
  await expect(page.getByText(`Run ${dq.data.status === 'PASS' ? 'PASSED' : 'FAILED'}`)).toBeVisible();
  await expect(page.getByText(dq.data.runId).first()).toBeVisible();
  await page.getByLabel('Validation status').selectOption('INTENTIONAL_ANOMALY');
  await expect(page.locator('tbody').last().getByText(/Intentional · ANM-/).first()).toBeVisible();
});

test('exports offer real downloadable files', async ({ page, request }) => {
  const exportsList = await (await request.get('/api/exports')).json();
  test.skip(!exportsList.data.length, 'no export on the server');
  await page.goto('/exports');
  const link = page.getByRole('link', { name: 'Download carriers.csv' }).first();
  await expect(link).toBeVisible();
  const res = await request.get(await link.getAttribute('href'));
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('text/csv');
  expect((await res.text()).split('\r\n')[0]).toContain('carrierId');
});

test('keyboard: skip link moves focus to the main content', async ({ page }) => {
  await page.goto('/shipments');
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to content' });
  await expect(skip).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#main$/);
});

test('admin: run validation as a background job from the UI', async ({ page }) => {
  test.skip(!process.env.E2E_ADMIN_KEY, 'set E2E_ADMIN_KEY to run admin workflows');
  test.setTimeout(240_000);
  await page.goto('/settings');
  await page.getByLabel('Admin API key').fill(process.env.E2E_ADMIN_KEY);
  await page.getByRole('button', { name: /Verify/ }).click();
  await expect(page.getByText('Key set for this session').first()).toBeVisible();
  await page.getByRole('link', { name: 'Data Quality' }).first().click();
  await page.getByRole('button', { name: 'Run validation now' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Start validation' }).click();
  await expect(page.getByText('Running').or(page.getByText('Queued')).first()).toBeVisible();
  await expect(page.getByText('Succeeded')).toBeVisible({ timeout: 200_000 });
});
