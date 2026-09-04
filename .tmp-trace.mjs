import { chromium } from 'playwright-core';
import { browserArgs } from './tools/browser-args.mjs';
const browser = await chromium.launch({ channel: 'chrome', args: browserArgs() });
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
const seen = [];
page.on('console', m => seen.push(['console:' + m.type(), m.text()]));
page.on('pageerror', e => seen.push(['pageerror', e.stack || e.message]));
await page.goto(process.argv[2], { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForTimeout(Number(process.argv[3] || 120000));
for (const [k, t] of seen) { console.log('=== ' + k + ' ==='); console.log(String(t).slice(0, 2500)); }
console.log('total events:', seen.length);
await browser.close();
