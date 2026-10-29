// RFC 4180 CSV helpers. Values containing a delimiter, quote, CR or LF are quoted and quotes doubled.

export function csvCell(value) {
  if (value === null || value === undefined) return '';
  let text;
  if (value instanceof Date) text = value.toISOString();
  else if (Array.isArray(value) || typeof value === 'object') text = JSON.stringify(value);
  else text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export const csvRow = (values) => `${values.map(csvCell).join(',')}\r\n`;

/** Minimal RFC 4180 parser (used by tests / export verification). Returns array of string arrays. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** Read a nested value with a dotted path ("evaluation.absErrorMinutes"). */
export function getPath(obj, path) {
  let cur = obj;
  for (const key of path.split('.')) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[key];
  }
  return cur;
}
