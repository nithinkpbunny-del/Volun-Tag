"""Lint-style check: no new XSS sinks in the React frontend.

The login token lives in sessionStorage, so any script injected into the page
could read it. React escapes text, so the risk is in the few places that
turn data into markup or addresses. This test scans frontend/src (tests
excluded) and fails when:

* a raw-HTML or code sink appears anywhere (dangerouslySetInnerHTML,
  innerHTML, outerHTML, insertAdjacentHTML, document.write, eval, new
  Function, srcDoc, a "javascript:" string);
* window.open or a location change appears outside src/safeUrl.js;
* an href=, src=, action= or formAction= expression, or an assignment to
  .href/.src, is not one of the reviewed expressions below and is not a call
  to a safeUrl.js helper.

Adding a link? Build it with safeExternalUrl(), safeBlobUrl() or mapsUrl()
from src/safeUrl.js, or, if it is provably safe (a constant, an internal API
path, an object URL made in the same component), review it and add it to
REVIEWED with the reason.
"""

import re
from pathlib import Path

FRONTEND_SRC = Path(__file__).resolve().parents[2] / "frontend" / "src"

BANNED = {
    "dangerouslySetInnerHTML": r"dangerouslySetInnerHTML",
    "innerHTML / outerHTML": r"\.(inner|outer)HTML\b",
    "insertAdjacentHTML": r"insertAdjacentHTML",
    "document.write": r"document\.write",
    "eval": r"(?<![\w.])eval\s*\(",
    "new Function": r"new\s+Function\s*\(",
    "srcDoc": r"\bsrcdoc\b",
    "javascript: URL": r"javascript:",
}

ONLY_IN_SAFEURL = {
    "window.open": r"\bwindow\.open\s*\(",
    "location change": (
        r"\b(?:window|document|self|top|parent)\.location\s*=[^=]"
        r"|\blocation\.(?:href\s*=[^=]|assign\s*\(|replace\s*\()"
    ),
}

SAFE_CALL = re.compile(r"^(safeExternalUrl|safeBlobUrl|mapsUrl)\(")

# (file, expression) -> why it is safe. Expressions are compared without spaces.
REVIEWED = {
    ("components/About.jsx", "REPO_URL"): "constant",
    ("components/LandingPage.js", "`mailto:${CONTACT_EMAIL}`"): "constant",
    ("components/LandingPage.js", "REPO_URL"): "constant",
    ("components/Contact.jsx", "`mailto:${CONTACT_EMAIL}`"): "constant",
    ("components/Contact.jsx", "REPO_URL"): "constant",
    ("components/ImagePreviewCard.js", "preview"): "URL.createObjectURL of a chosen file",
    ("components/AuthImage.jsx", "state.url"): "object URL from fetchBlobUrl",
    ("components/admin/AdminImage.jsx", "state.url"): "object URL from fetchBlobUrl",
    ("components/admin/AdminNGODetail.jsx", "href"): "safeExternalUrl() result",
    ("components/admin/AdminDocumentViewer.jsx", "view.url"): "URL.createObjectURL",
    ("components/admin/AdminDocumentViewer.jsx", "url"): "URL.createObjectURL (download link)",
    ("components/admin/AdminProofDetail.jsx", "docUrl"): "object URL from fetchBlobUrl",
    ("components/admin/AdminProofDetail.jsx", "url"): "URL.createObjectURL (download link)",
    ("components/admin/AdminProofDetail.jsx",
     "`/issue-files/issue/${encodeURIComponent(issue.complaint_id)}/${index}`"): "API path for AdminImage",
    ("components/admin/AdminProofDetail.jsx", "`/issue-files/resolution/${proof.id}/before`"): "API path for AdminImage",
    ("components/admin/AdminProofDetail.jsx", "`/issue-files/resolution/${proof.id}/after`"): "API path for AdminImage",
    ("components/admin/AdminContactMessages.jsx", "mailto"): "replyMailto() validates the address",
    ("components/ngo/NGODashboard.jsx", "src"): "API path passed to AuthImage",
    ("components/ngo/NGODashboard.jsx", 'resolutionFilePath(iss.resolution_id,"before")'): "API path for AuthImage",
    ("components/ngo/NGODashboard.jsx", 'resolutionFilePath(iss.resolution_id,"after")'): "API path for AuthImage",
    ("components/ngo/NGODashboard.jsx", "issuePhotoPath(iss.complaint_id,index)"): "API path for AuthImage",
    ("components/volunteer/VolunteerDashboard.jsx", "src"): "API path passed to AuthImage",
    ("components/volunteer/VolunteerDashboard.jsx", "issuePhotoPath(iss.complaint_id,index)"): "API path for AuthImage",
    ("components/ngo/ResolveIssue.jsx", "beforePreview"): "URL.createObjectURL of a chosen file",
    ("components/ngo/ResolveIssue.jsx", "afterPreview"): "URL.createObjectURL of a chosen file",
    ("components/messaging/Messages.jsx", "filePath"): "API path passed to AuthImage",
    ("components/messaging/Messages.jsx", "pendingFile.previewUrl"): "URL.createObjectURL of a chosen file",
    ("components/ngo/NGORegisterForm.jsx", "URL.createObjectURL(file)"): "object URL of a chosen file",
}

ATTRIBUTE = re.compile(r"\b(href|src|action|formAction)=\{")
ASSIGNMENT = re.compile(r"\.(href|src)\s*=(?!=)\s*([^;\n]+)")


def source_files():
    for path in sorted(FRONTEND_SRC.rglob("*")):
        if path.suffix not in {".js", ".jsx"} or ".test." in path.name or path.name == "setupTests.js":
            continue
        yield path


def braced(text, start):
    """The expression inside {...} that opens at text[start - 1]."""
    depth, i = 1, start
    while depth and i < len(text):
        depth += {"{": 1, "}": -1}.get(text[i], 0)
        i += 1
    return text[start:i - 1]


def strip_comments(text):
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    return re.sub(r"(?m)^\s*//.*$", "", text)


def find_problems():
    problems = []

    for path in source_files():
        rel = path.relative_to(FRONTEND_SRC).as_posix()
        text = strip_comments(path.read_text(encoding="utf-8"))

        for label, pattern in BANNED.items():
            if re.search(pattern, text, flags=re.I if label == "srcDoc" else 0):
                problems.append(f"{rel}: {label}")

        if rel != "safeUrl.js":
            for label, pattern in ONLY_IN_SAFEURL.items():
                if re.search(pattern, text):
                    problems.append(f"{rel}: {label} outside safeUrl.js")

        expressions = [(m.group(1), braced(text, m.end())) for m in ATTRIBUTE.finditer(text)]
        expressions += [(m.group(1), m.group(2)) for m in ASSIGNMENT.finditer(text)]

        for attribute, expr in expressions:
            compact = re.sub(r"\s+", "", expr)
            if rel == "safeUrl.js" or SAFE_CALL.match(compact):
                continue
            if (rel, compact) in REVIEWED:
                continue
            # The UI kit's action={...} prop (EmptyState) takes an element, not an address.
            if attribute == "action" and re.search(r"<[A-Za-z]", compact):
                continue
            problems.append(f"{rel}: unreviewed address expression {expr.strip()!r}")

    return problems


def test_no_unreviewed_xss_sinks():
    assert FRONTEND_SRC.is_dir()
    problems = find_problems()
    assert problems == [], "\n".join(problems)


def test_the_check_catches_new_sinks(tmp_path, monkeypatch):
    bad = tmp_path / "components"
    bad.mkdir()
    (bad / "Bad.jsx").write_text(
        "export default function Bad({ ngo, html }) {\n"
        "  window.open(ngo.url);\n"
        "  return <div><a href={ngo.website_url}>x</a>\n"
        "  <div dangerouslySetInnerHTML={{ __html: html }} /></div>;\n"
        "}\n"
    )
    (bad / "Good.jsx").write_text(
        "export default function Good({ ngo }) {\n"
        "  return <a href={safeExternalUrl(ngo.website_url)}>x</a>;\n"
        "}\n"
    )
    monkeypatch.setattr(__import__(__name__), "FRONTEND_SRC", tmp_path)
    problems = find_problems()
    assert problems == [
        "components/Bad.jsx: dangerouslySetInnerHTML",
        "components/Bad.jsx: window.open outside safeUrl.js",
        "components/Bad.jsx: unreviewed address expression 'ngo.website_url'",
    ]
