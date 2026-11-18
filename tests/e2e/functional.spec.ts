import { test, expect } from '@playwright/test';

test('edit.addTrack increases track count', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(3000);
  const before = await page.evaluate(() => (window as any).studiomio.store.project.tracks.length);
  await page.evaluate(async () => {
    await fetch('/command', {
      method: 'POST',
      headers: { Authorization: 'Bearer secret123', 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'command', name: 'edit.addTrack', args: ['audio'] }),
    });
  });
  // consume pending via app polling? Instead invoke directly through app.commands
  await page.evaluate(() => (window as any).studiomio.commands['edit.addTrack']('audio'));
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => (window as any).studiomio.store.project.tracks.length);
  expect(after).toBe(before + 1);
});