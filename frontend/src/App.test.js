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
    "About",
    "Contact",
    "Log in",
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

test("an unknown path shows the 404 page", async () => {
  const { container } = await renderAt("/no-such-page");

  expect(screen.getByRole("heading", { level: 1, name: "Page not found" })).toBeInTheDocument();
  expect(container.querySelector("#hero-section")).not.toBeInTheDocument();
  expect(document.title).toBe("Page not found · VolunTag");
});

test.each([
  ["/about", "About VolunTag", "About · VolunTag"],
  ["/contact", "Contact us", "Contact · VolunTag"],
  ["/forgot-password", "Forgot your password?", "Forgot password · VolunTag"],
  ["/login", "View My Dashboard", "Log in · VolunTag"],
  ["/register", "Join VolunTag", "Join VolunTag · VolunTag"],
])("%s has one h1 and its own document title", async (path, heading, title) => {
  await renderAt(path);

  const headings = screen.getAllByRole("heading", { level: 1 });
  expect(headings).toHaveLength(1);
  expect(headings[0]).toHaveTextContent(heading);
  expect(document.title).toBe(title);
});

test("the landing page has one h1, no personal email and no invented claims", async () => {
  const { container } = await renderAt("/");

  expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  expect(container).not.toHaveTextContent(/gmail\.com/i);
  expect(container).not.toHaveTextContent(/500\+/);
  expect(container).not.toHaveTextContent(/What People Say/);
  expect(screen.getByRole("link", { name: "contact@voluntag.example" })).toBeInTheDocument();
  expect(document.title).toBe("VolunTag — AI-Powered Volunteer-NGO Matching");
});

test("the landing stats use /stats and hide counters that are zero", async () => {
  global.fetch = jest.fn((url) =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve(
          String(url).endsWith("/stats")
            ? {
                total_volunteers: 82,
                total_ngos: 0,
                categories: { Education: 3 },
                category_list: ["Education", "Health"],
              }
            : {}
        ),
    })
  );

  await renderAt("/");

  const strip = await screen.findByRole("region", { name: "VolunTag in numbers" });
  expect(strip).toHaveTextContent("Volunteers");
  expect(strip).toHaveTextContent("82");
  expect(strip).toHaveTextContent("Cause areas with NGOs");
  expect(strip).not.toHaveTextContent("NGOs1");
  expect(screen.queryByText("NGOs", { selector: ".stat-label" })).not.toBeInTheDocument();
});

test("the stats strip is hidden when /stats has nothing to show", async () => {
  await renderAt("/");

  expect(screen.queryByRole("region", { name: "VolunTag in numbers" })).not.toBeInTheDocument();
});

test("/features/matching renders without crashing", async () => {
  const { container } = await renderAt("/features/matching");

  expect(container.querySelector("main.page-wrapper")).toBeInTheDocument();
  expect(container.querySelector("#hero-section")).not.toBeInTheDocument();
});
