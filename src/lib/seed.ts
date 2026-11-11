// One-time workspace bootstrap. This only runs when the demo workspace is
// completely empty, so everything the app renders afterwards is real data
// coming out of PostgreSQL through the normal workspace API.
//
// The demo workspace reads like a small Mumbai studio in mid-November:
// the Diwali rush just wrapped, a Pongal shoot on the horizon, rupee
// figures in the notes and cutting chai in the rituals. Made in India,
// for the world.
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { activities, ideas, milestones, projects, subtasks, tasks } from "@/db/schema";

const DAY = 24 * 60 * 60 * 1000;

function day(offset: number) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
const hoursAgo = (hours: number) => new Date(Date.now() - hours * 60 * 60 * 1000);
const daysAgo = (days: number) => new Date(Date.now() - days * DAY);

const seeded = new Set<string>();

export async function seedWorkspace(userId: string) {
  if (seeded.has(userId)) return;
  seeded.add(userId);
  try {
    const existing = await db.select({ id: projects.id }).from(projects).where(eq(projects.userId, userId)).limit(1);
    if (existing.length) return;

    const projectRows = await db
      .insert(projects)
      .values([
        { userId, name: "Folio Design System", description: "A shared language of tokens, components and patterns so every screen feels like the same product.", status: "In progress", priority: "High", color: "violet", icon: "pen", category: "Product", startDate: day(-24), dueDate: day(11), favorite: true, createdAt: daysAgo(38), updatedAt: hoursAgo(3) },
        { userId, name: "Bandra Store Rollout", description: "Fitting out the new Bandra shopfront — fixtures, POS tablets and a launch-week runbook for the Colaba team.", status: "In progress", priority: "High", color: "blue", icon: "layout", category: "Client work", startDate: day(-20), dueDate: day(4), favorite: true, createdAt: daysAgo(26), updatedAt: hoursAgo(7) },
        { userId, name: "Festive 2026 Campaign", description: "Diwali wrap-up, Christmas teasers and the New Year launch story for the marigold collection.", status: "In progress", priority: "Medium", color: "pink", icon: "megaphone", category: "Marketing", startDate: day(-15), dueDate: day(2), favorite: false, createdAt: daysAgo(19), updatedAt: hoursAgo(20) },
        { userId, name: "Personal Portfolio", description: "Six case studies, a slower reading rhythm, and writing that actually sounds like me.", status: "Planning", priority: "Medium", color: "peach", icon: "book", category: "Personal", startDate: day(3), dueDate: day(24), favorite: false, createdAt: daysAgo(12), updatedAt: daysAgo(2) },
        { userId, name: "UPI Autopay Platform", description: "Versioned endpoints, typed SDK and a documentation site that stays in sync — now with UPI Autopay mandates.", status: "Completed", priority: "High", color: "green", icon: "code", category: "Engineering", startDate: day(-64), dueDate: day(-6), favorite: false, createdAt: daysAgo(64), updatedAt: daysAgo(5) },
        { userId, name: "Reading Habit", description: "Twenty quiet pages a day. Notes worth returning to.", status: "On hold", priority: "Low", color: "yellow", icon: "book", category: "Personal", startDate: day(-45), dueDate: null, favorite: false, createdAt: daysAgo(48), updatedAt: daysAgo(16) },
        { userId, name: "Website Refresh 2024", description: "Last year’s marketing site refresh — shipped, measured and wrapped up.", status: "Completed", priority: "Medium", color: "blue", icon: "code", category: "Marketing", startDate: day(-180), dueDate: day(-120), favorite: false, archived: true, createdAt: daysAgo(190), updatedAt: daysAgo(90) },
      ])
      .returning({ id: projects.id, name: projects.name });

    const p = Object.fromEntries(projectRows.map((row) => [row.name, row.id]));
    const design = p["Folio Design System"];
    const store = p["Bandra Store Rollout"];
    const campaign = p["Festive 2026 Campaign"];
    const portfolio = p["Personal Portfolio"];
    const upi = p["UPI Autopay Platform"];
    const reading = p["Reading Habit"];
    const website = p["Website Refresh 2024"];

    const milestoneRows = await db
      .insert(milestones)
      .values([
        { userId, projectId: design, title: "Foundations", description: "Colour, type and spacing tokens agreed and published.", dueDate: day(-8), completed: true, completedAt: daysAgo(7), createdAt: daysAgo(30) },
        { userId, projectId: design, title: "Core components", description: "Buttons, inputs, cards and menus built on the new tokens.", dueDate: day(3), createdAt: daysAgo(30) },
        { userId, projectId: design, title: "Documentation site", description: "Usage guidance and live examples for every component.", dueDate: day(11), createdAt: daysAgo(30) },
        { userId, projectId: store, title: "Site handover approved", description: "Landlord sign-off, keys and the Meera-formatted floor plan.", dueDate: day(-9), completed: true, completedAt: daysAgo(9), createdAt: daysAgo(22) },
        { userId, projectId: store, title: "Fixture installation", description: "Teak shelving, the gift-wrap counter and the brass name board.", dueDate: day(1), createdAt: daysAgo(22) },
        { userId, projectId: store, title: "Staff training week", description: "POS drills, queue flow and the launch-week runbook.", dueDate: day(4), createdAt: daysAgo(22) },
        { userId, projectId: campaign, title: "Festive narrative", description: "Diwali wrap-up story, tone of voice and key messages.", dueDate: day(-5), completed: true, completedAt: daysAgo(3), createdAt: daysAgo(15) },
        { userId, projectId: campaign, title: "Festive launch assets", description: "Email, landing page and motion teasers ready to go.", dueDate: day(2), createdAt: daysAgo(15) },
        { userId, projectId: portfolio, title: "Case study selection", description: "Choose the six projects that tell the clearest story.", dueDate: day(6), createdAt: daysAgo(10) },
        { userId, projectId: portfolio, title: "First draft live", description: "", dueDate: day(24), createdAt: daysAgo(10) },
        { userId, projectId: upi, title: "SDK release", description: "", dueDate: day(-12), completed: true, completedAt: daysAgo(12), createdAt: daysAgo(55) },
        { userId, projectId: upi, title: "Docs migration", description: "", dueDate: day(-6), completed: true, completedAt: daysAgo(6), createdAt: daysAgo(55) },
      ])
      .returning({ id: milestones.id, title: milestones.title, projectId: milestones.projectId });

    const m = (projectId: string, title: string) => milestoneRows.find((row) => row.projectId === projectId && row.title === title)?.id ?? null;

    type Status = "todo" | "in_progress" | "in_review" | "done";
    interface SeedTask { title: string; project?: string; milestone?: string; priority?: string; status?: Status; due?: number; start?: number; labels?: string[]; estimate?: number; description?: string; notes?: string; doneHoursAgo?: number; created: number; updatedHoursAgo?: number; steps?: [string, boolean][] }
    const D = "Folio Design System", M = "Bandra Store Rollout", C = "Festive 2026 Campaign", P = "Personal Portfolio", A = "UPI Autopay Platform", R = "Reading Habit", W = "Website Refresh 2024";
    const seedTasks: SeedTask[] = [
      // Due today
      { title: "Finalise the elevation and shadow scale", project: D, milestone: "Core components", priority: "High", status: "in_progress", due: 0, start: -2, labels: ["design-system", "tokens"], estimate: 120, description: "Three levels only — card, popover, modal.", created: 3, updatedHoursAgo: 2, steps: [["Audit current shadows in the app", true], ["Define three elevation levels", true], ["Write usage guidance", false], ["Review with engineering", false]] },
      { title: "Review POS handoff with the store team", project: M, milestone: "Staff training week", priority: "Urgent", status: "in_review", due: 0, labels: ["handoff", "pos"], estimate: 60, description: "Walk through the queue flow and the UPI confirmation screens.", notes: "Bring the edge-case list from the Colaba dry run.", created: 2, updatedHoursAgo: 4, steps: [["Export final screens", true], ["Annotate interactions", true], ["Record walkthrough video", false]] },
      { title: "Send the Diwali wrap-up reel to the brand team", project: C, milestone: "Festive launch assets", priority: "Medium", status: "in_progress", due: 0, labels: ["copy"], estimate: 90, description: "Diyas at dusk, the whole studio in kurta, one warm cut.", created: 1, updatedHoursAgo: 6 },
      { title: "Audit icon sizes across the dashboard", project: D, milestone: "Core components", priority: "Low", due: 0, labels: ["design-system"], estimate: 30, created: 1 },
      { title: "Pick three case studies to lead with", project: P, milestone: "Case study selection", priority: "Medium", due: 0, labels: ["writing"], doneHoursAgo: 5, created: 4 },
      // Overdue
      { title: "Approve the mithai-box packaging proofs", project: C, milestone: "Festive launch assets", priority: "Urgent", status: "in_review", due: -2, labels: ["print", "client"], estimate: 45, description: "Kaju katli boxes for the corporate gifting set.", notes: "Mehra Printers revised quote: ₹12,500 for 500 boxes.", created: 9, updatedHoursAgo: 30 },
      { title: "Fix POS tablet spacing on small screens", project: M, milestone: "Fixture installation", priority: "High", due: -4, labels: ["bug", "pos"], estimate: 60, created: 11, updatedHoursAgo: 70, steps: [["Reproduce on the shop tablet", true], ["Adjust safe-area insets", false]] },
      { title: "Renew the design tooling subscription", priority: "Low", due: -1, labels: ["admin"], estimate: 15, created: 6 },
      // Upcoming
      { title: "Plan the Pongal collection shoot", project: C, milestone: "Festive launch assets", priority: "High", status: "in_progress", due: 1, start: -1, labels: ["festive", "photo"], estimate: 240, description: "Studio in Worli, sugarcane and brass props, morning light.", created: 5, updatedHoursAgo: 9, steps: [["Shortlist photographers", true], ["Moodboard: marigold and brass", false], ["Book the Worli studio", false]] },
      { title: "Document the spacing tokens", project: D, milestone: "Documentation site", priority: "Medium", status: "in_review", due: 2, labels: ["docs", "tokens"], estimate: 60, created: 5, updatedHoursAgo: 20 },
      { title: "Book the Christmas catalogue photographer", project: C, milestone: "Festive launch assets", priority: "Medium", due: 3, labels: ["client"], estimate: 30, created: 7 },
      { title: "Draft the about page copy", project: P, milestone: "First draft live", priority: "Low", due: 5, labels: ["writing"], estimate: 90, created: 3 },
      { title: "Run an accessibility pass on form controls", project: D, milestone: "Core components", priority: "High", due: 6, labels: ["a11y", "design-system"], estimate: 180, description: "Contrast, focus rings, label association.", created: 2, steps: [["Check contrast ratios", false], ["Keyboard-only walkthrough", false], ["Screen reader labels", false]] },
      { title: "Prepare the Bandra launch review deck", project: M, milestone: "Staff training week", priority: "Medium", due: 8, labels: ["client"], estimate: 120, created: 2 },
      { title: "Shoot marigold-toned header photography", project: P, milestone: "First draft live", priority: "Low", due: 13, labels: ["photo"], estimate: 240, created: 1 },
      { title: "Write usage guidance for menus and dialogs", project: D, milestone: "Documentation site", priority: "Medium", due: 9, labels: ["docs"], estimate: 120, created: 1 },
      { title: "Plan the Q1 learning goals", priority: "None", due: 11, labels: ["planning"], created: 1, description: "Two hours on Sunday mornings. Maybe finally the Tamil letters." },
      // No due date
      { title: "Pick the next three books", project: R, priority: "None", labels: ["reading"], created: 20, notes: "Ruskin Bond’s next, maybe." },
      { title: "Collect inspiration for the portfolio grid", project: P, priority: "Low", labels: ["research"], estimate: 45, created: 6 },
      // Recently completed (feeds progress, insights and the weekly focus ring)
      { title: "Define the colour token naming scheme", project: D, milestone: "Foundations", priority: "High", due: -1, labels: ["tokens"], doneHoursAgo: 27, created: 8 },
      { title: "Publish the type scale", project: D, milestone: "Foundations", priority: "Medium", due: -9, labels: ["tokens"], doneHoursAgo: 8 * 24, created: 18 },
      { title: "Build button and input primitives", project: D, milestone: "Core components", priority: "High", due: -3, labels: ["design-system"], doneHoursAgo: 50, created: 12 },
      { title: "Finalise the store floor plan", project: M, milestone: "Site handover approved", priority: "Medium", due: -2, doneHoursAgo: 50, created: 10 },
      { title: "Design the gift-wrap counter", project: M, milestone: "Fixture installation", priority: "Medium", due: -1, labels: ["pos"], doneHoursAgo: 30, created: 9 },
      { title: "Agree the festive tone of voice", project: C, milestone: "Festive narrative", priority: "Medium", due: -3, labels: ["copy"], doneHoursAgo: 74, created: 12 },
      { title: "Ship the UPI Autopay SDK release", project: A, milestone: "SDK release", priority: "High", due: -12, doneHoursAgo: 12 * 24, created: 30 },
      { title: "Migrate docs to the new generator", project: A, milestone: "Docs migration", priority: "Medium", due: -8, labels: ["docs"], doneHoursAgo: 7 * 24, created: 33 },
      { title: "Close out the v1 deprecation notice", project: A, priority: "Low", due: -10, doneHoursAgo: 9 * 24, created: 35 },
      { title: "Collect feedback on the first component set", project: D, priority: "Medium", due: -5, labels: ["research"], doneHoursAgo: 4 * 24, created: 20 },
      { title: "Finish “Malgudi Days”", project: R, priority: "Low", due: -30, labels: ["reading"], doneHoursAgo: 28 * 24, created: 45 },
      { title: "Launch the refreshed marketing site", project: W, priority: "High", due: -120, doneHoursAgo: 121 * 24, created: 185 },
    ];
    const insertedTasks = await db.insert(tasks).values(seedTasks.map((t) => {
      const done = t.doneHoursAgo !== undefined;
      const projectId = t.project ? p[t.project] : null;
      return {
        userId, projectId, milestoneId: projectId && t.milestone ? m(projectId, t.milestone) : null,
        title: t.title, description: t.description ?? "", notes: t.notes ?? "", priority: t.priority ?? "Medium",
        status: done ? "done" : t.status ?? "todo", completed: done, completedAt: done ? hoursAgo(t.doneHoursAgo!) : null,
        dueDate: t.due === undefined ? null : day(t.due), startDate: t.start === undefined ? null : day(t.start),
        labels: t.labels ?? [], estimateMinutes: t.estimate ?? null,
        createdAt: daysAgo(t.created), updatedAt: done ? hoursAgo(t.doneHoursAgo!) : hoursAgo(t.updatedHoursAgo ?? t.created * 24),
      };
    })).returning({ id: tasks.id, title: tasks.title });
    const taskId = Object.fromEntries(insertedTasks.map((row) => [row.title, row.id]));
    const steps = seedTasks.flatMap((t) => (t.steps ?? []).map(([title, done], position) => ({ userId, taskId: taskId[t.title], title, completed: done, completedAt: done ? hoursAgo(6 + position * 5) : null, position, createdAt: daysAgo(t.created) })));
    if (steps.length) await db.insert(subtasks).values(steps);

    await db.insert(ideas).values([
      { userId, title: "Chai-time weekly review ritual", description: "A Friday prompt over cutting chai that summarises what moved and what slipped.", category: "Product", color: "violet", status: "Ready to start", createdAt: daysAgo(2) },
      { userId, title: "Focus mode with a quiet timer", description: "Hide everything except the task in front of you.", category: "Product", color: "green", status: "Exploring", createdAt: daysAgo(5) },
      { userId, title: "Shareable project snapshots", description: "A read-only link clients can open without an account.", category: "Client work", color: "blue", status: "Just an idea", createdAt: daysAgo(9) },
      { userId, title: "Illustrated empty states", description: "Small Madhubani-border drawings that make a blank workspace feel welcoming.", category: "Design", color: "peach", status: "Exploring", createdAt: daysAgo(14) },
      { userId, title: "Morning planning email", description: "Three priorities, one deadline, nothing else — before the first filter coffee.", category: "Personal", color: "yellow", status: "Just an idea", createdAt: daysAgo(21) },
    ]);

    await db.insert(activities).values([
      { userId, projectId: portfolio, taskId: taskId["Pick three case studies to lead with"], text: "Completed “Pick three case studies to lead with”", type: "complete", createdAt: hoursAgo(5) },
      { userId, projectId: store, taskId: taskId["Review POS handoff with the store team"], text: "Moved “Review POS handoff with the store team” to In review", type: "task", createdAt: hoursAgo(4) },
      { userId, projectId: design, taskId: taskId["Finalise the elevation and shadow scale"], text: "Checked off “Define three elevation levels” in “Finalise the elevation and shadow scale”", type: "subtask", createdAt: hoursAgo(2) },
      { userId, projectId: design, taskId: taskId["Finalise the elevation and shadow scale"], text: "Added “Finalise the elevation and shadow scale” to “Folio Design System”", type: "task", createdAt: hoursAgo(9) },
      { userId, projectId: null, text: "Captured the idea “Chai-time weekly review ritual”", type: "idea", createdAt: hoursAgo(26) },
      { userId, projectId: design, taskId: taskId["Define the colour token naming scheme"], text: "Completed “Define the colour token naming scheme”", type: "complete", createdAt: hoursAgo(27) },
      { userId, projectId: store, taskId: taskId["Design the gift-wrap counter"], text: "Completed “Design the gift-wrap counter”", type: "complete", createdAt: hoursAgo(30) },
      { userId, projectId: campaign, text: "Moved “Festive 2026 Campaign” to In progress", type: "project", createdAt: hoursAgo(44) },
      { userId, projectId: store, taskId: taskId["Finalise the store floor plan"], text: "Completed “Finalise the store floor plan”", type: "complete", createdAt: hoursAgo(50) },
      { userId, projectId: design, taskId: taskId["Build button and input primitives"], text: "Completed “Build button and input primitives”", type: "complete", createdAt: daysAgo(2) },
      { userId, projectId: campaign, text: "Reached milestone “Festive narrative”", type: "milestone", createdAt: daysAgo(3) },
      { userId, projectId: store, text: "Starred “Bandra Store Rollout”", type: "project", createdAt: daysAgo(4) },
      { userId, projectId: upi, text: "Moved “UPI Autopay Platform” to Completed", type: "project", createdAt: daysAgo(5) },
      { userId, projectId: upi, text: "Reached milestone “Docs migration”", type: "milestone", createdAt: daysAgo(6) },
      { userId, projectId: design, text: "Reached milestone “Foundations”", type: "milestone", createdAt: daysAgo(7) },
      { userId, projectId: store, text: "Reached milestone “Site handover approved”", type: "milestone", createdAt: daysAgo(9) },
      { userId, projectId: portfolio, text: "Created project “Personal Portfolio”", type: "project", createdAt: daysAgo(12) },
      { userId, projectId: reading, text: "Moved “Reading Habit” to On hold", type: "project", createdAt: daysAgo(16) },
      { userId, projectId: campaign, text: "Created project “Festive 2026 Campaign”", type: "project", createdAt: daysAgo(19) },
      { userId, projectId: store, text: "Created project “Bandra Store Rollout”", type: "project", createdAt: daysAgo(26) },
      { userId, projectId: design, text: "Created project “Folio Design System”", type: "project", createdAt: daysAgo(38) },
      { userId, projectId: website, text: "Archived “Website Refresh 2024”", type: "project", createdAt: daysAgo(90) },
    ]);
  } catch (error) {
    console.error("Workspace seed failed:", error);
    seeded.delete(userId);
  }
}
