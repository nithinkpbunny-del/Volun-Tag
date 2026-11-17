// Volunteer profile fields and their rules, shared by the registration form
// and Settings. The server applies the same rules (backend/schemas.py:
// VolunteerName, VolunteerText, VolunteerAge), so keep the two in step.

export const SKILL_SUGGESTIONS = [
  "Teaching", "Tutoring", "Mentoring", "First Aid", "Web Development",
  "Graphic Design", "Writing", "Public Speaking", "Photography",
  "Counseling", "Data Analysis", "Event Planning", "Fundraising",
  "Social Media", "Translation", "Nursing", "Cooking", "Driving",
  "Construction", "Legal Aid", "Music", "Sports Coaching",
];

export const GENDER_OPTIONS = ["Male", "Female", "Other", "Prefer not to say"];

export const AVAILABILITY_OPTIONS = [
  "Flexible", "Weekdays", "Weekends", "Part-time", "Full-time",
];

export const EXPERIENCE_OPTIONS = ["Beginner", "Intermediate", "Experienced"];

// The five causes (same list as NGO categories and the server's CAUSE_CATEGORIES).
export const CAUSE_OPTIONS = ["Education", "Health", "Environment", "Animal Welfare", "Social Services"];

export const NAME_MAX = 100;
export const BIO_MAX = 1000;

const text = (value) => String(value ?? "");

/** "a, b" -> ["a", "b"] (trimmed, empty items dropped). */
export function splitList(value) {
  return text(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

/** True when the comma list contains skill (any case). */
export function hasSkill(skills, skill) {
  return splitList(skills).some((s) => s.toLowerCase() === skill.toLowerCase());
}

/** Add or remove one skill from a comma list; returns the new list text. */
export function toggleSkill(skills, skill) {
  const current = splitList(skills);
  const exists = current.some((s) => s.toLowerCase() === skill.toLowerCase());
  const updated = exists
    ? current.filter((s) => s.toLowerCase() !== skill.toLowerCase())
    : [...current, skill];
  return updated.join(", ");
}

/**
 * Errors for the profile fields that registration requires, keyed by field
 * name ({} when everything is valid). Email and password are checked by the
 * registration form itself.
 */
export function validateVolunteerProfile(form) {
  const errs = {};

  if (!text(form.name).trim()) {
    errs.name = "Name is required";
  } else if (text(form.name).trim().length > NAME_MAX) {
    errs.name = `Name must be at most ${NAME_MAX} characters`;
  }

  if (!text(form.contact_number).trim()) {
    errs.contact_number = "Contact number is required";
  }

  if (!form.age) {
    errs.age = "Age is required";
  } else if (Number(form.age) < 1 || Number(form.age) > 120 || !Number.isInteger(Number(form.age))) {
    errs.age = "Age must be between 1 and 120";
  }

  if (!text(form.designation).trim()) {
    errs.designation = "Designation is required";
  }

  if (!text(form.gender).trim()) {
    errs.gender = "Gender is required";
  }

  if (splitList(form.skills).length === 0) {
    errs.skills = "Skills are required";
  }

  if (!text(form.location).trim()) {
    errs.location = "Location is required";
  }

  if (!text(form.availability).trim()) {
    errs.availability = "Availability is required";
  }

  if (form.bio !== undefined && text(form.bio).trim().length > BIO_MAX) {
    errs.bio = `Keep it under ${BIO_MAX} characters`;
  }

  return errs;
}
