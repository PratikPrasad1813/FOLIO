import "dotenv/config";
import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { delimiter, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";

// Run with: npx --yes --package=@playwright/test -c 'node scripts/test-search-browser.mjs'
// Resolve the temporary npx install without adding Playwright to Folio's runtime dependencies.
const modulePath = (process.env.PATH || "").split(delimiter).map(bin => resolve(bin, "..", "playwright", "index.mjs")).find(existsSync);
if (!modulePath) throw new Error("Run this script through npx --package=@playwright/test (see SEARCH_AND_FILTERS.md).");
const { chromium } = await import(pathToFileURL(modulePath).href);
const BASE = (process.env.TEST_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);
const token = randomBytes(32).toString("hex");
let userId;
let browser;
let page;
const errors = [];
let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks++; };
const today = new Date().toISOString().slice(0, 10);
const tomorrow = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
mkdirSync("artifacts", { recursive: true });
async function api(path, body) {
  const response = await fetch(`${BASE}${path}`, { method: "POST", headers: { Origin: BASE, Cookie: `folio_session=${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json();
  assert.ok(response.ok, JSON.stringify(result));
  return result;
}
async function settledResults(expected) {
  await page.waitForFunction(n => {
    const result = document.querySelector('.pj-results-count');
    return result?.textContent?.includes(`${n} matching`) && !document.querySelector('.sf-results-pending');
  }, expected);
  checks++;
}
async function openSearch(q = "") {
  await page.getByRole("button", { name: "Search workspace", exact: true }).click();
  const input = page.getByRole("combobox", { name: "Search your workspace" });
  await input.waitFor();
  if (q) {
    await input.fill(q);
    await page.locator('.gs-result').first().waitFor();
  }
  return input;
}

try {
  await fetch(`${BASE}/api/search?q=`);
  const { rows: [owner] } = await db.execute(sql`insert into folio_users (name, email, provider) values ('Browser test user', ${`search-test-${randomUUID()}@example.invalid`}, 'test') returning id`);
  userId = owner.id;
  await db.execute(sql`update folio_users set onboarding_completed_at = now(), onboarding_step = 10 where id = ${userId}`);
  await db.execute(sql`insert into folio_sessions (user_id, token_hash, expires_at) values (${userId}, ${createHash("sha256").update(token).digest("hex")}, now() + interval '1 day')`);
  const { item: project } = await api('/api/workspace', { kind: 'projects', data: { name: 'Orchard Design Kit', description: 'A cohesive visual language for a calmer workspace.', status: 'In progress', priority: 'High', startDate: today, dueDate: tomorrow, color: 'violet', icon: 'pen' } });
  await api('/api/workspace', { kind: 'tasks', data: { title: 'Review Orchard typography', description: 'Check readability and optical spacing.', projectId: project.id, status: 'in_progress', priority: 'High', dueDate: today, labels: ['a11y'], reminder: { enabled: false } } });
  await api('/api/workspace', { kind: 'tasks', data: { title: 'Write Orchard documentation', description: 'Capture the component decisions.', projectId: project.id, status: 'todo', priority: 'Medium', dueDate: tomorrow, labels: ['docs'], reminder: { enabled: false } } });
  await api('/api/workspace', { kind: 'tasks', data: { title: 'Archive last review', projectId: project.id, status: 'done', priority: 'Low', reminder: { enabled: false } } });
  await api('/api/workspace', { kind: 'ideas', data: { title: 'Orchard weekly ritual', description: 'A quieter way to plan the week.', color: 'yellow' } });

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addCookies([{ name: 'folio_session', value: token, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  page = await context.newPage();
  page.setDefaultTimeout(15_000);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${BASE}/overview`);
  await page.getByRole('button', { name: 'Search workspace', exact: true }).waitFor();
  await page.getByRole('heading', { name: /Browser/ }).first().waitFor();
  await page.keyboard.press('Control+k');
  let input = page.getByRole('combobox', { name: 'Search your workspace' });
  await input.waitFor();
  check(await input.evaluate(el => el === document.activeElement), 'Ctrl+K focuses search input');
  await input.fill('Orchard');
  await page.locator('.gs-result').first().waitFor();
  check(await page.locator('.gs-group').count() === 3, 'All search groups visible');
  check(await page.locator('.gs-result mark').count() > 0, 'Matching terms highlighted');
  const firstActive = await input.getAttribute('aria-activedescendant');
  await input.press('ArrowDown');
  check(await input.getAttribute('aria-activedescendant') !== firstActive, 'ArrowDown updates active result');
  await page.screenshot({ path: 'artifacts/search-light.png' });
  await input.press('Enter');
  await page.getByRole('dialog', { name: 'Task details', exact: true }).waitFor();
  await page.waitForURL('**/tasks');
  check(page.url().includes('/tasks'), 'Keyboard selection opens actual task view and drawer');
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  input = await openSearch();
  await page.locator('.gs-recent-option').waitFor();
  check((await page.locator('.gs-recent-option').innerText()).includes('Orchard'), 'Submitted search persisted');
  await input.press('Enter');
  await page.locator('.gs-result').first().waitFor();
  await page.locator('.gs-scope-bar').getByRole('button', { name: 'Ideas', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.gs-result').length === 1 && document.querySelector('.gs-result')?.textContent?.includes('weekly ritual'));
  await page.locator('.gs-result').click();
  await page.waitForURL('**/ideas');
  await page.locator('.gs-palette').waitFor({ state: 'detached' });
  await page.getByRole('dialog').waitFor();
  check(page.url().includes('/ideas'), 'Idea result uses the existing idea editor');
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await openSearch('Orchard');
  await page.locator('.gs-scope-bar').getByRole('button', { name: 'Projects', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.gs-result').length === 1 && document.querySelector('.gs-result')?.textContent?.includes('Design Kit'));
  await page.locator('.gs-result').click();
  await page.waitForURL(`**/projects/${project.id}`);
  checks++;
  await page.keyboard.press('Meta+k');
  await page.getByRole('combobox', { name: 'Search your workspace' }).waitFor();
  await page.keyboard.press('Escape');
  await page.locator('.gs-palette').waitFor({ state: 'detached' });
  checks++;
  console.log('✓ Ctrl/Cmd+K, arrows, Enter, Escape, grouping, highlights, recent searches, project/task/idea navigation');

  await page.goto(`${BASE}/tasks`);
  await settledResults(3);
  await page.route('**/api/workspace/browse?**', async route => {
    const config = JSON.parse(new URL(route.request().url()).searchParams.get('filters') || '{}');
    if (config.q === 'slow filter') await new Promise(resolve => setTimeout(resolve, 700));
    await route.continue().catch(() => {});
  });
  const slowFilterSent = page.waitForRequest(req => new URL(req.url()).pathname === '/api/workspace/browse' && JSON.parse(new URL(req.url()).searchParams.get('filters') || '{}').q === 'slow filter');
  await page.getByRole('searchbox', { name: 'Search tasks', exact: true }).fill('slow filter');
  await slowFilterSent;
  await page.getByRole('searchbox', { name: 'Search tasks', exact: true }).fill('typography');
  await settledResults(1);
  await page.waitForTimeout(850);
  await settledResults(1);
  check((await page.locator('.tk-card').innerText()).includes('typography'), 'Late filter response cannot overwrite newer matches');
  await page.unroute('**/api/workspace/browse?**');
  await page.getByRole('button', { name: 'Clear search', exact: true }).click();
  await settledResults(3);
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  let filters = page.getByRole('dialog', { name: 'Advanced filters' });
  await filters.getByRole('button', { name: 'High', exact: true }).click();
  await filters.getByRole('button', { name: 'In progress', exact: true }).click();
  await filters.getByRole('button', { name: '#a11y', exact: true }).click();
  await settledResults(1);
  await page.screenshot({ path: 'artifacts/task-filters.png' });
  await filters.getByRole('button', { name: 'Done', exact: true }).click();
  check(await page.locator('.pj-results-bar .pj-chip').count() === 3, 'All active filters are removable chips');
  await page.locator('.tk-views').getByRole('button', { name: 'List', exact: true }).click();
  await settledResults(1);
  await page.locator('.tk-views').getByRole('button', { name: 'Calendar', exact: true }).click();
  await page.locator('.tk-cal-chip', { hasText: 'Review Orchard typography' }).waitFor();
  check(await page.locator('.tk-cal-chip').count() === 1, 'Calendar respects combined filters');
  await page.locator('.tk-views').getByRole('button', { name: 'Board', exact: true }).click();
  await page.locator('.tk-card').waitFor();
  check(await page.locator('.tk-card').count() === 1, 'Board respects same combined filters');
  await page.getByRole('button', { name: 'Saved filters', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Save this filter combination' }).click();
  await page.getByLabel('Filter name').fill('My focused work');
  await page.getByRole('button', { name: 'Save filter', exact: true }).click();
  await page.getByRole('dialog', { name: 'Keep this view close.' }).waitFor({ state: 'detached' });
  await page.locator('.pj-results-bar').getByRole('button', { name: 'Clear filters', exact: true }).click();
  await settledResults(3);
  await page.reload();
  await settledResults(3);
  await page.getByRole('button', { name: 'Saved filters', exact: true }).click();
  await page.getByRole('menuitem', { name: 'My focused work', exact: true }).click();
  await settledResults(1);
  await page.getByRole('button', { name: 'Saved filters', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Delete saved filter My focused work' }).click();
  await page.getByRole('dialog', { name: 'Delete saved filter?' }).getByRole('button', { name: 'Delete filter', exact: true }).click();
  await page.getByRole('dialog', { name: 'Delete saved filter?' }).waitFor({ state: 'detached' });
  checks++;
  console.log('✓ Task combined filters, chips, Clear All, Board/List/Calendar consistency, saved filter persistence and deletion');

  await page.goto(`${BASE}/projects`);
  await settledResults(1);
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  filters = page.getByRole('dialog', { name: 'Advanced filters' });
  await filters.getByLabel('Minimum progress').fill('25');
  await filters.getByLabel('Maximum progress').fill('75');
  await filters.getByLabel('Project status', { exact: true }).selectOption('In progress');
  await filters.getByLabel('Project priority', { exact: true }).selectOption('High');
  await filters.getByRole('button', { name: 'Next 7 days', exact: true }).click();
  await settledResults(1);
  await page.screenshot({ path: 'artifacts/project-filters.png' });
  await filters.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'Remove progress filter' }).click();
  await settledResults(1);
  await page.getByRole('combobox', { name: 'Sort projects', exact: true }).selectOption('priority');
  await settledResults(1);
  await page.getByRole('button', { name: 'List view', exact: true }).click();
  await page.getByRole('table', { name: 'Projects', exact: true }).waitFor();
  checks++;
  console.log('✓ Project progress, status, priority, upcoming deadlines, sorting, chips, and grid/list switching');

  input = await openSearch();
  await input.fill('nothing-matches-this-query');
  await page.getByRole('heading', { name: /No matches for/ }).waitFor();
  checks++;
  let outages = 0;
  await page.route('**/api/search?**', async route => {
    if (new URL(route.request().url()).searchParams.get('q') === 'temporary outage' && outages++ === 0) {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Temporary search outage' }) });
    } else await route.continue();
  });
  await input.fill('temporary outage');
  await page.getByRole('alert').filter({ hasText: 'Temporary search outage' }).waitFor();
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await page.getByRole('heading', { name: /No matches for/ }).waitFor();
  checks++;
  await page.unroute('**/api/search?**');
  let searchRequests = 0;
  const listener = req => { if (new URL(req.url()).pathname === '/api/search') searchRequests++; };
  await input.fill('');
  await page.waitForTimeout(250);
  page.on('request', listener);
  await input.pressSequentially('Orchard', { delay: 20 });
  await page.locator('.gs-result').first().waitFor();
  check(searchRequests === 1, 'Debounced typing makes one search request');
  page.off('request', listener);
  await page.route('**/api/search?**', async route => {
    if (new URL(route.request().url()).searchParams.get('q') === 'slow search') await new Promise(resolve => setTimeout(resolve, 700));
    await route.continue().catch(() => {});
  });
  const slowSearchSent = page.waitForRequest(req => new URL(req.url()).pathname === '/api/search' && new URL(req.url()).searchParams.get('q') === 'slow search');
  await input.fill('slow search');
  await slowSearchSent;
  await input.fill('Orchard');
  await page.locator('.gs-result').first().waitFor();
  await page.waitForTimeout(850);
  check(await page.locator('.gs-result').count() > 0 && await input.inputValue() === 'Orchard', 'Late global search response cannot overwrite newer matches');
  await page.unroute('**/api/search?**');
  await page.keyboard.press('Escape');
  await page.locator('.theme-toggle').click();
  check(await page.locator('html').getAttribute('data-theme') === 'dark', 'Existing theme toggle still works');
  await openSearch('Orchard');
  const darkBackground = await page.locator('.gs-palette').evaluate(el => getComputedStyle(el).backgroundColor);
  check(darkBackground !== 'rgb(255, 255, 255)', 'Search palette uses dark tokens');
  await page.screenshot({ path: 'artifacts/search-dark.png' });
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 844 });
  await openSearch('Orchard');
  const box = await page.locator('.gs-palette').boundingBox();
  check(box.x >= 0 && box.x + box.width <= 390 && box.y + box.height <= 844, 'Mobile search palette stays within viewport');
  await page.screenshot({ path: 'artifacts/search-mobile.png' });
  await page.keyboard.press('Escape');
  await page.goto(`${BASE}/tasks`);
  await settledResults(1);
  await page.locator('.sf-filter-button').click();
  const filterBox = await page.locator('.sf-popover').boundingBox();
  check(filterBox.x >= 0 && filterBox.x + filterBox.width <= 390, 'Mobile filter panel stays within viewport');
  await page.screenshot({ path: 'artifacts/filters-mobile.png' });
  await page.keyboard.press('Escape');
  check(errors.length === 0, `Browser exceptions: ${errors.join('; ')}`);
  console.log('✓ Empty/error/retry states, input debounce, dark theme, mobile bounds, and no browser exceptions');
  console.log(`\nPASS: ${checks} browser checks. Screenshots are in artifacts/.`);
} catch (error) {
  if (page) {
    await page.screenshot({ path: 'artifacts/search-test-failure.png' }).catch(() => {});
    console.error('Page:', page.url());
    console.error('Browser errors:', errors);
  }
  throw error;
} finally {
  if (browser) await browser.close();
  if (userId) await db.execute(sql`delete from folio_users where id = ${userId}`);
  await pool.end();
}
