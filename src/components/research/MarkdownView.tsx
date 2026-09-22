import { Fragment, ReactNode } from 'react';

interface MarkdownViewProps {
  content: string;
  className?: string;
}

function inlineParts(value: string): ReactNode[] {
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)]+\))/g;
  const output: ReactNode[] = [];
  let cursor = 0;
  for (const match of value.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) output.push(value.slice(cursor, index));
    const token = match[0];
    if (token.startsWith('**')) {
      output.push(<strong key={`${index}-${token}`} className="font-semibold text-ink-900">{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('`')) {
      output.push(<code key={`${index}-${token}`} className="rounded bg-ink-50 px-1 py-0.5 text-[0.92em] text-ink-700">{token.slice(1, -1)}</code>);
    } else {
      const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      output.push(link ? (
        <a key={`${index}-${token}`} href={link[2]} target="_blank" rel="noreferrer" className="font-medium text-brand-700 underline decoration-brand-100 underline-offset-4 hover:decoration-brand-500">
          {link[1]}
        </a>
      ) : token);
    }
    cursor = index + token.length;
  }
  if (cursor < value.length) output.push(value.slice(cursor));
  return output;
}

function tableCells(value: string): string[] {
  return value.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
}

function isTableDivider(value: string): boolean {
  const cells = tableCells(value);
  return cells.length > 1 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

export function MarkdownView({ content, className = '' }: MarkdownViewProps) {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (!trimmed) {
      blocks.push(<div key={index} className="h-3" />);
      continue;
    }
    if (trimmed.includes('|') && index + 1 < lines.length && isTableDivider(lines[index + 1])) {
      const headers = tableCells(trimmed);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && lines[index].trim().includes('|')) {
        rows.push(tableCells(lines[index]));
        index += 1;
      }
      index -= 1;
      blocks.push(
        <div key={`table-${index}`} className="my-5 overflow-x-auto rounded-md border border-ink-200">
          <table className="w-full min-w-[560px] border-collapse text-left text-[13px] leading-6">
            <thead className="bg-ink-50 text-xs font-semibold uppercase text-ink-500">
              <tr>{headers.map((header, cellIndex) => <th key={cellIndex} className="border-b border-ink-200 px-4 py-2.5">{inlineParts(header)}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex} className="align-top">
                  {headers.map((_, cellIndex) => <td key={cellIndex} className="px-4 py-2.5 text-ink-700">{inlineParts(row[cellIndex] || '')}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (trimmed === '---') {
      blocks.push(<hr key={index} className="my-5 border-ink-100" />);
      continue;
    }
    const heading = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      const headingClass = level === 1
        ? 'mb-3 mt-2 text-xl font-bold text-ink-950'
        : level === 2
          ? 'mb-2 mt-6 text-base font-bold text-ink-950'
          : 'mb-1 mt-4 text-sm font-bold text-ink-900';
      blocks.push(<div key={index} className={headingClass}>{inlineParts(heading[2])}</div>);
      continue;
    }
    if (/^[-*]\s+/.test(trimmed)) {
      blocks.push(
        <div key={index} className="flex gap-3 pl-1">
          <span className="mt-[11px] h-1 w-1 shrink-0 rounded-full bg-ink-400" />
          <span>{inlineParts(trimmed.replace(/^[-*]\s+/, ''))}</span>
        </div>,
      );
      continue;
    }
    if (/^\d+\.\s+/.test(trimmed)) {
      const match = trimmed.match(/^(\d+)\.\s+(.+)$/);
      blocks.push(
        <div key={index} className="flex gap-3 pl-1">
          <span className="min-w-5 font-semibold text-ink-500">{match?.[1]}.</span>
          <span>{inlineParts(match?.[2] || trimmed)}</span>
        </div>,
      );
      continue;
    }
    if (/^>\s?/.test(trimmed)) {
      blocks.push(<blockquote key={index} className="my-3 border-l-2 border-brand-500 bg-brand-50 px-4 py-2 text-ink-600">{inlineParts(trimmed.replace(/^>\s?/, ''))}</blockquote>);
      continue;
    }
    blocks.push(<p key={index}>{inlineParts(trimmed).map((part, partIndex) => <Fragment key={partIndex}>{part}</Fragment>)}</p>);
  }
  return (
    <div className={`text-sm leading-7 text-ink-700 ${className}`}>
      {blocks}
    </div>
  );
}
