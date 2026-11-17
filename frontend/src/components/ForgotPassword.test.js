import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import ForgotPassword from "./ForgotPassword";

const SENT = "If an account exists for that email, a reset link has been sent.";

function renderAt(path = "/forgot-password") {
  render(
    <MemoryRouter initialEntries={[path]}>
      <ForgotPassword />
    </MemoryRouter>
  );
}

beforeEach(() => {
  global.fetch = jest.fn(() =>
    Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ message: SENT }) })
  );
});

test("the role comes from the address and the request sends role and email", async () => {
  renderAt("/forgot-password?role=ngo");

  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Forgot your password?");
  expect(screen.getByLabelText("NGO")).toBeChecked();

  fireEvent.change(screen.getByLabelText(/Registered Email/), {
    target: { value: "  ngo@example.test " },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));

  expect(await screen.findByText(SENT)).toBeInTheDocument();
  const [url, options] = global.fetch.mock.calls[0];
  expect(url).toMatch(/\/forgot-password$/);
  expect(JSON.parse(options.body)).toEqual({ role: "ngo", email: "ngo@example.test" });
});

test("an empty email is caught before sending", () => {
  renderAt();

  fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));

  expect(screen.getByRole("alert")).toHaveTextContent(/enter the email/i);
  expect(global.fetch).not.toHaveBeenCalled();
});

test("a network failure shows an error and keeps the form", async () => {
  global.fetch = jest.fn(() => Promise.reject(new TypeError("Failed to fetch")));
  renderAt();

  fireEvent.change(screen.getByLabelText(/Registered Email/), {
    target: { value: "vol@example.test" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(/could not reach/i);
  expect(screen.getByLabelText(/Registered Email/)).toHaveValue("vol@example.test");
});
