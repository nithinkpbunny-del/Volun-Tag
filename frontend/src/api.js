// Shared helpers for talking to the backend as a logged-in volunteer or NGO.
//
// The login session ({ token, role, email }) lives in sessionStorage under
// "voluntag_session", so it survives a page refresh but ends when the tab
// closes. The admin console keeps its own, separate token (components/admin).
import { API_BASE } from "./config";

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
    throw new Error(
      typeof data.detail === "string" ? data.detail : "Unable to log in"
    );
  }

  saveSession({ token: data.token, role, email: data.email || email });

  return data;
}

/** Ask the server whether the stored session is still valid. */
export async function restoreSession() {
  const stored = getSession();

  if (!stored) return null;

  try {
    const res = await fetch(`${API_BASE}/session`, {
      headers: { Authorization: `Bearer ${stored.token}` },
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
  const win = window.open("", "_blank");

  if (win) {
    win.opener = null;
    win.document.title = "Loading…";
  }

  try {
    const url = await fetchBlobUrl(path);

    if (win) {
      win.location.href = url;
    } else {
      window.open(url, "_blank");
    }

    // Give the tab time to read it before the URL is released.
    setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000);
  } catch (err) {
    if (win) win.close();
    throw err;
  }
}
