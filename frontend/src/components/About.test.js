import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import About from "./About";
import * as content from "../content/aboutContent";

jest.mock("../content/aboutContent", () => {
  const actual = jest.requireActual("../content/aboutContent");
  return {
    ...actual,
    PROJECT: { ...actual.PROJECT },
    GUIDE: { ...actual.GUIDE },
    TEAM: actual.TEAM.map((member) => ({ ...member })),
  };
});

const renderAbout = () =>
  render(
    <MemoryRouter>
      <About />
    </MemoryRouter>
  );

afterEach(() => {
  content.PROJECT.college = "";
  content.PROJECT.department = "";
  content.GUIDE.name = "";
  content.TEAM.forEach((member) => {
    member.name = "";
    member.role = "";
  });
});

test("the About page shows the mission and the repository link, with one h1", () => {
  renderAbout();

  expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  expect(screen.getByText(content.MISSION)).toBeInTheDocument();
  expect(screen.getAllByRole("link", { name: "VolunTag on GitHub" })[0]).toHaveAttribute(
    "href",
    "https://github.com/nithinkpbunny-del/Volun-Tag"
  );
});

test("empty project, guide and team fields hide their sections", () => {
  renderAbout();

  expect(screen.queryByRole("heading", { name: "The project" })).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Team" })).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Guide" })).not.toBeInTheDocument();
  expect(screen.queryByText(/\[|PLACEHOLDER/)).not.toBeInTheDocument();
});

test("filled-in fields show their sections", () => {
  content.PROJECT.college = "Example College";
  content.PROJECT.department = "Computer Science";
  content.GUIDE.name = "Dr. Example";
  content.TEAM[0].name = "Sample Person";
  content.TEAM[0].role = "Frontend";

  renderAbout();

  expect(screen.getByRole("heading", { name: "The project" })).toBeInTheDocument();
  expect(screen.getByText(/Example College, Computer Science/)).toBeInTheDocument();
  expect(screen.getByText("Dr. Example")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Team" })).toBeInTheDocument();
  expect(screen.getByText("Sample Person")).toBeInTheDocument();
});
