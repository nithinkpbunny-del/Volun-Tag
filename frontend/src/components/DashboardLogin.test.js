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
