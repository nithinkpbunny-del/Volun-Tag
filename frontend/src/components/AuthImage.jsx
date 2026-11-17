import { useEffect, useState } from "react";
import { fetchBlobUrl, openAuthedFile } from "../api";

const PLACEHOLDER_STYLE = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minWidth: 80,
  minHeight: 80,
  padding: 8,
  fontSize: "0.8rem",
  opacity: 0.7,
  textAlign: "center",
};

/**
 * An image behind a login, fetched with the session token as a blob URL.
 * Shows a placeholder while loading, a note if it fails, and releases the
 * object URL when it goes away. Clicking opens the full file in a new tab.
 */
export default function AuthImage({
  src,
  alt,
  className = "",
  linkClassName = "",
  onFail,
  onOpenError,
}) {
  const [state, setState] = useState({ url: null, status: "loading" });

  useEffect(() => {
    let cancelled = false;
    let objectUrl = null;

    setState({ url: null, status: "loading" });

    fetchBlobUrl(src)
      .then((url) => {
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        objectUrl = url;
        setState({ url, status: "ready" });
      })
      .catch(() => {
        if (cancelled) return;
        setState({ url: null, status: "error" });
        if (onFail) onFail();
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  // onFail is read when the load fails; it is not a reason to refetch.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  if (state.status === "loading") {
    return (
      <span
        className={`auth-image auth-image--loading ${className}`}
        style={PLACEHOLDER_STYLE}
        role="img"
        aria-label={`Loading ${alt || "image"}`}
      >
        Loading…
      </span>
    );
  }

  if (state.status === "error") {
    return (
      <span
        className={`auth-image auth-image--error ${className}`}
        style={PLACEHOLDER_STYLE}
      >
        Photo unavailable
      </span>
    );
  }

  return (
    <a
      className={linkClassName}
      href={state.url}
      target="_blank"
      rel="noopener noreferrer"
      title="Open full size in a new tab"
      onClick={(e) => {
        // Open through the shared helper so the tab is not left blank.
        e.preventDefault();
        openAuthedFile(src).catch(() => {
          if (onOpenError) onOpenError();
        });
      }}
    >
      <img className={className} src={state.url} alt={alt} />
    </a>
  );
}
