type SalesInfoBlock =
  | { type: 'text'; content: string }
  | { type: 'table'; rows: string[][] };

function tableRow(line: string): string[] | null {
  if (line.includes('\\|')) return null;
  const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
  return cells.length >= 2 && cells.every(Boolean) ? cells : null;
}

function salesInfoBlocks(text: string): SalesInfoBlock[] {
  const lines = text.split('\n');
  const blocks: SalesInfoBlock[] = [];
  let paragraph: string[] = [];
  const flushParagraph = () => {
    const content = paragraph.join('\n').replace(/^\s*\n|\n\s*$/g, '');
    if (content.trim()) blocks.push({ type: 'text', content });
    paragraph = [];
  };

  for (let index = 0; index < lines.length;) {
    if (!lines[index].includes('|')) {
      paragraph.push(lines[index++]);
      continue;
    }

    const candidate: string[] = [];
    while (index < lines.length && lines[index].includes('|')) candidate.push(lines[index++]);
    const rows = candidate.map(tableRow);
    const columns = rows[0]?.length;
    if (rows.length >= 2 && columns && rows.every((row) => row?.length === columns)) {
      flushParagraph();
      blocks.push({ type: 'table', rows: rows as string[][] });
    } else {
      paragraph.push(...candidate);
    }
  }

  flushParagraph();
  return blocks.some((block) => block.type === 'table') ? blocks : [{ type: 'text', content: text }];
}

/** Formats explicit pipe-delimited rows without interpreting or changing their wording. */
export function SalesInfo({ text, label }: { text: string; label: string }) {
  return <div className="ticket-sales-info">
    {salesInfoBlocks(text).map((block, index) => block.type === 'text'
      ? <p key={index}>{block.content}</p>
      : <div key={index} className="ticket-sales-table-scroll" role="region" aria-label={label} tabIndex={0}>
        <table className="ticket-sales-table" aria-label={label} style={{ minWidth: block.rows[0].length > 2 ? block.rows[0].length * 140 : undefined }}>
          <thead><tr>{block.rows[0].map((cell, column) => <th key={column} scope="col">{cell}</th>)}</tr></thead>
          <tbody>{block.rows.slice(1).map((row, rowIndex) => <tr key={rowIndex}>
            {row.map((cell, column) => <td key={column}>{cell}</td>)}
          </tr>)}</tbody>
        </table>
      </div>)}
  </div>;
}
