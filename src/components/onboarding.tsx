"use client";
import Link from "next/link";
import TIMEZONE_OPTIONS from "@/lib/timezones.json";
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, Check, CheckCheck, Globe2, Laptop, Leaf, Moon, ShieldCheck, Sparkles, Sun } from "lucide-react";
import { Logo, Spinner } from "@/components/ui";
import { applyTheme, ThemeToggle } from "@/components/theme-toggle";
import { countries, DEFAULT_PERSONAL, ONBOARDING_STEPS, WORK_USES, type PersonalPreferences } from "@/lib/personalization";
import type { readProfile } from "@/lib/profile-service";

type SetupData = Awaited<ReturnType<typeof readProfile>>;
const TITLES = [
  ["Welcome to Folio.", "Let’s make a little room for you."],
  ["What should we call you?", "Your provider gave us a starting point. Make it your own."],
  ["A hello that feels like you.", "How would you like Folio to address you?"],
  ["A little about you. Only if you’d like.", "Would you like to share your gender? This is optional, never inferred, and doesn’t affect access."],
  ["Where in the world are you?", "Just your country. No address or precise location needed."],
  ["Let’s get on the same time.", "Which timezone should Folio use for your schedule?"],
  ["The little details, your way.", "Choose how dates, times, and numbers feel most familiar."],
  ["What brings you to Folio?", "Choose what fits. A mix is perfectly fine."],
  ["Find your own rhythm.", "A few small choices for a workspace that fits your day."],
  ["How should your space feel?", "A little light, a little dark, or in step with your day."],
  ["Meet your thinking companion.", "Personalize your assistant—or leave it for another day."],
];
export function Onboarding({ initial, next, editing = false }: { initial: SetupData; next: string; editing?: boolean }) {
  const [step, setStep] = useState(editing ? 1 : initial.onboardingStep);
  const [name, setName] = useState(initial.user.name);
  const [personal, setPersonal] = useState<PersonalPreferences>({ ...DEFAULT_PERSONAL, ...initial.personal });
  const [timezone, setTimezone] = useState(initial.timezone);
  const [assistant, setAssistant] = useState(initial.assistant);
  const [goal, setGoal] = useState(initial.user.weeklyGoal);
  const [notificationsEnabled, setNotificationsEnabled] = useState(initial.notificationsEnabled);
  const [quiet, setQuiet] = useState(initial.quietHoursEnabled);
  const [countrySearch, setCountrySearch] = useState("");
  const [suggestedCountry, setSuggestedCountry] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [finishing, setFinishing] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const countryList = useMemo(countries, []);
  const filteredCountries = countryList.filter(c => `${c.name} ${c.code}`.toLowerCase().includes(countrySearch.toLowerCase()));
  const zones = useMemo(() => [...new Set([timezone, ...TIMEZONE_OPTIONS])], [timezone]);
  const patch = (value: Partial<PersonalPreferences>) => setPersonal(current => ({ ...current, ...value }));

  useEffect(() => {
    document.documentElement.dataset.folioAccount = initial.user.id;
    if (editing || initial.onboardingCompleted || initial.onboardingStep >= 10) applyTheme(personal.theme, false);
    else {
      try {
        const saved = localStorage.getItem("folio-theme");
        if (saved === "light" || saved === "dark" || saved === "system") setPersonal(current => ({ ...current, theme: saved }));
      } catch { /* a visitor can still choose their theme without storage */ }
    }
    try {
      const locale = new Intl.Locale(navigator.language);
      if (locale.region) setSuggestedCountry(locale.region);
      if (!editing && initial.onboardingStep <= 5) setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone || initial.timezone);
    } catch { /* optional suggestions */ }
    // Read visitor preferences once; subsequent changes are explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { titleRef.current?.focus(); }, [step]);
  function valuesForStep(): Record<string, unknown> {
    if (step === 1) return { name };
    if (step === 2) return { personal: { addressMode: personal.addressMode, preferredName: personal.preferredName, customAddress: personal.customAddress } };
    if (step === 3) return { personal: { gender: personal.gender, genderDescription: personal.genderDescription } };
    if (step === 4) return { personal: { country: personal.country } };
    if (step === 5) return { timezone };
    if (step === 6) return { personal: { language: personal.language, locale: personal.locale, dateFormat: personal.dateFormat, timeFormat: personal.timeFormat, weekStart: personal.weekStart } };
    if (step === 7) return { personal: { workUses: personal.workUses } };
    if (step === 8) return { weeklyGoal: goal, personal: { taskDensity: personal.taskDensity, taskInsights: personal.taskInsights }, notificationsEnabled, quietHoursEnabled: quiet };
    if (step === 9) return { personal: { theme: personal.theme } };
    if (step === 10) return { assistant: { assistantName: assistant.assistantName, presentation: assistant.presentation, style: assistant.style } };
    return {};
  }
  async function persist(target: number, skip = false) {
    if (busy) return; setBusy(true); setError("");
    try {
      const complete = step === 10 && target > 10;
      const body = { ...(skip ? {} : valuesForStep()), ...(!editing ? { step: Math.min(target, 10) } : {}), ...(complete ? { complete: true } : {}) };
      const response = await fetch("/api/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || "Couldn’t save. Please try again.");
      if (complete) {
        setFinishing(true);
        applyTheme(personal.theme, false);
        // This transition follows an actual committed profile update. No sample
        // tasks or projects are created in a real user's workspace.
        window.setTimeout(() => window.location.assign(editing ? "/settings" : next), 1000);
      } else setStep(target);
    } catch (err) { setError(err instanceof Error ? err.message : "Couldn’t save your preferences."); }
    finally { setBusy(false); }
  }
  async function quickEnterWorkspace() {
    if (busy || editing) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          timezone,
          personal: { theme: personal.theme },
          complete: true,
          skipSetup: true,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Couldn’t prepare your workspace.");
      setFinishing(true);
      applyTheme(personal.theme, false);
      window.setTimeout(() => window.location.assign(next), 750);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t prepare your workspace.");
    } finally {
      setBusy(false);
    }
  }
  const welcomeFirstName = name.trim().split(" ").filter(Boolean)[0] || "";
  const headingText = step === 0 && welcomeFirstName ? `Welcome to Folio, ${welcomeFirstName}.` : TITLES[step][0];
  const onSubmit = (event: FormEvent) => { event.preventDefault(); void persist(step + 1); };
  const option = (label: string, selected: boolean, action: () => void, detail?: string, icon?: ReactNode) => <button type="button" className={`ob-option ${selected ? "is-selected" : ""}`} aria-pressed={selected} onClick={action}><span className="ob-option-icon">{icon ?? <span/>}</span><span><strong>{label}</strong>{detail && <small>{detail}</small>}</span><i>{selected && <Check size={13}/>}</i></button>;

  return <div className="public-site ob-page"><header className="ob-header"><Link href="/" aria-label="Folio home"><Logo/></Link><div>{!editing && <button type="button" className="ob-skip" disabled={busy} onClick={() => void quickEnterWorkspace()}>Use smart defaults &amp; open workspace</button>}<span>{editing ? "YOUR SPACE, YOUR WAY" : "A LITTLE MORE YOU"}</span><ThemeToggle/></div></header>{finishing ? <main className="ob-finishing" role="status"><span className="ob-finish-icon"><Sparkles size={31}/></span><h1>{editing ? "Your changes are saved." : "Your Folio is coming together…"}</h1><p>Your preferences are saved. Let’s make room for what matters.</p><Spinner size={20}/></main> : <main className="ob-main"><div className="ob-progress" aria-label={`Setup step ${step} of 10`}><span>{editing ? "Personalize your Folio" : "Make yourself at home"}</span><span>{step === 0 ? "LET’S BEGIN" : `${String(step).padStart(2,"0")} / 10`}</span><div><i style={{ width: `${step * 10}%` }}/></div></div><form onSubmit={onSubmit} className="ob-form"><span className="lp-eyebrow">{ONBOARDING_STEPS[step]}</span><h1 ref={titleRef} tabIndex={-1}>{headingText}</h1><p className="ob-intro">{TITLES[step][1]}</p><div className="ob-question" key={step}>
      {step === 0 && <div className="ob-welcome-art"><div className="ob-paper"><span className="ob-paper-mark"><Logo compact/></span><strong>A space to make things happen.</strong><span><Check size={13}/>Projects, milestones &amp; tasks in harmony.</span><span><Check size={13}/>Schedule &amp; Idea Board kept calm and private.</span><span><Check size={13}/>Optional hosted Folio AI, powered by Gemini.</span><i/></div><span className="ob-art-seal"><Leaf size={27}/></span><p>Tailor your workspace in under a minute, or jump right in with smart defaults—everything can be adjusted later in Settings.</p></div>}
      {step === 1 && <label className="ob-field"><span>Your display name</span><input aria-label="Your display name" value={name} maxLength={80} required autoComplete="name" placeholder="Your name, your way" onChange={e => setName(e.target.value)}/><small>You can change the name provided by your sign-in account.</small></label>}
      {step === 2 && <><div className="ob-options">{option("First name", personal.addressMode === "first", () => patch({ addressMode: "first" }), `Hello, ${name.split(" ")[0] || "you"}.`)}{option("Full name", personal.addressMode === "full", () => patch({ addressMode: "full" }), `Hello, ${name}.`)}{option("A preferred name", personal.addressMode === "preferred", () => patch({ addressMode: "preferred" }), "A nickname, or the name that feels most like you.")}{option("Something custom", personal.addressMode === "custom", () => patch({ addressMode: "custom" }), "Choose your own form of address.")}</div>{personal.addressMode === "preferred" && <label className="ob-field"><span>Your preferred name</span><input aria-label="Your preferred name" maxLength={80} value={personal.preferredName || ""} onChange={e => patch({ preferredName: e.target.value || null })}/></label>}{personal.addressMode === "custom" && <label className="ob-field"><span>Address me as</span><input aria-label="Address me as" maxLength={80} value={personal.customAddress || ""} onChange={e => patch({ customAddress: e.target.value || null })}/></label>}</>}
      {step === 3 && <><div className="ob-options is-two">{([['woman','Woman'],['man','Man'],['nonbinary','Non-binary'],['self','Self-describe'],['undisclosed','Prefer not to say']] as const).map(([value,label]) => <div key={value}>{option(label, personal.gender === value, () => patch({ gender: value, genderDescription: value === "self" ? personal.genderDescription : null }))}</div>)}</div>{personal.gender === "self" && <label className="ob-field"><span>In your own words</span><input aria-label="In your own words" maxLength={80} value={personal.genderDescription || ""} onChange={e => patch({ genderDescription: e.target.value || null })}/></label>}<button type="button" className="ob-subtle" onClick={() => patch({ gender: null, genderDescription: null })}>Clear this answer</button><p className="ob-note"><ShieldCheck size={14}/>Optional profile information only. Never used for access or inferred from your account.</p></>}
      {step === 4 && <><label className="ob-field"><span>Find your country</span><input aria-label="Find your country" type="search" placeholder="Search countries…" value={countrySearch} onChange={e => setCountrySearch(e.target.value)}/></label><label className="ob-field"><span>Country</span><select aria-label="Country" value={personal.country || ""} onChange={e => patch({ country: e.target.value || null })}><option value="">Prefer not to say</option>{filteredCountries.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}</select></label>{suggestedCountry && !personal.country && countryList.some(c => c.code === suggestedCountry) && <button type="button" className="ob-suggestion" onClick={() => patch({ country: suggestedCountry })}><Globe2 size={14}/>Suggested by your browser: {countryList.find(c => c.code === suggestedCountry)?.name}<span>Use this<ArrowRight size={12}/></span></button>}</>}
      {step === 5 && <><label className="ob-field"><span>Your timezone</span><select aria-label="Your timezone" value={timezone} onChange={e => setTimezone(e.target.value)}>{zones.map(zone => <option key={zone} value={zone}>{zone.replaceAll("_"," ")}</option>)}</select><small>Your browser’s timezone is a suggestion. Choose the zone you actually use.</small></label><p className="ob-note"><CalendarIcon/>This keeps calendar events, deadline cutoffs, and reminders on the same clock.</p></>}
      {step === 6 && <><label className="ob-field"><span>App language</span><select aria-label="App language" value="en" onChange={() => {}}><option value="en">English</option></select><small>English is the supported interface language in this version.</small></label><div className="ob-two-fields"><label className="ob-field"><span>Regional number formatting</span><select aria-label="Regional number formatting" value={personal.locale} onChange={e => patch({ locale: e.target.value as PersonalPreferences["locale"] })}><option value="en-US">English · United States</option><option value="en-GB">English · United Kingdom</option><option value="en-IN">English · India</option><option value="en-CA">English · Canada</option><option value="en-AU">English · Australia</option></select></label><label className="ob-field"><span>Date format</span><select aria-label="Date format" value={personal.dateFormat} onChange={e => patch({ dateFormat: e.target.value as PersonalPreferences["dateFormat"] })}><option value="readable">Readable · Nov 1, 2026</option><option value="dmy">Day / month / year</option><option value="mdy">Month / day / year</option><option value="ymd">Year / month / day</option></select></label><label className="ob-field"><span>Time format</span><select aria-label="Time format" value={personal.timeFormat} onChange={e => patch({ timeFormat: e.target.value as "12h" | "24h" })}><option value="12h">12-hour · 2:30 PM</option><option value="24h">24-hour · 14:30</option></select></label><label className="ob-field"><span>Week starts on</span><select aria-label="Week starts on" value={personal.weekStart} onChange={e => patch({ weekStart: Number(e.target.value) as 0 | 1 })}><option value={1}>Monday</option><option value={0}>Sunday</option></select></label></div></>}
      {step === 7 && <div className="ob-options">{WORK_USES.map(use => <div key={use}>{option(use, personal.workUses.includes(use), () => patch({ workUses: personal.workUses.includes(use) ? personal.workUses.filter(v => v !== use) : [...personal.workUses,use] }))}</div>)}</div>}
      {step === 8 && <><div className="ob-two-fields"><label className="ob-field"><span>Tasks per week</span><input aria-label="Tasks per week" type="number" min={1} max={200} value={goal} onChange={e => setGoal(Number(e.target.value))}/><small>A gentle goal, not a deadline.</small></label><label className="ob-field"><span>Task list spacing</span><select aria-label="Task list spacing" value={personal.taskDensity} onChange={e => patch({ taskDensity: e.target.value as PersonalPreferences["taskDensity"] })}><option value="comfortable">Comfortable · room to breathe</option><option value="compact">Compact · more in view</option></select></label></div><div className="ob-toggles"><label><span><strong>Show task insights</strong><small>See completion and weekly progress on My tasks.</small></span><input type="checkbox" checked={personal.taskInsights} onChange={e => patch({ taskInsights: e.target.checked })}/></label><label><span><strong>Keep me in the loop</strong><small>Enable Folio notifications. Fine-tune categories in Settings.</small></span><input type="checkbox" checked={notificationsEnabled} onChange={e => setNotificationsEnabled(e.target.checked)}/></label><label><span><strong>Give me quiet hours</strong><small>Hold reminders during your configured rest hours.</small></span><input type="checkbox" checked={quiet} onChange={e => setQuiet(e.target.checked)}/></label></div></>}
      {step === 9 && <div className="ob-theme-choices">{([{ value: "light", label: "Light", Icon: Sun },{ value: "dark", label: "Dark", Icon: Moon },{ value: "system", label: "Follow my system", Icon: Laptop }] as const).map(({ value,label,Icon }) => <button key={value} type="button" className={personal.theme === value ? "is-selected" : ""} aria-pressed={personal.theme === value} onClick={() => { patch({ theme: value }); applyTheme(value, false); }}><div className={`ob-theme-preview is-${value}`}><i/><span><b/><b/><b/></span></div><span><Icon size={15}/>{label}{personal.theme === value && <Check size={14}/>}</span></button>)}</div>}
      {step === 10 && <><div className="ob-ai-note"><Sparkles size={19}/><span><strong>Powered by Google Gemini.</strong> Folio AI sends your prompt to Google AI Studio. It is optional and is not required to use the rest of Folio.</span></div><label className="ob-field"><span>Assistant name</span><input aria-label="Assistant name" maxLength={40} value={assistant.assistantName} onChange={e => setAssistant({ ...assistant, assistantName: e.target.value })}/></label><div className="ob-two-fields"><label className="ob-field"><span>Assistant presentation</span><select aria-label="Assistant presentation" value={assistant.presentation} onChange={e => setAssistant({ ...assistant, presentation: e.target.value as typeof assistant.presentation })}><option value="neutral">Neutral</option><option value="feminine">Feminine</option><option value="masculine">Masculine</option><option value="custom">Custom</option></select></label><label className="ob-field"><span>Communication style</span><select aria-label="Communication style" value={assistant.style} onChange={e => setAssistant({ ...assistant, style: e.target.value as typeof assistant.style })}>{["professional","friendly","concise","motivational","calm"].map(style => <option value={style} key={style}>{style[0].toUpperCase() + style.slice(1)}</option>)}</select></label></div><p className="ob-note">Folio AI uses Gemini with a 10,000-token daily Folio allowance. Your assistant’s presentation is independent of your own identity.</p></>}
    </div>{error && <p className="auth-inline-error" role="alert">{error}</p>}<div className="ob-controls">{step > (editing ? 1 : 0) ? <button type="button" className="ob-back" disabled={busy} onClick={() => void persist(step - 1, true)}><ArrowLeft size={15}/>Back</button> : <span/>}{step > 1 && <button type="button" className="ob-skip" disabled={busy} onClick={() => void persist(step + 1, true)}>{step === 10 ? "Skip AI setup" : "Skip for now"}</button>}<button type="submit" className="lp-button is-primary" disabled={busy || (step === 1 && !name.trim())}>{busy ? <Spinner size={15}/> : null}{step === 0 ? "Make yourself at home" : step === 10 ? editing ? "Save my preferences" : "Open my workspace" : "Continue"}<ArrowRight size={16}/></button></div><div className="ob-save-note"><CheckCheck size={13}/>Saved as you continue. Change anything later in Settings.</div></form></main>}<footer className="ob-footer"><span>A little more organized. A little more you.</span><div><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link>{editing && <Link href="/settings">Back to Settings</Link>}</div></footer></div>;
}
function CalendarIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4m8-4v4M3 10h18"/></svg>; }
