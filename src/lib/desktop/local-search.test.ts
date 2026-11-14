import test from "node:test";
import assert from "node:assert/strict";
import { getLocalSearchItem, searchLocalWorkspace } from "./local-search";
import { DEFAULT_PERSONAL } from "../personalization";
import type { WorkspaceData } from "../types";

const sampleWorkspace: WorkspaceData = {
  user: {
    id: "00000000-0000-4000-8000-000000000001",
    name: "Aarav Mehta",
    email: "aarav@example.com",
    provider: "email",
    weeklyGoal: 12,
    personal: {
      ...DEFAULT_PERSONAL,
      theme: "dark",
      weekStart: 1,
      taskDensity: "comfortable",
      taskInsights: true,
    },
    timezone: "UTC",
    onboardingCompleted: true,
    guideDismissed: true,
    greetingName: "Aarav",
  },
  projects: [
    {
      id: "10000000-0000-4000-8000-000000000001",
      name: "Folio Desktop",
      description: "Build native installers for Windows, macOS, and Linux",
      status: "In progress",
      priority: "High",
      color: "violet",
      icon: "layout",
      category: "Engineering",
      startDate: null,
      dueDate: "2026-12-01",
      favorite: true,
      archived: false,
      createdAt: "2026-11-01T10:00:00.000Z",
      updatedAt: "2026-11-05T10:00:00.000Z",
    },
    {
      id: "10000000-0000-4000-8000-000000000002",
      name: "Desktop Icons Pack",
      description: "Archive icon set",
      status: "Planning",
      priority: "Low",
      color: "blue",
      icon: "pen",
      category: "Design",
      startDate: null,
      dueDate: null,
      favorite: false,
      archived: true,
      createdAt: "2026-10-01T10:00:00.000Z",
      updatedAt: "2026-10-02T10:00:00.000Z",
    },
  ],
  tasks: [
    {
      id: "20000000-0000-4000-8000-000000000001",
      title: "Harden SQLite tombstone sync",
      description: "Propagate web deletions to desktop offline mirror",
      projectId: "10000000-0000-4000-8000-000000000001",
      milestoneId: null,
      status: "in_progress",
      completed: false,
      priority: "Urgent",
      startDate: null,
      dueDate: "2026-11-20",
      labels: ["offline", "sync"],
      estimateMinutes: 60,
      notes: "Verify soft deletes via deleted_at",
      completedAt: null,
      createdAt: "2026-11-02T10:00:00.000Z",
      updatedAt: "2026-11-06T10:00:00.000Z",
    },
    {
      id: "20000000-0000-4000-8000-000000000002",
      title: "Tombstone",
      description: "Exact title test",
      projectId: null,
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
      createdAt: "2026-11-01T10:00:00.000Z",
      updatedAt: "2026-11-01T10:00:00.000Z",
    },
  ],
  subtasks: [],
  milestones: [],
  ideas: [
    {
      id: "30000000-0000-4000-8000-000000000001",
      title: "Offline command palette",
      description: "Zero-latency desktop search",
      color: "yellow",
      category: "Product",
      status: "Exploring",
      createdAt: "2026-11-04T10:00:00.000Z",
    },
  ],
  activities: [],
};

test("searchLocalWorkspace searches projects, tasks, and ideas and ranks exact titles first", () => {
  const res = searchLocalWorkspace(sampleWorkspace, "Tombstone", "all", 8);
  assert.equal(res.groups.length, 3);
  const taskGroup = res.groups.find((g) => g.kind === "tasks");
  assert.ok(taskGroup);
  assert.equal(taskGroup.items.length, 2);
  assert.equal(taskGroup.items[0].title, "Tombstone");
  assert.equal(taskGroup.items[1].projectName, "Folio Desktop");
});

test("searchLocalWorkspace matches hash-prefixed labels and parent project names", () => {
  const res = searchLocalWorkspace(sampleWorkspace, "#offline folio", "tasks", 8);
  assert.equal(res.groups.length, 1);
  assert.equal(res.groups[0].items.length, 1);
  assert.equal(res.groups[0].items[0].id, "20000000-0000-4000-8000-000000000001");
});

test("searchLocalWorkspace honors scope, limit, and hasMore", () => {
  const res = searchLocalWorkspace(sampleWorkspace, "desktop", "projects", 1);
  assert.equal(res.groups.length, 1);
  assert.equal(res.groups[0].items.length, 1);
  assert.equal(res.groups[0].hasMore, true);
  assert.equal(res.groups[0].items[0].title, "Desktop Icons Pack"); // startsWith "Desktop" beats "Folio Desktop"
});

test("getLocalSearchItem resolves items or returns null when absent", () => {
  const found = getLocalSearchItem(sampleWorkspace, "ideas", "30000000-0000-4000-8000-000000000001");
  assert.ok(found);
  assert.equal("title" in found ? found.title : "", "Offline command palette");
  assert.equal(getLocalSearchItem(sampleWorkspace, "tasks", "missing-id"), null);
});
