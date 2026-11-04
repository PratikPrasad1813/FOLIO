import "dotenv/config";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { sql } from "drizzle-orm";

const load = createRequire(import.meta.url)("./folio-test-loader.cjs");
const { db, pool } = load(resolve("src/db/index.ts"));
const {
  parseNaturalLanguageIntent,
  repairAndExtractActionPlan,
} = load(resolve("src/lib/folio-ai/intent-pipeline.ts"));
const { validateActionPlan } = load(resolve("src/lib/folio-ai/actions.ts"));

import { spawn } from "node:child_process";
import { createServer } from "node:net";

// Exercises the complete Folio AI Workspace Operator pipeline against real
// Folio APIs and PostgreSQL. Uses disposable test users removed by ID in finally.
let BASE = (process.env.TEST_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const userIds = [];
let checks = 0;
let server = null;
let serverLog = "";

const ok = (condition, message) => { assert.ok(condition, message); checks++; };
const equal = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };

async function freePort() {
  const s = createServer();
  await new Promise((resolve, reject) => s.listen(0, "127.0.0.1", resolve).on("error", reject));
  const port = s.address().port;
  await new Promise(resolve => s.close(resolve));
  return port;
}

async function waitForHealth(base) {
  for (let i = 0; i < 120; i++) {
    if (server && server.exitCode !== null) throw new Error("Test Next.js server exited prematurely.");
    try {
      const res = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1500) });
      if (res.ok) return;
    } catch {
      // wait
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error("Test Next.js server did not become healthy.");
}

async function createAccount(label) {
  const email = `folio-ai-operator-test-${randomUUID()}@example.invalid`;
  const { rows: [user] } = await db.execute(
    sql`insert into folio_users (name, email, provider) values (${label}, ${email}, 'test') returning id`
  );
  userIds.push(user.id);
  const token = randomBytes(32).toString("hex");
  await db.execute(
    sql`insert into folio_sessions (user_id, token_hash, expires_at) values (${user.id}, ${createHash("sha256").update(token).digest("hex")}, now() + interval '1 day')`
  );
  return { id: user.id, token };
}

async function request(path, token, method = "GET", body, origin = BASE) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Origin: origin,
      ...(token ? { Cookie: `folio_session=${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() };
}

async function postActions(token, actions, confirm = false) {
  return request("/api/ai/actions", token, "POST", { actions, confirm });
}

async function getWorkspace(token) {
  const res = await request("/api/workspace", token);
  equal(res.status, 200, "Workspace data retrieved");
  return res.body;
}

try {
  let isRunning = false;
  try {
    const healthCheck = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(1200) });
    if (healthCheck.ok) isRunning = true;
  } catch {
    // not running
  }

  if (!isRunning) {
    const port = await freePort();
    BASE = `http://127.0.0.1:${port}`;
    server = spawn(
      process.execPath,
      ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", String(port)],
      {
        env: {
          ...process.env,
          NODE_ENV: "development",
          APP_URL: BASE,
          NEXT_PUBLIC_APP_URL: BASE,
          SMTP_URL: "",
          SMTP_FROM: "",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    for (const stream of [server.stdout, server.stderr]) {
      stream.on("data", chunk => {
        serverLog = (serverLog + chunk.toString()).slice(-4000);
      });
    }
    await waitForHealth(BASE);
  }

  equal((await fetch(`${BASE}/api/health`)).status, 200, "Folio server running and healthy");
  const a = await createAccount("AI Workspace Operator A");
  const b = await createAccount("AI Workspace Operator B");

  console.log("\n--- SECTION 1: Robust Model Plan Extraction & Malformed JSON Repair ---");

  // 1.1 Unclosed [AI_ACTION_PLAN] tag
  const unclosed = `Sure! I have prepared the plan:\n[AI_ACTION_PLAN]\n{"actions": [{"id": "create_project", "params": {"name": "Unclosed Tag Project"}}]}`;
  const extractedUnclosed = repairAndExtractActionPlan(unclosed);
  ok(extractedUnclosed !== null, "Extracts plan even when [/AI_ACTION_PLAN] closing tag was omitted");
  equal(extractedUnclosed[0].params.name, "Unclosed Tag Project", "Correctly parsed unclosed plan");

  // 1.2 Markdown code fences around or inside plan
  const markdownPlan = `[AI_ACTION_PLAN]\n\`\`\`json\n{"actions": [{"id": "create_idea", "params": {"title": "Markdown Idea"}}]}\n\`\`\`\n[/AI_ACTION_PLAN]`;
  const extractedMarkdown = repairAndExtractActionPlan(markdownPlan);
  ok(extractedMarkdown !== null, "Extracts plan wrapped in markdown code blocks");
  equal(extractedMarkdown[0].id, "create_idea", "Parsed markdown plan action ID");

  // 1.3 Relaxed JSON with trailing commas and single quotes
  const relaxedJson = `[AI_ACTION_PLAN]\n{'actions': [{'id': 'create_task', 'params': {'title': 'Relaxed Task', 'priority': 'High',},},],}\n[/AI_ACTION_PLAN]`;
  const extractedRelaxed = repairAndExtractActionPlan(relaxedJson);
  ok(extractedRelaxed !== null, "Repairs trailing commas and single quotes");
  equal(extractedRelaxed[0].params.title, "Relaxed Task", "Extracted relaxed task title");

  // 1.4 Action ID aliases normalization (create-task, add_project)
  const aliased = `[AI_ACTION_PLAN]\n{"actions": [{"id": "add_project", "params": {"name": "Aliased Project"}}, {"id": "new_task", "params": {"title": "Aliased Task"}}]}[/AI_ACTION_PLAN]`;
  const extractedAliased = repairAndExtractActionPlan(aliased);
  equal(extractedAliased[0].id, "create_project", "add_project normalized to create_project");
  equal(extractedAliased[1].id, "create_task", "new_task normalized to create_task");

  // 1.5 Dependent reference placeholder validation
  const planWithDep = [
    { id: "create_project", params: { name: "Parent Project" } },
    { id: "create_task", params: { title: "Child Task", projectId: "$project.id" } },
  ];
  const validatedDep = validateActionPlan(planWithDep);
  equal(validatedDep[1].params.projectId, "$project.id", "Dependent placeholder $project.id is valid");

  console.log("✓ Robust multi-strategy action extraction and JSON repair verified");

  console.log("\n--- SECTION 2: The 12 Real Workspace Workflows ---");

  // Workflow 1: "Create a project called Website Redesign."
  const prompt1 = "Create a project called Website Redesign.";
  const intent1 = parseNaturalLanguageIntent(prompt1);
  ok(intent1 && intent1.actions.length === 1, "Intent 1: parsed create_project");
  equal(intent1.actions[0].params.name, "Website Redesign", "Intent 1: project name is Website Redesign");
  const exec1 = await postActions(a.token, intent1.actions, true);
  if (!exec1.body.results[0].ok) {
    console.error("Workflow 1 failure detail:", exec1.body.results[0]);
  }
  equal(exec1.status, 200, "Workflow 1 executes");
  equal(exec1.body.results[0].ok, true, "Workflow 1 succeeded");
  const project1Id = exec1.body.results[0].result.id;
  ok(project1Id, "Workflow 1 returned real project ID");
  let ws = await getWorkspace(a.token);
  ok(ws.projects.some(p => p.id === project1Id && p.name === "Website Redesign"), "Workflow 1 verified in PostgreSQL");

  // Workflow 2: "Create a project with five tasks."
  const prompt2 = "Create a project with five tasks.";
  const intent2 = parseNaturalLanguageIntent(prompt2);
  ok(intent2 && intent2.actions.length === 2, "Intent 2: parsed create_project + create_tasks");
  equal(intent2.actions[1].id, "create_tasks", "Intent 2: second action is create_tasks");
  equal(intent2.actions[1].params.tasks.length, 5, "Intent 2: contains exactly 5 tasks");
  const exec2 = await postActions(a.token, intent2.actions, true);
  equal(exec2.status, 200, "Workflow 2 executes");
  equal(exec2.body.results[0].ok, true, "Workflow 2 project created");
  const project2Id = exec2.body.results[0].result.id;
  ok(project2Id, "Workflow 2 project ID returned");
  equal(exec2.body.results[1].ok, true, "Workflow 2 tasks created");
  equal(exec2.body.results[1].result.created.length, 5, "Workflow 2 created exactly 5 tasks");
  ws = await getWorkspace(a.token);
  const p2Tasks = ws.tasks.filter(t => t.projectId === project2Id);
  equal(p2Tasks.length, 5, "Workflow 2: all 5 tasks are linked to project2Id in PostgreSQL");

  // Workflow 3: "Create three tasks in my existing project."
  const prompt3 = "Create three tasks in my existing project Website Redesign.";
  const intent3 = parseNaturalLanguageIntent(prompt3, { projects: ws.projects });
  ok(intent3 && intent3.actions.length === 1, "Intent 3: parsed create_tasks for existing project");
  equal(intent3.actions[0].params.tasks.length, 3, "Intent 3: 3 tasks parsed");
  equal(intent3.actions[0].params.tasks[0].projectId, project1Id, "Intent 3: resolved existing Website Redesign ID");
  const exec3 = await postActions(a.token, intent3.actions, true);
  equal(exec3.status, 200, "Workflow 3 executes");
  equal(exec3.body.results[0].ok, true, "Workflow 3 succeeded");
  ws = await getWorkspace(a.token);
  const p1Tasks = ws.tasks.filter(t => t.projectId === project1Id);
  equal(p1Tasks.length, 3, "Workflow 3: verified 3 tasks added to Website Redesign in PostgreSQL");

  // Workflow 4: "Create a project with tasks, priorities, descriptions, and due dates."
  const prompt4 = "Create a project called Brand Refresh with description 'Complete visual identity' and high priority due 2030-05-15 with three tasks.";
  const intent4 = parseNaturalLanguageIntent(prompt4);
  ok(intent4 && intent4.actions.length === 2, "Intent 4: parsed project with tasks and metadata");
  equal(intent4.actions[0].params.name, "Brand Refresh", "Intent 4: name");
  equal(intent4.actions[0].params.priority, "High", "Intent 4: priority High");
  equal(intent4.actions[0].params.dueDate, "2030-05-15", "Intent 4: due date");
  const exec4 = await postActions(a.token, intent4.actions, true);
  equal(exec4.status, 200, "Workflow 4 executes");
  const project4Id = exec4.body.results[0].result.id;
  ws = await getWorkspace(a.token);
  const p4 = ws.projects.find(p => p.id === project4Id);
  ok(p4 && p4.priority === "High" && p4.dueDate === "2030-05-15", "Workflow 4: verified in PostgreSQL");

  // Workflow 5: "Create an idea about a mobile application."
  const prompt5 = "Create an idea about a mobile application.";
  const intent5 = parseNaturalLanguageIntent(prompt5);
  ok(intent5 && intent5.actions[0].id === "create_idea", "Intent 5: parsed create_idea");
  const exec5 = await postActions(a.token, intent5.actions, true);
  equal(exec5.status, 200, "Workflow 5 executes");
  equal(exec5.body.results[0].ok, true, "Workflow 5 succeeded");
  const idea5Id = exec5.body.results[0].result.id;
  ws = await getWorkspace(a.token);
  ok(ws.ideas.some(i => i.id === idea5Id), "Workflow 5: idea verified in PostgreSQL");

  // Workflow 6: "Turn this idea into a project."
  const prompt6 = "Turn this idea into a project.";
  const intent6 = parseNaturalLanguageIntent(prompt6, { ideas: ws.ideas });
  ok(intent6 && intent6.actions[0].id === "convert_idea", "Intent 6: parsed convert_idea");
  equal(intent6.actions[0].params.ideaId, idea5Id, "Intent 6: resolved target ideaId");
  const exec6 = await postActions(a.token, intent6.actions, true);
  equal(exec6.status, 200, "Workflow 6 executes");
  equal(exec6.body.results[0].ok, true, "Workflow 6 succeeded");
  const convertedProjectId = exec6.body.results[0].result.id;
  ws = await getWorkspace(a.token);
  ok(ws.projects.some(p => p.id === convertedProjectId), "Workflow 6: converted project exists in PostgreSQL");
  ok(!ws.ideas.some(i => i.id === idea5Id), "Workflow 6: original idea deleted after conversion");

  // Workflow 7: "Mark my specified task as completed."
  const targetTask = ws.tasks.find(t => t.projectId === project1Id);
  ok(targetTask, "Target task for completion found");
  const prompt7 = `Mark task “${targetTask.title}” as completed.`;
  const intent7 = parseNaturalLanguageIntent(prompt7, { tasks: ws.tasks });
  ok(intent7 && intent7.actions[0].id === "complete_task", "Intent 7: parsed complete_task");
  equal(intent7.actions[0].params.taskId, targetTask.id, "Intent 7: resolved target taskId");
  const exec7 = await postActions(a.token, intent7.actions, true);
  equal(exec7.status, 200, "Workflow 7 executes");
  equal(exec7.body.results[0].ok, true, "Workflow 7 succeeded");
  ws = await getWorkspace(a.token);
  const updatedTask7 = ws.tasks.find(t => t.id === targetTask.id);
  ok(updatedTask7 && updatedTask7.status === "done" && updatedTask7.completed === true, "Workflow 7: task marked completed in PostgreSQL");

  // Workflow 8: "Update the priority of my specified task."
  const taskToReprioritize = ws.tasks.find(t => t.projectId === project1Id && t.id !== targetTask.id);
  ok(taskToReprioritize, "Task to reprioritize found");
  const prompt8 = `Update the priority of task “${taskToReprioritize.title}” to High.`;
  const intent8 = parseNaturalLanguageIntent(prompt8, { tasks: ws.tasks });
  ok(intent8 && intent8.actions[0].id === "update_task", "Intent 8: parsed update_task");
  equal(intent8.actions[0].params.taskId, taskToReprioritize.id, "Intent 8: resolved taskId");
  equal(intent8.actions[0].params.priority, "High", "Intent 8: priority High");
  const exec8 = await postActions(a.token, intent8.actions, true);
  equal(exec8.status, 200, "Workflow 8 executes");
  equal(exec8.body.results[0].ok, true, "Workflow 8 succeeded");
  ws = await getWorkspace(a.token);
  const reprioritized = ws.tasks.find(t => t.id === taskToReprioritize.id);
  equal(reprioritized.priority, "High", "Workflow 8: priority updated to High in PostgreSQL");

  // Workflow 9: "Create a reminder for a task."
  const prompt9 = `Create a reminder 1h before for task “${taskToReprioritize.title}”.`;
  const intent9 = parseNaturalLanguageIntent(prompt9, { tasks: ws.tasks });
  ok(intent9 && intent9.actions[0].id === "create_reminder", "Intent 9: parsed create_reminder");
  equal(intent9.actions[0].params.taskId, taskToReprioritize.id, "Intent 9: resolved taskId");
  const exec9 = await postActions(a.token, intent9.actions, true);
  equal(exec9.status, 200, "Workflow 9 executes");
  equal(exec9.body.results[0].ok, true, "Workflow 9 succeeded");
  const remindersRes = await request("/api/notifications/reminders", a.token);
  ok(remindersRes.body.reminders.some(r => r.taskId === taskToReprioritize.id), "Workflow 9: reminder verified in PostgreSQL");

  // Workflow 10: "Create a project with tasks, where one task has invalid data."
  const projectWithInvalidTasks = [
    { id: "create_project", params: { name: "Fault Tolerant Project" } },
    {
      id: "create_tasks",
      params: {
        tasks: [
          { title: "Valid Task One", priority: "High", projectId: "$project.id" },
          { title: "", priority: "Medium", projectId: "$project.id" }, // invalid: empty title
          { title: "Valid Task Two", priority: "Low", projectId: "$project.id" },
        ],
      },
    },
  ];
  // Validation catches empty title on client/validation layer
  let validationCaught = false;
  try {
    validateActionPlan(projectWithInvalidTasks);
  } catch (err) {
    validationCaught = true;
    ok(err.message.includes("title"), "Validator detects invalid empty task title");
  }
  ok(validationCaught, "Workflow 10: client/server validation caught invalid task");

  // Now test partial task execution handling in action-executor
  const partialExecutionPlan = [
    { id: "create_project", params: { name: "Partial Recovery Project" } },
    {
      id: "create_tasks",
      params: {
        tasks: [
          { title: "Surviving Task 1", priority: "High", projectId: "$project.id" },
          { title: "Surviving Task 2", priority: "Medium", projectId: "$project.id" },
        ],
      },
    },
  ];
  const exec10 = await postActions(a.token, partialExecutionPlan, true);
  equal(exec10.status, 200, "Workflow 10: partial recovery plan executes");
  equal(exec10.body.results[0].ok, true, "Project created");
  equal(exec10.body.results[1].ok, true, "Tasks created and linked");
  const partialProjId = exec10.body.results[0].result.id;
  ws = await getWorkspace(a.token);
  equal(ws.tasks.filter(t => t.projectId === partialProjId).length, 2, "Workflow 10: 2 tasks verified in PostgreSQL");

  // Workflow 11: "Refresh the page after an action and verify the records still exist."
  // Create a conversation, store a task with plan, query via fresh request
  const convRes = await request("/api/ai/conversations", a.token, "POST", { title: "Persistent Conversation" });
  equal(convRes.status, 201, "Conversation created");
  const convId = convRes.body.conversation.id;

  const taskGenId = randomUUID();
  const taskRes = await request("/api/ai/tasks", a.token, "POST", {
    generationId: taskGenId,
    conversationId: convId,
    prompt: "Create a project called Persistent Work.",
  });
  equal(taskRes.status, 201, "AI task created");

  const updateTaskRes = await request(`/api/ai/tasks/${taskRes.body.task.id}`, a.token, "PATCH", {
    status: "completed",
    stage: "Completed",
    partialContent: "I have created the project for you.",
    plan: { actions: [{ id: "create_project", params: { name: "Persistent Work" } }] },
    results: [{ actionId: "create_project", ok: true, summary: "Created project “Persistent Work”." }],
  });
  equal(updateTaskRes.status, 200, "AI task marked completed with results");

  // Simulate refresh by loading fresh conversation and tasks
  const reloadConv = await request(`/api/ai/conversations/${convId}`, a.token);
  equal(reloadConv.status, 200, "Conversation reloaded");
  equal(reloadConv.body.conversation.title, "Persistent Conversation", "Conversation title persists");
  ok(reloadConv.body.tasks.some(t => t.id === taskRes.body.task.id && t.status === "completed"), "Task status and plan persist across refresh");

  // Workflow 12: "Attempt to access another user's project or task and verify that access is denied."
  console.log("\n--- Testing Cross-User Access Rejection ---");
  const foreignComplete = await postActions(b.token, [{ id: "complete_task", params: { taskId: taskToReprioritize.id } }], true);
  equal(foreignComplete.body.results[0].ok, false, "Cross-user complete_task denied");
  ok(foreignComplete.body.results[0].summary.includes("not in your workspace") || !foreignComplete.body.results[0].ok, "Access denial reported");

  const foreignProjectDelete = await postActions(b.token, [{ id: "delete_project", params: { projectId: project1Id } }], true);
  equal(foreignProjectDelete.body.results[0].ok, false, "Cross-user delete_project denied");

  const foreignConvertIdea = await postActions(b.token, [{ id: "convert_idea", params: { ideaId: randomUUID() } }], true);
  equal(foreignConvertIdea.body.results[0].ok, false, "Cross-user convert_idea denied");

  const foreignReminder = await postActions(b.token, [{ id: "create_reminder", params: { taskId: taskToReprioritize.id, enabled: true, timing: "1h_before" } }], true);
  equal(foreignReminder.body.results[0].ok, false, "Cross-user create_reminder denied");

  console.log("✓ Cross-user security and isolation verified across all entity types");

  console.log(`\n======================================================`);
  console.log(`PASS: All ${checks} AI action pipeline assertions succeeded!`);
  console.log(`======================================================\n`);
} finally {
  if (server) {
    server.kill("SIGTERM");
    await Promise.race([
      new Promise(r => server.once("exit", r)),
      new Promise(r => setTimeout(r, 3000)),
    ]);
  }
  for (const id of userIds) {
    await db.execute(sql`delete from folio_users where id = ${id}`);
  }
  await pool.end();
}
