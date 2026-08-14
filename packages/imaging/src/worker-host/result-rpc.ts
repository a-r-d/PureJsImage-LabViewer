import type { WorkerRequest, WorkerResponse } from '@pji-workbench/contracts'
import type { TableColumn, TableResult } from 'purejsimage/analysis/results'

function tableCell(column: TableColumn, row: number): number | boolean | string | null {
  if (column.validity !== undefined) {
    const byte = column.validity.bits[Math.floor(row / 8)] ?? 0
    if ((byte & (1 << (row % 8))) === 0) return null
  }
  if (column.kind === 'numeric') {
    const value = column.values[row]
    if (typeof value === 'bigint')
      return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : String(value)
    return value ?? null
  }
  if (column.kind === 'boolean')
    return ((column.values[Math.floor(row / 8)] ?? 0) & (1 << (row % 8))) !== 0
  if (column.kind === 'category') return column.categories[column.codes[row] ?? -1] ?? null
  const start = column.offsets[row]
  const end = column.offsets[row + 1]
  return start === undefined || end === undefined
    ? null
    : new TextDecoder().decode(column.data.subarray(start, end))
}

function numericTableValue(
  table: TableResult,
  columnName: string,
  row: number,
): number | undefined {
  const column = table.columns.find((candidate) => candidate.name === columnName)
  if (column?.kind !== 'numeric') return undefined
  const value = tableCell(column, row)
  return typeof value === 'number' ? value : undefined
}

export function tablePage(
  table: TableResult,
  request: Extract<WorkerRequest, { kind: 'analysis.table-page' }>['payload'],
): Extract<WorkerResponse, { kind: 'analysis.table-page' }>['payload'] {
  let rows = Array.from({ length: table.rowCount }, (_value, row) => row)
  if (request.filter !== undefined) {
    const filter = request.filter
    rows = rows.filter((row) => {
      const value = numericTableValue(table, filter.column, row)
      return (
        value !== undefined &&
        (filter.minimum === undefined || value >= filter.minimum) &&
        (filter.maximum === undefined || value <= filter.maximum)
      )
    })
  }
  if (request.sort !== undefined) {
    const sort = request.sort
    const direction = sort.direction === 'ascending' ? 1 : -1
    rows.sort((left, right) => {
      const a = numericTableValue(table, sort.column, left)
      const b = numericTableValue(table, sort.column, right)
      if (a === undefined) return b === undefined ? left - right : 1
      if (b === undefined) return -1
      return a === b ? left - right : (a - b) * direction
    })
  }
  const pageRows = rows.slice(request.offset, request.offset + request.limit)
  const selected =
    request.columns === undefined
      ? table.columns
      : request.columns
          .map((name) => table.columns.find((column) => column.name === name))
          .filter((column): column is TableColumn => column !== undefined)
  return {
    offset: request.offset,
    rowCount: pageRows.length,
    totalRows: rows.length,
    columns: selected.map((column) => ({
      name: column.name,
      kind: column.kind,
      ...('unit' in column && column.unit !== undefined ? { unit: column.unit } : {}),
      values: pageRows.map((row) => tableCell(column, row)),
    })),
  }
}
