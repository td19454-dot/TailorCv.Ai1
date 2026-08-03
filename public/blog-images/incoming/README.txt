DROP NEW BLOG IMAGES HERE
=========================

Put images in this folder, then tell Claude which blog post each one
belongs to (post slug or title) and roughly where in the article it
should sit. Claude will move it to public/blog-images/ and insert it
into the post's markdown.

Naming: anything is fine here - it gets renamed to match the target
post's slug on the way out (e.g. ats-resume-checklist-2026-step3.webp).

Formats: .webp preferred (smallest). .png and .jpg are fine and can be
converted with convert_blog_images_to_webp.py.

This folder is a staging area only - nothing here is served to readers
until it has been placed into a post.
