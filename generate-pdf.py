#!/usr/bin/env python3
"""Generate PDF from the user manual markdown with embedded images."""
import re
import os
import base64
import markdown
from weasyprint import HTML

BASE_DIR = '/home/mozo/ebus-eventlog'
INPUT_MD = os.path.join(BASE_DIR, '麥味登智取櫃-訂單查詢系統-使用手冊.md')
OUTPUT_PDF = os.path.join(BASE_DIR, '麥味登智取櫃-訂單查詢系統-使用手冊.pdf')

with open(INPUT_MD, 'r', encoding='utf-8') as f:
    md_content = f.read()

# Replace <!-- IMG:filename --> with actual img tags using base64 data URIs
def replace_img_placeholder(match):
    filename = match.group(1)
    filepath = os.path.join(BASE_DIR, filename)
    if os.path.exists(filepath):
        with open(filepath, 'rb') as img_file:
            img_data = base64.b64encode(img_file.read()).decode('utf-8')
        ext = filename.rsplit('.', 1)[-1].lower()
        mime = 'image/png' if ext == 'png' else 'image/jpeg'
        return f'<img src="data:{mime};base64,{img_data}" class="screenshot" />'
    return f'<!-- Image not found: {filename} -->'

md_content = re.sub(r'<!-- IMG:(\S+?) -->', replace_img_placeholder, md_content)

html_body = markdown.markdown(md_content, extensions=['tables', 'fenced_code'])

html_full = f"""<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8">
<style>
  @page {{
    size: A4;
    margin: 2cm 2.2cm;
    @bottom-center {{
      content: counter(page);
      font-size: 9pt;
      color: #999;
    }}
  }}

  body {{
    font-family: 'Noto Serif CJK TC', 'Noto Sans CJK TC', 'Microsoft JhengHei', 'PingFang TC', serif;
    font-size: 11pt;
    line-height: 1.75;
    color: #333;
  }}

  h1 {{
    font-size: 22pt;
    color: #154733;
    text-align: center;
    border-bottom: 3px solid #154733;
    padding-bottom: 14px;
    margin-bottom: 36px;
    margin-top: 50px;
  }}

  h2 {{
    font-size: 15pt;
    color: #154733;
    border-left: 5px solid #154733;
    padding-left: 12px;
    margin-top: 30px;
    margin-bottom: 14px;
    page-break-after: avoid;
  }}

  h3 {{
    font-size: 13pt;
    color: #1b5b41;
    margin-top: 24px;
    margin-bottom: 10px;
    page-break-after: avoid;
  }}

  h4 {{
    font-size: 11.5pt;
    color: #2e353e;
    margin-top: 18px;
    margin-bottom: 8px;
    page-break-after: avoid;
  }}

  table {{
    width: 100%;
    border-collapse: collapse;
    margin: 12px 0 20px 0;
    font-size: 10pt;
    page-break-inside: avoid;
  }}

  th {{
    background: #154733;
    color: white;
    padding: 8px 12px;
    text-align: left;
    font-weight: 500;
  }}

  td {{
    padding: 7px 12px;
    border-bottom: 1px solid #e0e0e0;
    vertical-align: top;
  }}

  tr:nth-child(even) {{
    background: #f8f9fa;
  }}

  code {{
    font-family: 'Consolas', 'Courier New', monospace;
    background: #f5f5f5;
    padding: 1px 4px;
    border-radius: 3px;
    font-size: 9.5pt;
  }}

  pre {{
    background: #f8f9fa;
    border: 1px solid #e0e0e0;
    border-left: 4px solid #154733;
    padding: 14px 16px;
    border-radius: 4px;
    font-size: 8.5pt;
    line-height: 1.55;
    overflow-x: auto;
    page-break-inside: avoid;
    white-space: pre-wrap;
    word-wrap: break-word;
  }}

  pre code {{
    background: none;
    padding: 0;
    font-size: 8.5pt;
  }}

  blockquote {{
    border-left: 4px solid #e36159;
    background: #fff8f0;
    padding: 10px 16px;
    margin: 12px 0;
    font-size: 10.5pt;
    color: #555;
    page-break-inside: avoid;
  }}

  blockquote p {{
    margin: 0;
  }}

  strong {{
    color: #154733;
  }}

  hr {{
    border: none;
    border-top: 1px solid #ddd;
    margin: 22px 0;
  }}

  ul, ol {{
    padding-left: 22px;
    margin: 8px 0;
  }}

  li {{
    margin-bottom: 5px;
  }}

  p {{
    margin: 6px 0;
  }}

  .screenshot {{
    display: block;
    max-width: 100%;
    margin: 16px auto;
    border: 1px solid #ddd;
    border-radius: 6px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
  }}
</style>
</head>
<body>
{html_body}
</body>
</html>"""

HTML(string=html_full).write_pdf(OUTPUT_PDF)
print(f'PDF generated: {OUTPUT_PDF}')
