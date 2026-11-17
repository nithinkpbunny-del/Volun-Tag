import { fireEvent, render, screen } from "@testing-library/react";
import { ActionMenu, Badge, Chips, EmptyState, Progress, SkeletonList } from "./ui";

test("Badge shows its text with the tone class", () => {
  render(<Badge tone="warning">Waiting</Badge>);

  expect(screen.getByText("Waiting")).toHaveClass("ui-badge", "ui-badge--warning");
});

test("Chips split a comma list, trim it and fold the rest into +n more", () => {
  render(<Chips items="teaching,  first aid , ,cooking, driving" max={2} />);

  const list = screen.getByRole("list", { name: "Skills" });
  expect(list).toHaveTextContent("teaching");
  expect(list).toHaveTextContent("first aid");
  expect(list).toHaveTextContent("+2 more");
  expect(list).not.toHaveTextContent("cooking");
});

test("Chips render nothing for an empty list", () => {
  const { container } = render(<Chips items="  " />);

  expect(container).toBeEmptyDOMElement();
});

test("EmptyState shows a title, a sentence and an action", () => {
  render(
    <EmptyState title="No events yet" action={<button type="button">Create</button>}>
      Organize your first event.
    </EmptyState>
  );

  expect(screen.getByText("No events yet")).toBeInTheDocument();
  expect(screen.getByText("Organize your first event.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Create" })).toBeInTheDocument();
});

test("SkeletonList announces loading to screen readers", () => {
  render(<SkeletonList count={2} label="Loading events" />);

  expect(screen.getByRole("status")).toHaveTextContent("Loading events");
});

test("Progress exposes value and total, and has no bar without a total", () => {
  const { rerender } = render(<Progress value={2} total={5} label="Spots approved" />);

  const bar = screen.getByRole("progressbar");
  expect(bar).toHaveAttribute("aria-valuenow", "2");
  expect(bar).toHaveAttribute("aria-valuemax", "5");

  rerender(<Progress value={2} label="2 approved" />);
  expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
});

describe("ActionMenu", () => {
  const setup = () => {
    const onEdit = jest.fn();
    const onCancel = jest.fn();
    render(
      <ActionMenu
        label="More actions"
        items={[
          { label: "Edit event", onSelect: onEdit },
          false,
          { label: "Mark as filled", disabled: true, onSelect: jest.fn() },
          { label: "Cancel event", danger: true, onSelect: onCancel },
        ]}
      />
    );
    return { onEdit, onCancel, button: screen.getByRole("button", { name: "More actions" }) };
  };

  test("opens on click, runs the chosen action and closes", () => {
    const { onEdit, button } = setup();

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByRole("menuitem")).toHaveLength(3);
    expect(screen.getByRole("menuitem", { name: "Mark as filled" })).toBeDisabled();

    fireEvent.click(screen.getByRole("menuitem", { name: "Edit event" }));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  test("Escape closes it and returns focus to the button", () => {
    const { button } = setup();

    fireEvent.click(button);
    expect(screen.getByRole("menuitem", { name: "Edit event" })).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  test("arrow keys move between the usable items", () => {
    const { button } = setup();

    fireEvent.click(button);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: "Cancel event" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: "Edit event" })).toHaveFocus();
  });

  test("a click outside closes it", () => {
    const { button } = setup();

    fireEvent.click(button);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  test("renders nothing when there are no actions", () => {
    const { container } = render(<ActionMenu items={[false, null]} />);

    expect(container).toBeEmptyDOMElement();
  });
});
