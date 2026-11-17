import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { CheckEmail } from "./EmailVerification";

const jsonResponse = (status, body) =>
  Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });

test("check-your-email names the address and can send a new link", async () => {
  global.fetch = jest.fn(() =>
    jsonResponse(200, { message: "If an account with that email is waiting to be confirmed, we have sent it a new link." })
  );
  render(
    <MemoryRouter>
      <CheckEmail role="ngo" email="org@example.test" />
    </MemoryRouter>
  );

  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Check your email");
  expect(screen.getByText("org@example.test")).toBeInTheDocument();
  expect(screen.getByText(/finish creating your NGO account/)).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Send a new link" }));
  expect(await screen.findByText(/we have sent it a new link/)).toBeInTheDocument();
  expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({ role: "ngo", email: "org@example.test" });
});

test("a 429 on resend is shown as an error and the button comes back", async () => {
  global.fetch = jest.fn(() =>
    jsonResponse(429, { detail: "You have asked for several links. Please try again in an hour." })
  );
  render(
    <MemoryRouter>
      <CheckEmail role="volunteer" email="vol@example.test" />
    </MemoryRouter>
  );

  fireEvent.click(screen.getByRole("button", { name: "Send a new link" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(/several links/);
  expect(screen.getByRole("button", { name: "Send a new link" })).toBeEnabled();
});
