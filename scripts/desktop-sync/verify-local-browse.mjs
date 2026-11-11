/**
 * Offline verification of the local browse engine — the Projects and Tasks
 * filter semantics that replace the server browse inside the desktop shell
 * (the fix for "overview counted N projects but the list showed 0 matching").
 *
 * Runs on plain Node (type stripping + the alias loader in this folder):
 *   npm run test:desktop-sync
 */
import { browseLocalProjects, browseLocalTasks } from "@/lib/desktop/local-browse";
import { defaultFilters } from "@/lib/search-types";

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : ` — got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`}`);
}

const now = new Date().toISOString();
const user = { id: "u1", name: "Test", email: "t@t.dev", provider: "email", weeklyGoal: 12, onboardingCompleted: true, timezone: "UTC" };

const project = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "My First Project",
  description: "planned work",
  status: "Planning",
  priority: "Medium",
  color: "violet",
  icon: "layout",
  category: "Personal",
  startDate: null,
  dueDate: null,
  favorite: false,
  archived: false,
  createdAt: now,
  updatedAt: now,
};

const firstTask = {
  id: "33333333-3333-4333-8333-333333333333",
  title: "First task",
  description: "",
  projectId: project.id,
  milestoneId: null,
  status: "todo",
  completed: false,
  priority: "Medium",
  startDate: null,
  dueDate: null,
  labels: [],
  estimateMinutes: null,
  notes: "",
  completedAt: null,
  createdAt: now,
  updatedAt: now,
};

const projectData = { user, projects: [project], tasks: [firstTask], subtasks: [], ideas: [], milestones: [], activities: [] };

/* ---------- projects ---------- */

const all = browseLocalProjects(projectData, defaultFilters("projects"), 0, 60);
check("default filter lists the 1 project", all.total, 1);
check("project id matches", all.items.map((p) => p.id), [project.id]);
check("progress stats attached", [all.items[0].progress, all.items[0].taskCount], [0, 1]);

const planning = browseLocalProjects(projectData, { ...defaultFilters("projects"), statuses: ["Planning"] }, 0, 60);
check("Planning tab lists the project", planning.total, 1);

const inProgress = browseLocalProjects(projectData, { ...defaultFilters("projects"), statuses: ["In progress"] }, 0, 60);
check("In progress tab is empty", inProgress.total, 0);

check("query matches the project", browseLocalProjects(projectData, { ...defaultFilters("projects"), q: "first" }, 0, 60).total, 1);
check("query with no match is empty", browseLocalProjects(projectData, { ...defaultFilters("projects"), q: "zzz" }, 0, 60).total, 0);
check("archived view is empty", browseLocalProjects(projectData, { ...defaultFilters("projects"), archived: true }, 0, 60).total, 0);
check("0% progress filter matches", browseLocalProjects(projectData, { ...defaultFilters("projects"), progressMin: 0, progressMax: 0 }, 0, 60).total, 1);
check("1-100% progress filter excludes", browseLocalProjects(projectData, { ...defaultFilters("projects"), progressMin: 1, progressMax: 100 }, 0, 60).total, 0);
check("sorted list still shows it", browseLocalProjects(projectData, { ...defaultFilters("projects"), sort: "updated", dir: "desc" }, 0, 60).total, 1);

/* ---------- tasks ---------- */

const taskProject = { ...project, id: "p1", name: "Alpha" };
const t = (id, over = {}) => ({ ...firstTask, id, title: `Task ${id}`, projectId: "p1", ...over });
const taskData = {
  user,
  projects: [taskProject],
  tasks: [
    t("t1"),
    t("t2", { completed: true, status: "done", completedAt: now }),
    t("t3", { dueDate: "2020-01-01" }),
    t("t4", { projectId: null }),
    t("t5", { status: "in_progress", labels: ["zebra"] }),
  ],
  subtasks: [],
  ideas: [],
  milestones: [],
  activities: [],
};

check("all tasks", browseLocalTasks(taskData, defaultFilters("tasks"), 0, 60).total, 5);
check("smart sort: overdue open first", browseLocalTasks(taskData, defaultFilters("tasks"), 0, 60).items.map((i) => i.id)[0], "t3");
check("focus todo", browseLocalTasks(taskData, { ...defaultFilters("tasks"), focus: "todo" }, 0, 60).total, 3);
check("focus done", browseLocalTasks(taskData, { ...defaultFilters("tasks"), focus: "done" }, 0, 60).total, 1);
check("focus overdue", browseLocalTasks(taskData, { ...defaultFilters("tasks"), focus: "overdue" }, 0, 60).total, 1);
check("focus no_date", browseLocalTasks(taskData, { ...defaultFilters("tasks"), focus: "no_date" }, 0, 60).total, 4);
check("project filter", browseLocalTasks(taskData, { ...defaultFilters("tasks"), projects: ["p1"] }, 0, 60).total, 4);
check("project none filter", browseLocalTasks(taskData, { ...defaultFilters("tasks"), projects: ["none"] }, 0, 60).total, 1);
check("label filter", browseLocalTasks(taskData, { ...defaultFilters("tasks"), labels: ["zebra"] }, 0, 60).total, 1);
check("query hits project name", browseLocalTasks(taskData, { ...defaultFilters("tasks"), q: "alpha" }, 0, 60).total, 4);
check("query hits label via #", browseLocalTasks(taskData, { ...defaultFilters("tasks"), q: "#zebra" }, 0, 60).total, 1);
check("pagination limit", browseLocalTasks(taskData, defaultFilters("tasks"), 0, 2).items.length, 2);
check("pagination hasMore", browseLocalTasks(taskData, defaultFilters("tasks"), 0, 2).hasMore, true);
check("due-date range", browseLocalTasks(taskData, { ...defaultFilters("tasks"), from: "2019-01-01", to: "2021-01-01" }, 0, 60).total, 1);

console.log(failures ? `\n${failures} FAILURES` : "\nALL BROWSE CHECKS PASSED");
process.exit(failures ? 1 : 0);
