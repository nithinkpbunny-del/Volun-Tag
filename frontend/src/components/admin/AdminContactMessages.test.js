import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import AdminContactMessages from "./AdminContactMessages";
import AdminLayout from "./AdminLayout";
import { isSafeEmail, replyMailto } from "./adminApi";

const json = (status, body) =>
  Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });

const ITEMS = [
  {
    id: 2, name: "Asha", email: "asha@example.test", subject: "Volunteering question",
    preview: "Hello, how do I join?", role: "volunteer", is_read: false, is_archived: false,
    created_at: "2026-11-16T10:00:00Z", read_at: null, archived_at: null, mail_sent: false,
  },
  {
    id: 1, name: "Ravi", email: "ravi@example.test", subject: null,
    preview: "No subject here, just a note", role: null, is_read: true, is_archived: false,
    created_at: "2026-11-15T10:00:00Z", read_at: "2026-11-15T11:00:00Z", archived_at: null, mail_sent: false,
  },
];

const FULL = {
  ...ITEMS[0],
  message: '<b>not bold</b>\nSecond line\n<script>alert(1)</script>',
};

let routes;

function installFetch() {
  global.fetch = jest.fn((url, options = {}) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, "");
    for (const [test, handler] of routes) {
      if (test(path, options)) return handler(path, options);
    }
    return json(404, { detail: "not mocked" });
  });
}

const calls = () => global.fetch.mock.calls.map(([url, o = {}]) => `${o.method || "GET"} ${String(url).replace(/^https?:\/\/[^/]+/, "")}`);

beforeEach(() => {
  sessionStorage.clear();
  routes = [
    [(p) => p.startsWith("/admin/contact-messages?"), () => json(200, { items: ITEMS, total: 2, page: 1, page_size: 20, unread_count: 1 })],
    [(p, o) => p === "/admin/contact-messages/2" && !o.method, () => json(200, FULL)],
    [(p) => p === "/admin/contact-messages/2/read", () => json(200, { ...FULL, is_read: true, changed: true, unread_count: 0 })],
    [(p) => p === "/admin/contact-messages/2/archive", () => json(200, { ...FULL, is_archived: true, changed: true, unread_count: 0 })],
  ];
  installFetch();
});

function renderScreen(props = {}) {
  const showToast = jest.fn();
  const onDataChanged = jest.fn();
  render(<AdminContactMessages showToast={showToast} onDataChanged={onDataChanged} {...props} />);
  return { showToast, onDataChanged };
}

test("lists messages with sender, subject or first line, unread marker and unread count", async () => {
  renderScreen();

  expect(screen.getByRole("status")).toHaveTextContent("Loading messages");
  const list = await screen.findByRole("list", { name: "Contact messages" });
  const rows = within(list).getAllByRole("button");
  expect(rows).toHaveLength(2);
  expect(rows[0]).toHaveTextContent("Asha");
  expect(rows[0]).toHaveTextContent("Volunteering question");
  expect(rows[0]).toHaveTextContent("Unread");
  expect(rows[0]).toHaveClass("adm-cm-row--unread");
  expect(rows[1]).toHaveTextContent("No subject here, just a note");
  expect(rows[1]).not.toHaveClass("adm-cm-row--unread");
  expect(screen.getByText(/1 unread\./)).toBeInTheDocument();
  expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  expect(calls()[0]).toBe("GET /admin/contact-messages?status=inbox&page=1&page_size=20");
});

test("opens a message as plain text with line breaks, and offers copy and a safe mailto", async () => {
  const { container } = render(<AdminContactMessages showToast={jest.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: /Asha/ }));

  const body = await screen.findByLabelText("Message text");
  expect(body.textContent).toBe(FULL.message);
  expect(container.querySelector("script")).toBeNull();
  expect(container.querySelector(".adm-cm-body b")).toBeNull();
  expect(screen.getByText("asha@example.test", { selector: "dd" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Reply by email" })).toHaveAttribute(
    "href",
    "mailto:asha@example.test?subject=Re%3A%20Volunteering%20question"
  );
  expect(screen.getByRole("button", { name: "Copy email" })).toBeInTheDocument();
});

test("mark as read and archive call the API, update the panel and refresh the badge", async () => {
  const { showToast, onDataChanged } = renderScreen();
  fireEvent.click(await screen.findByRole("button", { name: /Asha/ }));

  fireEvent.click(await screen.findByRole("button", { name: "Mark as read" }));
  expect(await screen.findByRole("button", { name: "Mark as unread" })).toBeInTheDocument();
  expect(showToast).toHaveBeenCalledWith("Marked as read.", "success");
  expect(onDataChanged).toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "Archive" }));
  expect(await screen.findByRole("button", { name: "Move to inbox" })).toBeInTheDocument();
  expect(calls()).toEqual(expect.arrayContaining([
    "POST /admin/contact-messages/2/read",
    "POST /admin/contact-messages/2/archive",
  ]));
});

test("copy email uses the clipboard", async () => {
  const writeText = jest.fn(() => Promise.resolve());
  Object.assign(navigator, { clipboard: { writeText } });
  const { showToast } = renderScreen();
  fireEvent.click(await screen.findByRole("button", { name: /Asha/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Copy email" }));
  await waitFor(() => expect(showToast).toHaveBeenCalledWith("Email address copied.", "success"));
  expect(writeText).toHaveBeenCalledWith("asha@example.test");
});

test("search and status filter are sent to the API", async () => {
  jest.useFakeTimers();
  try {
    renderScreen();
    await act(async () => {});

    fireEvent.click(screen.getByRole("button", { name: "Archived" }));
    await act(async () => {});
    fireEvent.change(screen.getByLabelText("Search messages"), { target: { value: "pothole" } });
    await act(async () => {
      jest.advanceTimersByTime(400);
    });

    expect(calls()).toContain("GET /admin/contact-messages?status=archived&page=1&page_size=20");
    expect(calls()).toContain("GET /admin/contact-messages?status=archived&page=1&page_size=20&q=pothole");
  } finally {
    jest.useRealTimers();
  }
});

test("shows an empty state", async () => {
  routes.unshift([(p) => p.startsWith("/admin/contact-messages?"), () => json(200, { items: [], total: 0, page: 1, page_size: 20, unread_count: 0 })]);
  renderScreen();
  expect(await screen.findByText(/No messages yet/)).toBeInTheDocument();
});

test("shows an error state with a retry", async () => {
  routes.unshift([(p) => p.startsWith("/admin/contact-messages?"), () => json(500, { detail: "Server unhappy" })]);
  renderScreen();
  expect(await screen.findByRole("alert")).toHaveTextContent("Server unhappy");
  expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
});

test("pagination appears when there is more than one page", async () => {
  routes.unshift([(p) => p.includes("page=2"), () => json(200, { items: [ITEMS[1]], total: 21, page: 2, page_size: 20, unread_count: 1 })]);
  routes.unshift([(p) => p.includes("page=1"), () => json(200, { items: ITEMS, total: 21, page: 1, page_size: 20, unread_count: 1 })]);
  renderScreen();
  expect(await screen.findByText("1–20 of 21")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(await screen.findByText("21–21 of 21")).toBeInTheDocument();
});

test("mailto is built only from a validated address", () => {
  expect(isSafeEmail("asha@example.test")).toBe(true);
  expect(isSafeEmail("a@b.co?bcc=x@y.z")).toBe(false);
  expect(isSafeEmail("a@b.co&cc=x")).toBe(false);
  expect(isSafeEmail("a b@c.de")).toBe(false);
  expect(isSafeEmail("javascript:alert(1)//@x.io")).toBe(false);
  expect(replyMailto("a@b.co?bcc=x@y.z", "Hi")).toBeNull();
  expect(replyMailto("a@b.co", "")).toBe("mailto:a@b.co?subject=Re%3A%20Your%20message%20to%20VolunTag");
});

test("the admin nav shows the unread contact badge", async () => {
  routes.unshift([(p) => p === "/admin/contact-messages/unread-count", () => json(200, { unread_count: 3 })]);
  routes.unshift([(p) => p.startsWith("/admin/resolutions"), () => json(200, [])]);
  routes.unshift([(p) => p === "/admin/overview", () => new Promise(() => {})]);
  render(<AdminLayout showToast={jest.fn()} onLogout={jest.fn()} />);

  const item = screen.getByRole("button", { name: /Contact messages/ });
  expect(await within(item).findByLabelText("3 unread")).toHaveTextContent("3");
});
