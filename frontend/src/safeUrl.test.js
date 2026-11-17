import { mapsUrl, openSafeWindow, safeBlobUrl, safeExternalUrl } from "./safeUrl";

test("only http(s) websites become links", () => {
  expect(safeExternalUrl("https://example.org/a?b=1")).toBe("https://example.org/a?b=1");
  expect(safeExternalUrl("http://example.org")).toBe("http://example.org/");
  expect(safeExternalUrl("  example.org ")).toBe("https://example.org/");
  expect(safeExternalUrl("www.example.org/about")).toBe("https://www.example.org/about");

  for (const bad of [
    "javascript:alert(1)",
    " JavaScript:alert(1)",
    "java\tscript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "mailto:a@b.co",
    "//evil.example",
    "localhost",
    "",
    null,
    undefined,
    42,
  ]) {
    expect(safeExternalUrl(bad)).toBeNull();
  }
});

test("blob URLs only", () => {
  expect(safeBlobUrl("blob:http://localhost/1234")).toBe("blob:http://localhost/1234");
  expect(safeBlobUrl("javascript:alert(1)")).toBeNull();
  expect(safeBlobUrl("https://example.org")).toBeNull();
});

test("maps links only for real coordinates", () => {
  expect(mapsUrl(18.52, 73.85)).toBe("https://www.google.com/maps?q=18.52,73.85");
  expect(mapsUrl("18.5", "73.8")).toBe("https://www.google.com/maps?q=18.5,73.8");
  expect(mapsUrl("1,javascript:alert(1)", 2)).toBeNull();
  expect(mapsUrl(null, 2)).toBeNull();
  expect(mapsUrl(91, 0)).toBeNull();
});

test("openSafeWindow refuses script URLs", () => {
  const open = jest.spyOn(window, "open").mockImplementation(() => null);
  expect(openSafeWindow("javascript:alert(1)")).toBeNull();
  expect(open).not.toHaveBeenCalled();
  openSafeWindow("blob:http://localhost/1");
  expect(open).toHaveBeenCalledWith("blob:http://localhost/1", "_blank", "noopener,noreferrer");
  open.mockRestore();
});
