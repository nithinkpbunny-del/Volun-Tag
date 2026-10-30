import { useCallback, useEffect, useRef, useState } from "react";
import { getNGODocumentBlob } from "./adminApi";

// Revoking a blob URL right after link.click() can cancel the download in some browsers.
const DOWNLOAD_URL_LIFETIME_MS = 60000;

const EXTENSIONS = {
  "application/pdf": ".pdf",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/bmp": ".bmp",
  "image/tiff": ".tiff",
};

function baseType(contentType) {
  return (contentType || "").split(";")[0].trim().toLowerCase();
}

function downloadName(label, type) {
  return `${label}${EXTENSIONS[type] || ""}`;
}

/**
 * One NGO registration document or work photo. The file is fetched only when
 * View is clicked; images and PDFs show inline, anything else is downloaded.
 */
export default function AdminDocumentViewer({ ngoId, doc, showToast }) {
  const [view, setView] = useState(null); // { url, type } while a preview is open
  const [loading, setLoading] = useState(false);

  // The preview's blob URL, and a counter that makes late fetches no-ops.
  const urlRef = useRef(null);
  const requestSeq = useRef(0);

  const hide = useCallback(() => {
    requestSeq.current += 1;
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    setView(null);
    setLoading(false);
  }, []);

  // Release the preview on unmount.
  useEffect(() => hide, [hide]);

  const handleView = async () => {
    if (loading || view) return;

    const seq = ++requestSeq.current;
    setLoading(true);

    try {
      const { blob, contentType } = await getNGODocumentBlob(ngoId, doc.key);
      if (seq !== requestSeq.current) return;

      const type = baseType(contentType || blob.type);
      const url = URL.createObjectURL(blob);

      if (type.startsWith("image/") || type === "application/pdf") {
        urlRef.current = url;
        setView({ url, type });
        return;
      }

      const link = document.createElement("a");
      link.href = url;
      link.download = downloadName(doc.label, type);
      document.body.appendChild(link);
      link.click();
      link.remove();

      setTimeout(() => URL.revokeObjectURL(url), DOWNLOAD_URL_LIFETIME_MS);
    } catch (err) {
      if (seq === requestSeq.current && err.status !== 401) {
        showToast(err.message || "Could not load the document", "error");
      }
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  };

  return (
    <li className={`adm-doc-row${doc.available ? "" : " adm-doc-row--missing"}`}>
      <div className="adm-doc-row-head">
        <span className="adm-doc-row-label">{doc.label}</span>

        {!doc.available ? (
          <span className="adm-doc-row-status">Not uploaded</span>
        ) : !view ? (
          <button
            type="button"
            className="adm-btn adm-btn--secondary adm-btn--sm"
            onClick={handleView}
            disabled={loading}
            aria-busy={loading}
          >
            {loading ? "Loading…" : "View"}
          </button>
        ) : null}
      </div>

      {view && (
        <div className="adm-doc-panel adm-doc-row-panel">
          <div className="adm-doc-toolbar">
            <span className="adm-doc-name">{doc.label}</span>
            <div className="adm-doc-actions">
              <a
                className="adm-btn adm-btn--secondary adm-btn--sm"
                href={view.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open in new tab
              </a>
              <a
                className="adm-btn adm-btn--secondary adm-btn--sm"
                href={view.url}
                download={downloadName(doc.label, view.type)}
              >
                Download
              </a>
              <button
                type="button"
                className="adm-btn adm-btn--ghost adm-btn--sm"
                onClick={hide}
              >
                Hide
              </button>
            </div>
          </div>

          {view.type === "application/pdf" ? (
            <iframe className="adm-doc-frame" src={view.url} title={doc.label} />
          ) : (
            <img className="adm-doc-image" src={view.url} alt={doc.label} />
          )}
        </div>
      )}
    </li>
  );
}
