import { test, expect } from '@playwright/test';

test('studiomio loads and registers remote commands', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(4000);
  const schema = await page.evaluate(async () => {
    const r = await fetch('/schema', { headers: { Authorization: 'Bearer secret123' } });
    return r.json();
  });
  expect(schema.methods.length).toBeGreaterThan(0);
});