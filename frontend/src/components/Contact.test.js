import { fireEvent, render, screen } from "@testing-library/react";
import Contact from "./Contact";
import { CONTACT_EMAIL } from "../content/contact";

const reply = (status, body) =>
  Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });

function fillValidForm() {
  fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Asha" } });
  fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: "asha@example.test" } });
  fireEvent.change(screen.getByLabelText(/^Message/), {
    target: { value: "How do I register my NGO?" },
  });
}

const send = () => fireEvent.click(screen.getByRole("button", { name: /Send message|Try again/ }));

beforeEach(() => {
  sessionStorage.clear();
  global.fetch = jest.fn(() => reply(201, { message: "received" }));
});

test("the page has one h1 and shows the public contact address", () => {
  render(<Contact />);

  expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  expect(screen.getByRole("link", { name: CONTACT_EMAIL })).toHaveAttribute(
    "href",
    `mailto:${CONTACT_EMAIL}`
  );
});

test("submitting an empty form shows field errors and sends nothing", () => {
  render(<Contact />);

  send();

  expect(screen.getByText(/Please enter your name/)).toBeInTheDocument();
  expect(screen.getByText(/Please enter your email/)).toBeInTheDocument();
  expect(screen.getByText(/Please write a little more/)).toBeInTheDocument();
  expect(global.fetch).not.toHaveBeenCalled();
});

test("a valid message is sent with an empty honeypot and the form is cleared", async () => {
  render(<Contact />);

  fillValidForm();
  send();

  expect(await screen.findByText("Thanks, we received your message.")).toBeInTheDocument();
  const [url, options] = global.fetch.mock.calls[0];
  expect(url).toMatch(/\/contact$/);
  expect(JSON.parse(options.body)).toEqual({
    name: "Asha",
    email: "asha@example.test",
    subject: "",
    message: "How do I register my NGO?",
    role: null,
    website: "",
  });

  fireEvent.click(screen.getByRole("button", { name: "Send another message" }));
  expect(screen.getByLabelText(/^Name/)).toHaveValue("");
});

test("the honeypot field is hidden from people and keyboard users", () => {
  const { container } = render(<Contact />);

  // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access
  const honeypot = container.querySelector('input[name="website"]');
  expect(honeypot).toHaveAttribute("tabindex", "-1");
  expect(honeypot).toHaveAttribute("autocomplete", "off");
  // eslint-disable-next-line testing-library/no-node-access
  expect(honeypot.closest('[aria-hidden="true"]')).not.toBeNull();
});

test("a 429 shows the server's message and keeps what was typed", async () => {
  global.fetch = jest.fn(() =>
    reply(429, { detail: "Too many messages. Please try again in an hour." })
  );
  render(<Contact />);

  fillValidForm();
  send();

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Too many messages. Please try again in an hour."
  );
  expect(screen.getByLabelText(/^Message/)).toHaveValue("How do I register my NGO?");
  expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
});

test("server validation errors are shown next to their fields", async () => {
  global.fetch = jest.fn(() =>
    reply(422, { detail: [{ loc: ["body", "email"], msg: "Value error, Enter a valid email address" }] })
  );
  render(<Contact />);

  fillValidForm();
  send();

  expect(await screen.findByText("Enter a valid email address")).toBeInTheDocument();
});
