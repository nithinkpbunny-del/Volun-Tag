import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import AccountSettings from "./AccountSettings";
import { saveSession } from "../../api";

const VOLUNTEER = {
  name: "Asha Test", email: "vol@example.test", contact_number: "99999", age: 25,
  designation: "Student", gender: "Female", skills: "Cooking, Driving", location: "Pune",
  availability: "Weekends", experience: "Beginner", bio: null, cause_interests: [],
};

const NGO = {
  name: "Read Trust", email: "org@example.test", contact_number: "88888", category: "Education",
  location: "Pune", address: null, website_url: "https://read.example.org", motto: "Teaching children",
  legal_structure: "Trust", year_founded: 2001, verification_status: "Approved",
  documents: [{ kind: "pan_card", label: "PAN card" }],
};

const SESSIONS = [
  { id: 1, device: "Chrome on macOS", created_at: "2026-11-17T08:00:00Z", last_used_at: "2026-11-17T09:00:00Z", expires_at: "2026-11-17T20:00:00Z", current: true },
  { id: 2, device: "Firefox on Windows", created_at: "2026-11-16T08:00:00Z", last_used_at: "2026-11-16T09:00:00Z", expires_at: "2026-11-16T20:00:00Z", current: false },
];

let routes;
let calls;

const reply = (status, data) =>
  Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(data) });

beforeEach(() => {
  saveSession({ token: "t", role: "volunteer", email: "vol@example.test" });
  calls = [];
  routes = {
    "GET /volunteer/me": () => reply(200, VOLUNTEER),
    "PATCH /volunteer/me": (body) => reply(200, { ...VOLUNTEER, ...body }),
    "GET /ngo/me": () => reply(200, NGO),
    "PATCH /ngo/me": (body) => reply(200, { ...NGO, ...body }),
    "GET /account/sessions": () => reply(200, SESSIONS),
    "POST /account/sessions/logout-others": () => reply(200, { revoked: 1 }),
    "POST /account/password": () => reply(200, { message: "ok", sessions_revoked: 2 }),
  };
  global.fetch = jest.fn((url, options = {}) => {
    const path = new URL(String(url)).pathname;
    const method = options.method || "GET";
    const body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({ method, path, body });
    const handler = routes[`${method} ${path}`];
    return handler ? handler(body) : reply(404, { detail: "not found" });
  });
});

afterEach(() => {
  sessionStorage.clear();
});

function WhereAmI() {
  const { search } = useLocation();
  return <p data-testid="search">{search}</p>;
}

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

async function renderSettings(role, search = "?tab=settings", extra = {}) {
  const props = { role, showToast: jest.fn(), onProfileSaved: jest.fn(), ...extra };
  render(
    <MemoryRouter initialEntries={[`/dash${search}`]}>
      <Routes>
        <Route
          path="/dash"
          element={
            <>
              <AccountSettings {...props} />
              <WhereAmI />
            </>
          }
        />
      </Routes>
    </MemoryRouter>
  );
  await settle();
  return props;
}

const sent = (method, path) => calls.filter((c) => c.method === method && c.path === path);

// ─── Volunteer profile ───────────────────────────────────────────
test("volunteer profile: save is disabled until something changes, then sends only the change", async () => {
  const props = await renderSettings("volunteer");

  const save = screen.getByRole("button", { name: "Save changes" });
  expect(save).toBeDisabled();
  expect(screen.getByLabelText(/Full name/)).toHaveValue("Asha Test");

  fireEvent.change(screen.getByLabelText(/City \/ location/), { target: { value: "  Goa " } });
  expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
  expect(save).toBeEnabled();

  fireEvent.click(save);
  await settle();

  expect(sent("PATCH", "/volunteer/me").map((c) => c.body)).toEqual([{ location: "Goa" }]);
  expect(screen.getByText("Saved")).toBeInTheDocument();
  expect(save).toBeDisabled();
  expect(props.onProfileSaved).toHaveBeenCalledWith(
    expect.objectContaining({ location: "Goa" }),
    { matchingChanged: true }
  );
});

test("volunteer profile: a skill chip adds the skill and causes are sent as a list", async () => {
  await renderSettings("volunteer");

  fireEvent.click(screen.getByRole("button", { name: "Teaching" }));
  expect(screen.getByLabelText(/^Skills/)).toHaveValue("Cooking, Driving, Teaching");
  expect(screen.getByRole("button", { name: "Teaching" })).toHaveAttribute("aria-pressed", "true");

  fireEvent.click(screen.getByLabelText("Health"));
  fireEvent.click(screen.getByLabelText("Education"));
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await settle();

  expect(sent("PATCH", "/volunteer/me")[0].body).toEqual({
    skills: "Cooking, Driving, Teaching",
    cause_interests: ["Education", "Health"],
  });
});

test("volunteer profile: the registration rules block a bad save before it is sent", async () => {
  await renderSettings("volunteer");

  fireEvent.change(screen.getByLabelText(/Full name/), { target: { value: "  " } });
  fireEvent.change(screen.getByLabelText(/^Age/), { target: { value: "130" } });
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await settle();

  expect(screen.getByText("Name is required")).toBeInTheDocument();
  expect(screen.getByText("Age must be between 1 and 120")).toBeInTheDocument();
  expect(screen.getByLabelText(/Full name/)).toHaveAttribute("aria-invalid", "true");
  expect(sent("PATCH", "/volunteer/me")).toHaveLength(0);
});

test("volunteer profile: a server error is shown and the changes are kept", async () => {
  routes["PATCH /volunteer/me"] = () => reply(400, { detail: "Volunteer 'Bina' already exists" });
  await renderSettings("volunteer");

  fireEvent.change(screen.getByLabelText(/Full name/), { target: { value: "Bina" } });
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await settle();

  expect(screen.getByRole("alert")).toHaveTextContent("Volunteer 'Bina' already exists");
  expect(screen.getByLabelText(/Full name/)).toHaveValue("Bina");
  expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
});

test("volunteer profile: discard puts the saved values back", async () => {
  await renderSettings("volunteer");
  fireEvent.change(screen.getByLabelText(/Phone/), { target: { value: "123" } });
  fireEvent.click(screen.getByRole("button", { name: "Discard" }));
  expect(screen.getByLabelText(/Phone/)).toHaveValue("99999");
  expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
});

// ─── NGO profile ─────────────────────────────────────────────────
test("NGO profile: name and documents are read-only with a note to contact the admin", async () => {
  saveSession({ token: "t", role: "ngo", email: "org@example.test" });
  await renderSettings("ngo");

  const details = screen.getByRole("region", { name: "Organisation details" });
  expect(within(details).getByText("Read Trust")).toBeInTheDocument();
  expect(within(details).getByText("PAN card")).toBeInTheDocument();
  expect(within(details).queryByRole("textbox")).toBeNull();
  expect(within(details).getByRole("link", { name: "Contact the admin" })).toHaveAttribute("href", "/contact");
  expect(screen.queryByDisplayValue("Read Trust")).toBeNull();
});

test("NGO profile: a category change asks for confirmation before saving", async () => {
  saveSession({ token: "t", role: "ngo", email: "org@example.test" });
  await renderSettings("ngo");

  fireEvent.change(screen.getByLabelText(/Cause category/), { target: { value: "Health" } });
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await settle();

  const dialog = screen.getByRole("alertdialog");
  expect(dialog).toHaveTextContent("Change your category from Education to Health?");
  expect(dialog).toHaveTextContent("some volunteers who see them today will stop seeing them");
  expect(sent("PATCH", "/ngo/me")).toHaveLength(0);

  // "Keep" puts the old category back and sends nothing.
  fireEvent.click(within(dialog).getByRole("button", { name: "Keep Education" }));
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(screen.getByLabelText(/Cause category/)).toHaveValue("Education");

  fireEvent.change(screen.getByLabelText(/Cause category/), { target: { value: "Health" } });
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await settle();
  fireEvent.click(screen.getByRole("button", { name: "Change category and save" }));
  await settle();

  expect(sent("PATCH", "/ngo/me").map((c) => c.body)).toEqual([{ category: "Health" }]);
  expect(screen.getByText("Saved")).toBeInTheDocument();
});

test("NGO profile: only http(s) websites are accepted", async () => {
  saveSession({ token: "t", role: "ngo", email: "org@example.test" });
  await renderSettings("ngo");

  const website = screen.getByLabelText(/Website/);
  fireEvent.change(website, { target: { value: "javascript:alert(1)" } });
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await settle();

  expect(screen.getByText("Enter a website address such as https://example.org")).toBeInTheDocument();
  expect(sent("PATCH", "/ngo/me")).toHaveLength(0);
  expect(screen.queryByRole("link", { name: /javascript/ })).toBeNull();

  fireEvent.change(website, { target: { value: "new.example.org" } });
  expect(screen.getByRole("link", { name: "https://new.example.org/" })).toHaveAttribute("href", "https://new.example.org/");
});

// ─── Security ────────────────────────────────────────────────────
test("security section opens from the address and lists sessions", async () => {
  await renderSettings("volunteer", "?tab=settings&section=security");

  expect(screen.getByRole("button", { name: /^Security/ })).toHaveAttribute("aria-current", "true");
  expect(screen.getByText("Chrome on macOS")).toBeInTheDocument();
  expect(screen.getByText("This device")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Log out other sessions" }));
  await settle();
  expect(sent("POST", "/account/sessions/logout-others")).toHaveLength(1);
  expect(screen.getByText("1 other session was logged out.")).toBeInTheDocument();
});

test("log out other sessions is disabled when this is the only session", async () => {
  routes["GET /account/sessions"] = () => reply(200, [SESSIONS[0]]);
  await renderSettings("volunteer", "?tab=settings&section=security");
  expect(screen.getByRole("button", { name: "Log out other sessions" })).toBeDisabled();
  expect(screen.getByText("No other sessions.")).toBeInTheDocument();
});

test("change password: checks locally, then shows the server's answer", async () => {
  await renderSettings("volunteer", "?tab=settings&section=security");
  const submit = screen.getByRole("button", { name: "Change password" });
  expect(submit).toBeDisabled();

  fireEvent.change(screen.getByLabelText(/Current password/), { target: { value: "Old#Pass123" } });
  fireEvent.change(screen.getByLabelText(/^New password/), { target: { value: "New#Pass123" } });
  fireEvent.change(screen.getByLabelText(/Confirm new password/), { target: { value: "Other#Pass123" } });
  fireEvent.click(submit);
  await settle();
  expect(screen.getByText("The two new passwords do not match")).toBeInTheDocument();
  expect(sent("POST", "/account/password")).toHaveLength(0);

  routes["POST /account/password"] = () => reply(400, { detail: "The password you entered is not correct." });
  fireEvent.change(screen.getByLabelText(/Confirm new password/), { target: { value: "New#Pass123" } });
  fireEvent.click(submit);
  await settle();
  expect(screen.getByRole("alert")).toHaveTextContent("The password you entered is not correct.");

  routes["POST /account/password"] = () => reply(200, { sessions_revoked: 2 });
  fireEvent.click(submit);
  await settle();
  expect(sent("POST", "/account/password").at(-1).body).toEqual({
    current_password: "Old#Pass123",
    new_password: "New#Pass123",
  });
  expect(screen.getByText(/Password changed\. 2 other sessions were logged out/)).toBeInTheDocument();
  expect(screen.getByLabelText(/Current password/)).toHaveValue("");
});

test("switching sections keeps the address in step", async () => {
  await renderSettings("volunteer");
  fireEvent.click(screen.getByRole("button", { name: /^Security/ }));
  await settle();
  expect(screen.getByTestId("search")).toHaveTextContent("?tab=settings&section=security");
  fireEvent.click(screen.getByRole("button", { name: /^Profile/ }));
  await settle();
  expect(screen.getByTestId("search")).toHaveTextContent("?tab=settings");
});
