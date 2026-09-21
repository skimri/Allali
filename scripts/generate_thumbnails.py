"""Generate lightweight gallery previews and wire them into gallery pages."""

from pathlib import Path
from urllib.parse import unquote
import re

from PIL import Image, ImageOps


ROOT = Path(__file__).resolve().parents[1]
GALLERY_PAGES = sorted((ROOT / "gallery").glob("*/index.html"))
EXTRA_SOURCES = [
    ROOT / "assets" / "img" / "Model drawing" / "IMG_0668.JPG-cover.webp",
]
IMAGE_PATTERN = re.compile(r'<img src="([^"]+\.webp)"(?![^>]*data-full-src)([^>]*)>')


def make_thumbnail(source: Path) -> Path:
    destination = source.with_name(f"{source.stem}.thumb.webp")
    with Image.open(source) as opened:
        image = ImageOps.exif_transpose(opened)
        image.thumbnail((800, 800), Image.Resampling.LANCZOS)
        image.save(destination, "WEBP", quality=72, method=6)
    return destination


created = set()

for source in EXTRA_SOURCES:
    created.add(make_thumbnail(source))

for page in GALLERY_PAGES:
    html = page.read_text(encoding="utf-8")

    def replace_image(match: re.Match[str]) -> str:
        relative_source = match.group(1)
        source = (page.parent / unquote(relative_source)).resolve()
        if not source.is_relative_to(ROOT / "assets" / "img") or not source.exists():
            return match.group(0)

        thumbnail = make_thumbnail(source)
        created.add(thumbnail)
        relative_thumbnail = relative_source.removesuffix(".webp") + ".thumb.webp"
        attributes = match.group(2).rstrip().removesuffix("/").rstrip()
        return (
            f'<img src="{relative_thumbnail}" data-full-src="{relative_source}"'
            f'{attributes} decoding="async" />'
        )

    updated = IMAGE_PATTERN.sub(replace_image, html)
    if updated != html:
        page.write_text(updated, encoding="utf-8", newline="")

print(f"Generated {len(created)} gallery thumbnails")
