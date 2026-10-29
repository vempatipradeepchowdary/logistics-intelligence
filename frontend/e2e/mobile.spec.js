import { expect, test } from '@playwright/test';

test('mobile: drawer navigation and collapsible filters', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Operations overview' })).toBeVisible();
  await page.getByRole('button', { name: 'Open navigation' }).click();
  const drawer = page.locator('#mobile-nav');
  await drawer.getByRole('link', { name: 'Tracking Events' }).click();
  await expect(page.getByRole('heading', { name: 'Tracking events' })).toBeVisible();
  await expect(drawer).toHaveClass(/-translate-x-full/);
  const toggle = page.getByRole('button', { name: /^Filters/ });
  await expect(page.getByLabel('Event type')).toBeHidden();
  await toggle.click();
  await expect(page.getByLabel('Event type')).toBeVisible();
  await expect(page.locator('tbody tr').first()).toBeVisible();
});
