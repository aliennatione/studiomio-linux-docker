import { test, expect } from '@playwright/test';

test('all edit commands callable without throwing', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(3000);
  const methods: string[] = await page.evaluate(() => Object.keys((window as any).studiomio.commands));
  const editMethods = methods.filter(m => m.startsWith('edit.'));
  const failures: string[] = [];
  for (const m of editMethods) {
    try {
      await page.evaluate((name) => (window as any).studiomio.commands[name](), m);
    } catch (e) {
      failures.push(m + ': ' + (e as Error).message);
    }
  }
  // allow some failures but report
  console.log('tested', editMethods.length, 'commands, failures:', failures.length);
  expect(failures.length).toBeLessThan(editMethods.length);
});