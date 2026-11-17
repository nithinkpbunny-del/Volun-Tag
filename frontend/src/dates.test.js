import {
  eventDayInputValue,
  formatEventDay,
  formatTimestampDate,
  isCompletedPhase,
  isOpenPhase,
  parseServerTime,
  phaseLabel,
  tomorrowInIST,
} from "./dates";

test("an event day is formatted from its parts, never shifted by a time zone", () => {
  expect(formatEventDay("2026-11-16")).toBe(
    new Date(2026, 10, 16).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    })
  );
  expect(formatEventDay(null)).toBe("Date to be announced");
  expect(formatEventDay("", "—")).toBe("—");
});

test("the date input value is the plain day", () => {
  expect(eventDayInputValue("2026-12-01")).toBe("2026-12-01");
  expect(eventDayInputValue(null)).toBe("");
});

test("phase labels and checks follow the server's phase", () => {
  expect(phaseLabel("open")).toBe("Registration open");
  expect(phaseLabel("in_progress")).toBe("Happening today");
  expect(phaseLabel("completed")).toBe("Completed");
  expect(phaseLabel("something")).toBe("");
  expect(isOpenPhase("open")).toBe(true);
  expect(isOpenPhase("in_progress")).toBe(false);
  expect(isCompletedPhase("completed")).toBe(true);
  expect(isCompletedPhase(undefined)).toBe(false);
});

test("tomorrow is computed in India Standard Time", () => {
  // 2026-11-16 18:29 UTC is 23:59 IST on the 16th: tomorrow is the 17th.
  expect(tomorrowInIST(Date.UTC(2026, 10, 16, 18, 29))).toBe("2026-11-17");
  // 2026-11-16 18:30 UTC is 00:00 IST on the 17th: tomorrow is the 18th.
  expect(tomorrowInIST(Date.UTC(2026, 10, 16, 18, 30))).toBe("2026-11-18");
  // Month and year roll over.
  expect(tomorrowInIST(Date.UTC(2026, 11, 31, 6, 0))).toBe("2027-01-01");
});

test("naive server timestamps are read as UTC", () => {
  expect(parseServerTime("2026-11-16T20:00:00").toISOString()).toBe(
    "2026-11-16T20:00:00.000Z"
  );
  expect(parseServerTime("2026-11-16T20:00:00+05:30").toISOString()).toBe(
    "2026-11-16T14:30:00.000Z"
  );
  expect(parseServerTime("not a date")).toBeNull();
  // 20:00 UTC on the 16th is already the 17th in IST.
  expect(formatTimestampDate("2026-11-16T20:00:00")).toMatch(/17/);
  expect(formatTimestampDate(null)).toBe("—");
});
