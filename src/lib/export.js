export function downloadText(text, filename, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export function downloadDataUrl(dataUrl, filename) {
  if (!dataUrl) return
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
}

export function exportChartPng(chartRef, filename = 'export.png') {
  const chart = chartRef?.current
  const url =
    (chart?.toBase64Image && chart.toBase64Image('image/png', 1)) ||
    chart?.canvas?.toDataURL?.('image/png')
  downloadDataUrl(url, filename)
}

function csvEscape(v) {
  const s = String(v ?? '').replace(/\r?\n/g, ' ').trim()
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

export function tableElementToCsv(tableEl) {
  if (!tableEl) return ''
  const rows = Array.from(tableEl.querySelectorAll('tr')).map((tr) => {
    const cells = tr.querySelectorAll('th,td')
    return Array.from(cells).map((c) => csvEscape(c.innerText)).join(',')
  })
  return rows.join('\n')
}

export function downloadTableCsv(tableRef, filename = 'table.csv') {
  const tableEl = tableRef?.current
  const csv = tableElementToCsv(tableEl)
  if (!csv) return
  downloadText(csv, filename, 'text/csv;charset=utf-8')
}

