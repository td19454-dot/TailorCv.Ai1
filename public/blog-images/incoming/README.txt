DROP NEW BLOG IMAGES HERE
=========================

Put images in this folder, then tell Claude which blog post each one
belongs to (or just what it shows) and Claude will convert it to WebP,
copy it into public/blog-images/, and insert it into the post.

CLAUDE MUST NEVER DELETE OR MOVE ANYTHING IN THIS FOLDER.
Originals stay here until Trisha removes them herself. Claude copies
out, never moves out.

Formats: PNG/JPG/WebP all fine. Converted at quality 95, max 1800px
wide, which keeps UI text sharp in the ~800px article column.

RESUME TEMPLATE RE-EXPORTS (wanted)
-----------------------------------
The 22 template previews (static/pic1.webp ... pic22.webp) are only
487-649px wide, so they blur when shown large in a blog post. If you
re-export them at ~1200-1600px wide and drop them here named
pic1.png, pic2.png ... (matching the existing numbers), Claude will
convert them at quality 95 and swap them in - then the preview can be
shown big AND stay sharp.

Until then the CSS caps each preview at its own natural width, so it is
smaller but never blurry.

PENDING RE-CAPTURE
------------------
AFTERINTERVIEWSCORECARD.png - the version supplied shows 0% on every
metric with "Interview incomplete, you answered 0% of questions".
Publishing that would make the feature look broken, so it is converted
(public/blog-images/mock-interview-scorecard.webp) but NOT placed in any
post yet. Run one mock interview to the end, screenshot the real
scorecard, drop it here under the same name, and it gets swapped in and
published across the interview posts.

STILL WANTED
------------
A portfolio screenshot - the builder, or a published portfolio page.
40 portfolio posts currently have no product screenshot at all, the
biggest remaining gap.
