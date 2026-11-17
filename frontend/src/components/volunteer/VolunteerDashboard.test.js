import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import VolunteerDashboard from "./VolunteerDashboard";
import { saveSession } from "../../api";

const EMAIL = "vol@example.test";

const EVENTS = [
  {
    activity_id: 1,
    title: "Beach cleanup",
    ngo_name: "Green Shore",
    ngo_email: "green@example.test",
    ngo_category: "Environment",
    ngo_location: "Pune",
    location: "Pune",
    event_date: "2026-12-05T00:00:00",
    event_day: "2026-12-05",
    phase: "open",
    required_skills: "cleanup",
    match_percentage: 80,
    joined: false,
    approved: false,
  },
  {
    activity_id: 2,
    title: "Reading camp",
    ngo_name: "Green Shore",
    ngo_email: "green@example.test",
    ngo_category: "Environment",
    ngo_location: "Pune",
    location: "Pune",
    event_date: "2026-11-16T00:00:00",
    event_day: "2026-11-16",
    phase: "in_progress",
    required_skills: "teaching",
    match_percentage: 70,
    joined: true,
    approved: false,
  },
];

const ROUTES = {
  "/volunteer-dashboard/": { name: "Asha Test", skills: "cleanup, teaching", location: "Pune" },
  "/volunteer-events/": EVENTS,
  "/volunteer-activity/": [
    { activity_id: 1, title: "Past drive", ngo_name: "Green Shore", event_status: "Active", phase: "completed", status_label: "Attended", attendance_status: "attended", rating: 4 },
    { activity_id: 2, title: "Reading camp", ngo_name: "Green Shore", event_status: "Active", phase: "in_progress", status_label: "Approved", attendance_status: null },
    { activity_id: 3, title: "Old plan", ngo_name: "Green Shore", event_status: "Cancelled", phase: "open", status_label: "Cancelled", attendance_status: null },
  ],
  "/volunteer-issues/": [],
  "/volunteer-matches/": [],
  "/conversations/": [],
  "/ngos": [],
};

function body(url) {
  const key = Object.keys(ROUTES).find((part) => url.includes(part));
  return key ? ROUTES[key] : {};
}

function WhereAmI() {
  const { search } = useLocation();
  return <p data-testid="search">{search}</p>;
}

// Let pending loads (events, NGOs, matches, unread count) settle.
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

async function renderDashboard(path) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/volunteer/dashboard"
          element={
            <>
              <VolunteerDashboard email={EMAIL} showToast={jest.fn()} onReportProblem={jest.fn()} />
              <WhereAmI />
            </>
          }
        />
      </Routes>
    </MemoryRouter>
  );
  await screen.findByRole("heading", { level: 1, name: "Volunteer dashboard" });
  await settle();
}

beforeEach(() => {
  sessionStorage.clear();
  saveSession({ token: "t", role: "volunteer", email: EMAIL });
  global.fetch = jest.fn((url) =>
    Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body(String(url))) })
  );
});

test("the tab comes from ?tab= and clicking a tab updates the address", async () => {
  await renderDashboard("/volunteer/dashboard?tab=settings");

  expect(screen.getByText("Account settings are coming soon.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Settings" })).toHaveAttribute("aria-current", "page");

  fireEvent.click(screen.getByRole("button", { name: "My Activity" }));
  await settle();
  expect(screen.getByTestId("search")).toHaveTextContent("?tab=activity");

  fireEvent.click(screen.getByRole("button", { name: "Profile" }));
  await settle();
  expect(screen.getByTestId("search")).toBeEmptyDOMElement();
});

test("an unknown tab falls back to the profile", async () => {
  await renderDashboard("/volunteer/dashboard?tab=nonsense");

  expect(screen.getByRole("button", { name: "Profile" })).toHaveAttribute("aria-current", "page");
});

test("events show the server's phase; Join and Leave only while registration is open", async () => {
  await renderDashboard("/volunteer/dashboard");

  expect(await screen.findByText("Beach cleanup")).toBeInTheDocument();
  expect(screen.getByText("Registration open")).toBeInTheDocument();
  expect(screen.getByText("Happening today")).toBeInTheDocument();

  // Open event, not joined: can join.
  expect(screen.getByRole("button", { name: "Join activity" })).toBeInTheDocument();
  // In-progress event already joined: no Leave button any more.
  expect(screen.getByText("Joined")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Leave activity" })).not.toBeInTheDocument();
});

test("the sidebar shows real numbers from the volunteer's activity, not hard-coded zeros", async () => {
  await renderDashboard("/volunteer/dashboard");

  const stat = (label) =>
    // eslint-disable-next-line testing-library/no-node-access
    screen.getByText(label).closest(".ui-stat");

  // Two events that were not cancelled, one of them attended.
  expect(stat("Events joined")).toHaveTextContent("2");
  expect(stat("Events attended")).toHaveTextContent("1");
  expect(screen.queryByText("Contributions")).not.toBeInTheDocument();
});

test("My Activity is grouped into upcoming and past", async () => {
  await renderDashboard("/volunteer/dashboard?tab=activity");

  expect(screen.getByRole("heading", { name: "Upcoming" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Past" })).toBeInTheDocument();
  expect(screen.getByText("Attended")).toBeInTheDocument();
});
