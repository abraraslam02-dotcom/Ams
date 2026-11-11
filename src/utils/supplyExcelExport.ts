import * as XLSX from 'xlsx';

export function exportSupplyTableToExcel(options: {
  title: string;
  fileName: string;
  columns: Array<{ key: string; label: string; align?: 'left' | 'right' | 'center' }>;
  rows: Array<Record<string, unknown>>;
  grandTotals?: Record<string, number>;
  secondarySheet?: {
    sheetName: string;
    columns: Array<{ key: string; label: string }>;
    rows: Array<Record<string, unknown>>;
  };
}) {
  const wb = XLSX.utils.book_new();

  const headerLabels = options.columns.map((c) => c.label);
  const dataRows = options.rows.map((r) =>
    options.columns.map((c) => {
      const val = r[c.key];
      if (typeof val === 'number') return Number(val.toFixed(2));
      return val ?? '';
    })
  );

  if (options.grandTotals && Object.keys(options.grandTotals).length > 0) {
    const totalRow = options.columns.map((c, idx) => {
      if (idx === 0) return 'GRAND TOTAL';
      if (options.grandTotals && options.grandTotals[c.key] !== undefined) {
        return Number(options.grandTotals[c.key].toFixed(2));
      }
      return '';
    });
    dataRows.push(totalRow);
  }

  const wsData = [
    ['ABRAR MEDICAL STORE - SUPPLY & DISTRIBUTION SYSTEM'],
    [options.title],
    [`Exported On: ${new Date().toLocaleString()}`],
    [],
    headerLabels,
    ...dataRows,
  ];

  const ws = XLSX.utils.aoa_to_sheet(wsData);
  ws['!cols'] = options.columns.map((c) => ({
    wch: Math.max(14, c.label.length + 6),
  }));

  XLSX.utils.book_append_sheet(wb, ws, 'Summary');

  if (options.secondarySheet && options.secondarySheet.rows.length > 0) {
    const secHeaders = options.secondarySheet.columns.map((c) => c.label);
    const secRows = options.secondarySheet.rows.map((r) =>
      options.secondarySheet!.columns.map((c) => {
        const val = r[c.key];
        if (typeof val === 'number') return Number(val.toFixed(2));
        return val ?? '';
      })
    );
    const secWs = XLSX.utils.aoa_to_sheet([secHeaders, ...secRows]);
    secWs['!cols'] = options.secondarySheet.columns.map((c) => ({
      wch: Math.max(14, c.label.length + 6),
    }));
    XLSX.utils.book_append_sheet(
      wb,
      secWs,
      options.secondarySheet.sheetName.slice(0, 31)
    );
  }

  const cleanFile = options.fileName.endsWith('.xlsx')
    ? options.fileName
    : `${options.fileName}.xlsx`;
  XLSX.writeFile(wb, cleanFile);
}
