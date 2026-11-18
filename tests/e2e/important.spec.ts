import { test, expect } from '@playwright/test';

test('createDemoProject creates tracks', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(3000);
  const before = await page.evaluate(() => (window as any).studiomio.store.project.tracks.length);
  await page.evaluate(() => (window as any).studiomio.commands['createDemoProject']());
  await page.waitForTimeout(1000);
  const after = await page.evaluate(() => (window as any).studiomio.store.project.tracks.length);
  expect(after).toBeGreaterThan(before);
});

test('transport play/stop do not throw', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(3000);
  await page.evaluate(() => {
    const c = (window as any).studiomio.commands;
    c['transport.play']?.();
    c['transport.stop']?.();
  });
});