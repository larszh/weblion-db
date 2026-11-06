import { Fragment, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/cn';

/**
 * Model text as React elements (ai 11.3): paragraphs and line breaks, "-" and "1." lists, **bold**, `code`
 * and [label](path) links. Nothing is interpreted as HTML (React escapes every string), there are no images
 * and no tables, and only console paths become links. Every other link and every bare URL stays plain text,
 * so an injected instruction cannot turn an answer into an exfiltration link.
 */

const CONSOLE_PATH = /^\/(o|admin)(\/[A-Za-z0-9._~%-]+)*\/?(\?[A-Za-z0-9._~%&=-]*)?$/;

/** A path inside the console (ai 11.3): /o/... or /admin..., no "//", no backslash, at most 300 characters. */
export function isConsolePath(path: unknown): path is string {
  if (typeof path !== 'string' || path.length > 300) return false;
  if (path.includes('//') || path.includes('\\')) return false;
  if (!(path === '/admin' || path.startsWith('/admin/') || path.startsWith('/admin?'))) {
    if (!path.startsWith('/o/')) return false;
  }
  if (!CONSOLE_PATH.test(path)) return false;
  // "." and ".." segments would leave the area the link claims to point to.
  return !path
    .split('?')[0]!
    .split('/')
    .some((segment) => segment === '.' || segment === '..');
}

// One token per match: `code`, **bold** or [label](target). Anything else is text.
const INLINE = /`([^`\n]+)`|\*\*([^*\n]+?)\*\*|\[([^\]\n]+)\]\(([^)\s]+)\)/g;

function inline(text: string, keyPrefix: string, allowBold = true): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let index = 0;
  for (const match of text.matchAll(INLINE)) {
    const start = match.index ?? 0;
    if (start > last) out.push(text.slice(last, start));
    const key = `${keyPrefix}-${index++}`;
    const [whole, code, bold, label, target] = match;
    if (code !== undefined) {
      out.push(
        <code key={key} className="rounded bg-surface-3 px-1 py-0.5 font-mono text-[12.5px] break-all">
          {code}
        </code>,
      );
    } else if (bold !== undefined) {
      out.push(
        allowBold ? (
          <strong key={key} className="font-semibold">
            {inline(bold, key, false)}
          </strong>
        ) : (
          whole
        ),
      );
    } else if (label !== undefined && target !== undefined) {
      out.push(
        isConsolePath(target) ? (
          <Link key={key} to={target} className="font-medium text-primary-text underline underline-offset-2">
            {label}
          </Link>
        ) : (
          // Not a console path: shown as text, never as a link (ai 11.3).
          <Fragment key={key}>{`${label} (${target})`}</Fragment>
        ),
      );
    }
    last = start + whole.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

type Block =
  { kind: 'p'; lines: string[] } | { kind: 'ul'; items: string[] } | { kind: 'ol'; items: string[] };

const BULLET = /^\s*[-*]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;

function blocks(text: string): Block[] {
  const out: Block[] = [];
  for (const chunk of text.replace(/\r\n/g, '\n').split(/\n\s*\n/)) {
    for (const line of chunk.split('\n')) {
      if (!line.trim()) continue;
      const bullet = BULLET.exec(line);
      const numbered = bullet ? null : NUMBERED.exec(line);
      const prev = out[out.length - 1];
      if (bullet) {
        if (prev?.kind === 'ul') prev.items.push(bullet[1]!);
        else out.push({ kind: 'ul', items: [bullet[1]!] });
      } else if (numbered) {
        if (prev?.kind === 'ol') prev.items.push(numbered[1]!);
        else out.push({ kind: 'ol', items: [numbered[1]!] });
      } else if (prev?.kind === 'p') {
        prev.lines.push(line.trim());
      } else {
        out.push({ kind: 'p', lines: [line.trim()] });
      }
    }
    // A blank line ends the paragraph or list before it.
    out.push({ kind: 'p', lines: [] });
  }
  return out.filter((b) => b.kind !== 'p' || b.lines.length > 0);
}

export function AiText({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn('space-y-2 text-sm leading-relaxed break-words text-text', className)}>
      {blocks(text).map((block, i) => {
        const key = `b${i}`;
        if (block.kind === 'p') {
          return (
            <p key={key}>
              {block.lines.map((line, j) => (
                <Fragment key={j}>
                  {j > 0 && <br />}
                  {inline(line, `${key}-${j}`)}
                </Fragment>
              ))}
            </p>
          );
        }
        const List = block.kind === 'ul' ? 'ul' : 'ol';
        return (
          <List
            key={key}
            className={cn('space-y-1 pl-5', block.kind === 'ul' ? 'list-disc' : 'list-decimal')}
          >
            {block.items.map((item, j) => (
              <li key={j}>{inline(item, `${key}-${j}`)}</li>
            ))}
          </List>
        );
      })}
    </div>
  );
}
