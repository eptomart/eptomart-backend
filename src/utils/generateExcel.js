const ExcelJS = require('exceljs');
const business = require('../../config/business');

const generateExpenseExcel = async (expenses, filters = {}) => {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Eptomart';
  wb.created = new Date();

  const ws = wb.addWorksheet('Expenses', {
    pageSetup: { paperSize: 9, orientation: 'landscape' },
  });

  // ── Title row ────────────────────────────────────────
  ws.mergeCells('A1:G1');
  ws.getCell('A1').value = `${business.name} — Expense Report`;
  ws.getCell('A1').font  = { bold: true, size: 14, color: { argb: 'FFF97316' } };
  ws.getCell('A1').alignment = { horizontal: 'center' };

  ws.mergeCells('A2:G2');
  const period = filters.from && filters.to
    ? `Period: ${filters.from} to ${filters.to}`
    : `Generated: ${new Date().toLocaleDateString('en-IN')}`;
  ws.getCell('A2').value     = period;
  ws.getCell('A2').font      = { size: 9, color: { argb: 'FF666666' } };
  ws.getCell('A2').alignment = { horizontal: 'center' };

  ws.addRow([]);

  // ── Header row ────────────────────────────────────────
  const headers = ['#', 'Date', 'Category', 'Title', 'Description', 'Amount (₹)', 'Added By'];
  const hRow = ws.addRow(headers);
  hRow.eachCell(cell => {
    cell.font      = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF97316' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border    = {
      bottom: { style: 'thin', color: { argb: 'FFDDDDDD' } },
    };
  });
  hRow.height = 22;

  // ── Data rows ─────────────────────────────────────────
  let totalAmount = 0;
  expenses.forEach((exp, idx) => {
    const row = ws.addRow([
      idx + 1,
      new Date(exp.date).toLocaleDateString('en-IN'),
      exp.category?.name || '—',
      exp.title,
      exp.description || '',
      exp.amount,
      exp.createdBy?.name || '—',
    ]);

    // Alternating row fill
    if (idx % 2 === 0) {
      row.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF8F0' } };
      });
    }

    // Amount column — right-align + number format
    row.getCell(6).numFmt  = '₹#,##0.00';
    row.getCell(6).alignment = { horizontal: 'right' };
    totalAmount += exp.amount;
  });

  // ── Total row ─────────────────────────────────────────
  ws.addRow([]);
  const totRow = ws.addRow(['', '', '', '', 'TOTAL', totalAmount, '']);
  totRow.getCell(5).font      = { bold: true };
  totRow.getCell(6).font      = { bold: true };
  totRow.getCell(6).numFmt    = '₹#,##0.00';
  totRow.getCell(6).alignment = { horizontal: 'right' };
  totRow.getCell(6).fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF0E0' } };

  // ── Column widths ─────────────────────────────────────
  ws.columns = [
    { key: 'no',   width: 5  },
    { key: 'date', width: 14 },
    { key: 'cat',  width: 22 },
    { key: 'title',width: 35 },
    { key: 'desc', width: 30 },
    { key: 'amt',  width: 16 },
    { key: 'by',   width: 18 },
  ];

  // ── Summary sheet ─────────────────────────────────────
  const ws2 = wb.addWorksheet('Summary by Category');
  ws2.addRow(['Category', 'Count', 'Total Amount (₹)']).font = { bold: true };

  const byCategory = {};
  expenses.forEach(e => {
    const key = e.category?.name || 'Uncategorised';
    if (!byCategory[key]) byCategory[key] = { count: 0, total: 0 };
    byCategory[key].count++;
    byCategory[key].total += e.amount;
  });

  Object.entries(byCategory).forEach(([cat, data]) => {
    const r = ws2.addRow([cat, data.count, data.total]);
    r.getCell(3).numFmt = '₹#,##0.00';
  });

  ws2.columns = [{ width: 30 }, { width: 10 }, { width: 20 }];

  // Return as Buffer
  return wb.xlsx.writeBuffer();
};

module.exports = { generateExpenseExcel };
