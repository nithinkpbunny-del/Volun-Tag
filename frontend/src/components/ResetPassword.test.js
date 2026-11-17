import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import ResetPassword from "./ResetPassword";

const GOOD = "Better@2026";

function LoginStub() {
  const { state } = useLocation();
  return <p>Login page {state && state.showLogin ? "(form)" : ""}</p>;
}

function renderAt(path, showToast = jest.fn()) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/reset-password" element={<ResetPassword showToast={showToast} />} />
        <Route path="/login" element={<LoginStub />} />
        <Route path="/forgot-password" element={<p>Forgot page</p>} />
      </Routes>
    </MemoryRouter>
  );
  return showToast;
}

const reply = (status, body) =>
  Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });

// fetch mock: verify answers `verify`, reset answers the password change.
function mockServer({ valid = true, reset = [200, { message: "Password updated. Please log in." }] } = {}) {
  global.fetch = jest.fn((url) =>
    url.endsWith("/reset-password/verify") ? reply(200, { valid }) : reply(...reset)
  );
}

function fillPasswords(first, second = first) {
  fireEvent.change(screen.getByLabelText(/^New password/), { target: { value: first } });
  fireEvent.change(screen.getByLabelText(/Confirm new password/), { target: { value: second } });
}

test("an expired link shows the expired state before the user types", async () => {
  mockServer({ valid: false });
  renderAt("/reset-password?token=old");

  expect(await screen.findByRole("heading", { name: "This link has expired" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Request a new link" })).toHaveAttribute(
    "href",
    "/forgot-password"
  );
  expect(screen.queryByLabelText(/^New password/)).not.toBeInTheDocument();
  expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({ token: "old" });
});

test("a link without a token is treated as invalid", async () => {
  mockServer();
  renderAt("/reset-password");

  expect(screen.getByRole("heading", { name: "This link has expired" })).toBeInTheDocument();
  expect(global.fetch).not.toHaveBeenCalled();
});

test("a valid link resets the password and goes to the login form with a toast", async () => {
  mockServer();
  const showToast = renderAt("/reset-password?token=abc");

  await screen.findByLabelText(/^New password/);
  fillPasswords(GOOD);
  fireEvent.click(screen.getByRole("button", { name: "Set new password" }));

  expect(await screen.findByText(/Login page \(form\)/)).toBeInTheDocument();
  expect(showToast).toHaveBeenCalledWith("Password updated. Please log in.", "success");
  const resetCall = global.fetch.mock.calls.find(([url]) => url.endsWith("/reset-password"));
  expect(JSON.parse(resetCall[1].body)).toEqual({ token: "abc", new_password: GOOD });
});

test("mismatched or weak passwords are caught before sending", async () => {
  mockServer();
  renderAt("/reset-password?token=abc");

  await screen.findByLabelText(/^New password/);

  fillPasswords(GOOD, "Different@2026");
  fireEvent.click(screen.getByRole("button", { name: "Set new password" }));
  expect(screen.getByRole("alert")).toHaveTextContent("The two passwords do not match.");

  fillPasswords("short");
  fireEvent.click(screen.getByRole("button", { name: "Set new password" }));
  expect(screen.getByRole("alert")).toHaveTextContent(/does not meet all the rules/);

  // Only the verify call went out.
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test("a link that expires while typing switches to the expired state", async () => {
  mockServer({ reset: [400, { detail: "This link is invalid or has expired." }] });
  renderAt("/reset-password?token=abc");

  await screen.findByLabelText(/^New password/);
  fillPasswords(GOOD);
  fireEvent.click(screen.getByRole("button", { name: "Set new password" }));

  expect(await screen.findByRole("heading", { name: "This link has expired" })).toBeInTheDocument();
});

test("a server-side password rule error keeps the form so the user can retry", async () => {
  mockServer({ reset: [422, { detail: "Password must have: a digit" }] });
  renderAt("/reset-password?token=abc");

  await screen.findByLabelText(/^New password/);
  fillPasswords(GOOD);
  fireEvent.click(screen.getByRole("button", { name: "Set new password" }));

  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent("Password must have: a digit")
  );
  expect(screen.getByLabelText(/^New password/)).toBeInTheDocument();
});
