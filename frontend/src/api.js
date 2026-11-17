// Shared helpers for talking to the backend as a logged-in volunteer or NGO.
//
// The login session ({ token, role, email }) lives in sessionStorage under
// "voluntag_session", so it survives a page refresh but ends when the tab
// closes. The admin console keeps its own, separate token (components/admin).
import { API_BASE } from "./config";
import { navigateWindow, openBlankWindow, openSafeWindow } from "./safeUrl";

const SESSION_KEY = "voluntag_session";

let unauthorizedHandler = null;

// ─── Session storage ─────────────────────────────────────────────
export function getSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;

    const data = JSON.parse(raw);

    if (data && data.token && data.role && data.email) {
      return { token: data.token, role: data.role, email: data.email };
    }
  } catch {
    // Storage unavailable or corrupt: behave as logged out.
  }

  return null;
}

export function saveSession({ token, role, email }) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ token, role, email }));
  } catch {
    // Without storage the login lasts only until the page reloads.
  }
}

export function clearSession() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Nothing to clear.
  }
}

/** Register what to do when the server says the login has expired. */
export function setUnauthorizedHandler(handler) {
  unauthorizedHandler = handler;
}

// ─── Requests ────────────────────────────────────────────────────
function toUrl(path) {
  return /^https?:\/\//i.test(path) ? path : `${API_BASE}${path}`;
}

/**
 * fetch() with the login token attached. Accepts a full URL or a path.
 * On a 401 while logged in, the session is cleared and the registered
 * handler returns the app to the login screen; the response is still
 * returned so callers can stop what they were doing.
 */
export async function authFetch(path, options = {}) {
  const sent = getSession();
  const headers = new Headers(options.headers || {});

  if (sent) headers.set("Authorization", `Bearer ${sent.token}`);

  const res = await fetch(toUrl(path), { ...options, headers });

  if (res.status === 401 && sent) {
    // Ignore a late 401 from a request sent before a deliberate logout
    // or a fresh login.
    const now = getSession();

    if (now && now.token === sent.token) {
      clearSession();
      if (unauthorizedHandler) unauthorizedHandler();
    }
  }

  return res;
}

/** Log in as a volunteer or NGO. Stores the session and returns the response data. */
export async function loginUser(role, email, password) {
  const res = await fetch(`${API_BASE}/${role}-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  let data = {};

  try {
    data = await res.json();
  } catch {
    data = {};
  }

  if (!res.ok) {
    const err = new Error(errorText(data, "Unable to log in"));
    // "email_not_verified" (403) lets the login screen offer a new link.
    err.code = typeof data.code === "string" ? data.code : "";
    err.status = res.status;
    throw err;
  }

  saveSession({ token: data.token, role, email: data.email || email });

  return data;
}

// ─── Email verification ─────────────────────────────────────────
export const RESEND_FALLBACK =
  "If an account with that email is waiting to be confirmed, we have sent it a new link.";

/**
 * Ask for a new confirmation link. The server answers the same way whether
 * or not the account exists. Resolves to the message to show; rejects with
 * a readable Error on 429 or a network problem.
 */
export async function resendVerification(role, email) {
  const res = await fetch(`${API_BASE}/resend-verification`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role, email: (email || "").trim() }),
  });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(errorText(data, "Could not send a new link. Please try again."));
  }

  return typeof data.message === "string" && data.message ? data.message : RESEND_FALLBACK;
}

/**
 * Confirm an email with the token from the link.
 * Resolves to {status: "verified", role} or {status: "expired" | "used" | "invalid" | "error", message}.
 */
export async function verifyEmailToken(token) {
  let res;
  let data = {};

  try {
    res = await fetch(`${API_BASE}/verify-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    data = await res.json().catch(() => ({}));
  } catch {
    return {
      status: "error",
      message: "Could not reach VolunTag. Check your connection and try again.",
    };
  }

  if (res.ok) return { status: "verified", role: data.role === "ngo" ? "ngo" : "volunteer" };

  const byCode = {
    verification_link_expired: "expired",
    verification_link_used: "used",
    verification_link_invalid: "invalid",
  };
  const status = byCode[data.code] || (res.status === 400 ? "invalid" : "error");

  return { status, message: errorText(data, "Could not check the link. Please try again.") };
}

// How long the app waits for the server before it shows itself logged out.
const RESTORE_TIMEOUT_MS = 8000;

/**
 * Ask the server whether the stored session is still valid.
 *
 * Only a definite "no" (401) removes the stored login. A timeout, a network
 * error or any other failure returns null for this page load but keeps the
 * stored token, so a later reload can still restore it.
 */
export async function restoreSession() {
  const stored = getSession();

  if (!stored) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RESTORE_TIMEOUT_MS);

  try {
    const res = await fetch(`${API_BASE}/session`, {
      headers: { Authorization: `Bearer ${stored.token}` },
      signal: controller.signal,
    });

    if (res.ok) {
      const data = await res.json();
      const session = { token: stored.token, role: data.role, email: data.email };
      saveSession(session);
      return session;
    }

    if (res.status !== 401) return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }

  clearSession();
  return null;
}

/** End the session on the server (best effort) and in this browser. */
export async function logoutUser() {
  const stored = getSession();

  clearSession();

  if (!stored) return;

  try {
    await fetch(`${API_BASE}/logout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${stored.token}` },
    });
  } catch {
    // The token still expires on its own.
  }
}

// ─── Protected files ─────────────────────────────────────────────
/** Fetch a protected file and return an object URL for it. Revoke it when done. */
export async function fetchBlobUrl(path) {
  const res = await authFetch(path);

  if (!res.ok) throw new Error("File unavailable");

  return URL.createObjectURL(await res.blob());
}

/**
 * Open a protected file in a new tab. The window is opened first, inside the
 * click, so popup blockers allow it; its address is set once the file loads.
 */
export async function openAuthedFile(path) {
  const win = openBlankWindow();

  if (win) {
    win.document.title = "Loading…";
  }

  try {
    const url = await fetchBlobUrl(path);

    if (!navigateWindow(win, url)) {
      openSafeWindow(url);
    }

    // Give the tab time to read it before the URL is released.
    setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000);
  } catch (err) {
    if (win) win.close();
    throw err;
  }
}

/**
 * A readable message from an error response body. FastAPI sends either
 * {detail: "text"} or, for validation errors, {detail: [{msg, loc}, ...]}.
 */
export function errorText(data, fallback = "Something went wrong") {
  if (!data) return fallback;
  if (typeof data.message === "string" && data.message) return data.message;
  if (typeof data.detail === "string" && data.detail) return data.detail;
  if (Array.isArray(data.detail) && data.detail.length) {
    return data.detail
      .map((item) => {
        const field = Array.isArray(item.loc) ? item.loc[item.loc.length - 1] : "";
        const msg = String(item.msg || "").replace(/^Value error, /, "");
        return field && field !== "body" ? `${String(field).replace(/_/g, " ")}: ${msg}` : msg;
      })
      .join(" · ");
  }
  return fallback;
}
