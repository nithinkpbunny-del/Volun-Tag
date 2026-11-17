import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import VerifyEmail from "./VerifyEmail";

const jsonResponse = (status, body) =>
  Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });

function renderAt(path) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/verify-email" element={<VerifyEmail />} />
        <Route path="/login" element={<p>login page</p>} />
      </Routes>
    </MemoryRouter>
  );
}

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

test("removes the token from the address bar and confirms it with a POST", async () => {
  window.history.replaceState(null, "", "/verify-email?token=abc123");
  global.fetch = jest.fn(() => jsonResponse(200, { status: "verified", role: "ngo" }));
  renderAt("/verify-email?token=abc123");

  expect(screen.getByRole("status")).toHaveTextContent(/checking/i);
  expect(window.location.search).toBe("");

  await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Email confirmed"));
  const [url, options] = global.fetch.mock.calls[0];
  expect(url).toMatch(/\/verify-email$/);
  expect(options.method).toBe("POST");
  expect(JSON.parse(options.body)).toEqual({ token: "abc123" });

  fireEvent.click(screen.getByRole("link", { name: "Log in" }));
  expect(screen.getByText("login page")).toBeInTheDocument();
});

test("a used link says the email is already confirmed", async () => {
  global.fetch = jest.fn(() =>
    jsonResponse(400, { code: "verification_link_used", message: "used", detail: "used" })
  );
  renderAt("/verify-email?token=old");

  await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Already confirmed"));
  expect(screen.getByRole("link", { name: "Log in" })).toBeInTheDocument();
});

test("an expired link offers a form for a new one", async () => {
  global.fetch = jest.fn((url) =>
    url.endsWith("/verify-email")
      ? jsonResponse(400, { code: "verification_link_expired", message: "expired", detail: "expired" })
      : jsonResponse(200, { message: "If an account with that email is waiting to be confirmed, we have sent it a new link." })
  );
  renderAt("/verify-email?token=late");

  await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("This link has expired"));

  fireEvent.click(screen.getByLabelText("NGO"));
  fireEvent.change(screen.getByLabelText(/Registered Email/), { target: { value: " org@example.test " } });
  fireEvent.click(screen.getByRole("button", { name: "Send a new link" }));

  expect(await screen.findByText(/we have sent it a new link/)).toBeInTheDocument();
  expect(JSON.parse(global.fetch.mock.calls[1][1].body)).toEqual({ role: "ngo", email: "org@example.test" });
});

test("no token at all shows the invalid state without calling the server", () => {
  global.fetch = jest.fn();
  renderAt("/verify-email");

  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("This link does not work");
  expect(global.fetch).not.toHaveBeenCalled();
});

test("a network failure can be retried", async () => {
  global.fetch = jest
    .fn()
    .mockImplementationOnce(() => Promise.reject(new TypeError("Failed to fetch")))
    .mockImplementationOnce(() => jsonResponse(200, { status: "verified", role: "volunteer" }));
  renderAt("/verify-email?token=abc");

  expect(await screen.findByRole("alert")).toHaveTextContent(/could not reach/i);
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));

  await waitFor(() =>
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Email confirmed")
  );
});
