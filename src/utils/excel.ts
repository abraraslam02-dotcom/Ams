import * as XLSX from 'xlsx';
import { Item, ItemFormData } from '../types/item';

export const EXCEL_COLUMNS = [
  { header: 'Item Code', key: 'item_code', width: 14 },
  { header: 'Company Name', key: 'company_name', width: 22 },
  { header: 'Item Name', key: 'item_name', width: 26 },
  { header: 'Generic Name', key: 'generic_name', width: 22 },
  { header: 'Category', key: 'category', width: 14 },
  { header: 'Packing', key: 'packing', width: 14 },
  { header: 'Barcode', key: 'barcode', width: 16 },
  { header: 'Purchase Price', key: 'purchase_price', width: 15 },
  { header: 'Trade Price', key: 'trade_price', width: 15 },
  { header: 'Wholesale Price', key: 'wholesale_price', width: 15 },
  { header: 'Retail Price', key: 'retail_price', width: 15 },
  { header: 'Discount %', key: 'discount_percent', width: 12 },
  { header: 'Tax %', key: 'tax_percent', width: 10 },
  { header: 'Opening Stock', key: 'opening_stock', width: 14 },
  { header: 'Minimum Stock', key: 'minimum_stock', width: 14 },
  { header: 'Rack Number', key: 'rack_number', width: 14 },
  { header: 'Status', key: 'status', width: 12 },
];

/**
 * Export items array directly to an Excel (.xlsx) file
 */
export function exportItemsToExcel(items: Item[], filename: string = 'Abrar_Medical_Store_Items.xlsx') {
  const data = items.map((item) => ({
    'Item Code': item.item_code,
    'Company Name': item.company_name,
    'Item Name': item.item_name,
    'Generic Name': item.generic_name || '',
    Category: item.category,
    Packing: item.packing,
    Barcode: item.barcode || '',
    'Purchase Price': Number(item.purchase_price.toFixed(2)),
    'Trade Price': Number(item.trade_price.toFixed(2)),
    'Wholesale Price': Number(item.wholesale_price.toFixed(2)),
    'Retail Price': Number(item.retail_price.toFixed(2)),
    'Discount %': Number(item.discount_percent.toFixed(2)),
    'Tax %': Number(item.tax_percent.toFixed(2)),
    'Opening Stock': item.opening_stock,
    'Minimum Stock': item.minimum_stock,
    'Rack Number': item.rack_number || '',
    Status: item.status,
  }));

  const worksheet = XLSX.utils.json_to_sheet(data);

  // Set column widths
  worksheet['!cols'] = EXCEL_COLUMNS.map((col) => ({ wch: col.width }));

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Items Master');

  XLSX.writeFile(workbook, filename);
}

/**
 * Download a standard blank template for bulk Excel import
 */
export function downloadExcelTemplate() {
  const templateSampleData = [
    {
      'Item Code': 'MED-001',
      'Company Name': 'GSK Pakistan',
      'Item Name': 'Panadol 500mg',
      'Generic Name': 'Paracetamol',
      Category: 'Tablet',
      Packing: '20x10',
      Barcode: '8964000123456',
      'Purchase Price': 28.5,
      'Trade Price': 30.0,
      'Wholesale Price': 31.5,
      'Retail Price': 35.0,
      'Discount %': 5.0,
      'Tax %': 0.0,
      'Opening Stock': 200,
      'Minimum Stock': 50,
      'Rack Number': 'A-12',
      Status: 'Active',
    },
    {
      'Item Code': 'MED-002',
      'Company Name': 'Abbott Pakistan',
      'Item Name': 'Brufen 400mg',
      'Generic Name': 'Ibuprofen',
      Category: 'Tablet',
      Packing: '10x10',
      Barcode: '8964000987654',
      'Purchase Price': 45.0,
      'Trade Price': 48.0,
      'Wholesale Price': 50.0,
      'Retail Price': 55.0,
      'Discount %': 0.0,
      'Tax %': 0.0,
      'Opening Stock': 100,
      'Minimum Stock': 30,
      'Rack Number': 'B-04',
      Status: 'Active',
    },
  ];

  const worksheet = XLSX.utils.json_to_sheet(templateSampleData);
  worksheet['!cols'] = EXCEL_COLUMNS.map((col) => ({ wch: col.width }));

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Template');

  XLSX.writeFile(workbook, 'AMS_Items_Master_Import_Template.xlsx');
}

export interface ParsedExcelRow {
  item_code: string;
  company_name: string;
  item_name: string;
  generic_name: string;
  category: string;
  packing: string;
  barcode: string;
  purchase_price: number;
  trade_price: number;
  wholesale_price: number;
  retail_price: number;
  discount_percent: number;
  tax_percent: number;
  opening_stock: number;
  minimum_stock: number;
  rack_number: string;
  status: 'Active' | 'Inactive';
  _isValid: boolean;
  _errors: string[];
}

/**
 * Parses user-uploaded Excel (.xlsx or .csv) file
 */
export async function parseExcelFile(file: File): Promise<{
  rows: ParsedExcelRow[];
  validCount: number;
  invalidCount: number;
}> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const buffer = e.target?.result;
        const workbook = XLSX.read(buffer, { type: 'binary' });

        const firstSheetName = workbook.SheetNames[0];
        if (!firstSheetName) {
          throw new Error('Spreadsheet does not contain any sheets.');
        }

        const sheet = workbook.Sheets[firstSheetName];
        const rawJson = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });

        if (rawJson.length === 0) {
          throw new Error('Spreadsheet contains no data rows.');
        }

        const seenCodes = new Set<string>();

        const parsedRows: ParsedExcelRow[] = rawJson.map((row, index) => {
          const rowErrors: string[] = [];
          const rowNum = index + 2;

          // Flexible key lookup helper
          const findVal = (keys: string[]): string => {
            for (const key of keys) {
              for (const rowKey of Object.keys(row)) {
                if (rowKey.trim().toLowerCase() === key.toLowerCase()) {
                  return String(row[rowKey]).trim();
                }
              }
            }
            return '';
          };

          const item_code = findVal(['Item Code', 'item_code', 'Code', 'ItemCode']);
          const company_name = findVal(['Company Name', 'company_name', 'Company', 'Manufacturer']);
          const item_name = findVal(['Item Name', 'item_name', 'Item', 'Medicine Name', 'Brand Name']);
          const generic_name = findVal(['Generic Name', 'generic_name', 'Generic', 'Formula']);
          const category = findVal(['Category', 'category', 'Type', 'Dosage Form']) || 'Tablet';
          const packing = findVal(['Packing', 'packing', 'Pack', 'Pack Size']) || '1x1';
          const barcode = findVal(['Barcode', 'barcode']);
          const rack_number = findVal(['Rack Number', 'rack_number', 'Rack', 'Shelf']);
          const statusRaw = findVal(['Status', 'status']) || 'Active';
          const status: 'Active' | 'Inactive' =
            statusRaw.toLowerCase() === 'inactive' ? 'Inactive' : 'Active';

          const parseNum = (keys: string[], defaultVal: number = 0): number => {
            const valStr = findVal(keys);
            if (!valStr) return defaultVal;
            const parsed = parseFloat(valStr.replace(/[^0-9.-]/g, ''));
            return isNaN(parsed) ? defaultVal : Math.round(parsed * 100) / 100;
          };

          const purchase_price = parseNum(['Purchase Price', 'purchase_price', 'Cost Price', 'Purchase']);
          const trade_price = parseNum(['Trade Price', 'trade_price', 'TP', 'Trade']);
          const wholesale_price = parseNum(['Wholesale Price', 'wholesale_price', 'Wholesale']);
          const retail_price = parseNum(['Retail Price', 'retail_price', 'MRP', 'Retail', 'Sale Price']);
          const discount_percent = parseNum(['Discount %', 'discount_percent', 'Discount', 'Disc%']);
          const tax_percent = parseNum(['Tax %', 'tax_percent', 'Tax', 'GST']);
          const opening_stock = parseNum(['Opening Stock', 'opening_stock', 'Stock', 'Qty']);
          const minimum_stock = parseNum(['Minimum Stock', 'minimum_stock', 'Min Stock', 'Alert Qty']);

          // Validations
          if (!item_code) {
            rowErrors.push('Item Code is required');
          } else {
            const upperCode = item_code.toUpperCase();
            if (seenCodes.has(upperCode)) {
              rowErrors.push(`Duplicate Item Code "${item_code}" inside this spreadsheet`);
            } else {
              seenCodes.add(upperCode);
            }
          }

          if (!company_name) {
            rowErrors.push('Company Name is required');
          }
          if (!item_name) {
            rowErrors.push('Item Name is required');
          }

          return {
            item_code,
            company_name,
            item_name,
            generic_name,
            category,
            packing,
            barcode,
            purchase_price,
            trade_price,
            wholesale_price,
            retail_price,
            discount_percent,
            tax_percent,
            opening_stock,
            minimum_stock,
            rack_number,
            status,
            _isValid: rowErrors.length === 0,
            _errors: rowErrors,
          };
        });

        const validCount = parsedRows.filter((r) => r._isValid).length;
        const invalidCount = parsedRows.length - validCount;

        resolve({
          rows: parsedRows,
          validCount,
          invalidCount,
        });
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        reject(new Error(`Failed to parse Excel file: ${errorMsg}`));
      }
    };

    reader.onerror = () => {
      reject(new Error('Failed to read file from disk.'));
    };

    reader.readAsBinaryString(file);
  });
}
