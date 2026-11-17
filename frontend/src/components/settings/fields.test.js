import { toggleSkill, validateVolunteerProfile } from "../volunteer/volunteerFields";
import { validateNgoProfile } from "../ngo/ngoFields";
import { changedFields } from "./settingsApi";

const VALID = {
  name: "Asha", contact_number: "1", age: "30", designation: "S", gender: "F",
  skills: "Teaching", location: "Pune", availability: "Weekends",
};

test("volunteer rules: valid profile has no errors", () => {
  expect(validateVolunteerProfile(VALID)).toEqual({});
});

test.each([
  ["name", "", "Name is required"],
  ["name", "x".repeat(101), "Name must be at most 100 characters"],
  ["age", "0", "Age must be between 1 and 120"],
  ["age", "2.5", "Age must be between 1 and 120"],
  ["skills", " , ", "Skills are required"],
  ["location", "  ", "Location is required"],
  ["availability", "", "Availability is required"],
])("volunteer rules: %s = %p", (field, value, message) => {
  expect(validateVolunteerProfile({ ...VALID, [field]: value })[field]).toBe(message);
});

test("toggleSkill adds and removes ignoring case", () => {
  expect(toggleSkill("Cooking", "Teaching")).toBe("Cooking, Teaching");
  expect(toggleSkill("Cooking, teaching", "Teaching")).toBe("Cooking");
});

test("NGO rules: website must be http(s)", () => {
  const ok = { contact_number: "1", category: "Health", location: "Pune", motto: "Help" };
  expect(validateNgoProfile(ok)).toEqual({});
  expect(validateNgoProfile({ ...ok, website_url: "javascript:alert(1)" }).website_url).toBeTruthy();
  expect(validateNgoProfile({ ...ok, website_url: "ftp://x.org" }).website_url).toBeTruthy();
  expect(validateNgoProfile({ ...ok, website_url: "example.org" }).website_url).toBeUndefined();
  expect(validateNgoProfile({ ...ok, motto: " " }).motto).toBe("Motto is required");
});

test("changedFields compares trimmed text and lists", () => {
  const saved = { a: "x", b: ["1"], c: "" };
  expect(changedFields({ a: " x ", b: ["1"], c: "" }, saved, ["a", "b", "c"])).toEqual({});
  expect(changedFields({ a: "y ", b: [], c: "z" }, saved, ["a", "b", "c"])).toEqual({ a: "y", b: [], c: "z" });
});
