# Quick Start Guide

## What You Have

✅ **5 HTML Templates** - Different layout structures
✅ **3 CSS Stylesheets** - Different visual themes  
✅ **Sample JSON Data** - Based on your actual resume
✅ **Complete Documentation** - Integration examples included

## Key Feature: Visible URLs

All links are displayed as plain text in the format:

```
Email: user@example.com
GitHub: https://github.com/username
LinkedIn: https://linkedin.com/in/username
Website: https://example.com
```

No embedded hyperlinks - everything is fully visible for easy copying by recruiters.

## Files Structure

```
resume-templates/
├── html/
│   ├── template1.html  → Traditional Single Column
│   ├── template2.html  → Skills First Layout
│   ├── template3.html  → Projects First Layout
│   ├── template4.html  → Compact Layout
│   └── template5.html  → Experience Focused Layout
├── css/
│   ├── style1.css      → Professional Blue Theme
│   ├── style2.css      → Modern Minimalist Theme
│   └── style3.css      → Classic Elegant Theme
├── sample_data.json    → Your resume data
└── README.md           → Full documentation
```

## How to Use in Your Backend

### Step 1: Install Jinja2
```bash
pip install jinja2
```

### Step 2: Basic Flask Example
```python
from jinja2 import Template
import json

# Load your user's resume data
with open('user_data.json', 'r') as f:
    resume_data = json.load(f)

# Load template
with open('resume-templates/html/template1.html', 'r') as f:
    html_template = f.read()

# Load CSS
with open('resume-templates/css/style1.css', 'r') as f:
    css_content = f.read()

# Inject CSS into template
html_template = html_template.replace(
    '<link rel="stylesheet" href="STYLESHEET_PLACEHOLDER">',
    f'<style>{css_content}</style>'
)

# Render with Jinja2
template = Template(html_template)
final_html = template.render(**resume_data)

# Return or save
print(final_html)
```

### Step 3: Choose Your Combination

Pick any combination of template (1-5) and style (1-3):

| Template | Style | Result |
|----------|-------|--------|
| template1.html | style1.css | Traditional + Professional Blue |
| template1.html | style2.css | Traditional + Modern Minimalist |
| template3.html | style2.css | Projects First + Modern Minimalist |
| template4.html | style1.css | Compact + Professional Blue |
| template5.html | style3.css | Experience + Classic Elegant |

## JSON Data Format

Your JSON should follow this structure:

```json
{
  "name": "John Doe",
  "contact": {
    "email": "john@example.com",
    "github": "https://github.com/johndoe",
    "linkedin": "https://linkedin.com/in/johndoe"
  },
  "summary": "Professional summary...",
  "experience": [...],
  "projects": [...],
  "skills": [...],
  "education": [...],
  "achievements": [...],
  "extracurriculars": [...]
}
```

See `sample_data.json` for complete example.

## Testing a Template

**Option 1: Manual Test**
1. Open any HTML file in a text editor
2. Replace `{{ name }}` with actual name
3. Replace `STYLESHEET_PLACEHOLDER` with CSS file path
4. Open in browser

**Option 2: With Python Script**
```python
from jinja2 import Template
import json

with open('sample_data.json') as f:
    data = json.load(f)

with open('html/template1.html') as f:
    html = f.read()

with open('css/style1.css') as f:
    css = f.read()

html = html.replace('STYLESHEET_PLACEHOLDER', f'<style>{css}</style>')
output = Template(html).render(**data)

with open('test_resume.html', 'w') as f:
    f.write(output)

print("✅ Test resume created: test_resume.html")
```

## Customization Tips

### Change Colors
Edit CSS files:
- **Blue theme:** Search for `#1e3c72` and `#2a5298`
- **Green theme:** Search for `#27ae60`  
- **Gold theme:** Search for `#d4af37`

### Reorder Sections
Move `<section>` blocks in HTML templates.

### Add New Fields
1. Add to JSON data
2. Add to HTML template:
```html
{% if new_field %}
  <div>{{ new_field }}</div>
{% endif %}
```

## Generate PDF

1. Render HTML in browser
2. Press Ctrl+P (Cmd+P on Mac)
3. Select "Save as PDF"
4. Done!

## 15 Total Combinations

You can create 15 unique resume designs:

**Professional Blue (style1.css):**
- Template 1, 2, 3, 4, 5

**Modern Minimalist (style2.css):**
- Template 1, 2, 3, 4, 5

**Classic Elegant (style3.css):**
- Template 1, 2, 3, 4, 5

## Need Help?

Check `README.md` for:
- Complete JSON structure
- Detailed Flask/FastAPI integration
- All customization options
- Troubleshooting tips

## Quick Tips

✅ Always use UTF-8 encoding for HTML files
✅ Test with sample_data.json first
✅ URLs will be plain text (not clickable) - this is intentional
✅ All templates are print-optimized
✅ Templates work offline (no external dependencies)

---

**Ready to integrate?** Check out the complete examples in `README.md`!
