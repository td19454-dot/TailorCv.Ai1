# Resume Templates - Complete Package

## Overview
This package contains **5 HTML templates** and **3 CSS stylesheets** for creating professional resumes. All URLs and links are displayed as visible text in the format `label: url`.

## Package Contents

```
resume-templates/
├── html/
│   ├── template1.html    # Traditional Single Column
│   ├── template2.html    # Skills First Layout
│   ├── template3.html    # Projects First Layout
│   ├── template4.html    # Compact Layout
│   └── template5.html    # Experience Focused Layout
├── css/
│   ├── style1.css        # Professional Blue Theme
│   ├── style2.css        # Modern Minimalist Theme
│   └── style3.css        # Classic Elegant Theme
├── sample_data.json      # Sample JSON data structure
└── README.md            # This file
```

## Template Descriptions

### HTML Templates (5 Layouts)

#### Template 1: Traditional Single Column
- **Best for:** General purpose, corporate positions
- **Section order:** Summary → Experience → Projects → Skills → Education → Achievements → Extracurriculars

#### Template 2: Skills First Layout
- **Best for:** Technical roles where skills are the primary selling point
- **Section order:** Summary → Skills → Experience → Education → Projects → Achievements → Extracurriculars

#### Template 3: Projects First Layout
- **Best for:** Portfolio-based applications, developer positions, startups
- **Section order:** About Me → Education → Projects → Experience → Skills → Achievements → Leadership

#### Template 4: Compact Layout
- **Best for:** One-page resumes, space-efficient designs
- **Section order:** Summary → Skills → Experience → Projects → Education → Achievements → Leadership
- **Special features:** Uses pipe separators (|) for compact display

#### Template 5: Experience Focused Layout
- **Best for:** Experienced professionals, management roles
- **Section order:** Profile → Experience → Projects → Education → Skills → Leadership → Achievements

### CSS Themes (3 Styles)

#### Style 1: Professional Blue
- **Color scheme:** Blue gradient header (#1e3c72 to #2a5298)
- **Typography:** Segoe UI, clean and readable
- **Best for:** Corporate jobs, finance, consulting
- **Bullet style:** Triangular arrows (▸)

#### Style 2: Modern Minimalist
- **Color scheme:** White with green accents (#27ae60)
- **Typography:** Inter/Helvetica, contemporary
- **Best for:** Tech startups, design agencies, modern companies
- **Bullet style:** Simple dots (•)
- **Special feature:** Left border accent line

#### Style 3: Classic Elegant
- **Color scheme:** Dark header (#2c2c2c) with gold accents (#d4af37)
- **Typography:** Georgia serif, sophisticated
- **Best for:** Law firms, academia, publishing, luxury brands
- **Bullet style:** Diamond shapes (◆)

## URL Display Format

All links are displayed as plain text in the format:

```
Email: user@example.com
GitHub: https://github.com/username
LinkedIn: https://linkedin.com/in/username
Website: https://example.com
```

This ensures all contact information and links are **fully visible** on the resume for easy copying by recruiters.

## JSON Data Structure

```json
{
  "name": "Full Name",
  "contact": {
    "email": "email@example.com",
    "phone": "+1234567890",
    "address": "City, State",
    "linkedin": "https://linkedin.com/in/username",
    "github": "https://github.com/username",
    "portfolio": "https://portfolio.com",
    "kaggle": "https://kaggle.com/username",
    "leetcode": "https://leetcode.com/username",
    "codeforces": "https://codeforces.com/username",
    "codechef": "https://codechef.com/username",
    "google_scholar": "https://scholar.google.com/..."
  },
  "summary": "Professional summary text...",
  "experience": [
    {
      "title": "Job Title",
      "company": "Company Name",
      "dates": "Jan 2020 - Present",
      "bullets": [
        "Achievement or responsibility 1",
        "Achievement or responsibility 2"
      ]
    }
  ],
  "projects": [
    {
      "name": "Project Name",
      "github": "https://github.com/user/repo",
      "url": "https://project-demo.com",
      "bullets": [
        "Project description or achievement 1",
        "Project description or achievement 2"
      ]
    }
  ],
  "skills": [
    "Category: Skill1, Skill2, Skill3",
    "Category: Skill4, Skill5"
  ],
  "education": [
    {
      "degree": "Bachelor of Science in Computer Science",
      "school": "University Name",
      "year": "2020-2024",
      "links": ""
    }
  ],
  "certifications": [
    {
      "name": "Certification Name",
      "issuer": "Issuing Organization",
      "year": "2023",
      "url": "https://cert-link.com"
    }
  ],
  "achievements": [
    "Achievement 1",
    "Achievement 2"
  ],
  "extracurriculars": [
    {
      "role": "President",
      "organization": "Student Club",
      "url": "https://club-website.com",
      "bullets": [
        "Leadership activity 1",
        "Leadership activity 2"
      ]
    }
  ],
  "publications": [
    {
      "title": "Paper Title",
      "publisher": "Conference/Journal Name",
      "year": "2023",
      "url": "https://paper-link.com"
    }
  ]
}
```

## Integration with Flask

```python
from flask import Flask, render_template_string
from jinja2 import Environment, FileSystemLoader
import json

app = Flask(__name__)
env = Environment(loader=FileSystemLoader('resume-templates/html'))

@app.route('/resume/<int:template_id>/<int:style_id>')
def generate_resume(template_id, style_id):
    # Validate IDs
    if template_id not in range(1, 6) or style_id not in range(1, 4):
        return "Invalid template or style", 400
    
    # Load resume data from your database or JSON
    with open('user_resume_data.json', 'r') as f:
        resume_data = json.load(f)
    
    # Load template and CSS
    template = env.get_template(f'template{template_id}.html')
    
    with open(f'resume-templates/css/style{style_id}.css', 'r') as f:
        css_content = f.read()
    
    # Render template
    html_output = template.render(**resume_data)
    
    # Inject CSS
    html_output = html_output.replace(
        '<link rel="stylesheet" href="STYLESHEET_PLACEHOLDER">',
        f'<style>{css_content}</style>'
    )
    
    return html_output
```

## Integration with FastAPI

```python
from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse
from jinja2 import Environment, FileSystemLoader
import json

app = FastAPI()
env = Environment(loader=FileSystemLoader('resume-templates/html'))

@app.get("/resume/{template_id}/{style_id}", response_class=HTMLResponse)
async def generate_resume(template_id: int, style_id: int):
    if template_id not in range(1, 6) or style_id not in range(1, 4):
        raise HTTPException(status_code=400, detail="Invalid template or style")
    
    # Load resume data
    with open('user_resume_data.json', 'r') as f:
        resume_data = json.load(f)
    
    # Load and process templates
    template = env.get_template(f'template{template_id}.html')
    
    with open(f'resume-templates/css/style{style_id}.css', 'r') as f:
        css_content = f.read()
    
    html_output = template.render(**resume_data)
    html_output = html_output.replace(
        '<link rel="stylesheet" href="STYLESHEET_PLACEHOLDER">',
        f'<style>{css_content}</style>'
    )
    
    return html_output
```

## Quick Test

To test a template:

1. Open any HTML template file
2. Replace `STYLESHEET_PLACEHOLDER` with the path to a CSS file
3. Replace Jinja2 variables ({{ }}) with actual data
4. Open in browser

Or use the included `sample_data.json` with the integration code above.

## Customization

### Changing Colors
Edit the CSS files and search for hex color codes:
- Style 1 (Blue): `#1e3c72`, `#2a5298`
- Style 2 (Green): `#27ae60`
- Style 3 (Gold): `#d4af37`

### Modifying Section Order
Reorder the `<section>` blocks in the HTML templates.

### Adding New Sections
1. Add data to your JSON
2. Add a new section in HTML template:
```html
{% if new_section and new_section|length > 0 %}
<section class="section">
    <h2 class="section-title">New Section</h2>
    <!-- Your content here -->
</section>
{% endif %}
```

## Print & PDF Export

All templates are print-optimized. To generate PDF:
1. Open the resume in a browser
2. Press Ctrl+P (Cmd+P on Mac)
3. Select "Save as PDF"
4. Adjust margins if needed

## All 15 Combinations

| # | Template | Style | Best Use Case |
|---|----------|-------|---------------|
| 1 | Traditional | Professional Blue | Corporate/Traditional |
| 2 | Traditional | Modern Minimalist | Tech/Startup |
| 3 | Traditional | Classic Elegant | Legal/Academia |
| 4 | Skills First | Professional Blue | Technical Roles |
| 5 | Skills First | Modern Minimalist | Developer Jobs |
| 6 | Skills First | Classic Elegant | Senior Technical |
| 7 | Projects First | Professional Blue | Portfolio/Developer |
| 8 | Projects First | Modern Minimalist | Creative Tech |
| 9 | Projects First | Classic Elegant | Research/Publications |
| 10 | Compact | Professional Blue | One-page Corporate |
| 11 | Compact | Modern Minimalist | Startup Applications |
| 12 | Compact | Classic Elegant | Executive Summary |
| 13 | Experience Focused | Professional Blue | Senior Positions |
| 14 | Experience Focused | Modern Minimalist | Career Changers |
| 15 | Experience Focused | Classic Elegant | Leadership Roles |

## Features

✅ **Visible URLs** - All links displayed as text (label: url)
✅ **Jinja2 Templates** - Easy integration with Python backends
✅ **Responsive Design** - Works on all screen sizes
✅ **Print Friendly** - Optimized for PDF generation
✅ **No Dependencies** - Self-contained HTML/CSS
✅ **15 Combinations** - 5 layouts × 3 themes
✅ **Clean Code** - Well-organized and commented
✅ **Professional** - Production-ready designs

## Browser Compatibility

✅ Chrome/Edge (Chromium)
✅ Firefox
✅ Safari
✅ Opera

## License

These templates are provided for your resume optimizer web application. Feel free to modify and customize as needed.

## Support

For issues or questions:
1. Check that JSON data matches the expected format
2. Ensure Jinja2 syntax is correct
3. Verify CSS files are loaded properly
4. Test with the included `sample_data.json` first
