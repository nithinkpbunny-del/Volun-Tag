"""Persistent cache of sentence-transformer vectors.

Vectors are stored per (owner_type, owner_id) together with a hash of the exact
text that was encoded, so a stale row is re-encoded and a fresh one is reused.
"""

import hashlib
from datetime import datetime

import numpy as np
from sqlalchemy import and_, or_
from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.orm import Session

try:
    from .db_models import EmbeddingDB
    from .matching import encode_texts
except ImportError:
    from db_models import EmbeddingDB
    from matching import encode_texts


DEFAULT_DIM = 384

# SQLite allows 999 bound variables by default; each pair uses two.
_LOOKUP_CHUNK = 400


def text_hash(text: str) -> str:
    """sha256 hex of the exact string that gets encoded."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _load_rows(db: Session, items: list) -> dict:
    """Return {(owner_type, owner_id): EmbeddingDB} for all items."""
    pairs = list({(owner_type, owner_id) for owner_type, owner_id, _ in items})
    rows = {}

    for start in range(0, len(pairs), _LOOKUP_CHUNK):
        chunk = pairs[start:start + _LOOKUP_CHUNK]

        found = (
            db.query(EmbeddingDB)
            .filter(
                or_(
                    *[
                        and_(
                            EmbeddingDB.owner_type == owner_type,
                            EmbeddingDB.owner_id == owner_id,
                        )
                        for owner_type, owner_id in chunk
                    ]
                )
            )
            .all()
        )

        for row in found:
            rows[(row.owner_type, row.owner_id)] = row

    return rows


def get_vectors(db: Session, items: list) -> np.ndarray:
    """Return float32 vectors for (owner_type, owner_id, text) items, in order.

    Fresh stored vectors are reused; all others are encoded in one batch and
    upserted.
    """
    if not items:
        return np.zeros((0, DEFAULT_DIM), dtype=np.float32)

    rows = _load_rows(db, items)

    vectors = [None] * len(items)
    stale = []

    for idx, (owner_type, owner_id, text) in enumerate(items):
        row = rows.get((owner_type, owner_id))

        if row is not None and row.text_hash == text_hash(text):
            vectors[idx] = np.frombuffer(
                row.vector, dtype=np.float32
            ).reshape(row.dim)
        else:
            stale.append(idx)

    if stale:
        encoded = np.asarray(
            encode_texts([items[idx][2] for idx in stale]),
            dtype=np.float32,
        )

        now = datetime.utcnow()
        values = []

        for pos, idx in enumerate(stale):
            owner_type, owner_id, text = items[idx]
            vector = np.ascontiguousarray(encoded[pos])
            vectors[idx] = vector

            values.append(
                {
                    "owner_type": owner_type,
                    "owner_id": owner_id,
                    "text_hash": text_hash(text),
                    "vector": vector.tobytes(),
                    "dim": int(vector.shape[0]),
                    "updated_at": now,
                }
            )

        # An item listed twice yields identical values; keep the last one.
        values = list(
            {(v["owner_type"], v["owner_id"]): v for v in values}.values()
        )

        stmt = insert(EmbeddingDB.__table__)
        stmt = stmt.on_conflict_do_update(
            index_elements=["owner_type", "owner_id"],
            set_={
                "text_hash": stmt.excluded.text_hash,
                "vector": stmt.excluded.vector,
                "dim": stmt.excluded.dim,
                "updated_at": stmt.excluded.updated_at,
            },
        )

        db.execute(stmt, values)
        db.commit()

    return np.vstack(vectors).astype(np.float32, copy=False)


def refresh_vector(db: Session, owner_type: str, owner_id: int, text: str):
    """Encode and store one item's vector; does nothing for empty text."""
    if not text:
        return None

    return get_vectors(db, [(owner_type, owner_id, text)])
