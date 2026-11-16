import { act, render, screen } from "@testing-library/react";
import ResultsPage from "./ResultsPage";

// The /match demo is anonymised by the server; the page must show the
// "Volunteer N" label, the skills and the explanation, never a name.
const MATCH = {
  matches: [
    {
      label: "Volunteer 1",
      volunteer: "Volunteer 1",
      volunteer_skills: "Teaching, literacy",
      best_score: 0.8,
      best_match: "Bright Horizons Foundation",
      matches: [
        {
          ngo: "Bright Horizons Foundation",
          ngo_category: "Education",
          score: 0.8,
          percentage: 80,
          confidence: "high",
          explanation: { summary: "Matched on: teaching, literacy" },
        },
      ],
    },
  ],
  total_volunteers: 82,
  total_ngos: 24,
  total_matches: 70,
  returned: 1,
  anonymised: true,
};

beforeEach(() => {
  global.fetch = jest.fn((url) =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve(
          String(url).includes("/match")
            ? MATCH
            : { total_volunteers: 82, total_ngos: 24 }
        ),
    })
  );
});

test("shows anonymised rows with skills and explanation", async () => {
  render(<ResultsPage showToast={() => {}} />);
  await act(async () => {});

  expect(screen.getByRole("heading", { name: "Volunteer 1" })).toBeInTheDocument();
  expect(screen.getByText("Skills: Teaching, literacy")).toBeInTheDocument();
  expect(screen.getByText("Matched on: teaching, literacy")).toBeInTheDocument();
  expect(screen.getByText("70")).toBeInTheDocument();
  expect(screen.queryByText(/Name A-Z/)).not.toBeInTheDocument();
});
