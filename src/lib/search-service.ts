import { and, asc, desc, eq, gt, gte, ilike, inArray, isNull, lt, lte, ne, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { ideas, notificationPreferences, projects, tasks, users } from "@/db/schema";
import { getZonedParts, safeTimezone, shiftDateKey } from "@/lib/timezone";
import type { DatePreset, FilterConfig, FilterKind, SearchGroup, SearchKind, SearchResult, SearchScope } from "@/lib/search-types";

// Parameterized full-text search, plus literal substring matching for partial
// names and labels. Escape LIKE wildcards so %, _ and backslashes are literal.
export const escapeLike = (text: string) => text.replace(/[\\%_]/g, "\\$&");
const projectText = sql`${projects.name} || ' ' || ${projects.description} || ' ' || ${projects.category}`;
const taskText = sql`${tasks.title} || ' ' || ${tasks.description} || ' ' || ${tasks.notes}`;
const ideaText = sql`${ideas.title} || ' ' || ${ideas.description} || ' ' || ${ideas.category}`;
function match(text: SQL, query: string, additional?: SQL) {
  const document = additional ? sql`${text} || ' ' || ${additional}` : text;
  const tokens = query.split(/\s+/).filter(Boolean).slice(0, 20);
  return or(
    sql`to_tsvector('simple', ${text}) @@ plainto_tsquery('simple', ${query})`,
    and(...tokens.map(token => ilike(document, `%${escapeLike(token.replace(/^#/, ""))}%`))),
  );
}
function rank(title: SQL, text: SQL, q: string) {
  return sql`(case when lower(${title}) = lower(${q}) then 100 when ${title} ilike ${escapeLike(q) + "%"} then 60 when ${title} ilike ${"%" + escapeLike(q) + "%"} then 30 else 0 end) + ts_rank(to_tsvector('simple', ${text}), plainto_tsquery('simple', ${q}))`;
}
function snippet(text: string, query: string) {
  const flat = text.replace(/\s+/g, " ").trim();
  const words = query.toLowerCase().split(/\s+/).map(s => s.replace(/^#/, ""));
  const found = words.map(word => flat.toLowerCase().indexOf(word)).filter(index => index >= 0);
  const start = found.length ? Math.max(0, Math.min(...found) - 35) : 0;
  return `${start ? "…" : ""}${flat.slice(start, start + 160)}${flat.length > start + 160 ? "…" : ""}`;
}
export async function globalSearch(userId: string, q: string, scope: SearchScope, limit: number) {
  if (!q) return { query: q, groups: [] as SearchGroup[] };
  const kinds: SearchKind[] = scope === "all" ? ["projects", "tasks", "ideas"] : [scope];
  const groups = await Promise.all(kinds.map(async (kind): Promise<SearchGroup> => {
    let items: SearchResult[];
    if (kind === "projects") {
      const rows = await db.select().from(projects).where(and(eq(projects.userId, userId), isNull(projects.deletedAt), match(projectText, q)))
        .orderBy(desc(rank(sql`${projects.name}`, projectText, q)), desc(projects.updatedAt), asc(projects.id)).limit(limit + 1);
      items = rows.map(p => ({ id: p.id, kind, title: p.name, description: snippet(p.description || p.category, q), status: p.status, priority: p.priority, projectId: null, projectName: null, color: p.color, icon: p.icon, archived: p.archived, labels: [] }));
    } else if (kind === "tasks") {
      const rows = await db.select({ task: tasks, projectName: projects.name, projectColor: projects.color }).from(tasks)
        .leftJoin(projects, and(eq(tasks.projectId, projects.id), eq(projects.userId, userId), isNull(projects.deletedAt)))
        .where(and(eq(tasks.userId, userId), isNull(tasks.deletedAt), match(taskText, q, sql`coalesce(${projects.name}, '') || ' ' || array_to_string(${tasks.labels}, ' ')`)))
        .orderBy(desc(rank(sql`${tasks.title}`, taskText, q)), desc(tasks.updatedAt), asc(tasks.id)).limit(limit + 1);
      items = rows.map(({ task: t, projectName, projectColor }) => ({ id: t.id, kind, title: t.title, description: snippet([t.description, t.notes, ...t.labels.map(l => `#${l}`)].filter(Boolean).join(" · "), q), status: t.status, priority: t.priority, projectId: t.projectId, projectName, color: projectColor ?? "violet", icon: "task", archived: false, labels: t.labels }));
    } else {
      const rows = await db.select().from(ideas).where(and(eq(ideas.userId, userId), isNull(ideas.deletedAt), match(ideaText, q)))
        .orderBy(desc(rank(sql`${ideas.title}`, ideaText, q)), desc(ideas.createdAt), asc(ideas.id)).limit(limit + 1);
      items = rows.map(i => ({ id: i.id, kind, title: i.title, description: snippet(i.description || i.category, q), status: i.status, priority: null, projectId: null, projectName: null, color: i.color, icon: "idea", archived: false, labels: [] }));
    }
    return { kind, items: items.slice(0, limit), hasMore: items.length > limit };
  }));
  return { query: q, groups };
}

export async function workspaceToday(userId: string) {
  const [prefs] = await db.select({ timezone: notificationPreferences.timezone }).from(notificationPreferences).where(eq(notificationPreferences.userId, userId)).limit(1);
  return getZonedParts(new Date(), safeTimezone(prefs?.timezone)).dateKey;
}
export function mondayOf(date: string) {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return shiftDateKey(date, -((day + 6) % 7));
}
const priorityRank = (column: SQL) => sql`case ${column} when 'Urgent' then 0 when 'High' then 1 when 'Medium' then 2 when 'Low' then 3 else 4 end`;
function dates(column: SQL, preset: DatePreset | "upcoming_tasks", today: string, weekStartDay = 1) {
  if (preset === "overdue") return lt(column, today);
  if (preset === "today") return eq(column, today);
  if (preset === "week") {
    const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
    const first = shiftDateKey(today, -((weekday - weekStartDay + 7) % 7));
    return and(gte(column, first), lte(column, shiftDateKey(first, 6)));
  }
  if (preset === "upcoming") return and(gte(column, today), lte(column, shiftDateKey(today, 7)));
  if (preset === "upcoming_tasks") return gt(column, today);
  if (preset === "no_date") return isNull(column);
  return undefined;
}

export async function browseWorkspace(userId: string, kind: FilterKind, f: FilterConfig, limit: number, offset: number) {
  const today = await workspaceToday(userId);
  const [user] = await db.select({ personal: users.personal }).from(users).where(eq(users.id, userId)).limit(1);
  const weekStartDay = user?.personal?.weekStart ?? 1;
  // All dynamic field and direction choices use allow-listed SQL expressions.
  const order = (expression: SQL) => f.dir === "asc" ? sql`${expression} asc nulls last` : sql`${expression} desc nulls last`;
  if (kind === "tasks") {
    const conditions: (SQL | undefined)[] = [eq(tasks.userId, userId), isNull(tasks.deletedAt)];
    if (f.statuses.length) conditions.push(inArray(tasks.status, f.statuses));
    if (f.priorities.length) conditions.push(inArray(tasks.priority, f.priorities));
    if (f.projects.length) conditions.push(or(
      f.projects.includes("none") ? isNull(tasks.projectId) : undefined,
      f.projects.some(id => id !== "none") ? inArray(tasks.projectId, f.projects.filter(id => id !== "none")) : undefined,
    ));
    if (f.labels.length) conditions.push(sql`exists (select 1 from unnest(${tasks.labels}) as label where lower(label) in (${sql.join(f.labels.map(l => sql`${l}`), sql`, `)}))`);
    if (f.from) conditions.push(gte(tasks.dueDate, f.from));
    if (f.to) conditions.push(lte(tasks.dueDate, f.to));
    if (f.startFrom) conditions.push(gte(tasks.startDate, f.startFrom));
    if (f.startTo) conditions.push(lte(tasks.startDate, f.startTo));
    if (["todo", "in_progress", "in_review", "done"].includes(f.focus)) conditions.push(eq(tasks.status, f.focus));
    else conditions.push(dates(sql`${tasks.dueDate}`, f.focus === "upcoming" ? "upcoming_tasks" : f.focus as DatePreset, today, weekStartDay));
    if (f.focus === "overdue" || f.deadline === "overdue") conditions.push(eq(tasks.completed, false));
    conditions.push(dates(sql`${tasks.dueDate}`, f.deadline, today, weekStartDay));
    if (f.q) conditions.push(match(taskText, f.q, sql`coalesce(${projects.name}, '') || ' ' || array_to_string(${tasks.labels}, ' ')`));
    const by: Record<string, SQL> = {
      title: sql`lower(${tasks.title})`, priority: priorityRank(sql`${tasks.priority}`), due: sql`${tasks.dueDate}`,
      created: sql`${tasks.createdAt}`, updated: sql`${tasks.updatedAt}`, project: sql`lower(${projects.name})`,
      status: sql`case ${tasks.status} when 'todo' then 0 when 'in_progress' then 1 when 'in_review' then 2 else 3 end`,
    };
    const ordering = f.sort === "smart"
      ? [order(sql`${tasks.completed}`), order(sql`${tasks.dueDate}`), order(priorityRank(sql`${tasks.priority}`)), asc(tasks.id)]
      : [order(by[f.sort]), asc(tasks.id)];
    const join = and(eq(tasks.projectId, projects.id), eq(projects.userId, userId), isNull(projects.deletedAt));
    const [rows, [count]] = await Promise.all([
      db.select({ item: tasks }).from(tasks).leftJoin(projects, join).where(and(...conditions)).orderBy(...ordering).limit(limit).offset(offset),
      db.select({ total: sql<number>`count(*)::int` }).from(tasks).leftJoin(projects, join).where(and(...conditions)),
    ]);
    const total = count?.total ?? 0;
    return { items: rows.map(({ item: { userId: _user, ...item } }) => item), total, hasMore: offset + rows.length < total, offset, limit, today };
  }
  // Aggregate in PostgreSQL, scoped by owner, using the exact same completed/
  // total task ratio as Folio's existing project cards. Empty projects = 0%.
  const taskStats = db.select({ projectId: tasks.projectId,
    progress: sql<number>`round(100.0 * count(*) filter (where ${tasks.completed}) / nullif(count(*), 0))::integer`.as("progress"),
    total: sql<number>`count(*)::integer`.as("total"),
    done: sql<number>`count(*) filter (where ${tasks.completed})::integer`.as("done"),
  }).from(tasks).where(and(eq(tasks.userId, userId), isNull(tasks.deletedAt))).groupBy(tasks.projectId).as("task_stats");
  const progress = sql<number>`coalesce(${taskStats.progress}, 0)::integer`;
  const conditions: (SQL | undefined)[] = [eq(projects.userId, userId), isNull(projects.deletedAt), eq(projects.archived, f.archived)];
  if (f.statuses.length) conditions.push(inArray(projects.status, f.statuses));
  if (f.priorities.length) conditions.push(inArray(projects.priority, f.priorities));
  if (f.q) conditions.push(match(projectText, f.q));
  if (f.from) conditions.push(gte(projects.dueDate, f.from));
  if (f.to) conditions.push(lte(projects.dueDate, f.to));
  if (f.startFrom) conditions.push(gte(projects.startDate, f.startFrom));
  if (f.startTo) conditions.push(lte(projects.startDate, f.startTo));
  if (f.progressMin !== null) conditions.push(gte(progress, f.progressMin));
  if (f.progressMax !== null) conditions.push(lte(progress, f.progressMax));
  if (["overdue", "upcoming"].includes(f.deadline)) conditions.push(ne(projects.status, "Completed"));
  conditions.push(dates(sql`${projects.dueDate}`, f.deadline, today, weekStartDay));
  const by: Record<string, SQL> = { name: sql`lower(${projects.name})`, priority: priorityRank(sql`${projects.priority}`), created: sql`${projects.createdAt}`, updated: sql`${projects.updatedAt}`, due: sql`${projects.dueDate}`, progress };
  const join = eq(taskStats.projectId, projects.id);
  const [rows, [count]] = await Promise.all([
    db.select({ item: projects, progress, taskCount: sql<number>`coalesce(${taskStats.total}, 0)::integer`, completedTaskCount: sql<number>`coalesce(${taskStats.done}, 0)::integer` }).from(projects).leftJoin(taskStats, join).where(and(...conditions)).orderBy(order(by[f.sort]), asc(projects.id)).limit(limit).offset(offset),
    db.select({ total: sql<number>`count(*)::int` }).from(projects).leftJoin(taskStats, join).where(and(...conditions)),
  ]);
  const total = count?.total ?? 0;
  return { items: rows.map(({ item: { userId: _user, ...item }, progress: value, taskCount, completedTaskCount }) => ({ ...item, progress: value, taskCount, completedTaskCount })), total, hasMore: offset + rows.length < total, offset, limit, today };
}
