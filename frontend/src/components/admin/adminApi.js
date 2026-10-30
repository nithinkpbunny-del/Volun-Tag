import { useEffect, useRef } from "react";

export const API_BASE = "http://127.0.0.1:8000";

const TOKEN_KEY = "voluntag_admin_token";

export const REFRESH_MS = 10000;

// ─── Token storage (sessionStorage can throw in private modes) ─────
// The in-memory copy keeps the console working when storage is blocked;
// the session then only lasts until the page is reloaded.
let memoryToken = "";

export function getToken() {
  try {
    return sessionStorage.getItem(TOKEN_KEY) || memoryToken;
  } catch {
    return memoryToken;
  }
}

export function setToken(token) {
  memoryToken = token;
  try {
    sessionStorage.setItem(TOKEN_KEY, token);
  } catch {
    // memoryToken still holds it.
  }
}

export function clearToken() {
  memoryToken = "";
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // Nothing stored, nothing to clear.
  }
}

// ─── Session-ended callback ────────────────────────────────────────
let onUnauthorized = null;

export function setOnUnauthorized(callback) {
  onUnauthorized = callback;
}

function handleUnauthorized() {
  clearToken();
  if (onUnauthorized) onUnauthorized();
}

export class AdminApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function errorFrom(res) {
  let detail = "";
  try {
    const data = await res.json();
    detail = typeof data.detail === "string" ? data.detail : "";
  } catch {
    detail = "";
  }
  return new AdminApiError(detail || `Request failed (${res.status})`, res.status);
}

async function authorizedFetch(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  } catch {
    throw new AdminApiError("Unable to connect to the VolunTag server", 0);
  }

  if (res.status === 401) {
    handleUnauthorized();
    throw new AdminApiError("Your admin session has ended", 401);
  }

  if (!res.ok) throw await errorFrom(res);

  return res;
}

/** Call an admin JSON endpoint with the bearer token; returns parsed JSON. */
export async function adminFetch(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  const res = await authorizedFetch(path, { ...options, headers });
  return res.json();
}

/** Fetch a protected file and return a blob object URL. Callers must revoke it. */
export async function fetchFileUrl(path) {
  const res = await authorizedFetch(path);
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

/** Exchange the password for a token. Not routed through adminFetch: a 401 here is a wrong password. */
export async function loginRequest(password) {
  let res;
  try {
    res = await fetch(`${API_BASE}/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
  } catch {
    throw new AdminApiError("Unable to connect to the VolunTag server", 0);
  }

  if (!res.ok) throw await errorFrom(res);

  return res.json();
}

// ─── Dates ─────────────────────────────────────────────────────────
const IST_DATE = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "numeric",
  month: "short",
  year: "numeric",
});

const IST_DATE_TIME = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

/**
 * Format a backend datetime in IST. The backend sends naive UTC strings
 * (no "Z"), so a "Z" is appended when no timezone is present.
 */
export function formatIST(value, { time = true } = {}) {
  if (!value) return "—";

  const text = String(value);
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/i.test(text);
  const date = new Date(hasZone ? text : `${text}Z`);

  if (Number.isNaN(date.getTime())) return "—";

  return time ? `${IST_DATE_TIME.format(date)} IST` : IST_DATE.format(date);
}

// ─── Silent polling ────────────────────────────────────────────────
/**
 * Run callback every REFRESH_MS while the tab is visible, and once when the
 * tab becomes visible again. Pass enabled=false to pause.
 */
export function useVisibleInterval(callback, enabled = true) {
  const saved = useRef(callback);

  useEffect(() => {
    saved.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!enabled) return undefined;

    const tick = () => {
      if (document.visibilityState === "visible") saved.current();
    };

    const id = setInterval(tick, REFRESH_MS);
    document.addEventListener("visibilitychange", tick);

    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [enabled]);
}

// ─── Status helpers ────────────────────────────────────────────────
export const PENDING_STATUS = "Under evaluation";

/** Pill colour for proof, issue and NGO verification statuses. */
export function statusModifier(status) {
  switch (status) {
    case "Under evaluation":
    case "Pending":
      return "pending";
    case "Approved":
    case "Resolved":
      return "approved";
    case "Rejected":
      return "rejected";
    default:
      return "closed";
  }
}
