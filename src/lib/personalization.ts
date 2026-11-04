import COUNTRY_OPTIONS from "@/lib/countries.json";
// Shared, secret-free profile contract. English is the only translated UI.
export const ONBOARDING_VERSION = 1;
export const ONBOARDING_STEPS = ["Welcome", "Your name", "A personal hello", "About you", "Country", "Timezone", "Your region", "Your work", "Your pace", "Appearance", "Your assistant"] as const;
export type ThemePreference = "system" | "light" | "dark";
export interface PersonalPreferences {
  addressMode: "first" | "full" | "preferred" | "custom";
  preferredName: string | null;
  customAddress: string | null;
  gender: "woman" | "man" | "nonbinary" | "self" | "undisclosed" | null;
  genderDescription: string | null;
  country: string | null;
  language: "en";
  locale: "en-US" | "en-GB" | "en-IN" | "en-CA" | "en-AU";
  dateFormat: "readable" | "dmy" | "mdy" | "ymd";
  timeFormat: "12h" | "24h";
  weekStart: 0 | 1;
  theme: ThemePreference;
  workUses: string[];
  taskDensity: "comfortable" | "compact";
  taskInsights: boolean;
}
export const DEFAULT_PERSONAL: PersonalPreferences = {
  addressMode: "first", preferredName: null, customAddress: null, gender: null, genderDescription: null, country: null,
  language: "en", locale: "en-US", dateFormat: "readable", timeFormat: "12h", weekStart: 1, theme: "system",
  workUses: [], taskDensity: "comfortable", taskInsights: true,
};
export const WORK_USES = ["Personal productivity", "Studies & learning", "Professional work", "Managing projects", "A mix of everything", "Other"];
export const COUNTRY_CODES = "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW".split(" ");
export function countries() { return COUNTRY_OPTIONS; }

export function personalAddress(name: string, p?: Partial<PersonalPreferences> | null) {
  if (p?.addressMode === "full") return name;
  if (p?.addressMode === "preferred" && p.preferredName) return p.preferredName;
  if (p?.addressMode === "custom" && p.customAddress) return p.customAddress;
  return name.split(" ").filter(Boolean)[0] || "there";
}
export function validatePersonal(raw: unknown): Partial<PersonalPreferences> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Please provide valid preferences.");
  const data = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const choices: Record<string, readonly unknown[]> = {
    addressMode: ["first","full","preferred","custom"], gender: ["woman","man","nonbinary","self","undisclosed",null],
    language: ["en"], locale: ["en-US","en-GB","en-IN","en-CA","en-AU"], dateFormat: ["readable","dmy","mdy","ymd"],
    timeFormat: ["12h","24h"], weekStart: [0,1], theme: ["system","light","dark"], taskDensity: ["comfortable","compact"],
  };
  for (const [key, value] of Object.entries(data)) {
    if (!Object.hasOwn(DEFAULT_PERSONAL, key)) throw new Error("Unknown preference field.");
    if (choices[key]) { if (!choices[key].includes(value)) throw new Error(`Please choose a valid ${key}.`); out[key] = value; }
    else if (["preferredName","customAddress","genderDescription"].includes(key)) {
      if (value !== null && (typeof value !== "string" || value.trim().length > 80 || /[\u0000-\u001f]/.test(value))) throw new Error("Personal details must be at most 80 characters.");
      out[key] = typeof value === "string" ? value.trim() || null : null;
    } else if (key === "country") {
      if (value !== null && !COUNTRY_CODES.includes(value as string)) throw new Error("Choose a country from the list."); out[key] = value;
    } else if (key === "taskInsights") {
      if (typeof value !== "boolean") throw new Error("Invalid insights preference."); out[key] = value;
    } else if (key === "workUses") {
      if (!Array.isArray(value) || value.length > 6 || value.some(v => !WORK_USES.includes(v))) throw new Error("Choose a valid work preference."); out[key] = [...new Set(value)];
    }
  }
  if ("gender" in out && out.gender !== "self") out.genderDescription = null;
  return out as Partial<PersonalPreferences>;
}

// A browser-only view of formatting preferences, initialized before workspace
// children render. The server never uses mutable process-global user settings.
let browserPersonal: PersonalPreferences = DEFAULT_PERSONAL;
let browserTimezone: string | undefined;
export function setBrowserPersonal(value: PersonalPreferences, timezone: string) {
  if (typeof window === "undefined") return;
  browserPersonal = value; browserTimezone = timezone;
}
export function regionalPreferences() { return typeof window === "undefined" ? DEFAULT_PERSONAL : browserPersonal; }
export function regionalTimezone() { return typeof window === "undefined" ? undefined : browserTimezone; }
export function regionalDate(date: Date, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat(regionalPreferences().locale, { timeZone: regionalTimezone(), ...options }).format(date);
}
export function regionalTime(date: Date) { return regionalDate(date, { hour: "numeric", minute: "2-digit", hour12: regionalPreferences().timeFormat === "12h" }); }
export function regionalNumber(value: number) { return new Intl.NumberFormat(regionalPreferences().locale).format(value); }
