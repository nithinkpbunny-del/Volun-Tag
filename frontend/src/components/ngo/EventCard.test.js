import { fireEvent, render, screen } from "@testing-library/react";
import EventCard from "./EventCard";

const BASE = {
  id: 7,
  title: "Science Lab Saturday",
  description: "Hands-on experiments.",
  required_skills: "teaching, lab demonstrations, exam coaching, physics, chemistry",
  location: "Ahmedabad, India",
  event_day: "2026-12-05",
  spots_available: 5,
  status: "Active",
  joined_count: 4,
  approved_count: 2,
  feedback_count: 0,
  phase: "open",
};

const handlers = () => ({
  onManage: jest.fn(),
  onEdit: jest.fn(),
  onMarkFilled: jest.fn(),
  onReopen: jest.fn(),
  onCancel: jest.fn(),
});

const openMenu = () => fireEvent.click(screen.getByRole("button", { name: /More actions for/ }));

test("an open event shows title, phase, status, spots progress, chips and its actions", () => {
  const h = handlers();
  render(<EventCard event={BASE} {...h} />);

  expect(screen.getByRole("heading", { name: "Science Lab Saturday" })).toBeInTheDocument();
  expect(screen.getByText("Registration open")).toBeInTheDocument();
  expect(screen.getByText("Active")).toBeInTheDocument();
  expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "2");
  expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuemax", "5");
  expect(screen.getByText("2 waiting")).toBeInTheDocument();
  expect(screen.getByRole("list", { name: "Required skills" })).toHaveTextContent("+1 more");

  fireEvent.click(screen.getByRole("button", { name: /Manage volunteers/ }));
  expect(h.onManage).toHaveBeenCalledTimes(1);

  openMenu();
  expect(screen.getByRole("menuitem", { name: /Edit event/ })).toBeInTheDocument();
  // Not every spot is approved yet, so the event cannot be marked as filled.
  expect(screen.getByRole("menuitem", { name: /Mark as filled/ })).toBeDisabled();
  fireEvent.click(screen.getByRole("menuitem", { name: /Cancel event/ }));
  expect(h.onCancel).toHaveBeenCalledTimes(1);
});

test("a full event can be marked as filled", () => {
  const h = handlers();
  render(<EventCard event={{ ...BASE, approved_count: 5, joined_count: 5 }} {...h} />);

  openMenu();
  fireEvent.click(screen.getByRole("menuitem", { name: /Mark as filled/ }));
  expect(h.onMarkFilled).toHaveBeenCalledTimes(1);
});

test("a filled event can be reopened only while registration is open", () => {
  const { rerender } = render(<EventCard event={{ ...BASE, status: "Filled" }} {...handlers()} />);

  openMenu();
  expect(screen.getByRole("menuitem", { name: /Reopen event/ })).toBeInTheDocument();
  expect(screen.queryByRole("menuitem", { name: /Edit event/ })).not.toBeInTheDocument();

  rerender(<EventCard event={{ ...BASE, status: "Filled", phase: "in_progress" }} {...handlers()} />);
  expect(screen.queryByRole("button", { name: /More actions for/ })).not.toBeInTheDocument();
});

test("a cancelled event has no phase badge and no menu", () => {
  render(<EventCard event={{ ...BASE, status: "Cancelled" }} {...handlers()} />);

  expect(screen.getByText("Cancelled")).toBeInTheDocument();
  expect(screen.queryByText("Registration open")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /View volunteers/ })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /More actions for/ })).not.toBeInTheDocument();
});

test("a completed event asks for ratings until every approved volunteer has feedback", () => {
  const done = { ...BASE, phase: "completed", approved_count: 3, feedback_count: 1 };
  const { rerender } = render(<EventCard event={done} {...handlers()} />);

  expect(screen.getByText("Completed")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Rate volunteers/ })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /More actions for/ })).not.toBeInTheDocument();

  rerender(<EventCard event={{ ...done, feedback_count: 3 }} {...handlers()} />);
  expect(screen.getByRole("button", { name: /View feedback/ })).toBeInTheDocument();

  rerender(<EventCard event={{ ...done, approved_count: 0, feedback_count: 0 }} {...handlers()} />);
  expect(screen.getByText("No approved volunteers")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Rate volunteers|View feedback/ })).not.toBeInTheDocument();
});

test("an event without a spot limit has no progress bar, and a new event is marked", () => {
  render(<EventCard event={{ ...BASE, spots_available: null }} isNew {...handlers()} />);

  expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  expect(screen.getByText(/no spot limit/)).toBeInTheDocument();
  expect(screen.getByText("New")).toBeInTheDocument();
});

test("while editing, the card shows the edit form instead", () => {
  render(<EventCard event={BASE} editForm={<form aria-label="Edit form" />} {...handlers()} />);

  expect(screen.getByRole("form", { name: "Edit form" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Manage volunteers/ })).not.toBeInTheDocument();
});
