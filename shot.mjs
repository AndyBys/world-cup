import { chromium } from 'playwright-core';

const EXEC = '/home/codespace/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome';
const base = 'http://localhost:4173/world-cup/#';

const browser = await chromium.launch({ executablePath: EXEC, args: ['--no-sandbox'] });

let page = await browser.newPage({ viewport: { width: 1500, height: 850 }, deviceScaleFactor: 1.5 });
await page.goto(base + '/tournament', { waitUntil: 'networkidle' });
await page.waitForTimeout(1800);
await page.screenshot({ path: '/tmp/bracket.png', fullPage: true });
console.log('bracket shot');

// Switch to Groups via the tab button specifically
await page.getByRole('button', { name: 'Groups' }).click();
await page.waitForSelector('.groups-grid', { timeout: 5000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: '/tmp/groups.png', fullPage: true });
console.log('groups shot');
await page.close();

page = await browser.newPage({ viewport: { width: 820, height: 1100 }, deviceScaleFactor: 1.5 });
await page.goto(base + '/team/Spain', { waitUntil: 'networkidle' });
await page.waitForTimeout(1800);
await page.screenshot({ path: '/tmp/team.png', fullPage: true });
console.log('team shot');

await browser.close();
