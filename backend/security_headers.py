"""Security headers on every API response (pure ASGI middleware).

The API only returns JSON and files that the frontend fetches, so its pages
never need to run scripts, load anything or be framed:

* Content-Security-Policy: default-src 'none'; frame-ancestors 'none'; ...
  (left off the interactive docs pages, which load Swagger UI; the docs are
  off when APP_ENV=production)
* X-Content-Type-Options: nosniff
* X-Frame-Options: DENY
* Referrer-Policy: no-referrer
* Permissions-Policy: every powerful feature off
* Strict-Transport-Security: only when the request came over https (directly,
  or via a trusted proxy's X-Forwarded-Proto), never on plain http.

A header the endpoint already set is left alone. The frontend's own headers
are in frontend/public/_headers (see DEPLOY.md).
"""

from starlette.requests import Request

try:
    from . import rate_limit
except ImportError:
    import rate_limit


API_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
PERMISSIONS_POLICY = (
    "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), "
    "microphone=(), payment=(), usb=(), browsing-topics=()"
)
HSTS = "max-age=31536000; includeSubDomains"

DOCS_PATHS = ("/docs", "/redoc", "/openapi.json")

COMMON = (
    (b"x-content-type-options", b"nosniff"),
    (b"x-frame-options", b"DENY"),
    (b"referrer-policy", b"no-referrer"),
    (b"permissions-policy", PERMISSIONS_POLICY.encode()),
)


def _is_docs(path: str) -> bool:
    return any(path == p or path.startswith(p + "/") for p in DOCS_PATHS)


class SecurityHeadersMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        extra = list(COMMON)
        if not _is_docs(scope.get("path", "")):
            extra.append((b"content-security-policy", API_CSP.encode()))
        if rate_limit.request_is_https(Request(scope)):
            extra.append((b"strict-transport-security", HSTS.encode()))

        async def send_with_headers(message):
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                present = {name.lower() for name, _ in headers}
                headers.extend((n, v) for n, v in extra if n not in present)
                message["headers"] = headers
            await send(message)

        await self.app(scope, receive, send_with_headers)
