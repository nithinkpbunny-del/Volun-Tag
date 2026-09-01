import { useEffect, useState } from "react";

export default function ImagePreviewCard({ file, onRemove }) {
  const [preview, setPreview] = useState(file.preview);

  useEffect(() => {
    if (!file.preview) {
      const objectUrl = URL.createObjectURL(file.file);
      setPreview(objectUrl);
      return () => URL.revokeObjectURL(objectUrl);
    }
    return undefined;
  }, [file]);

  return (
    <div className="image-preview-card">
      <img src={preview} alt={file.name} />
      <button type="button" className="remove-image-btn" onClick={onRemove}>
        Remove
      </button>
    </div>
  );
}
