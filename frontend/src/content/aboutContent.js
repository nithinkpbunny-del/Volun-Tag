// Content for the About page (/about).
//
// The project, guide and team facts below are left EMPTY on purpose: they
// have not been supplied yet and must not be invented. The About page shows
// each of those sections only when its fields are filled in, so an empty
// field never appears as placeholder text. Fill them in here; nothing else
// needs to change.

export { REPO_URL } from "./contact";

// Written from what the code actually does.
export const MISSION =
  "VolunTag helps people who want to help find the organisations that need their skills. " +
  "Volunteers describe what they can do, NGOs describe their work and their events, and " +
  "VolunTag suggests where each volunteer's skills fit best. Anyone registered as a volunteer " +
  "can also report a local problem with photos, and VolunTag passes it to NGOs that work on " +
  "that kind of problem.";

// "The project" section. It is shown only when `college` is filled in;
// `department` and `academicYear` are shown when they are filled in too.
export const PROJECT = {
  college: "",
  department: "",
  academicYear: "",
  // Optional extra sentence about the project, in your own words.
  note: "",
};

// The project guide or mentor. Shown only when `name` is filled in.
export const GUIDE = {
  name: "",
  role: "", // for example "Project guide"
};

// Team members. A member is shown only when `name` is filled in, and the
// Team section is hidden while no member has a name. `link` is optional
// (for example a GitHub or LinkedIn profile, with the person's consent).
export const TEAM = [
  { name: "", role: "", link: "" },
];
