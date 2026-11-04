// Pure IANA timezone and quiet-hours helpers with zero external dependencies.

const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_DT_RE = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/;

export function isValidTimezone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz.trim() || tz.length > 80) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz.trim() });
    return true;
  } catch {
    return false;
  }
}

export function safeTimezone(tz?: string | null): string {
  return tz && isValidTimezone(tz) ? tz.trim() : "UTC";
}

export function isValidHHMM(value: unknown): value is string {
  return typeof value === "string" && HHMM_RE.test(value);
}

export function parseHHMM(value: string): number {
  const match = HHMM_RE.exec(value);
  if (!match) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
}

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  dateKey: string;
  timeKey: string;
  minutesOfDay: number;
}

export function getZonedParts(instant: Date, timeZone: string): ZonedParts {
  const zone = safeTimezone(timeZone);
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const map: Record<string, string> = {};
  for (const part of formatter.formatToParts(instant)) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  const year = Number(map.year || 1970);
  const month = Number(map.month || 1);
  const day = Number(map.day || 1);
  // Some engines emit "24" at midnight with h23; normalise to 0.
  const rawHour = Number(map.hour || 0);
  const hour = rawHour === 24 ? 0 : rawHour;
  const minute = Number(map.minute || 0);
  const second = Number(map.second || 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    year,
    month,
    day,
    hour,
    minute,
    second,
    dateKey: `${String(year).padStart(4, "0")}-${pad(month)}-${pad(day)}`,
    timeKey: `${pad(hour)}:${pad(minute)}`,
    minutesOfDay: hour * 60 + minute,
  };
}

/**
 * Converts a local YYYY-MM-DD and HH:MM in `timeZone` into an exact UTC Date,
 * using a two-pass offset refinement so DST transitions stay accurate.
 */
export function localDateTimeToUtc(dateStr: string, timeStr: string, timeZone: string): Date | null {
  const dMatch = DATE_RE.exec(dateStr);
  const tMatch = HHMM_RE.exec(timeStr);
  if (!dMatch || !tMatch) return null;
  const year = Number(dMatch[1]);
  const month = Number(dMatch[2]);
  const day = Number(dMatch[3]);
  const hour = Number(tMatch[1]);
  const minute = Number(tMatch[2]);
  const targetUtcMs = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  if (Number.isNaN(targetUtcMs)) return null;

  const zone = safeTimezone(timeZone);
  let guess = targetUtcMs;
  for (let pass = 0; pass < 2; pass++) {
    const parts = getZonedParts(new Date(guess), zone);
    const observedAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0, 0);
    const diff = targetUtcMs - observedAsUtc;
    guess += diff;
  }
  return new Date(guess);
}

/** Parses a local datetime-local input value ("YYYY-MM-DDTHH:mm") in `timeZone` into UTC. */
export function parseCustomLocalToUtc(customLocal: string, timeZone: string): Date | null {
  const match = LOCAL_DT_RE.exec(customLocal.trim());
  if (!match) return null;
  return localDateTimeToUtc(match[1], `${match[2]}:${match[3]}`, timeZone);
}

/** Formats a UTC Date into a datetime-local string ("YYYY-MM-DDTHH:mm") in `timeZone`. */
export function formatUtcToCustomLocal(instant: Date, timeZone: string): string {
  const parts = getZonedParts(instant, timeZone);
  return `${parts.dateKey}T${parts.timeKey}`;
}

/** Whole calendar days from `fromDateKey` to `toDateKey` (both YYYY-MM-DD). */
export function calendarDaysDiff(fromDateKey: string, toDateKey: string): number {
  const a = Date.UTC(
    Number(fromDateKey.slice(0, 4)),
    Number(fromDateKey.slice(5, 7)) - 1,
    Number(fromDateKey.slice(8, 10)),
  );
  const b = Date.UTC(
    Number(toDateKey.slice(0, 4)),
    Number(toDateKey.slice(5, 7)) - 1,
    Number(toDateKey.slice(8, 10)),
  );
  return Math.round((b - a) / 86_400_000);
}

/** Adds whole days to a YYYY-MM-DD date string. */
export function shiftDateKey(dateKeyStr: string, deltaDays: number): string {
  const d = new Date(
    Date.UTC(
      Number(dateKeyStr.slice(0, 4)),
      Number(dateKeyStr.slice(5, 7)) - 1,
      Number(dateKeyStr.slice(8, 10)) + deltaDays,
    ),
  );
  return d.toISOString().slice(0, 10);
}

/**
 * Checks whether `instant` falls inside the user's configured quiet hours.
 * Supports both same-day windows (13:00 -> 15:00) and overnight windows (22:00 -> 08:00).
 */
export function isWithinQuietHours(
  instant: Date,
  timeZone: string,
  enabled: boolean,
  startHHMM: string,
  endHHMM: string,
): boolean {
  if (!enabled || !isValidHHMM(startHHMM) || !isValidHHMM(endHHMM)) return false;
  const start = parseHHMM(startHHMM);
  const end = parseHHMM(endHHMM);
  if (start === end) return false;
  const { minutesOfDay } = getZonedParts(instant, timeZone);
  if (start < end) {
    return minutesOfDay >= start && minutesOfDay < end;
  }
  return minutesOfDay >= start || minutesOfDay < end;
}

/** Computes the next UTC instant when quiet hours end so queued items know when to release. */
export function nextQuietHoursEndUtc(
  instant: Date,
  timeZone: string,
  startHHMM: string,
  endHHMM: string,
): Date {
  const parts = getZonedParts(instant, timeZone);
  const start = parseHHMM(startHHMM);
  const end = parseHHMM(endHHMM);
  let endDateKey = parts.dateKey;
  if (start > end && parts.minutesOfDay >= start) {
    // Overnight window and we are before midnight: quiet hours end tomorrow morning.
    endDateKey = shiftDateKey(parts.dateKey, 1);
  }
  return localDateTimeToUtc(endDateKey, endHHMM, timeZone) ?? new Date(instant.getTime() + 60 * 60_000);
}

export type NotificationDayGroup = "Today" | "Yesterday" | "Earlier";

export function dayGroupInZone(
  value: string | Date,
  timeZone: string,
  now: Date = new Date(),
): NotificationDayGroup {
  const instant = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(instant.getTime())) return "Earlier";
  const todayKey = getZonedParts(now, timeZone).dateKey;
  const itemKey = getZonedParts(instant, timeZone).dateKey;
  const diff = calendarDaysDiff(itemKey, todayKey);
  if (diff <= 0) return "Today";
  if (diff === 1) return "Yesterday";
  return "Earlier";
}

export function formatDateTimeInZone(
  instant: Date | string,
  timeZone: string,
  options?: Intl.DateTimeFormatOptions,
): string {
  const d = typeof instant === "string" ? new Date(instant) : instant;
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: safeTimezone(timeZone),
    ...(options ?? { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }),
  }).format(d);
}
