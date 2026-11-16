import { act, fireEvent, render, screen } from "@testing-library/react";
import IssueReportForm from "./IssueReportForm";
import { saveSession } from "../api";

const MESSAGE =
  "The photo and the description do not seem to describe the same problem. Please check both.";

beforeEach(() => {
  sessionStorage.clear();
  saveSession({ token: "t", role: "volunteer", email: "vol@example.test" });
  global.fetch = jest.fn(() =>
    Promise.resolve({
      ok: false,
      status: 422,
      json: () =>
        Promise.resolve({ code: "image_description_mismatch", message: MESSAGE, detail: MESSAGE }),
    })
  );
});

test("a photo/description mismatch is shown in the form and the text is kept", async () => {
  const showToast = jest.fn();
  const onReportSuccess = jest.fn();
  render(<IssueReportForm showToast={showToast} onReportSuccess={onReportSuccess} />);

  fireEvent.change(screen.getByLabelText(/Issue Description/), {
    target: { value: "Garbage dumped near the lake" },
  });
  fireEvent.change(screen.getByLabelText(/Location/), { target: { value: "Pune" } });
  fireEvent.click(screen.getByText(/Next: Add Photos/));

  await act(async () => {
    fireEvent.click(screen.getByText(/Submit Report/));
  });

  expect(screen.getByRole("alert")).toHaveTextContent(MESSAGE);
  expect(onReportSuccess).not.toHaveBeenCalled();
  expect(showToast).not.toHaveBeenCalledWith(expect.anything(), "error");

  fireEvent.click(screen.getByText(/Back/));
  expect(screen.getByLabelText(/Issue Description/)).toHaveValue("Garbage dumped near the lake");
});
