import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import NGODashboard from "./NGODashboard";
import { saveSession } from "../../api";

const EMAIL = "ngo@example.test";

const event = (id, overrides = {}) => ({
  id,
  ngo_id: 1,
  title: `Event ${id}`,
  description: null,
  required_skills: "teaching",
  location: "Pune",
  event_day: "2026-12-05",
  spots_available: 5,
  status: "Active",
  joined_count: 3,
  approved_count: 2,
  feedback_count: 0,
  phase: "open",
  ...overrides,
});

let events;

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

async function renderDashboard(path) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/ngo/dashboard"
          element={<NGODashboard email={EMAIL} showToast={jest.fn()} />}
        />
      </Routes>
    </MemoryRouter>
  );
  await screen.findByRole("heading", { level: 1, name: "NGO dashboard" });
  await settle();
}

beforeEach(() => {
  sessionStorage.clear();
  saveSession({ token: "t", role: "ngo", email: EMAIL });
  events = [
    event(1),
    event(2, { phase: "completed", approved_count: 4, feedback_count: 1 }),
    event(3, { status: "Cancelled", approved_count: 9 }),
  ];
  global.fetch = jest.fn((url, options = {}) => {
    const address = String(url);
    let body = {};
    if (address.includes("/ngo-dashboard/")) {
      body = { name: "Green Shore", email: EMAIL, verification_status: "Approved" };
    } else if (address.includes("/organize-event/") && options.method === "POST") {
      const created = event(10, { title: "Brand new event", joined_count: 0, approved_count: 0 });
      events = [created, ...events];
      body = created;
    } else if (address.includes("/ngo-events/")) {
      body = { events };
    } else if (address.includes("/ngo-issues/") || address.includes("/conversations/")) {
      body = [];
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
  });
});

test("the profile sidebar shows real numbers instead of hard-coded zeros", async () => {
  await renderDashboard("/ngo/dashboard");

  const stat = (label) =>
    // eslint-disable-next-line testing-library/no-node-access
    screen.getByText(label).closest(".ui-stat");

  expect(stat("Current events")).toHaveTextContent("1");
  expect(stat("Completed events")).toHaveTextContent("1");
  // Approved volunteers of events that were not cancelled: 2 + 4.
  expect(stat("Volunteers approved")).toHaveTextContent("6");
  expect(stat("Problems solved")).toHaveTextContent("0");
  expect(screen.queryByText("Volunteers Reached")).not.toBeInTheDocument();
});

test("the Events tab lists event cards; completed events are under Activities", async () => {
  await renderDashboard("/ngo/dashboard?tab=events");

  expect(screen.getByRole("heading", { name: "Event 1" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Event 3" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Event 2" })).not.toBeInTheDocument();
});

test("a newly created event appears first and is marked as new", async () => {
  await renderDashboard("/ngo/dashboard?tab=events");

  fireEvent.click(screen.getByRole("button", { name: /Organize event/ }));
  fireEvent.change(screen.getByLabelText(/^Event title/), { target: { value: "Brand new event" } });
  fireEvent.change(screen.getByRole("textbox", { name: /Required skills/ }), { target: { value: "teaching" } });
  fireEvent.click(screen.getByRole("button", { name: "Create event" }));
  await settle();

  const cards = screen.getAllByRole("article");
  expect(within(cards[0]).getByRole("heading", { name: "Brand new event" })).toBeInTheDocument();
  expect(within(cards[0]).getByText("New")).toBeInTheDocument();
  expect(cards[0]).toHaveClass("event-card--new");
});

test("an empty event list shows the empty state with its action", async () => {
  events = [];
  await renderDashboard("/ngo/dashboard?tab=events");

  expect(screen.getByText("No events yet")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Organize your first event/ })).toBeInTheDocument();
});
