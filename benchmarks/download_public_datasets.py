from __future__ import annotations

from http.cookiejar import MozillaCookieJar
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlparse
from urllib.request import HTTPSHandler, HTTPCookieProcessor, Request, build_opener
import argparse
import json
import re
import ssl
import time


DATASETS = {
    "calfw": {
        "name": "Cross-Age LFW",
        "googleDriveId": "1_cYgy7VFCy6JqkR8EvOxCVS02jHN1ozm",
        "sourceUrl": "http://whdeng.cn/CALFW/",
        "requiresCredential": False,
    },
    "cplfw": {
        "name": "Cross-Pose LFW",
        "googleDriveId": "1aInOZtuvKkiV-Gtitcv1-daZshL-8PAE",
        "sourceUrl": "http://whdeng.cn/CPLFW/",
        "requiresCredential": False,
    },
    "agedb": {
        "name": "AgeDB",
        "sourceUrl": "https://ibug.doc.ic.ac.uk/resources/agedb/",
        "requiresCredential": True,
        "note": "AgeDB download is password-protected by the dataset owner; request the ZIP password from the listed iBUG contact.",
    },
    "ytf": {
        "name": "YouTube Faces",
        "sourceUrl": "https://www.cs.tau.ac.il/~wolf/ytfaces/",
        "requiresCredential": True,
        "note": "YTF requires the official form/password and is large. Use a local copy with the Accuracy Lab runner.",
    },
}


def main() -> None:
    parser = argparse.ArgumentParser(description="Download benchmark datasets that expose unauthenticated official Google Drive files.")
    parser.add_argument("datasets", nargs="*", default=["calfw", "cplfw"])
    parser.add_argument("--output", default="benchmarks/public-data/downloads")
    parser.add_argument("--chunk-size", type=int, default=1024 * 1024)
    args = parser.parse_args()

    output = Path(args.output).expanduser().resolve()
    output.mkdir(parents=True, exist_ok=True)
    manifest: dict[str, object] = {"generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "datasets": []}
    for dataset_id in args.datasets:
        spec = DATASETS.get(dataset_id)
        if not spec:
            raise SystemExit(f"Unknown dataset: {dataset_id}")
        if spec.get("requiresCredential"):
            manifest["datasets"].append({"datasetId": dataset_id, "status": "manual", **spec})
            continue
        drive_id = str(spec["googleDriveId"])
        destination = output / f"{dataset_id}.download"
        try:
            result = download_google_drive_file(drive_id, destination, chunk_size=max(65536, int(args.chunk_size)))
        except Exception as exc:
            result = {"status": "error", "error": str(exc)[:1000]}
        result.update({"datasetId": dataset_id, **spec})
        manifest["datasets"].append(result)
    manifest_path = output / "public-dataset-downloads.json"
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps(manifest, indent=2))


def download_google_drive_file(file_id: str, destination: Path, *, chunk_size: int) -> dict[str, object]:
    cookies = MozillaCookieJar()
    opener = build_opener(HTTPCookieProcessor(cookies), HTTPSHandler(context=_ssl_context()))
    base = f"https://drive.google.com/uc?export=download&id={file_id}"
    response, body = _open(opener, base)
    content_type = response.headers.get("Content-Type", "")
    filename = _filename_from_response(response.headers.get("Content-Disposition", "")) or destination.name
    confirm_url = _confirm_url_from_response(response.geturl(), body)
    if confirm_url:
        response, body = _open(opener, confirm_url, preload=False)
        filename = _filename_from_response(response.headers.get("Content-Disposition", "")) or filename
        content_type = response.headers.get("Content-Type", content_type)
    if "text/html" in content_type.lower() and body:
        html = body.decode("utf-8", errors="ignore")
        raise RuntimeError(_drive_error_message(html) or "Google Drive returned HTML instead of a downloadable file.")
    final_destination = destination.with_name(_safe_filename(filename, fallback=destination.name))
    if final_destination.exists() and final_destination.stat().st_size > 0 and not _looks_like_html(final_destination):
        return {
            "status": "cached",
            "path": str(final_destination),
            "bytes": final_destination.stat().st_size,
            "source": response.geturl(),
        }
    temp = final_destination.with_suffix(final_destination.suffix + ".part")
    total = 0
    with temp.open("wb") as handle:
        if body:
            handle.write(body)
            total += len(body)
        while True:
            chunk = response.read(chunk_size)
            if not chunk:
                break
            handle.write(chunk)
            total += len(chunk)
    temp.replace(final_destination)
    if _looks_like_html(final_destination):
        html = final_destination.read_text(encoding="utf-8", errors="ignore")
        final_destination.unlink(missing_ok=True)
        raise RuntimeError(_drive_error_message(html) or "Google Drive returned HTML instead of a downloadable file.")
    return {"status": "downloaded", "path": str(final_destination), "bytes": total, "source": response.geturl()}


def _ssl_context() -> ssl.SSLContext:
    try:
        import certifi

        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        return ssl.create_default_context()


def _open(opener, url: str, *, preload: bool = True):
    request = Request(url, headers={"User-Agent": "Vintrace benchmark downloader"})
    response = opener.open(request, timeout=120)
    body = response.read(8192) if preload else b""
    return response, body


def _confirm_url_from_response(url: str, body: bytes) -> str:
    parsed = parse_qs(urlparse(url).query)
    for key in ("confirm", "download_warning"):
        values = parsed.get(key)
        if values:
            return f"{url}&confirm={values[0]}"
    text = body.decode("utf-8", errors="ignore")
    form = re.search(r'<form[^>]+action="([^"]+)"[^>]*>(.*?)</form>', text, flags=re.I | re.S)
    form_action = form.group(1) if form else ""
    form_body = form.group(2) if form else text
    hidden_inputs = dict(re.findall(r'<input[^>]+name="([^"]+)"[^>]+value="([^"]*)"', form_body, flags=re.I))
    if hidden_inputs.get("confirm"):
        action = form_action or "https://drive.usercontent.google.com/download"
        return f"{action}?{urlencode(hidden_inputs)}"
    match = re.search(r"confirm=([0-9A-Za-z_-]+)", text)
    return f"{url}&confirm={match.group(1)}" if match else ""


def _filename_from_response(disposition: str) -> str:
    match = re.search(r"filename\*?=(?:UTF-8'')?\"?([^\";]+)\"?", disposition)
    return match.group(1).strip() if match else ""


def _safe_filename(value: str, *, fallback: str) -> str:
    name = re.sub(r"[^A-Za-z0-9._ -]+", "_", value).strip(" ._")
    return name[:180] if name else fallback


def _drive_error_message(html: str) -> str:
    for pattern in (r"<title>(.*?)</title>", r"<p[^>]*class=\"uc-error-subcaption\"[^>]*>(.*?)</p>"):
        match = re.search(pattern, html, flags=re.I | re.S)
        if match:
            return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", match.group(1))).strip()
    return ""


def _looks_like_html(path: Path) -> bool:
    try:
        with path.open("rb") as handle:
            prefix = handle.read(256).lstrip().lower()
        return prefix.startswith(b"<!doctype html") or prefix.startswith(b"<html")
    except OSError:
        return False


if __name__ == "__main__":
    main()
