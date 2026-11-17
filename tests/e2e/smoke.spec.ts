import { test, expect } from '@playwright/test';

test('remote commands registered including edit.*', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(4000);
  const schema = await page.evaluate(async () => {
    const r = await fetch('/schema', { headers: { Authorization: 'Bearer secret123' } });
    return r.json();
  });
  expect(schema.methods).toContain('edit.addTrack');
  expect(schema.methods).toContain('createDemoProject');
});

test('dispatch edit.addTrack queues command', async ({ page, request }) => {
  await page.goto('/');
  await page.waitForTimeout(2000);
  const res = await request.post('http://localhost:8080/command', {
    headers: { Authorization: 'Bearer secret123', 'Content-Type': 'application/json' },
    data: { action: 'command', name: 'edit.addTrack', args: ['audio'] },
  });
  expect(res.ok()).toBeTruthy();
});