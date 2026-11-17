// Safe values for href, src and window.open.
//
// React escapes text, but it does not stop a "javascript:" URL in href from
// running when clicked. Every link or address built from data that a user,
// an NGO or the server supplied must go through one of these helpers. A
// check in backend/tests/test_frontend_sinks.py fails the build when a new
// href/src/window.open appears that does not.

/**
 * An http(s) URL for an outside website, or null.
 * A bare domain such as "example.org" is read as https://example.org.
 */
export function safeExternalUrl(value) {
  if (typeof value !== "string") return null;

  const text = value.trim();
  // Relative or protocol-relative ("/x", "//host") values are not websites.
  if (!text || /[\s<>"\\]/.test(text) || text.startsWith("/")) return null;

  // Has a scheme ("xxx:") -> must be http(s); otherwise try https://.
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;

  try {
    const url = new URL(candidate);
    if ((url.protocol === "http:" || url.protocol === "https:") && url.hostname.includes(".")) {
      return url.href;
    }
  } catch {
    // not a URL
  }

  return null;
}

/** An object URL made by URL.createObjectURL in this page, or null. */
export function safeBlobUrl(value) {
  return typeof value === "string" && value.startsWith("blob:") ? value : null;
}

/** A Google Maps link for real coordinates, or null. */
export function mapsUrl(latitude, longitude) {
  const lat = Number(latitude);
  const lng = Number(longitude);

  if (
    latitude === null || latitude === undefined || longitude === null || longitude === undefined ||
    !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180
  ) {
    return null;
  }

  return `https://www.google.com/maps?q=${lat},${lng}`;
}

/**
 * window.open for an http(s) or blob: address only, without giving the new
 * tab access to this one. Returns the new window (or null).
 */
export function openSafeWindow(url) {
  const safe = safeBlobUrl(url) || safeExternalUrl(url);
  if (!safe) return null;

  const win = window.open(safe, "_blank", "noopener,noreferrer");
  return win || null;
}

/** Point a window opened earlier with openBlankWindow() at a blob: URL. */
export function navigateWindow(win, url) {
  const safe = safeBlobUrl(url);
  if (win && safe) win.location.replace(safe);
  return Boolean(win && safe);
}

/** An empty tab opened inside a click (so popup blockers allow it), cut off from this one. */
export function openBlankWindow() {
  const win = window.open("", "_blank");
  if (win) win.opener = null;
  return win || null;
}
