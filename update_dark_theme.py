#!/usr/bin/env python3
"""
Convert CSS to dark theme - comprehensive update
"""

with open('static/css/style.css', 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Find and update specific line ranges
output = []
i = 0
while i < len(lines):
    line = lines[i]
    
    # Update .results-card background
    if '.results-card {' in line:
        output.append(line)
        i += 1
        # Skip white background line, add dark theme
        if i < len(lines) and 'background: white;' in lines[i]:
            output.append('    background: var(--bg-secondary);\n')
            output.append('    border: 1px solid var(--border-color);\n')
            i += 1
        continue
    
    # Update .template-option background
    elif '.template-option {' in line:
        output.append(line)
        i += 1
        while i < len(lines) and '}' not in lines[i]:
            if 'background: white;' in lines[i]:
                output.append('    background: var(--bg-secondary);\n')
            else:
                output.append(lines[i])
            i += 1
        if i < len(lines):
            output.append(lines[i])  # closing brace
            i += 1
        continue
    
    # Update .template-modal-content background
    elif '.template-modal-content {' in line:
        output.append(line)
        i += 1
        while i < len(lines) and '}' not in lines[i]:
            if 'background: white;' in lines[i]:
                output.append('    background: var(--bg-secondary);\n')
                output.append('    border: 1px solid var(--border-color);\n')
            else:
                output.append(lines[i])
            i += 1
        if i < len(lines):
            output.append(lines[i])  # closing brace
            i += 1
        continue
    
    # Update .item-tag background
    elif '.item-tag {' in line:
        output.append(line)
        i += 1
        while i < len(lines) and '}' not in lines[i]:
            if 'background: #e5f3ff;' in lines[i]:
                output.append('    background: rgba(99, 102, 241, 0.1);\n')
            elif 'color: #2563eb;' in lines[i]:
                output.append('    color: #818cf8;\n')
            else:
                output.append(lines[i])
            i += 1
        if i < len(lines):
            output.append(lines[i])  # closing brace
            i += 1
        continue
    
    else:
        output.append(line)
        i += 1

# Write updated content
with open('static/css/style.css', 'w', encoding='utf-8') as f:
    f.writelines(output)

print("✓ Dark theme CSS updated successfully!")
