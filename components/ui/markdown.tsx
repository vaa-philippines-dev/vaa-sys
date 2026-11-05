'use client'

import { Fragment, useRef, useState, type ReactNode } from 'react'
import { Bold, Heading2, Italic, List, ListOrdered } from 'lucide-react'
import { cn } from '@/lib/utils'

// A small Markdown editor and viewer for formatted text such as a service's
// Job Description: bold, italics, headings, bulleted and numbered lists. It
// is saved as Markdown, so it still reads well where it is shown as plain
// text (VAA Workforce keeps the same field). The viewer builds React
// elements and never inserts HTML, so saved text can't inject markup.

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(\*\*([^*]+)\*\*|\*([^*]+)\*|_([^_]+)_)/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    out.push(m[2] ? <strong key={`${key}-${i++}`}>{m[2]}</strong> : <em key={`${key}-${i++}`}>{m[3] ?? m[4]}</em>)
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export function Markdown({ text, className }: { text: string; className?: string }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let para: string[] = []
  let list: { ordered: boolean; items: string[] } | null = null
  const flush = () => {
    if (para.length) {
      const k = `p${blocks.length}`
      blocks.push(
        <p key={k}>
          {para.map((l, i) => (
            <Fragment key={i}>
              {i > 0 && <br />}
              {inline(l, `${k}-${i}`)}
            </Fragment>
          ))}
        </p>
      )
      para = []
    }
    if (list) {
      const k = `l${blocks.length}`
      const items = list.items.map((it, i) => <li key={i}>{inline(it, `${k}-${i}`)}</li>)
      blocks.push(list.ordered ? <ol key={k} className="list-decimal pl-5">{items}</ol> : <ul key={k} className="list-disc pl-5">{items}</ul>)
      list = null
    }
  }
  for (const raw of lines) {
    const line = raw.trimEnd()
    const heading = /^(#{1,3})\s+(.*)$/.exec(line)
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line)
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    if (!line.trim()) flush()
    else if (heading) {
      flush()
      const k = `h${blocks.length}`
      blocks.push(
        heading[1].length === 1 ? (
          <h3 key={k} className="text-base font-semibold">{inline(heading[2], k)}</h3>
        ) : (
          <h4 key={k} className="text-sm font-semibold">{inline(heading[2], k)}</h4>
        )
      )
    } else if (bullet || numbered) {
      if (para.length) flush()
      const ordered = !!numbered
      if (list && list.ordered !== ordered) flush()
      list ??= { ordered, items: [] }
      list.items.push((bullet ?? numbered)![1])
    } else {
      if (list) flush()
      para.push(line)
    }
  }
  flush()
  return <div className={cn('space-y-2 text-sm leading-relaxed', className)}>{blocks}</div>
}

export function MarkdownEditor({ id, value, onChange, rows = 10, placeholder }: { id: string; value: string; onChange: (v: string) => void; rows?: number; placeholder?: string }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const [tab, setTab] = useState<'write' | 'preview'>('write')

  // Wraps the selection (bold, italics) or prefixes its lines (heading, lists).
  const apply = (kind: 'bold' | 'italic' | 'heading' | 'bullet' | 'numbered') => {
    const el = ref.current
    if (!el) return
    const { selectionStart: s, selectionEnd: e } = el
    let next: string
    let cursor: [number, number]
    if (kind === 'bold' || kind === 'italic') {
      const mark = kind === 'bold' ? '**' : '*'
      const sel = value.slice(s, e) || (kind === 'bold' ? 'bold text' : 'italic text')
      next = value.slice(0, s) + mark + sel + mark + value.slice(e)
      cursor = [s + mark.length, s + mark.length + sel.length]
    } else {
      const lineStart = value.lastIndexOf('\n', s - 1) + 1
      const lineEnd = value.indexOf('\n', e) === -1 ? value.length : value.indexOf('\n', e)
      const block = value.slice(lineStart, lineEnd).split('\n')
      const done = block.map((l, i) => {
        const bare = l.replace(/^(#{1,3}\s+|\s*[-*]\s+|\s*\d+[.)]\s+)/, '')
        return kind === 'heading' ? `## ${bare}` : kind === 'bullet' ? `- ${bare}` : `${i + 1}. ${bare}`
      })
      const text = done.join('\n')
      next = value.slice(0, lineStart) + text + value.slice(lineEnd)
      cursor = [lineStart, lineStart + text.length]
    }
    onChange(next)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(...cursor)
    })
  }

  const tools = [
    { kind: 'bold' as const, Icon: Bold, label: 'Bold' },
    { kind: 'italic' as const, Icon: Italic, label: 'Italic' },
    { kind: 'heading' as const, Icon: Heading2, label: 'Heading' },
    { kind: 'bullet' as const, Icon: List, label: 'Bulleted list' },
    { kind: 'numbered' as const, Icon: ListOrdered, label: 'Numbered list' },
  ]

  return (
    <div className="overflow-hidden rounded-lg border border-input focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
      <div className="flex flex-wrap items-center gap-0.5 border-b bg-muted/40 px-1.5 py-1">
        {tools.map((t) => (
          <button
            key={t.kind}
            type="button"
            onClick={() => apply(t.kind)}
            disabled={tab === 'preview'}
            title={t.label}
            aria-label={t.label}
            className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
          >
            <t.Icon className="h-3.5 w-3.5" />
          </button>
        ))}
        <div className="ml-auto flex gap-0.5" role="tablist" aria-label="Editor view">
          {(['write', 'preview'] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={tab === v}
              onClick={() => setTab(v)}
              className={cn('rounded px-2 py-1 text-xs font-medium', tab === v ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
            >
              {v === 'write' ? 'Write' : 'Preview'}
            </button>
          ))}
        </div>
      </div>
      {tab === 'write' ? (
        <textarea
          ref={ref}
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={rows}
          placeholder={placeholder}
          className="block w-full resize-y bg-transparent px-3 py-2 font-mono text-[13px] leading-relaxed outline-none"
        />
      ) : (
        <div className="min-h-32 px-3 py-2">{value.trim() ? <Markdown text={value} /> : <p className="text-sm text-muted-foreground">Nothing written yet.</p>}</div>
      )}
    </div>
  )
}
