import type { SummaryRow } from './provision.js';

const ICONS: Record<SummaryRow['status'], string> = {
  exists: '·',
  created: '+',
  updated: '~',
  'would create': '+?',
  'would update': '~?',
  skipped: '-',
  'action needed': '!',
  failed: 'x',
};

/** Renders rows as an aligned plain-text table (no colours, so it reads well in CI logs). */
export function renderTable(rows: readonly SummaryRow[], maxDetail = 110): string {
  const header = ['', 'EXAMPLE', 'RESOURCE', 'NAME', 'STATUS', 'DETAIL'];
  const body = rows.map((row) => [
    ICONS[row.status],
    row.example,
    row.resource,
    row.name,
    row.status,
    row.detail.length > maxDetail ? `${row.detail.slice(0, maxDetail - 1)}…` : row.detail,
  ]);
  const widths = header.map((title, index) =>
    Math.max(title.length, ...body.map((cells) => (cells[index] ?? '').length)),
  );
  const line = (cells: readonly string[]) =>
    cells
      .map((cell, index) => (index === cells.length - 1 ? cell : cell.padEnd(widths[index] ?? 0)))
      .join('  ')
      .trimEnd();
  return [line(header), line(widths.map((width) => '─'.repeat(width))), ...body.map(line)].join('\n');
}

export function summarize(rows: readonly SummaryRow[]): string {
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
  }
  return [...counts.entries()].map(([status, count]) => `${String(count)} ${status}`).join(', ');
}
