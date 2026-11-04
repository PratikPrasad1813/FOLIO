import { test, expect } from "@playwright/test";

const BASE = "http://127.0.0.1:3000";
test.use({ baseURL: BASE, viewport: { width: 1440, height: 1000 } });
test.setTimeout(180000);
test.beforeEach(async ({ page }) => { page.setDefaultTimeout(15000); });

const credentials = () => ({ email: `folio-${Date.now()}-${Math.random().toString(16).slice(2, 8)}@example.com`, password: "A-good-little-password-42" });

async function register(page: import("@playwright/test").Page, email: string, password: string, name = "Taylor Reed") {
  await page.goto("/");
  await page.getByRole("tab", { name: "Create account", exact: true }).click();
  await page.getByLabel("Your name", { exact: true }).fill(name);
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Create my workspace", exact: true }).click();
  await expect(page).toHaveURL(/\/overview$/);
}

test("sign-in gates the workspace, new accounts start empty, and all CRUD flows persist", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));

  const anonymous = await page.request.get("/api/workspace");
  expect(anonymous.status()).toBe(401);
  await page.goto("/overview");
  await expect(page).toHaveURL(`${BASE}/`);
  await expect(page.getByRole("heading", { name: "Welcome back.", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with Google", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with GitHub", exact: true })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("demo", { ignoreCase: true });

  await page.getByRole("button", { name: "Continue with Google", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Google sign-in needs this deployment to be connected");

  const { email, password } = credentials();
  await page.getByRole("tab", { name: "Create account", exact: true }).click();
  await page.getByLabel("Your name", { exact: true }).fill("Taylor Reed");
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Create my workspace", exact: true }).click();
  await expect(page).toHaveURL(/\/overview$/);
  await expect(page.getByRole("heading", { name: /Hello, Taylor/ })).toBeVisible();
  await expect(page.locator(".welcome-steps")).toContainText("Create your first project");
  await expect(page.locator(".save-status")).toContainText("All changes saved");

  let workspace = await (await page.request.get("/api/workspace")).json();
  expect(workspace.user.email).toBe(email);
  expect(workspace.projects).toHaveLength(0);
  expect(workspace.tasks).toHaveLength(0);
  expect(workspace.ideas).toHaveLength(0);
  expect(workspace.activities).toHaveLength(0);

  await page.locator(".welcome-start-actions").getByRole("button", { name: "Create your first project", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("Project name", { exact: true }).fill("Weekend field notes");
  await dialog.getByLabel("Description", { exact: true }).fill("A thoughtful collection of things worth noticing.");
  await dialog.getByLabel("Status", { exact: true }).selectOption("In progress");
  await dialog.getByRole("button", { name: "green color", exact: true }).click();
  await dialog.getByRole("button", { name: "Create project", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".project-title").filter({ hasText: "Weekend field notes" })).toBeVisible();
  await expect(page.locator(".welcome-start")).toHaveCount(0);

  await page.getByRole("button", { name: "Weekend field notes", exact: true }).last().click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Edit project", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Project name", { exact: true }).fill("Weekend field journal");
  await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: "Weekend field journal", exact: true })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Add task", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Task name", { exact: true }).fill("Write the first entry");
  await dialog.getByRole("button", { name: "Create task", exact: true }).click();
  await page.getByRole("dialog").getByRole("checkbox", { name: "Complete: Write the first entry", exact: true }).click();
  await expect(page.getByRole("dialog").getByText("100%", { exact: true })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Add to favorites", exact: true }).click();
  await expect(page.locator(".favorites-list")).toContainText("Weekend field journal");
  await page.getByRole("dialog").getByRole("button", { name: "Close dialog" }).click();

  workspace = await (await page.request.get("/api/workspace")).json();
  const project = workspace.projects.find((item: { name: string }) => item.name === "Weekend field journal");
  const task = workspace.tasks.find((item: { title: string }) => item.title === "Write the first entry");
  expect(project).toBeTruthy();
  expect(task.completed).toBe(true);
  expect(task.projectId).toBe(project.id);

  await page.getByRole("link", { name: /Idea board/ }).click();
  await page.locator(".new-resource-button").click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("What’s the idea?", { exact: true }).fill("Sunday sketchbook");
  await dialog.getByLabel("Let your thoughts wander", { exact: true }).fill("Explore one small drawing every Sunday morning.");
  await dialog.getByLabel("Stage", { exact: true }).selectOption("Ready to start");
  await dialog.getByRole("button", { name: "Save idea", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const ideaCard = page.locator(".idea-card").filter({ has: page.getByRole("button", { name: "Sunday sketchbook", exact: true }) });
  await ideaCard.getByRole("button", { name: "Make it a project", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Make it a project", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: "Sunday sketchbook", exact: true })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Close dialog" }).click();
  workspace = await (await page.request.get("/api/workspace")).json();
  expect(workspace.projects.some((item: { name: string }) => item.name === "Sunday sketchbook")).toBe(true);
  expect(workspace.ideas).toHaveLength(0);

  await page.locator(".sidebar-profile").click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(`${BASE}/`);
  await expect(page.getByRole("heading", { name: "Welcome back.", exact: true })).toBeVisible();
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill("wrong-password");
  await page.getByRole("button", { name: "Sign in to folio", exact: true }).click();
  await expect(page.locator(".auth-error")).toContainText("don’t match");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in to folio", exact: true }).click();
  await expect(page).toHaveURL(/\/overview$/);
  await page.reload();
  await expect(page.locator(".project-title").filter({ hasText: "Weekend field journal" })).toBeVisible();

  await page.getByRole("link", { name: /Projects/ }).first().click();
  await page.locator(".project-title").filter({ hasText: "Weekend field journal" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete project", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Yes, delete it", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  workspace = await (await page.request.get("/api/workspace")).json();
  expect(workspace.projects.some((item: { id: string }) => item.id === project.id)).toBe(false);
  expect(workspace.tasks.find((item: { id: string }) => item.id === task.id).projectId).toBeNull();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(350);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.getByRole("button", { name: "Open navigation", exact: true }).click();
  await page.getByRole("link", { name: "Calendar", exact: true }).click();
  await expect(page.locator("h1")).toHaveText("Calendar");
  await expect(page.locator(".calendar-day")).toHaveCount(42);
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  expect(errors).toEqual([]);
});

test("workspace API is authenticated, validated, and isolated per account", async ({ playwright }) => {
  const first = await playwright.request.newContext({ baseURL: BASE });
  const second = await playwright.request.newContext({ baseURL: BASE });
  expect((await first.get("/api/workspace")).status()).toBe(401);
  const a = credentials(); const b = credentials();
  expect((await first.post("/api/auth", { data: { action: "register", name: "Ada One", ...a } })).status()).toBe(200);
  expect((await second.post("/api/auth", { data: { action: "register", name: "Bo Two", ...b } })).status()).toBe(200);
  const seedless = await (await first.get("/api/workspace")).json();
  expect(seedless.projects).toEqual([]);
  expect(seedless.ideas).toEqual([]);
  expect(seedless.tasks).toEqual([]);
  const project = (await (await first.post("/api/workspace", { data: { kind: "projects", data: { name: "Private project" } } })).json()).item;
  expect((await second.patch("/api/workspace", { data: { kind: "projects", id: project.id, data: { name: "Not yours" } } })).status()).toBe(404);
  expect((await second.post("/api/workspace", { data: { kind: "tasks", data: { title: "Private task", projectId: project.id } } })).status()).toBe(400);
  expect((await first.post("/api/workspace", { data: { kind: "projects", data: { name: "" } } })).status()).toBe(400);
  for (const kind of ["projects", "tasks", "ideas"]) {
    const key = kind === "projects" ? "name" : "title";
    const created = await first.post("/api/workspace", { data: { kind, data: { [key]: `Test ${kind}` } } });
    expect(created.status()).toBe(201);
    const item = (await created.json()).item;
    const updated = await first.patch("/api/workspace", { data: { kind, id: item.id, data: { [key]: `Updated ${kind}` } } });
    expect(updated.status()).toBe(200);
    expect((await updated.json()).item[key]).toBe(`Updated ${kind}`);
    const persisted = await (await first.get("/api/workspace")).json();
    expect(persisted[kind].some((row: { id: string }) => row.id === item.id)).toBe(true);
    expect((await first.delete("/api/workspace", { data: { kind, id: item.id } })).status()).toBe(200);
    const after = await (await first.get("/api/workspace")).json();
    expect(after[kind].some((row: { id: string }) => row.id === item.id)).toBe(false);
  }
  expect((await first.post("/api/workspace", { headers: { Origin: "https://another-site.example" }, data: { kind: "ideas", data: { title: "CSRF attempt" } } })).status()).toBe(403);
  expect((await first.post("/api/auth", { data: { action: "register", name: "Again", email: a.email, password: a.password } })).status()).toBe(409);
  const duplicates = await first.get("/api/workspace");
  expect(duplicates.status()).toBe(200);
  await first.dispose(); await second.dispose();
});
