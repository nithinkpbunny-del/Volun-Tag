import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import AccountSettings from "./AccountSettings";
import ConfirmEmailChange from "../ConfirmEmailChange";
import { ReactivateControl, DeactivatedPill } from "../admin/AdminReactivate";
import { getSession, saveSession } from "../../api";

let routes;
let calls;

const reply = (status, data, headers = {}) =>
  Promise.resolve({
    ok: status < 400,
    status,
    json: () => Promise.resolve(data),
    blob: () => Promise.resolve(new Blob([JSON.stringify(data)], { type: "application/json" })),
    headers: { get: (name) => headers[name.toLowerCase()] || null },
  });

beforeEach(() => {
  saveSession({ token: "t", role: "volunteer", email: "vol@example.test" });
  calls = [];
  routes = {};
  global.fetch = jest.fn((url, options = {}) => {
    const path = new URL(String(url)).pathname;
    const method = options.method || "GET";
    const body = options.body ? JSON.parse(options.body) : undefined;
    const headers = new Headers(options.headers || {});
    calls.push({ method, path, body, auth: headers.get("Authorization") });
    const handler = routes[`${method} ${path}`];
    return handler ? handler(body) : reply(404, { detail: "not found" });
  });
});

afterEach(() => {
  sessionStorage.clear();
});

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

async function renderSection(section, props = {}) {
  render(
    <MemoryRouter initialEntries={[`/dash?tab=settings&section=${section}`]}>
      <Routes>
        <Route
          path="/dash"
          element={<AccountSettings role="volunteer" email="vol@example.test" showToast={jest.fn()} {...props} />}
        />
      </Routes>
    </MemoryRouter>
  );
  await settle();
}

const sent = (method, path) => calls.filter((c) => c.method === method && c.path === path);

// ─── Email ───────────────────────────────────────────────────────
test("email: sends the request and shows a pending notice that does not reveal anything", async () => {
  routes["POST /account/email"] = () =>
    reply(200, { message: "If this address can be used, we have sent a confirmation link to it." });
  await renderSection("email");

  expect(screen.getByText("vol@example.test")).toBeInTheDocument();
  const submit = screen.getByRole("button", { name: "Send confirmation link" });
  expect(submit).toBeDisabled();

  fireEvent.change(screen.getByLabelText(/New email address/), { target: { value: " New@Example.test " } });
  fireEvent.change(screen.getByLabelText(/Your password/), { target: { value: "Pass#1234" } });
  fireEvent.click(submit);
  await settle();

  expect(sent("POST", "/account/email")[0].body).toEqual({ password: "Pass#1234", new_email: "new@example.test" });
  const notice = screen.getByText("Waiting for confirmation").closest(".settings-pending");
  expect(notice).toHaveTextContent("If new@example.test can be used, we have sent a link to it");
  expect(notice).toHaveTextContent("Your address stays vol@example.test until you open that link");
  expect(screen.getByLabelText(/Your password/)).toHaveValue("");
});

test("email: checks the address locally and shows server errors", async () => {
  routes["POST /account/email"] = () => reply(400, { detail: "The password you entered is not correct." });
  await renderSection("email");

  fireEvent.change(screen.getByLabelText(/New email address/), { target: { value: "VOL@example.test" } });
  fireEvent.change(screen.getByLabelText(/Your password/), { target: { value: "x" } });
  fireEvent.click(screen.getByRole("button", { name: "Send confirmation link" }));
  await settle();
  expect(screen.getByText("That is already your email address")).toBeInTheDocument();
  expect(sent("POST", "/account/email")).toHaveLength(0);

  fireEvent.change(screen.getByLabelText(/New email address/), { target: { value: "other@example.test" } });
  fireEvent.click(screen.getByRole("button", { name: "Send confirmation link" }));
  await settle();
  expect(screen.getByRole("alert")).toHaveTextContent("The password you entered is not correct.");
  expect(screen.queryByText("Waiting for confirmation")).toBeNull();
});

// ─── Your data ───────────────────────────────────────────────────
test("data: downloads the JSON file after the password", async () => {
  global.URL.createObjectURL = jest.fn(() => "blob:http://localhost/abc");
  global.URL.revokeObjectURL = jest.fn();
  const click = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  routes["POST /account/export"] = () =>
    reply(200, { profile: {} }, { "content-disposition": 'attachment; filename="voluntag-volunteer-data-20261117.json"' });

  await renderSection("data");
  expect(screen.getByText(/never includes your password/)).toBeInTheDocument();
  const button = screen.getByRole("button", { name: "Download my data" });
  expect(button).toBeDisabled();

  fireEvent.change(screen.getByLabelText(/Confirm with your password/), { target: { value: "Pass#1234" } });
  fireEvent.click(button);
  await settle();

  expect(sent("POST", "/account/export")[0].body).toEqual({ password: "Pass#1234" });
  expect(click).toHaveBeenCalledTimes(1);
  expect(screen.getByText("Your data was saved as voluntag-volunteer-data-20261117.json.")).toBeInTheDocument();
  click.mockRestore();
});

test("data: a wrong password is shown and nothing is downloaded", async () => {
  routes["POST /account/export"] = () => reply(400, { detail: "The password you entered is not correct." });
  await renderSection("data");
  fireEvent.change(screen.getByLabelText(/Confirm with your password/), { target: { value: "bad" } });
  fireEvent.click(screen.getByRole("button", { name: "Download my data" }));
  await settle();
  expect(screen.getByRole("alert")).toHaveTextContent("The password you entered is not correct.");
});

// ─── Deactivate ──────────────────────────────────────────────────
test("deactivate: needs the password and the exact word, then hands over to the app", async () => {
  routes["POST /account/deactivate"] = () => reply(200, { message: "ok" });
  const onDeactivated = jest.fn();
  await renderSection("account", { onDeactivated });

  const button = screen.getByRole("button", { name: "Deactivate my account" });
  fireEvent.change(screen.getByLabelText(/Your password/), { target: { value: "Pass#1234" } });
  fireEvent.change(screen.getByLabelText(/Type DEACTIVATE to confirm/), { target: { value: "deactivate" } });
  expect(button).toBeDisabled();

  fireEvent.change(screen.getByLabelText(/Type DEACTIVATE to confirm/), { target: { value: "DEACTIVATE" } });
  expect(button).toBeEnabled();
  fireEvent.click(button);
  await settle();

  expect(sent("POST", "/account/deactivate")[0].body).toEqual({ password: "Pass#1234", confirm: "DEACTIVATE" });
  expect(onDeactivated).toHaveBeenCalledTimes(1);
});

test("deactivate: an NGO with upcoming events sees them and is not deactivated", async () => {
  routes["POST /account/deactivate"] = () =>
    reply(409, {
      code: "upcoming_events",
      message: "Cancel your 1 upcoming event first.",
      upcoming_events: [{ id: 4, title: "Beach cleanup", event_day: "2026-12-05", status: "Active" }],
    });
  const onDeactivated = jest.fn();
  const onOpenEvents = jest.fn();
  saveSession({ token: "t", role: "ngo", email: "org@example.test" });
  render(
    <MemoryRouter initialEntries={["/dash?tab=settings&section=account"]}>
      <Routes>
        <Route
          path="/dash"
          element={<AccountSettings role="ngo" email="org@example.test" onDeactivated={onDeactivated} onOpenEvents={onOpenEvents} />}
        />
      </Routes>
    </MemoryRouter>
  );
  await settle();

  expect(screen.getByText(/Upcoming events must be cancelled first/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText(/Your password/), { target: { value: "Pass#1234" } });
  fireEvent.change(screen.getByLabelText(/Type DEACTIVATE to confirm/), { target: { value: "DEACTIVATE" } });
  fireEvent.click(screen.getByRole("button", { name: "Deactivate my account" }));
  await settle();

  const alert = screen.getByRole("alert");
  expect(within(alert).getByText("Beach cleanup")).toBeInTheDocument();
  expect(onDeactivated).not.toHaveBeenCalled();
  fireEvent.click(within(alert).getByRole("button", { name: "Go to My Events" }));
  expect(onOpenEvents).toHaveBeenCalled();
});

// ─── Confirm page ────────────────────────────────────────────────
async function renderConfirm(path, onEmailChanged = jest.fn()) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/confirm-email-change" element={<ConfirmEmailChange onEmailChanged={onEmailChanged} />} />
      </Routes>
    </MemoryRouter>
  );
  await settle();
  return onEmailChanged;
}

test("confirm page: keeps this login and moves it to the new address", async () => {
  routes["POST /confirm-email-change"] = () =>
    reply(200, { status: "changed", role: "volunteer", email: "new@example.test", kept_session: true });
  const onEmailChanged = await renderConfirm("/confirm-email-change?token=abc123");

  expect(sent("POST", "/confirm-email-change")[0]).toMatchObject({ body: { token: "abc123" }, auth: "Bearer t" });
  expect(screen.getByRole("heading", { name: "Email address changed" })).toBeInTheDocument();
  expect(getSession().email).toBe("new@example.test");
  expect(onEmailChanged).toHaveBeenCalledWith({ role: "volunteer", email: "new@example.test" });
  expect(screen.getByRole("link", { name: "Back to Settings" })).toHaveAttribute(
    "href",
    "/volunteer/dashboard?tab=settings&section=email"
  );
});

test("confirm page: logged out elsewhere, it asks to log in with the new address", async () => {
  sessionStorage.clear();
  routes["POST /confirm-email-change"] = () =>
    reply(200, { status: "changed", role: "ngo", email: "new@example.test", kept_session: false });
  const onEmailChanged = await renderConfirm("/confirm-email-change?token=abc");
  expect(sent("POST", "/confirm-email-change")[0].auth).toBeNull();
  expect(screen.getByRole("link", { name: "Log in with your new address" })).toBeInTheDocument();
  expect(onEmailChanged).not.toHaveBeenCalled();
});

test.each([
  ["email_change_link_expired", "This link has expired"],
  ["email_change_link_used", "Already confirmed"],
  ["email_change_link_invalid", "This link does not work"],
  ["email_change_unavailable", "This address cannot be used"],
])("confirm page: %s", async (code, title) => {
  routes["POST /confirm-email-change"] = () => reply(400, { code, message: "Server says no." });
  await renderConfirm("/confirm-email-change?token=abc");
  expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
  expect(screen.getByText("Server says no.")).toBeInTheDocument();
  expect(getSession().email).toBe("vol@example.test");
});

test("confirm page without a token does not call the server", async () => {
  await renderConfirm("/confirm-email-change");
  expect(screen.getByRole("heading", { name: "This link does not work" })).toBeInTheDocument();
  expect(calls).toHaveLength(0);
});

// ─── Admin ───────────────────────────────────────────────────────
test("admin: Deactivated pill and Reactivate with a confirm step", async () => {
  sessionStorage.setItem("voluntag_admin_token", "admin");
  routes["POST /admin/volunteers/7/reactivate"] = () => reply(200, { id: 7, deactivated_at: null });
  const onReactivated = jest.fn();
  const showToast = jest.fn();

  const { rerender } = render(<DeactivatedPill deactivatedAt={null} />);
  expect(screen.queryByText("Deactivated")).toBeNull();
  rerender(
    <ReactivateControl
      kind="volunteer"
      id={7}
      name="Asha"
      deactivatedAt="2026-11-17T08:00:00"
      showToast={showToast}
      onReactivated={onReactivated}
    />
  );
  expect(screen.getByText("Deactivated")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Reactivate" }));
  expect(sent("POST", "/admin/volunteers/7/reactivate")).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Yes, reactivate" }));
  await settle();

  expect(sent("POST", "/admin/volunteers/7/reactivate")).toHaveLength(1);
  expect(onReactivated).toHaveBeenCalled();
  expect(showToast).toHaveBeenCalledWith("Asha can log in again", "success");
});
