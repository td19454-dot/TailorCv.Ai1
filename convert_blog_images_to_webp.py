"""Convert blog cover images from PNG (or JPG) to WebP.

Workflow:
  1. Drop your images into public/blog-images/, named exactly after the post slug,
     e.g. public/blog-images/how-to-pass-ats-in-2026.png
  2. Run:  python convert_blog_images_to_webp.py
  3. Each PNG/JPG becomes a matching .webp (same basename) that the blog frontmatter
     already points at (image: public/blog-images/<slug>.webp).

Options:
  --dir PATH     folder to scan (default: public/blog-images)
  --quality N    WebP quality 1-100 (default: 82)
  --max-width N  downscale images wider than N px (default: 1600; 0 = no resize)
  --keep         keep the original PNG/JPG (default: keep; use --delete to remove)
  --delete       delete the source PNG/JPG after a successful conversion
  --overwrite    re-convert even if the .webp already exists
"""

import argparse
import os
import sys

try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow is required.  Install it with:  pip install Pillow")

SOURCE_EXTS = (".png", ".jpg", ".jpeg")


def convert_one(src_path, quality, max_width, overwrite):
    base, _ = os.path.splitext(src_path)
    webp_path = base + ".webp"

    if os.path.exists(webp_path) and not overwrite:
        return "skip", webp_path, "already exists (use --overwrite)"

    try:
        img = Image.open(src_path)
        # Flatten transparency onto white so JPEG-style covers don't get black edges,
        # but keep alpha if the image genuinely uses it.
        if img.mode in ("RGBA", "LA", "P"):
            img = img.convert("RGBA")
        else:
            img = img.convert("RGB")

        if max_width and img.width > max_width:
            new_h = round(img.height * max_width / img.width)
            img = img.resize((max_width, new_h), Image.LANCZOS)

        img.save(webp_path, "WEBP", quality=quality, method=6)
        return "ok", webp_path, f"{img.width}x{img.height}"
    except Exception as exc:  # noqa: BLE001 - report and continue
        return "error", webp_path, str(exc)


def main():
    ap = argparse.ArgumentParser(description="Convert blog PNG/JPG images to WebP.")
    ap.add_argument("--dir", default="public/blog-images")
    ap.add_argument("--quality", type=int, default=82)
    ap.add_argument("--max-width", type=int, default=1600)
    ap.add_argument("--delete", action="store_true", help="delete source after conversion")
    ap.add_argument("--overwrite", action="store_true")
    args = ap.parse_args()

    if not os.path.isdir(args.dir):
        sys.exit(f"Folder not found: {args.dir}")

    sources = [
        os.path.join(args.dir, f)
        for f in sorted(os.listdir(args.dir))
        if f.lower().endswith(SOURCE_EXTS)
    ]

    if not sources:
        print(f"No PNG/JPG files found in {args.dir}. Nothing to do.")
        return

    counts = {"ok": 0, "skip": 0, "error": 0}
    for src in sources:
        status, webp_path, detail = convert_one(src, args.quality, args.max_width, args.overwrite)
        counts[status] += 1
        name = os.path.basename(webp_path)
        if status == "ok":
            print(f"  converted  {name:<52} {detail}")
            if args.delete:
                os.remove(src)
        elif status == "skip":
            print(f"  skipped    {name:<52} {detail}")
        else:
            print(f"  ERROR      {name:<52} {detail}")

    print(f"\nDone. {counts['ok']} converted, {counts['skip']} skipped, {counts['error']} errors.")


if __name__ == "__main__":
    main()
