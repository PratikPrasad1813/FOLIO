import "dotenv/config";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";

// Integration tests use the REAL running application and PostgreSQL. Only
// disposable users prefixed search-test- are created; cleanup cascades from
// those exact IDs. No existing user's workspace or notification is altered.
const BASE = (process.env.TEST_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);
const owners = [];
let checks = 0;
const ok = (condition, message) => { assert.ok(condition, message); checks++; };
const equal = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const today = new Date().toISOString().slice(0, 10);
const day = n => { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const monday = day(-((new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7));
const sunday = new Date(new Date(`${monday}T12:00:00Z`).getTime() + 6 * 864e5).toISOString().slice(0, 10);
const iso = n => `${day(n)}T12:00:00.000Z`;

async function request(path, user, method = "GET", body, extra = {}) {
  const res = await fetch(`${BASE}${path}`, { method, headers: { Origin: BASE, ...(user ? { Cookie: `folio_session=${user.token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}), ...extra }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await res.json();
  return { status: res.status, data };
}
async function success(path, user, method = "GET", body) {
  const result = await request(path, user, method, body);
  ok(result.status >= 200 && result.status < 300, `${method} ${path.slice(0, 120)}: ${JSON.stringify(result.data)}`);
  return result.data;
}
async function makeUser(label) {
  const email = `search-test-${randomUUID()}@example.invalid`;
  const { rows: [user] } = await db.execute(sql`insert into folio_users (name, email, provider) values (${label}, ${email}, 'test') returning id`);
  owners.push(user.id);
  const token = randomBytes(32).toString("hex");
  const hash = createHash("sha256").update(token).digest("hex");
  await db.execute(sql`insert into folio_sessions (user_id, token_hash, expires_at) values (${user.id}, ${hash}, now() + interval '1 day')`);
  return { id: user.id, token };
}
async function project(user, name, status, priority, start, due, archived, index) {
  const { rows: [row] } = await db.execute(sql`insert into folio_projects (user_id, name, description, status, priority, start_date, due_date, archived, created_at, updated_at)
    values (${user.id}, ${name}, 'nebula project description', ${status}, ${priority}, ${start}, ${due}, ${archived}, ${iso(-10 + index)}, ${iso(-index)}) returning id`);
  return { ...row, name, status, priority, start, due, archived, created: iso(-10 + index), updated: iso(-index) };
}
async function task(user, title, projectId, status, priority, due, labels, index) {
  const { rows: [row] } = await db.execute(sql`insert into folio_tasks (user_id, project_id, title, description, notes, status, completed, priority, due_date, labels, created_at, updated_at)
    values (${user.id}, ${projectId}, ${title}, 'Keyboard flows and contrast', 'zebra-evidence prototype notes', ${status}, ${status === "done"}, ${priority}, ${due}, array[${sql.join(labels.map(label => sql`${label}`), sql`, `)}]::text[], ${iso(-10 + index)}, ${iso(-index)}) returning id`);
  return { ...row, title, projectId, status, priority, due, labels, created: iso(-10 + index), updated: iso(-index) };
}
async function browse(user, kind, filter = {}, limit = 60, offset = 0) {
  return success(`/api/workspace/browse?${new URLSearchParams({ kind, filters: JSON.stringify(filter), limit: String(limit), offset: String(offset) })}`, user);
}
const ids = rows => rows.map(r => r.id).sort();

try {
  const health = await fetch(`${BASE}/api/health`);
  equal(health.status, 200, "Start the Folio preview before running integration tests.");
  // The app's existing schema guard also applies additive Drizzle migrations.
  await request("/api/search?q=", null);
  const a = await makeUser("Search test A");
  const b = await makeUser("Search test B");
  const ps = [
    await project(a, "Alpha atelier", "In progress", "High", day(-3), day(2), false, 0),
    await project(a, "Beta finished", "Completed", "Medium", day(-8), day(-2), false, 1),
    await project(a, "Gamma planning", "Planning", "Low", day(4), null, false, 2),
    await project(a, "Delta overdue", "In progress", "Medium", day(-8), day(-1), false, 3),
    await project(a, "Archived reference", "Planning", "Low", day(-12), day(1), true, 4),
  ];
  const ts = [
    await task(a, "Polish nebula navigation", ps[0].id, "in_progress", "High", today, ["a11y", "Design"], 0),
    await task(a, "Write nebula documentation", ps[0].id, "todo", "Medium", day(1), ["docs"], 1),
    await task(a, "Shipped nebula tokens", ps[0].id, "done", "Low", day(-1), ["design"], 2),
    await task(a, "Fix nebula focus trap", ps[3].id, "todo", "Urgent", day(-1), ["bug", "a11y"], 3),
    await task(a, "Draft nebula idea", null, "in_review", "None", null, [], 4),
    await task(a, "100% coverage nebula", null, "todo", "Low", sunday, [], 5),
  ];
  const { rows: [idea] } = await db.execute(sql`insert into folio_ideas (user_id, title, description) values (${a.id}, 'nebula brainstorm', 'garden sketches') returning id`);
  const privateProject = await project(b, "PRIVATE nebula project", "Planning", "High", null, today, false, 0);
  const privateTask = await task(b, "PRIVATE nebula task", privateProject.id, "todo", "Urgent", today, [], 0);
  const { rows: [privateIdea] } = await db.execute(sql`insert into folio_ideas (user_id, title) values (${b.id}, 'PRIVATE nebula idea') returning id`);

  const all = await success("/api/search?q=nebula", a);
  equal(all.groups.length, 3, "Grouped project, task, idea results");
  equal(all.groups.find(g => g.kind === "projects").items.length, 5, "Project descriptions searchable, including archive");
  equal(all.groups.find(g => g.kind === "tasks").items.length, 6, "Tasks searchable");
  equal(all.groups.find(g => g.kind === "ideas").items[0].id, idea.id, "Ideas searchable");
  ok(!JSON.stringify(all).includes("PRIVATE"), "Search user isolation");
  equal((await success("/api/search?q=", a)).groups, [], "Empty query never returns entire workspace");
  for (const q of ["neb", "contrast", "zebra-evidence", "#a11y", "Alpha atelier"]) {
    const result = await success(`/api/search?${new URLSearchParams({ q, scope: "tasks" })}`, a);
    ok(result.groups[0].items.length > 0, `Task context search: ${q}`);
  }
  equal((await success("/api/search?q=%25&scope=tasks", a)).groups[0].items.map(x => x.id), [ts[5].id], "LIKE wildcard escaped literally");
  equal((await success(`/api/search?${new URLSearchParams({ q: "' OR 1=1 --" })}`, a)).groups.flatMap(g => g.items).length, 0, "Parameterized query is not executable SQL");
  for (const kind of ["projects", "tasks", "ideas"]) {
    const id = kind === "projects" ? ps[0].id : kind === "tasks" ? ts[0].id : idea.id;
    equal((await success(`/api/search/entity?kind=${kind}&id=${id}`, a)).item.id, id, `Existing ${kind} details load`);
  }
  console.log("✓ Grouped search, context fields, highlighting payloads, literal wildcards, and entity navigation");

  const scenarios = [
    [{ statuses: ["todo"] }, t => t.status === "todo"],
    [{ statuses: ["in_progress", "in_review"] }, t => ["in_progress", "in_review"].includes(t.status)],
    [{ priorities: ["Urgent", "High"] }, t => ["Urgent", "High"].includes(t.priority)],
    [{ projects: [ps[0].id] }, t => t.projectId === ps[0].id],
    [{ projects: ["none"] }, t => !t.projectId],
    [{ labels: ["DESIGN"] }, t => t.labels.some(l => l.toLowerCase() === "design")],
    [{ focus: "overdue" }, t => t.status !== "done" && t.due && t.due < today],
    [{ focus: "today" }, t => t.due === today],
    [{ focus: "week" }, t => t.due && t.due >= monday && t.due <= sunday],
    [{ focus: "upcoming" }, t => t.due && t.due > today],
    [{ focus: "no_date" }, t => !t.due],
    [{ from: today, to: day(1) }, t => t.due && t.due >= today && t.due <= day(1)],
    [{ q: "Polish", statuses: ["in_progress"], priorities: ["High"], projects: [ps[0].id], labels: ["a11y"], from: today, to: today }, t => t.id === ts[0].id],
  ];
  for (const [filters, predicate] of scenarios) equal(ids((await browse(a, "tasks", filters)).items), ids(ts.filter(predicate)), `Combined task filters ${JSON.stringify(filters)}`);
  const priorityRank = { Urgent: 0, High: 1, Medium: 2, Low: 3, None: 4 };
  const comparators = { created: (x, y) => x.created.localeCompare(y.created), updated: (x, y) => x.updated.localeCompare(y.updated), title: (x, y) => x.title.toLowerCase().localeCompare(y.title.toLowerCase()), priority: (x, y) => priorityRank[x.priority] - priorityRank[y.priority] };
  for (const [sort, compare] of Object.entries(comparators)) for (const dir of ["asc", "desc"]) {
    const rows = (await browse(a, "tasks", { sort, dir, q: "nebula" })).items;
    const originals = rows.map(r => ts.find(t => t.id === r.id));
    ok(originals.every((t, i) => !i || compare(originals[i - 1], t) * (dir === "asc" ? 1 : -1) <= 0), `Task sorting ${sort} ${dir}`);
  }
  for (const dir of ["asc", "desc"]) {
    const rows = (await browse(a, "tasks", { sort: "due", dir })).items;
    equal(rows.at(-1).id, ts[4].id, `Undated tasks always last (${dir})`);
    const dated = rows.filter(t => t.dueDate);
    ok(dated.every((t, i) => !i || dated[i - 1].dueDate.localeCompare(t.dueDate) * (dir === "asc" ? 1 : -1) <= 0), `Due sort ${dir}`);
  }
  const firstPage = await browse(a, "tasks", { sort: "created" }, 2);
  const secondPage = await browse(a, "tasks", { sort: "created" }, 2, 2);
  equal(firstPage.total, 6, "Unpaginated matching count");
  ok(firstPage.hasMore && secondPage.hasMore, "Pagination hasMore");
  equal(new Set([...firstPage.items, ...secondPage.items].map(t => t.id)).size, 4, "Stable, nonoverlapping pages");
  equal((await browse(a, "tasks", {})).total, 6, "Clear all restores all task matches");
  console.log("✓ All task filters, multi-filter combinations, sorting, Clear All, and pagination");

  const projectScenarios = [
    [{ statuses: ["In progress"] }, [ps[0], ps[3]]],
    [{ priorities: ["High"] }, [ps[0]]],
    [{ progressMin: 1, progressMax: 50 }, [ps[0]]],
    [{ progressMin: 0, progressMax: 0 }, [ps[1], ps[2], ps[3]]],
    [{ startFrom: today }, [ps[2]]],
    [{ startTo: day(-4) }, [ps[1], ps[3]]],
    [{ from: today, to: day(3) }, [ps[0]]],
    [{ deadline: "overdue" }, [ps[3]]],
    [{ deadline: "upcoming" }, [ps[0]]],
    [{ deadline: "no_date" }, [ps[2]]],
    [{ archived: true }, [ps[4]]],
    [{ statuses: ["In progress"], priorities: ["High"], progressMin: 30, progressMax: 40, deadline: "upcoming" }, [ps[0]]],
  ];
  for (const [filters, expected] of projectScenarios) equal(ids((await browse(a, "projects", filters)).items), ids(expected), `Project filters ${JSON.stringify(filters)}`);
  equal((await browse(a, "projects", { progressMin: 1 })).items[0].progress, 33, "Progress uses rounded completed/total task ratio");
  for (const sort of ["created", "updated", "priority", "name", "due", "progress"]) for (const dir of ["asc", "desc"]) {
    const result = await browse(a, "projects", { sort, dir });
    equal(result.total, 4, `Project ${sort} ${dir} retains filters`);
    if (sort === "due") equal(result.items.at(-1).id, ps[2].id, "Null project deadline sorts last");
  }
  console.log("✓ Project status, priority, progress, start/deadline ranges, overdue, upcoming, archive, and all sort modes");

  const saved = (await success("/api/filters", a, "POST", { kind: "tasks", name: "Focused work", config: { priorities: ["High"], sort: "title", dir: "asc" } })).filter;
  equal((await request("/api/filters", a, "POST", { kind: "tasks", name: "focused WORK", config: {} })).status, 409, "Case-insensitive duplicate saved names rejected");
  await success("/api/filters", b, "POST", { kind: "tasks", name: "Focused work", config: {} });
  equal((await success("/api/filters?kind=tasks", a)).filters.length, 1, "Saved filters isolated by user");
  equal((await browse(a, "tasks", saved.config)).items[0].id, ts[0].id, "Saved combination reapplies exactly");
  equal((await request(`/api/filters?id=${saved.id}`, b, "DELETE")).status, 404, "Cannot delete another user's saved filter");
  await success(`/api/filters?id=${saved.id}`, a, "DELETE");
  equal((await success("/api/filters?kind=tasks", a)).filters.length, 0, "Saved filter deletion persists");
  await success("/api/search/recent", a, "POST", { query: "nebula", scope: "tasks" });
  await success("/api/search/recent", a, "POST", { query: " NEBULA ", scope: "tasks" });
  equal((await success("/api/search/recent", a)).searches.length, 1, "Recent searches deduplicate normalized query");
  for (let i = 0; i < 9; i++) await success("/api/search/recent", a, "POST", { query: `search ${i}` });
  const recent = (await success("/api/search/recent", a)).searches;
  equal(recent.length, 8, "History bounded to eight per user");
  equal((await success("/api/search/recent", b)).searches.length, 0, "Recent searches are private");
  equal((await request(`/api/search/recent?id=${recent[0].id}`, b, "DELETE")).status, 404, "Cannot delete another user's search history");
  await success("/api/search/recent", a, "DELETE");
  equal((await success("/api/search/recent", a)).searches.length, 0, "Clear search history persists");
  // Concurrent saves share a database transaction lock, so quotas cannot race.
  for (let batch = 0; batch < 6; batch++) await Promise.all(Array.from({ length: 5 }, (_, i) => success('/api/filters', a, 'POST', { kind: 'tasks', name: `Quota test ${batch * 5 + i}`, config: {} })));
  equal((await request('/api/filters', a, 'POST', { kind: 'tasks', name: 'Over quota', config: {} })).status, 409, 'Saved filter quota is enforced');
  equal((await success('/api/filters?kind=tasks', a)).filters.length, 30, 'Concurrent writes preserve the per-user quota');
  console.log("✓ Saved filters and recent searches: persistence, normalization, reapplication, quotas, and deletion");

  const foreign = { projects: privateProject.id, tasks: privateTask.id, ideas: privateIdea.id };
  for (const kind of Object.keys(foreign)) equal((await request(`/api/search/entity?kind=${kind}&id=${foreign[kind]}`, a)).status, 404, `Cross-user ${kind} details forbidden`);
  equal((await browse(a, "tasks", { projects: [privateProject.id] })).total, 0, "Foreign project filter cannot leak tasks");
  for (const bad of [{ statuses: ["bad"] }, { projects: ["not-a-uuid"] }, { from: "2026-02-30" }, { from: "2026-05-10", to: "2026-01-01" }, { userId: b.id }, { sort: "drop table" }, { dir: "backwards" }, { progressMin: 50 }, { archived: true }]) {
    equal((await request(`/api/workspace/browse?${new URLSearchParams({ kind: "tasks", filters: JSON.stringify(bad) })}`, a)).status, 400, "Invalid filters rejected");
  }
  equal((await request('/api/workspace/browse?kind=projects&filters=%7B%22progressMin%22%3A80%2C%22progressMax%22%3A20%7D', a)).status, 400, "Invalid progress range rejected");
  equal((await request("/api/workspace/browse?kind=tasks&limit=0", a)).status, 400, "Zero limit rejected");
  equal((await request("/api/search?scope=private", a)).status, 400, "Invalid search scope rejected");
  equal((await request("/api/search?q=nebula", { token: "invalid" })).status, 401, "Invalid session fails closed, never falls back to demo");
  const expiredToken = randomBytes(32).toString("hex");
  await db.execute(sql`insert into folio_sessions (user_id, token_hash, expires_at) values (${a.id}, ${createHash("sha256").update(expiredToken).digest("hex")}, now() - interval '1 day')`);
  equal((await request("/api/search?q=nebula", { token: expiredToken })).status, 401, "Expired session rejected");
  equal((await request("/api/filters", a, "POST", { kind: "tasks", name: "bad", config: {} }, { Origin: "https://untrusted.invalid" })).status, 403, "Cross-origin writes rejected");
  console.log("✓ Authentication, user isolation, input validation, and cross-origin protection");
  equal((await success("/api/workspace", a)).tasks.length, 6, "Existing workspace still resolves the same signed-in user");
  ok((await request("/api/integrations/google", a)).status === 200, "Google Calendar integration route preserved");
  ok((await request("/api/notifications/unread-count", a)).status === 200, "Notification route preserved");
  console.log(`\nPASS: ${checks} assertions. Disposable fixtures will now be removed.`);
} finally {
  for (const id of owners) await db.execute(sql`delete from folio_users where id = ${id}`);
  await pool.end();
}
