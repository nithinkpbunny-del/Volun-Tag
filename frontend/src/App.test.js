import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import VolunTag from "./VolunTag";

// Router smoke test: renders the user app (not App.js, which reads
// window.location at import time and lazy-loads the admin console) at a given
// address, logged out, with fetch mocked so nothing reaches a network.

beforeEach(() => {
  sessionStorage.clear();
  global.fetch = jest.fn(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    })
  );
});

async function renderAt(path) {
  const view = render(
    <MemoryRouter initialEntries={[path]}>
      <VolunTag />
    </MemoryRouter>
  );

  // Let effects and any mocked requests settle inside act().
  await act(async () => {});

  return view;
}

const menuItems = (container) =>
  Array.from(container.querySelectorAll("#nav-menu a, #nav-menu button")).map(
    (el) => el.textContent.trim()
  );

test("/ shows the landing page and the public navbar in order", async () => {
  const { container } = await renderAt("/");

  expect(menuItems(container)).toEqual([
    "Home",
    "Features",
    "Report a problem",
    "News",
    "About",
    "Contact",
    "Log in",
    "Join",
  ]);
  expect(container.querySelector("#hero-section")).toBeInTheDocument();
});

test("/news shows the Coming soon page with its title", async () => {
  await renderAt("/news");

  expect(screen.getByRole("heading", { name: "News" })).toBeInTheDocument();
  expect(screen.getByText("Coming soon")).toBeInTheDocument();
});

test.each(["/volunteer/dashboard", "/ngo/events/1/volunteers"])(
  "%s while logged out ends on the login form",
  async (path) => {
    await renderAt(path);

    expect(screen.getByLabelText(/Registered Email/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View Dashboard" })).toBeInTheDocument();
  }
);

test("no navbar link points at the admin console", async () => {
  const { container } = await renderAt("/");

  const hrefs = Array.from(container.querySelectorAll("#nav-menu a")).map((a) =>
    a.getAttribute("href")
  );

  expect(hrefs.length).toBeGreaterThan(0);
  hrefs.forEach((href) => expect(href).not.toMatch(/admin/i));
});

test("an unknown path ends on the landing page", async () => {
  const { container } = await renderAt("/no-such-page");

  expect(container.querySelector("#hero-section")).toBeInTheDocument();
});

test("/features/matching renders without crashing", async () => {
  const { container } = await renderAt("/features/matching");

  expect(container.querySelector("main.page-wrapper")).toBeInTheDocument();
  expect(container.querySelector("#hero-section")).not.toBeInTheDocument();
});
