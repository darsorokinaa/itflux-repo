#!/usr/bin/env python3
"""
Scraper for FIPI OGE Mathematics Open Task Bank.
Fetches all tasks, extracts HTML and LaTeX content, saves to JSON.

Usage:
    python fipi_scraper.py --base-url https://oge.fipi.ru/bank --test
    python fipi_scraper.py --base-url https://oge.fipi.ru/bank
    python fipi_scraper.py --base-url https://oge.fipi.ru/bank --pagesize 50 --delay 0.5
"""

import requests
from bs4 import BeautifulSoup
import json
import time
import re
import argparse
from pathlib import Path
from typing import Optional

# ── Configuration ─────────────────────────────────────────────────────────────
PROJECT_ID = "DE0E276E497AB3784C3FC4CC20248DC0"
PAGESIZE = 10
TOTAL_TASKS = 3884
OUTPUT_DIR = Path("fipi_output")
DELAY = 1.0  # seconds between requests


# ── HTTP session ──────────────────────────────────────────────────────────────
def make_session(base_url: str, verify_ssl: bool = True) -> requests.Session:
    s = requests.Session()
    s.verify = verify_ssl
    if not verify_ssl:
        import urllib3
        urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
    s.headers.update({
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/124.0.0.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8",
        "Referer": f"{base_url}/index.php?crproj={PROJECT_ID}",
    })
    # Seed cookies by visiting the index page
    try:
        s.get(f"{base_url}/index.php?crproj={PROJECT_ID}", timeout=20)
    except Exception:
        pass
    return s


def fetch_page(session: requests.Session, base_url: str, page: int, pagesize: int) -> Optional[str]:
    url = f"{base_url}/questions.php"
    params = {
        "proj": PROJECT_ID,
        "page": page,
        "pagesize": pagesize,
        "search": "1",
    }
    try:
        r = session.get(url, params=params, timeout=30)
        r.raise_for_status()
        # FIPI pages are windows-1251; let requests auto-detect from headers
        if "charset" not in (r.headers.get("Content-Type") or "").lower():
            r.encoding = "windows-1251"
        return r.text
    except requests.RequestException as e:
        print(f"  [!] request error on page {page}: {e}")
        return None


# ── LaTeX extraction helpers ──────────────────────────────────────────────────
def _mathjax_scripts_to_latex(soup: BeautifulSoup) -> list[str]:
    """Extract LaTeX from MathJax <script type='math/tex'> tags."""
    parts = []
    for tag in soup.find_all("script", type=re.compile(r"math/tex", re.I)):
        formula = (tag.string or "").strip()
        if not formula:
            continue
        if "display" in (tag.get("type") or "").lower():
            parts.append(f"\\[{formula}\\]")
        else:
            parts.append(f"${formula}$")
    return parts


def _katex_spans_to_latex(soup: BeautifulSoup) -> list[str]:
    """Extract LaTeX from KaTeX annotation spans."""
    parts = []
    for ann in soup.find_all("annotation", encoding="application/x-tex"):
        formula = (ann.string or "").strip()
        if formula:
            parts.append(f"${formula}$")
    return parts


def _inline_dollar_patterns(text: str) -> str:
    """Normalise \\( \\) and \\[ \\] to $ and $$ in plain text."""
    text = re.sub(r"\\\((.*?)\\\)", r"$\1$", text, flags=re.DOTALL)
    text = re.sub(r"\\\[(.*?)\\\]", r"$$\1$$", text, flags=re.DOTALL)
    return text


def element_to_latex(el) -> str:
    """Best-effort LaTeX representation of a BeautifulSoup element."""
    latex_parts = _mathjax_scripts_to_latex(el) or _katex_spans_to_latex(el)
    if latex_parts:
        return " ".join(latex_parts)
    # Fallback: plain text with inline-math normalisation
    return _inline_dollar_patterns(el.get_text(separator=" ", strip=True))


# ── Task parser ───────────────────────────────────────────────────────────────
def _find_task_containers(soup: BeautifulSoup):
    """Try several CSS patterns used by FIPI to locate individual task blocks."""
    candidates = [
        soup.find_all(class_=re.compile(r"\bq-block\b")),
        soup.find_all(class_=re.compile(r"\bquestion[-_]block\b", re.I)),
        soup.find_all(class_=re.compile(r"\btask[-_]block\b", re.I)),
        soup.find_all("div", attrs={"data-qid": True}),
        soup.find_all("div", attrs={"data-id": True}),
        # Generic fallback: numbered divs that look like task containers
        soup.find_all(class_=re.compile(r"\bitem\b", re.I)),
    ]
    for group in candidates:
        if group:
            return group
    return []


def parse_task(el, base_url: str) -> dict:
    task: dict = {}

    # ── IDs ──
    for attr in ("data-qid", "data-id", "id"):
        val = el.get(attr)
        if val:
            task["id"] = val
            break

    # ── Raw HTML ──
    task["html"] = str(el)

    # ── Clean text ──
    # Remove MathJax script tags from visible text but keep their alt text
    for s in el.find_all("script"):
        s.decompose()
    task["text"] = re.sub(r"\s{2,}", " ", el.get_text(separator=" ", strip=True))

    # ── LaTeX ──
    # Re-parse from the stored HTML (scripts already removed from `el` above)
    el2 = BeautifulSoup(task["html"], "html.parser")
    task["latex"] = element_to_latex(el2)

    # ── Images ──
    imgs = []
    for img in el2.find_all("img"):
        src = img.get("src", "")
        if src and not src.startswith("data:"):
            # Make absolute
            if src.startswith("http"):
                abs_src = src
            else:
                abs_src = base_url.rstrip("/") + "/" + src.lstrip("/")
            imgs.append({"src": abs_src, "alt": img.get("alt", "")})
    if imgs:
        task["images"] = imgs

    # ── Answer options ──
    opts = []
    for opt_el in el2.find_all(class_=re.compile(r"answer|option|variant|choice", re.I)):
        t = opt_el.get_text(strip=True)
        if t and t not in opts:
            opts.append(t)
    if opts:
        task["options"] = opts

    # ── Question type from class names ──
    cls = " ".join(el.get("class") or [])
    for qtype in ("SELECTONE", "SELECTN", "SHORT", "FULL", "ACCORD"):
        if qtype.lower() in cls.lower():
            task["qtype"] = qtype
            break

    return task


def parse_questions_page(html: str, base_url: str, save_raw: Path = None) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")

    if save_raw:
        save_raw.write_text(html, encoding="utf-8")
        print(f"\n  [debug] full HTML saved → {save_raw}")

    containers = _find_task_containers(soup)

    if not containers:
        return [{"parse_error": "no task containers found", "raw_html": html}]

    return [parse_task(c, base_url) for c in containers]


# ── Main loop ─────────────────────────────────────────────────────────────────
def scrape(base_url: str, total: int, pagesize: int, delay: float,
           output_file: Path, test_only: bool = False,
           verify_ssl: bool = True) -> list[dict]:
    output_file.parent.mkdir(parents=True, exist_ok=True)
    session = make_session(base_url, verify_ssl=verify_ssl)

    total_pages = (total + pagesize - 1) // pagesize
    if test_only:
        total_pages = 1
        print("[test mode] fetching only page 1")

    all_tasks: list[dict] = []

    for page_num in range(total_pages):
        print(f"  page {page_num + 1}/{total_pages} … ", end="", flush=True)
        html = fetch_page(session, base_url, page_num, pagesize)
        if not html:
            print("skip (error)")
            time.sleep(delay * 2)
            continue

        save_raw = (output_file.parent / "page0_debug.html") if (test_only and page_num == 0) else None
        tasks = parse_questions_page(html, base_url, save_raw=save_raw)
        all_tasks.extend(tasks)
        print(f"{len(tasks)} tasks  (total {len(all_tasks)})")

        # Periodic save every 20 pages
        if (page_num + 1) % 20 == 0:
            _save(all_tasks, output_file)

        if page_num < total_pages - 1:
            time.sleep(delay)

    _save(all_tasks, output_file)
    return all_tasks


def _save(tasks: list[dict], path: Path):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(tasks, f, ensure_ascii=False, indent=2)
    print(f"  → saved {len(tasks)} tasks to {path}")


# ── Debug: inspect raw HTML structure ─────────────────────────────────────────
def inspect_first_page(base_url: str, raw_file: Path, verify_ssl: bool = True):
    """Fetch page 0 and dump raw HTML so you can see the actual structure."""
    session = make_session(base_url, verify_ssl=verify_ssl)
    html = fetch_page(session, base_url, 0, 10)
    if not html:
        print("Failed to fetch first page.")
        return
    raw_file.parent.mkdir(parents=True, exist_ok=True)
    raw_file.write_text(html, encoding="utf-8")
    print(f"Raw HTML saved to {raw_file}  — open it to inspect task element structure.")
    soup = BeautifulSoup(html, "html.parser")
    print("\nTop-level div classes found:")
    seen = set()
    for d in soup.find_all("div"):
        cls = tuple(d.get("class") or ())
        if cls and cls not in seen:
            seen.add(cls)
            print("  ", " ".join(cls))
        if len(seen) > 30:
            break


# ── CLI ───────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Scrape FIPI OGE math task bank")
    ap.add_argument(
        "--base-url",
        required=True,
        help="Base URL, e.g. https://oge.fipi.ru/bank",
    )
    ap.add_argument("--total", type=int, default=TOTAL_TASKS,
                    help="Total tasks to scrape (default: 3884)")
    ap.add_argument("--pagesize", type=int, default=PAGESIZE,
                    help="Tasks per page (default: 10, max depends on server)")
    ap.add_argument("--delay", type=float, default=DELAY,
                    help="Seconds between requests (default: 1.0)")
    ap.add_argument("--output", default=str(OUTPUT_DIR / "tasks.json"),
                    help="Output JSON path")
    ap.add_argument("--test", action="store_true",
                    help="Fetch only the first page and exit")
    ap.add_argument("--inspect", action="store_true",
                    help="Dump raw first-page HTML to fipi_output/page0.html and show div classes")
    ap.add_argument("--no-verify-ssl", action="store_true",
                    help="Disable SSL certificate verification (fixes macOS cert errors)")
    args = ap.parse_args()

    out = Path(args.output)
    verify_ssl = not args.no_verify_ssl

    if args.inspect:
        inspect_first_page(args.base_url, out.parent / "page0.html", verify_ssl=verify_ssl)
    else:
        tasks = scrape(
            base_url=args.base_url,
            total=args.total,
            pagesize=args.pagesize,
            delay=args.delay,
            output_file=out,
            test_only=args.test,
            verify_ssl=verify_ssl,
        )
        print(f"\nDone. {len(tasks)} tasks saved to {out}")
