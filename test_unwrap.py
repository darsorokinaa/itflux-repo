import re

_RE_INNER_TABLE = re.compile(
    r"<table\b[^>]*>((?:(?!<table\b).)*?)</table>",
    re.IGNORECASE | re.DOTALL,
)
_RE_TABLE_ROW = re.compile(r"<tr\b[^>]*>([\s\S]*?)</tr>", re.IGNORECASE)
_RE_TABLE_CELL = re.compile(r"<t[dh]\b[^>]*>([\s\S]*?)</t[dh]>", re.IGNORECASE)

def _cell_has_content(html: str) -> bool:
    s = re.sub(r"<[^>]+>", "", html).strip()
    return bool(s)

def _row_is_empty(html: str) -> bool:
    for cell_m in _RE_TABLE_CELL.finditer(html):
        if _cell_has_content(cell_m.group(1)):
            return False
    return True

def _is_real_data_table(table_html: str) -> bool:
    multi_col_rows = 0
    total_rows = 0
    for row_m in _RE_TABLE_ROW.finditer(table_html):
        total_rows += 1
        cells = _RE_TABLE_CELL.findall(row_m.group(1))
        if len(cells) < 2:
            continue
        with_content = sum(1 for c in cells if _cell_has_content(c.strip()))
        if with_content >= 1 and len(cells) >= 2:
            multi_col_rows += 1
    return total_rows >= 2 and multi_col_rows >= 2

def _unwrap_one_layout_table(table_html: str) -> str:
    if _is_real_data_table(table_html):
        return table_html
    parts = []
    has_any_row = False
    for row_m in _RE_TABLE_ROW.finditer(table_html):
        has_any_row = True
        if _row_is_empty(row_m.group(1)):
            continue
        for cell_m in _RE_TABLE_CELL.finditer(row_m.group(1)):
            inner = cell_m.group(1).strip()
            if _cell_has_content(inner):
                parts.append(inner)
    if not has_any_row:
        return ""
    if not parts:
        return ""
    return "".join(f'<div class="task-html-block">{p}</div>' for p in parts)

def unwrap_layout_tables(html: str) -> str:
    if not html or "<table" not in html.lower():
        return html
    out = html
    preserved_tables = {}
    
    for _ in range(64):
        replaced = False
        for m in _RE_INNER_TABLE.finditer(out):
            table_html = m.group(0)
            new_html = _unwrap_one_layout_table(table_html)
            if new_html != table_html:
                out = out[: m.start()] + new_html + out[m.end() :]
                replaced = True
                break
            else:
                placeholder = f"__PRESERVED_TABLE_{len(preserved_tables)}__"
                preserved_tables[placeholder] = table_html
                out = out[: m.start()] + placeholder + out[m.end() :]
                replaced = True
                break
        if not replaced:
            break
            
    for placeholder, table_html in reversed(list(preserved_tables.items())):
        out = out.replace(placeholder, table_html)
        
    return out

html = """<table><tbody><tr><td>
  <table><tbody>
    <tr><td>1)</td><td>Text 1</td></tr>
    <tr><td>2)</td><td>Text 2</td></tr>
    <tr><td>3)</td><td>Text 3</td></tr>
  </tbody></table>
</td></tr></tbody></table>"""

print(unwrap_layout_tables(html))
