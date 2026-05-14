const FORMULA_PREFIX_PATTERN = /^[=+\-@\t\r]/;

export function safeCsvCell(value: unknown): string {
  const text = value == null ? '' : String(value);
  const neutralized = FORMULA_PREFIX_PATTERN.test(text) ? `'${text}` : text;
  return `"${neutralized.replace(/"/g, '""')}"`;
}

export function safeCsvRow(values: readonly unknown[]): string {
  return values.map((value) => safeCsvCell(value)).join(',');
}

export function safeCsvRows(rows: readonly (readonly unknown[])[]): string {
  return rows.map((row) => safeCsvRow(row)).join('\n');
}
