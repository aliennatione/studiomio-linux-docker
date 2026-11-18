import { test, expect } from '@playwright/test';

test('app renders non-empty #app', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(3000);
  const html = await page.locator('#app').innerHTML();
  expect(html.length).toBeGreaterThan(0);
});

test('dispatch edit.addTrack queues command', async ({ request }) => {
  const res = await request.post('/command', {
    headers: { Authorization: 'Bearer secret123', 'Content-Type': 'application/json' },
    data: { action: 'command', name: 'edit.addTrack', args: ['audio'] },
  });
  expect(res.ok()).toBeTruthy();
  const pending = await request.get('/pending', { headers: { Authorization: 'Bearer secret123' } });
  const j = await pending.json();
  expect(j.command).toContain('edit.addTrack');
});

test('dispatch createDemoProject queues command', async ({ request }) => {
  const res = await request.post('/command', {
    headers: { Authorization: 'Bearer secret123', 'Content-Type': 'application/json' },
    data: { action: 'command', name: 'createDemoProject', args: [] },
  });
  expect(res.ok()).toBeTruthy();
});