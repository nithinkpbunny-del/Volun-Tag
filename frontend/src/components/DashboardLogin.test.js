import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import DashboardLogin from "./DashboardLogin";

function WhereAmI() {
  const { pathname, search } = useLocation();
  return <p data-testid="where">{pathname + search}</p>;
}

function renderLogin(showToast = jest.fn(), onLogin = jest.fn()) {
  render(
    <MemoryRouter initialEntries={["/login"]}>
      <Routes>
        <Route
          path="/login"
          element={<DashboardLogin showToast={showToast} onLogin={onLogin} />}
        />
        <Route path="*" element={<WhereAmI />} />
      </Routes>
    </MemoryRouter>
  );
  return { showToast, onLogin };
}

const jsonResponse = (status, body) =>
  Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });

beforeEach(() => {
  sessionStorage.clear();
});

test("pressing Enter in the password field logs in", async () => {
  global.fetch = jest.fn(() =>
    jsonResponse(200, { token: "tok", email: "vol@example.test" })
  );
  const { onLogin } = renderLogin();

  fireEvent.change(screen.getByLabelText(/Registered Email/), {
    target: { value: "vol@example.test" },
  });
  fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: "Typed@2026x" } });
  // Enter in a field submits the surrounding form.
  fireEvent.submit(screen.getByLabelText(/^Password/).closest("form"));

  await waitFor(() => expect(onLogin).toHaveBeenCalledWith({
    role: "volunteer",
    email: "vol@example.test",
  }));
  expect(global.fetch.mock.calls[0][0]).toMatch(/\/volunteer-login$/);
  expect(screen.getByTestId("where")).toHaveTextContent("/volunteer/dashboard");
});

test("the submit button is a real submit button", () => {
  global.fetch = jest.fn();
  renderLogin();

  expect(screen.getByRole("button", { name: "View Dashboard" })).toHaveAttribute("type", "submit");
});

test("the password stays in the field after a failed attempt", async () => {
  global.fetch = jest.fn(() => jsonResponse(401, { detail: "Invalid email or password" }));
  const { showToast, onLogin } = renderLogin();

  fireEvent.change(screen.getByLabelText(/Registered Email/), {
    target: { value: "vol@example.test" },
  });
  fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: "Wrong@123" } });
  fireEvent.click(screen.getByRole("button", { name: "View Dashboard" }));

  await waitFor(() =>
    expect(showToast).toHaveBeenCalledWith("Invalid email or password", "error")
  );
  expect(screen.getByLabelText(/^Password/)).toHaveValue("Wrong@123");
  expect(onLogin).not.toHaveBeenCalled();
});

test("the Forgot password link carries the selected role", () => {
  global.fetch = jest.fn();
  renderLogin();

  expect(screen.getByRole("link", { name: "Forgot password?" })).toHaveAttribute(
    "href",
    "/forgot-password?role=volunteer"
  );

  fireEvent.click(screen.getByLabelText("NGO"));

  expect(screen.getByRole("link", { name: "Forgot password?" })).toHaveAttribute(
    "href",
    "/forgot-password?role=ngo"
  );
});

test("an unconfirmed email shows a notice with a resend button, not a toast", async () => {
  const NOT_VERIFIED = "Please confirm your email address first. Open the link we emailed you, or send a new one.";
  global.fetch = jest.fn((url) =>
    url.endsWith("/volunteer-login")
      ? jsonResponse(403, { code: "email_not_verified", message: NOT_VERIFIED, detail: NOT_VERIFIED })
      : jsonResponse(200, { message: "If an account with that email is waiting to be confirmed, we have sent it a new link." })
  );
  const { showToast, onLogin } = renderLogin();

  fireEvent.change(screen.getByLabelText(/Registered Email/), { target: { value: "new@example.test" } });
  fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: "Typed@2026x" } });
  fireEvent.click(screen.getByRole("button", { name: "View Dashboard" }));

  expect(await screen.findByText(/not confirmed yet/i)).toBeInTheDocument();
  expect(screen.getByText(NOT_VERIFIED)).toBeInTheDocument();
  expect(showToast).not.toHaveBeenCalled();
  expect(onLogin).not.toHaveBeenCalled();
  expect(sessionStorage.length).toBe(0);

  fireEvent.click(screen.getByRole("button", { name: "Send a new link" }));
  expect(await screen.findByText(/we have sent it a new link/)).toBeInTheDocument();
  const [url, options] = global.fetch.mock.calls[1];
  expect(url).toMatch(/\/resend-verification$/);
  expect(JSON.parse(options.body)).toEqual({ role: "volunteer", email: "new@example.test" });

  // Changing the email hides the notice (it belonged to the old address).
  fireEvent.change(screen.getByLabelText(/Registered Email/), { target: { value: "other@example.test" } });
  expect(screen.queryByText(/not confirmed yet/i)).not.toBeInTheDocument();
});
