import ExcelJS from 'exceljs'
import { dateOnly, dayString } from '@/lib/customer-fields'

// Server-only: what the Excel imports share (Leads in lib/lead-import.ts,
// Customers in lib/customer-import.ts). A template is one sheet of columns
// with notes on the headers, dropdowns that read a hidden Lists sheet, and a
// "How to use" sheet. An upload is that workbook (or a CSV saved from it),
// read by header name so the columns can be in any order.

export type SheetColumn<K extends string> = { key: K; header: string; width: number; note: string }
export type SheetList<K extends string> = { key: K; title: string; values: string[] }
export type ReadRow<K extends string> = { row: number; values: Record<K, string> }

export async function buildTemplate<K extends string>(opts: {
  sheet: string
  columns: readonly SheetColumn<K>[]
  lists: SheetList<K>[]
  dateKeys: readonly K[]
  maxRows: number
  help: string[]
}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'vaa-sys'
  wb.created = new Date()

  const ws = wb.addWorksheet(opts.sheet, { views: [{ state: 'frozen', ySplit: 1 }] })
  ws.columns = opts.columns.map((c) => ({ header: c.header, key: c.key, width: c.width }))
  const header = ws.getRow(1)
  header.font = { bold: true }
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEDE7' } }
  opts.columns.forEach((c, i) => {
    header.getCell(i + 1).note = c.note
  })

  // The lists the dropdowns read, on a hidden sheet.
  const lists = wb.addWorksheet('Lists', { state: 'hidden' })
  opts.lists.forEach((l, i) => {
    lists.getCell(1, i + 1).value = l.title
    l.values.forEach((v, j) => (lists.getCell(j + 2, i + 1).value = v))
  })
  for (const [i, l] of opts.lists.entries()) {
    if (l.values.length === 0) continue
    const letter = String.fromCharCode(65 + i)
    const range = `Lists!$${letter}$2:$${letter}$${l.values.length + 1}`
    const col = opts.columns.findIndex((c) => c.key === l.key) + 1
    for (let r = 2; r <= opts.maxRows + 1; r++) {
      ws.getCell(r, col).dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: [range],
        showErrorMessage: true,
        errorStyle: 'stop',
        errorTitle: `Pick a ${l.title.toLowerCase()}`,
        error: `Choose a ${l.title.toLowerCase()} from the list.`,
      }
    }
  }
  for (const key of opts.dateKeys) ws.getColumn(key).numFmt = 'yyyy-mm-dd'

  const help = wb.addWorksheet('How to use')
  help.getColumn(1).width = 110
  ;[...opts.help, '', 'Columns:', ...opts.columns.map((c) => `• ${c.header}: ${c.note}`)].forEach((line, i) => (help.getCell(i + 1, 1).value = line))
  help.getRow(1).font = { bold: true, size: 13 }

  return Buffer.from(await wb.xlsx.writeBuffer())
}

// Excel stores dates as day counts from 1899-12-30.
function excelSerialDay(n: number) {
  return dayString(new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86_400_000))
}

function cellString(cell: ExcelJS.Cell, isDate: boolean): string {
  const v = cell.value
  if (v instanceof Date) return dayString(v)
  if (isDate && typeof v === 'number') return excelSerialDay(v)
  if (v && typeof v === 'object' && 'result' in v) {
    const r = (v as { result?: unknown }).result
    if (r instanceof Date) return dayString(r)
    if (isDate && typeof r === 'number') return excelSerialDay(r)
  }
  return (cell.text ?? '').trim()
}

// RFC 4180-ish: quoted fields, doubled quotes, commas and newlines inside quotes.
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const s = text.replace(/^﻿/, '')
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') {
        field += '"'
        i++
      } else if (ch === '"') quoted = false
      else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += ch
  }
  if (field !== '' || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

export async function readSheet<K extends string>(
  file: File,
  opts: { sheet: string; columns: readonly SheetColumn<K>[]; dateKeys: readonly K[]; required: readonly K[]; maxRows: number; maxBytes: number }
): Promise<{ rows: ReadRow<K>[] } | { error: string }> {
  if (file.size === 0) return { error: 'The file is empty.' }
  if (file.size > opts.maxBytes) return { error: `The file is too big. Split it into files of up to ${opts.maxRows} rows.` }
  const name = file.name.toLowerCase()
  const headerKey = (text: string): K | null => {
    const t = text.trim().toLowerCase().replace(/\s*\*$/, '')
    return opts.columns.find((c) => c.header.toLowerCase() === t || c.key.toLowerCase() === t)?.key ?? null
  }

  let headers: (K | null)[]
  let data: { row: number; cells: string[] }[]
  if (name.endsWith('.xlsx')) {
    const wb = new ExcelJS.Workbook()
    try {
      await wb.xlsx.load(await file.arrayBuffer())
    } catch {
      return { error: 'That file couldn’t be read as an Excel workbook.' }
    }
    const ws = wb.getWorksheet(opts.sheet) ?? wb.worksheets[0]
    if (!ws) return { error: 'The workbook has no sheets.' }
    const head = ws.getRow(1)
    headers = Array.from({ length: Math.max(head.cellCount, opts.columns.length) }, (_, i) => headerKey(head.getCell(i + 1).text ?? ''))
    data = []
    for (let r = 2; r <= ws.rowCount; r++) {
      const row = ws.getRow(r)
      data.push({ row: r, cells: headers.map((key, i) => cellString(row.getCell(i + 1), !!key && opts.dateKeys.includes(key))) })
    }
  } else if (name.endsWith('.csv')) {
    const table = parseCsv(await file.text())
    if (table.length === 0) return { error: 'The file is empty.' }
    headers = table[0].map(headerKey)
    data = table.slice(1).map((cells, i) => ({ row: i + 2, cells }))
  } else {
    return { error: 'Upload the Excel template (.xlsx) or a CSV saved from it.' }
  }

  for (const required of opts.required) {
    const header = opts.columns.find((c) => c.key === required)?.header ?? required
    if (!headers.includes(required)) return { error: `The “${header}” column is missing. Start from the downloaded template.` }
  }
  const rows = data
    .map(({ row, cells }) => {
      const values = Object.fromEntries(opts.columns.map((c) => [c.key, ''])) as Record<K, string>
      headers.forEach((key, i) => {
        if (key) values[key] = (cells[i] ?? '').trim()
      })
      return { row, values }
    })
    .filter((r) => Object.values<string>(r.values).some((v) => v !== ''))
  if (rows.length === 0) return { error: 'The file has no rows to import.' }
  if (rows.length > opts.maxRows) return { error: `The file has ${rows.length} rows; the most is ${opts.maxRows}. Split it into smaller files.` }
  return { rows }
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

// '' → null; YYYY-MM-DD or M/D/YYYY → YYYY-MM-DD; anything else → 'bad'.
export function parseDay(raw: string): string | null | 'bad' {
  const s = raw.trim()
  if (!s) return null
  let day = s
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s)
  if (us) day = `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`
  if (!DAY_RE.test(day) || dayString(dateOnly(day)) !== day) return 'bad'
  return day
}

// "Name <email>" (the template's CS team dropdown) or a plain email.
export const teamLabel = (m: { name: string; email: string }) => (m.name && m.name !== m.email ? `${m.name} <${m.email}>` : m.email)
export const emailFromLabel = (v: string) => (/<([^>]+)>/.exec(v)?.[1] ?? v).trim().toLowerCase()
