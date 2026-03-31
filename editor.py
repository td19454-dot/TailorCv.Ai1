import fitz  # PyMuPDF

# ---------- CONFIG ----------
MAX_FONT_REDUCTION = 7     # how much font can shrink
MIN_FONT_SIZE = 3
DEFAULT_FONT = "helv"


# ---------- TEXT FITTER ----------
def fit_text(page, rect, text, base_fontsize=11):
    """
    Insert text into rect and auto-shrink if overflow.
    """
    fontsize = base_fontsize
    
    while fontsize>=MIN_FONT_SIZE:
        overflow = page.insert_textbox(
            rect,
            text,
            fontsize=fontsize,
            fontname=DEFAULT_FONT,
            align=fitz.TEXT_ALIGN_LEFT,
            color=(0, 0, 0)  # Ensure black text
        )
        
        if overflow >= 0:
            return True
        
        fontsize -= 0.5

    return False


# ---------- REWRITE FUNCTION ----------
def rewrite_resume(
    input_pdf,
    output_pdf,
    rewrite_map
):
    """
    rewrite_map = {
        "old phrase": "new phrase",
        ...
    }
    """

    doc = fitz.open(input_pdf)
    
    # First pass: mark all text blocks for redaction
    replacements = []  # Store rect and new text for later
    
    for page in doc:
        blocks = page.get_text("blocks")

        for block in blocks:
            x0, y0, x1, y1, text, *_ = block
            text=text.strip()
            # print(f"text:'{text}' ")
            
            if not text.strip():
                continue

            for old, new in rewrite_map.items():
                if old in text:
                    rect = fitz.Rect(x0, y0, x1, y1)
                    
                    # Mark for redaction
                    page.add_redact_annot(rect, fill=(1, 1, 1))
                    replacements.append((page, rect, new))
                    print(replacements)
                    break
                
    
    # Apply all redactions
    for page in doc:
        page.apply_redactions()
    
    # Second pass: insert new text
    for page, rect, new in replacements:
        success = fit_text(page, rect, new)

        # Fallback with explicit color
        if not success:
            page.insert_textbox(
                rect,
                new[:200],
                fontsize=16,
                fontname=DEFAULT_FONT,
                color=(0, 0, 0)
            )

    doc.save(output_pdf, garbage=4, deflate=True)
    doc.close()
rewrite_map = {
    "Transcribed 50+ audio and video files to provide quality training and test data.":
    " Transcribed 1000+ audio and video files to provide quality training and test data.", 

    "Deployed the pipeline on AWS using Docker and exposed predictions via Flask REST APIs, enabling scalable and reproducible inference.":
    "Deployed the pipeline on AWS using Docker and exposed predictions via Fast API, enabling scalable and reproducible inference."
}

rewrite_resume(
    "resume.pdf",
    "optimized_resume.pdf",
    rewrite_map
)