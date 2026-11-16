import { errorText } from "./api";

test("errorText reads every error shape the backend sends", () => {
  expect(errorText({ detail: "Plain text" })).toBe("Plain text");
  expect(errorText({ code: "x", message: "Friendly", detail: "Friendly" })).toBe("Friendly");
  expect(
    errorText({
      detail: [{ loc: ["body", "spots_available"], msg: "Input should be greater than or equal to 1" }],
    })
  ).toBe("spots available: Input should be greater than or equal to 1");
  expect(errorText({ detail: [{ loc: ["body"], msg: "Value error, must not be empty" }] })).toBe(
    "must not be empty"
  );
  expect(errorText(null, "Fallback")).toBe("Fallback");
  expect(errorText({}, "Fallback")).toBe("Fallback");
});
