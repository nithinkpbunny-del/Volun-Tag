import { useEffect, useState } from "react";
import { fetchFileUrl } from "./adminApi";

/**
 * One protected image, loaded with the admin token as a blob URL.
 * Refetches only when `src` changes, so parent refreshes do not reload it.
 */
export default function AdminImage({ src, alt, className = "" }) {
  const [state, setState] = useState({ url: null, status: "loading" });

  useEffect(() => {
    let cancelled = false;
    let objectUrl = null;

    setState({ url: null, status: "loading" });

    fetchFileUrl(src)
      .then((url) => {
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        objectUrl = url;
        setState({ url, status: "ready" });
      })
      .catch(() => {
        if (!cancelled) setState({ url: null, status: "error" });
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src]);

  if (state.status === "loading") {
    return (
      <div
        className={`adm-image adm-image--loading ${className}`}
        role="img"
        aria-label={`Loading ${alt}`}
      />
    );
  }

  if (state.status === "error") {
    return (
      <div className={`adm-image adm-image--error ${className}`}>
        Photo unavailable
      </div>
    );
  }

  return (
    <a
      className={`adm-image adm-image--ready ${className}`}
      href={state.url}
      target="_blank"
      rel="noopener noreferrer"
      title="Open full size in a new tab"
    >
      <img src={state.url} alt={alt} />
    </a>
  );
}
