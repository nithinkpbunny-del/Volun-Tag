// Dates and event phases, one place for the whole app.
//
// Event days come from the server as "YYYY-MM-DD" (`event_day`) together with
// a server-computed `phase` ("open" | "in_progress" | "completed", India
// Standard Time). The browser never works out a phase itself and never parses
// `event_date` with new Date(), which shifted days across time zones.
//
// Timestamps (created_at, joined_at, message times) are stored by the server
// as naive UTC ("2026-11-16T08:15:00"); parseServerTime reads them as UTC.

export const APP_TIME_ZONE = "Asia/Kolkata";

export const PHASES = {
  open: "open",
  inProgress: "in_progress",
  completed: "completed",
};

const PHASE_LABELS = {
  open: "Registration open",
  in_progress: "Happening today",
  completed: "Completed",
};

/** A short, readable label for a phase ("" for an unknown value). */
export function phaseLabel(phase) {
  return PHASE_LABELS[phase] || "";
}

/** True when volunteers can still join or leave and the NGO can approve or remove. */
export const isOpenPhase = (phase) => phase === PHASES.open;

/** True when the event day is over (the NGO can rate attendance). */
export const isCompletedPhase = (phase) => phase === PHASES.completed;

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})/;

/**
 * "16 Nov 2026" for an event day ("2026-11-16"), built from its parts so no
 * time zone can move it. Returns the fallback when there is no day.
 */
export function formatEventDay(day, fallback = "Date to be announced") {
  const match = typeof day === "string" ? DAY_PATTERN.exec(day) : null;

  if (!match) return fallback;

  const [, y, m, d] = match;
  const date = new Date(Number(y), Number(m) - 1, Number(d));

  return date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** The event day in a "YYYY-MM-DD" form for a date input, or "". */
export function eventDayInputValue(day) {
  const match = typeof day === "string" ? DAY_PATTERN.exec(day) : null;
  return match ? `${match[1]}-${match[2]}-${match[3]}` : "";
}

/**
 * Tomorrow in India Standard Time as "YYYY-MM-DD": the earliest day the
 * server accepts for a new event. Only used as the date input's `min`; the
 * server still checks the date.
 */
export function tomorrowInIST(now = Date.now()) {
  // IST is UTC+05:30 all year (no daylight saving).
  const ist = new Date(now + 330 * 60 * 1000);
  const tomorrow = new Date(
    Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() + 1)
  );

  return tomorrow.toISOString().slice(0, 10);
}

const HAS_ZONE = /(Z|[+-]\d{2}:?\d{2})$/i;

/** A Date for a server timestamp; naive values are read as UTC. Null if invalid. */
export function parseServerTime(value) {
  if (!value) return null;

  const text = String(value);
  const date = new Date(HAS_ZONE.test(text) ? text : `${text}Z`);

  return Number.isNaN(date.getTime()) ? null : date;
}

/** "16 Nov 2026" for a server timestamp, shown in IST. */
export function formatTimestampDate(value, fallback = "—") {
  const date = parseServerTime(value);

  if (!date) return fallback;

  return date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: APP_TIME_ZONE,
  });
}
