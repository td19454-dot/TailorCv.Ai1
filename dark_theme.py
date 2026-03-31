#!/usr/bin/env python3
"""
Convert CSS to dark theme
"""
import re

print("Reading CSS file...")
with open('static/css/style.css', 'r', encoding='utf-8') as f:
    content = f.read()

# Simple string replacements for remaining white backgrounds
content = content.replace(
    '.results-card {\n    background: white;',
    '.results-card {\n    background: var(--bg-secondary);\n    border: 1px solid var(--border-color);'
)

content = content.replace(
    '.template-option {\n    border: 2px solid var(--border-color);\n    border-radius: 8px;\n    padding: 1rem;\n    cursor: pointer;\n    transition: all 0.3s ease;\n    background: white;',
    '.template-option {\n    border: 2px solid var(--border-color);\n    border-radius: 8px;\n    padding: 1rem;\n    cursor: pointer;\n    transition: all 0.3s ease;\n    background: var(--bg-secondary);'
)

content = content.replace(
    '.template-modal-content {\n    background: white;',
    '.template-modal-content {\n    background: var(--bg-secondary);\n    border: 1px solid var(--border-color);'
)

# Fix item tags background
content = content.replace(
    '.item-tag {\n    display: inline-block;\n    background: #e5f3ff;',
    '.item-tag {\n    display: inline-block;\n    background: rgba(99, 102, 241, 0.1);'
)

content = content.replace(
    '.item-tag {\n    color: #2563eb;',
    '.item-tag {\n    color: #818cf8;'
)

# Save the updated content
print("Writing updated CSS file...")
with open('static/css/style.css', 'w', encoding='utf-8') as f:
    f.write(content)

print("✓ CSS successfully updated to dark theme!")
