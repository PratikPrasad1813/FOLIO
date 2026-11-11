#!/usr/bin/env node
// Records the Notion-style hero loop: a real session in Aarav's workspace.
// Dashboard → task board → Pongal task modal → Folio AI → recent chat → composer.
// FOLIO_TOUR_THEME=light|dark picks the app theme (set the demo user's
// personal.theme in PostgreSQL to match before recording).
// Produces /tmp/folio-video-<theme>/tour.webm (raw), encoded separately with ffmpeg.
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";

const BASE = process.env.FOLIO_BASE ?? "http://localhost:3000";
const THEME = process.env.FOLIO_TOUR_THEME === "dark" ? "dark" : "light";
const TOKEN = readFileSync("/home/z/my-project/scripts/.demo_session", "utf8").trim();
const OUT_DIR = `/tmp/folio-video-${THEME}`;
mkdirSync(OUT_DIR, { recursive: true });
console.log(`Recording hero tour — theme: ${THEME} → ${OUT_DIR}`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 1,
  colorScheme: THEME,
  timezoneId: "Asia/Kolkata",
  locale: "en-IN",
  recordVideo: { dir: OUT_DIR, size: { width: 1440, height: 1000 } },
});
await context.addCookies([{ name: "folio_session", value: TOKEN, url: BASE, httpOnly: true, sameSite: "Lax" }]);
await context.addInitScript((theme) => {
  localStorage.setItem("folio-theme", theme);
  localStorage.setItem("folio.tasks.view", "board");
  localStorage.setItem("folio_ai_provider", "anthropic");
  localStorage.setItem("folio_ai_key_anthropic", "sk-ant-demo-capture-key");
  localStorage.setItem("folio_ai_theme", theme);

  // Notion-style visible cursor. The headless screencast has no native pointer,
  // so we draw one: a white dot with a dark ring (visible on paper AND Linear
  // dark), a soft halo ring that follows, and a press ripple on click.
  // It must survive React re-renders and route changes — hence the watchdog.
  if (window.__folioTourCursor) return;
  window.__folioTourCursor = true;
  const CSS = [
    "#tour-cursor{position:fixed;left:0;top:0;width:15px;height:15px;border-radius:9999px;",
    "background:radial-gradient(circle at 35% 30%,#fff 45%,#eef2f6 100%);",
    "box-shadow:0 0 0 2px rgba(8,12,18,.85),0 1px 2px rgba(8,12,18,.45),0 5px 16px rgba(8,12,18,.35);",
    "z-index:2147483647;pointer-events:none;will-change:transform;transition:scale .12s ease;}",
    "#tour-cursor.press{scale:.6;}",
    "#tour-cursor-ring{position:fixed;left:0;top:0;width:40px;height:40px;border-radius:9999px;",
    "border:1.5px solid rgba(255,255,255,.75);box-shadow:0 0 12px rgba(8,12,18,.28);",
    "z-index:2147483646;pointer-events:none;opacity:0;will-change:transform,opacity;",
    "transition:opacity .25s ease,scale .18s ease;}",
    "#tour-cursor-ring.live{opacity:1;}",
    "#tour-cursor-ring.press{scale:.72;}",
  ].join("");
  let x = Math.round(window.innerWidth / 2), y = Math.round(window.innerHeight * 0.42);
  const paint = () => {
    const dot = document.getElementById("tour-cursor");
    const ring = document.getElementById("tour-cursor-ring");
    if (dot) dot.style.transform = `translate(${x - 7.5}px, ${y - 7.5}px)`;
    if (ring) ring.style.transform = `translate(${x - 20}px, ${y - 20}px)`;
  };
  const boot = () => {
    const head = document.head || document.documentElement;
    if (head && !document.getElementById("tour-cursor-style")) {
      const style = document.createElement("style");
      style.id = "tour-cursor-style";
      style.textContent = CSS;
      head.append(style);
    }
    const root = document.body || document.documentElement;
    if (root && !document.getElementById("tour-cursor")) {
      const dot = document.createElement("div"); dot.id = "tour-cursor";
      const ring = document.createElement("div"); ring.id = "tour-cursor-ring";
      root.append(dot, ring);
      // Keep the cursor above everything Next.js hydrates afterwards.
      dot.style.zIndex = "2147483647"; ring.style.zIndex = "2147483646";
    }
    paint();
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
  window.addEventListener("mousemove", (e) => {
    x = e.clientX; y = e.clientY;
    paint();
    const ring = document.getElementById("tour-cursor-ring");
    if (ring) ring.classList.add("live");
  }, { passive: true, capture: true });
  window.addEventListener("mousedown", () => {
    const dot = document.getElementById("tour-cursor");
    const ring = document.getElementById("tour-cursor-ring");
    if (dot) dot.classList.add("press");
    if (ring) ring.classList.add("press", "live");
  }, { capture: true });
  window.addEventListener("mouseup", () => {
    const dot = document.getElementById("tour-cursor");
    const ring = document.getElementById("tour-cursor-ring");
    if (dot) dot.classList.remove("press");
    if (ring) ring.classList.remove("press");
  }, { capture: true });
  // Watchdog: re-create the cursor if anything removes it, and repaint at the
  // last known position so it never freezes off-screen.
  setInterval(boot, 600);
}, THEME);

const page = await context.newPage();
const humanClick = async (locator, hold = 90) => {
  await locator.waitFor({ timeout: 30_000 });
  await locator.scrollIntoViewIfNeeded({ timeout: 10_000 }).catch(() => {});
  await sleep(250);
  const box = await locator.boundingBox();
  if (!box) throw new Error("no box for click target");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 18 });
  await sleep(hold);
  await page.mouse.down();
  await sleep(70);
  await page.mouse.up();
};
// A gentle drift keeps the pointer alive between beats, like a real hand.
const drift = async (x, y, steps = 14, dwell = 300) => {
  await page.mouse.move(x, y, { steps });
  await sleep(dwell);
};
const pause = (ms) => sleep(ms);

try {
  // 1. Dashboard — settle, then let the eye wander across the week.
  await page.goto(`${BASE}/overview`, { waitUntil: "domcontentloaded" });
  await page.locator(".dash").first().waitFor({ timeout: 60_000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => !document.querySelector(".pj-skeleton, .sf-popover"), { timeout: 30_000 }).catch(() => {});
  await pause(1400);
  await drift(700, 380, 16, 500);
  await drift(1020, 330, 16, 600);
  await drift(480, 560, 18, 500);
  await pause(900);

  // 2. Open My tasks (board)
  await humanClick(page.getByRole("link", { name: "My tasks" }));
  await page.locator(".tk-card").first().waitFor({ timeout: 60_000 });
  await pause(700);
  await drift(980, 430, 16, 500);
  await pause(900);

  // 3. Open the Pongal task, read it, close it
  const pongal = page.locator(".tk-card", { hasText: "Plan the Pongal collection shoot" }).first();
  await humanClick(pongal, 120);
  await page.locator(".modal-backdrop, .task-modal, [class*=modal]").first().waitFor({ timeout: 8_000 }).catch(() => {});
  await pause(600);
  await drift(760, 520, 14, 700);
  await pause(700);
  await page.keyboard.press("Escape");
  await pause(800);

  // 4. Folio AI fullscreen — the last conversation opens with its messages
  await humanClick(page.getByRole("link", { name: "Folio AI" }));
  await page.locator(".fa-composer textarea").waitFor({ timeout: 60_000 });
  await page.locator(".fa-message").first().waitFor({ timeout: 30_000 });
  await pause(1000);
  await drift(720, 540, 16, 700);
  await pause(900);

  // 5. Type (not send) a follow-up question
  const composer = page.locator("#folio-ai-message");
  await composer.click({ timeout: 10_000 }).catch(() => {});
  await composer.pressSequentially("What's due before Pongal?", { delay: 55 });
  await pause(1200);

  // 6. Gentle scroll through the conversation, then hold
  await page.locator(".fa-messages").first().evaluate((el) => { el.scrollTop = Math.max(0, el.scrollHeight * 0.15); }).catch(() => {});
  await drift(700, 900, 12, 400);
  await pause(1800);

  console.log("recording complete");
} catch (error) {
  console.error("tour failed:", error.message);
  process.exitCode = 1;
} finally {
  await context.close(); // flushes the video file
  await browser.close();
}
