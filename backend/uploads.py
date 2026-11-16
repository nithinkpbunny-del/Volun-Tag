"""Safe saving of uploaded files.

* The file is copied to disk in chunks and stops at a hard byte cap (413),
  so nothing is ever read fully into memory.
* The CONTENT is checked, not the browser's Content-Type: images must be
  decodable by Pillow and below MAX_IMAGE_PIXELS (decompression bombs);
  PDF / DOC / DOCX must start with the right magic bytes.
* Every saved path is recorded in a SavedFiles list so a failing request can
  delete everything it already wrote.
"""

import uuid
from pathlib import Path
from typing import Optional

from fastapi import HTTPException, UploadFile
from PIL import Image

try:
    from .settings import MAX_IMAGE_PIXELS
except ImportError:
    from settings import MAX_IMAGE_PIXELS


CHUNK_SIZE = 64 * 1024

# Pillow warns above MAX_IMAGE_PIXELS and refuses above twice that. We also
# check the size ourselves before decoding anything.
Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS

IMAGE_EXTENSIONS = {
    "JPEG": ".jpg", "PNG": ".png", "GIF": ".gif",
    "WEBP": ".webp", "BMP": ".bmp", "TIFF": ".tif",
}

DOCUMENT_MAGIC = {
    ".pdf": (b"%PDF-",),
    ".doc": (b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1",),
    ".docx": (b"PK\x03\x04",),
}


class SavedFiles(list):
    """Paths written during one request; cleanup() removes them all."""

    def cleanup(self) -> None:
        for path in self:
            try:
                Path(path).unlink(missing_ok=True)
            except OSError:
                pass
        self.clear()


def _mb(n: int) -> str:
    return f"{n // (1024 * 1024)} MB"


def stream_to_disk(upload: UploadFile, dest: Path, max_bytes: int, label: str) -> int:
    """Copy upload to dest in chunks; 413 (and no file left) above max_bytes."""

    written = 0
    try:
        upload.file.seek(0)
    except Exception:
        pass

    try:
        with open(dest, "wb") as out:
            while True:
                chunk = upload.file.read(CHUNK_SIZE)
                if not chunk:
                    break
                written += len(chunk)
                if written > max_bytes:
                    raise HTTPException(
                        status_code=413,
                        detail=f"File '{label}' exceeds the {_mb(max_bytes)} size limit.",
                    )
                out.write(chunk)
    except BaseException:
        dest.unlink(missing_ok=True)
        raise

    if written == 0:
        dest.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail=f"File '{label}' is empty.")

    return written


def check_image_file(path: Path, label: str) -> str:
    """Return the Pillow format name, or raise 400 when it is not a safe image."""

    try:
        with Image.open(path) as img:
            width, height = img.size
            fmt = img.format
            if width * height > MAX_IMAGE_PIXELS:
                raise HTTPException(
                    status_code=400,
                    detail=f"Image '{label}' is too large ({width}×{height} pixels).",
                )
            img.verify()
    except HTTPException:
        raise
    except Image.DecompressionBombError:
        raise HTTPException(status_code=400, detail=f"Image '{label}' is too large.")
    except Exception:
        raise HTTPException(
            status_code=400,
            detail=(
                f"File '{label}' is not a supported image. "
                "Allowed: JPEG, PNG, GIF, WebP, BMP, TIFF."
            ),
        )

    if fmt not in IMAGE_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"File '{label}' is not a supported image. "
                "Allowed: JPEG, PNG, GIF, WebP, BMP, TIFF."
            ),
        )

    return fmt


def save_image(
    upload: UploadFile,
    dest_dir: Path,
    prefix: str,
    max_bytes: int,
    saved: Optional[SavedFiles] = None,
) -> tuple[str, Path]:
    """Save and verify one image; returns (stored name, path).

    The stored extension comes from the decoded format, not the client.
    """

    label = Path(upload.filename or "image").name
    tmp = dest_dir / f".upload-{uuid.uuid4().hex}"

    stream_to_disk(upload, tmp, max_bytes, label)

    try:
        fmt = check_image_file(tmp, label)
        stored_name = f"{prefix}{uuid.uuid4().hex}{IMAGE_EXTENSIONS[fmt]}"
        dest = dest_dir / stored_name
        tmp.replace(dest)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise

    if saved is not None:
        saved.append(dest)

    return stored_name, dest


def save_document(
    upload: UploadFile,
    dest_dir: Path,
    prefix: str,
    allowed_extensions: dict,
    max_bytes: int,
    label: str,
    saved: Optional[SavedFiles] = None,
) -> tuple[str, Path]:
    """Save a document whose content matches one of allowed_extensions.

    allowed_extensions maps an extension (".pdf") to a checker: "magic" for
    the DOCUMENT_MAGIC bytes, "image" for a Pillow-verified image.
    The extension of the client's file name picks the expected kind.
    """

    ext = Path(upload.filename or "").suffix.lower()
    if ext == ".jpeg":
        ext = ".jpg"

    if ext not in allowed_extensions:
        names = ", ".join(sorted(e.lstrip(".").upper() for e in allowed_extensions))
        raise HTTPException(status_code=400, detail=f"{label} must be one of: {names}.")

    tmp = dest_dir / f".upload-{uuid.uuid4().hex}"
    stream_to_disk(upload, tmp, max_bytes, label)

    try:
        kind = allowed_extensions[ext]
        if kind == "image":
            check_image_file(tmp, label)
        else:
            with open(tmp, "rb") as fh:
                head = fh.read(16)
            if not any(head.startswith(m) for m in DOCUMENT_MAGIC[ext]):
                raise HTTPException(
                    status_code=400,
                    detail=f"{label} does not look like a real {ext.lstrip('.').upper()} file.",
                )

        stored_name = f"{prefix}{uuid.uuid4().hex}{ext}"
        dest = dest_dir / stored_name
        tmp.replace(dest)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise

    if saved is not None:
        saved.append(dest)

    return stored_name, dest
