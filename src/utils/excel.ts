import * as XLSX from 'xlsx';
import { Item, ItemPackingLevel, ItemPurchaseUnitConfig, ItemTaxType, ItemVariant } from '../types/item';
import { resolveItemTaxConfig } from './taxCalculation';
import { classifyItemCategory } from './itemCategory';

export const EXCEL_COLUMNS = [
  // Original 17 Items Master Columns + Tax Type & Tax Value (preserved order; NO Loose Rate column)
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
  { header: 'Tax Type', key: 'tax_type', width: 14 },
  { header: 'Tax Value', key: 'tax_value', width: 12 },
  { header: 'Tax %', key: 'tax_percent', width: 10 },
  { header: 'Opening Stock', key: 'opening_stock', width: 14 },
  { header: 'Minimum Stock', key: 'minimum_stock', width: 14 },
  { header: 'Rack Number', key: 'rack_number', width: 14 },
  { header: 'Status', key: 'status', width: 12 },

  // A. Variant Management Columns
  { header: 'Variant Group', key: 'variant_group', width: 18 },
  { header: 'Variant Name', key: 'variant_name', width: 22 },
  { header: 'Variant Code', key: 'variant_code', width: 16 },
  { header: 'Variant Attributes', key: 'variant_attributes', width: 28 },

  // B. Multi-Level Packing Columns
  { header: 'Packing Level', key: 'packing_level', width: 14 },
  { header: 'Packing Unit', key: 'packing_unit', width: 15 },
  { header: 'Quantity per Parent Unit', key: 'quantity_per_parent', width: 22 },
  { header: 'Base Unit Conversion', key: 'base_unit_conversion', width: 20 },
  { header: 'Packing Barcode', key: 'packing_barcode', width: 18 },

  // C. Purchase Units Columns
  { header: 'Purchase Unit', key: 'purchase_unit', width: 15 },
  { header: 'Purchase Unit Conversion', key: 'purchase_unit_conversion', width: 24 },
  { header: 'Purchase Unit Rate', key: 'purchase_unit_rate', width: 19 },
  { header: 'Default Purchase Unit', key: 'default_purchase_unit', width: 20 },
  { header: 'Allow Fractional Purchase', key: 'allow_fractional_purchase', width: 24 },
];

export function formatVariantAttributesString(variant?: Partial<ItemVariant> | null): string {
  if (!variant) return '';
  const parts: string[] = [];
  if (variant.colour && String(variant.colour).trim()) {
    parts.push(`Colour: ${String(variant.colour).trim()}`);
  }
  if (variant.flavour && String(variant.flavour).trim()) {
    parts.push(`Flavour: ${String(variant.flavour).trim()}`);
  }
  if (variant.variant_type && String(variant.variant_type).trim()) {
    parts.push(`Type: ${String(variant.variant_type).trim()}`);
  }
  if (variant.other_attributes && String(variant.other_attributes).trim()) {
    parts.push(String(variant.other_attributes).trim());
  }
  return parts.join('; ');
}

function formatBoolLabel(val: unknown): string {
  if (val === true || val === 1 || String(val).toLowerCase() === 'yes' || String(val) === '1') {
    return 'Yes';
  }
  return 'No';
}

/**
 * Export items array directly to an Excel (.xlsx) file
 */
export function exportItemsToExcel(items: Item[], filename: string = 'Abrar_Medical_Store_Items.xlsx') {
  const data: Record<string, string | number>[] = [];

  for (const item of items) {
    const variants: ItemVariant[] = Array.isArray(item.variants) ? item.variants : [];
    const packingLevels: ItemPackingLevel[] = Array.isArray(item.packing_levels)
      ? [...item.packing_levels].sort((a, b) => Number(a.packing_level) - Number(b.packing_level))
      : [];
    const purchaseUnits: ItemPurchaseUnitConfig[] = Array.isArray(item.purchase_units)
      ? item.purchase_units
      : [];

    const rowCount = Math.max(variants.length, packingLevels.length, purchaseUnits.length, 1);

    for (let idx = 0; idx < rowCount; idx++) {
      const variant = variants[idx];
      const packingLevel = packingLevels[idx];
      const puConfig = purchaseUnits[idx];

      const effectivePurchaseUnit = puConfig
        ? puConfig.purchase_unit
        : idx === 0
        ? item.purchase_unit || ''
        : '';

      data.push({
        'Item Code': item.item_code,
        'Company Name': item.company_name,
        'Item Name': item.item_name,
        'Generic Name': item.generic_name || '',
        Category: classifyItemCategory(item.item_name),
        Packing: variant ? variant.packing || item.packing : item.packing,
        Barcode: variant ? variant.barcode || '' : item.barcode || '',
        'Purchase Price': Number(
          (variant && Number(variant.use_parent_pricing) === 0
            ? variant.purchase_price
            : item.purchase_price
          ).toFixed(2)
        ),
        'Trade Price': Number(
          (variant && Number(variant.use_parent_pricing) === 0
            ? variant.trade_price
            : item.trade_price
          ).toFixed(2)
        ),
        'Wholesale Price': Number(
          (variant && Number(variant.use_parent_pricing) === 0
            ? variant.wholesale_price
            : item.wholesale_price
          ).toFixed(2)
        ),
        'Retail Price': Number(
          (variant && Number(variant.use_parent_pricing) === 0
            ? variant.retail_price
            : item.retail_price
          ).toFixed(2)
        ),
        'Discount %': Number(
          (variant && Number(variant.use_parent_pricing) === 0
            ? variant.discount_percent
            : item.discount_percent
          ).toFixed(2)
        ),
        ...(() => {
          const taxCfg =
            variant && Number(variant.use_parent_pricing) === 0
              ? resolveItemTaxConfig({
                  tax_type: variant.tax_type,
                  tax_value: variant.tax_value,
                  tax_percent: variant.tax_percent,
                })
              : resolveItemTaxConfig({
                  tax_type: item.tax_type,
                  tax_value: item.tax_value,
                  tax_percent: item.tax_percent,
                });
          return {
            'Tax Type': taxCfg.tax_type === 'amount' ? 'Amount' : 'Percentage',
            'Tax Value': Number(taxCfg.tax_value.toFixed(2)),
            'Tax %': Number(taxCfg.tax_percent.toFixed(2)),
          };
        })(),
        'Opening Stock': variant ? variant.opening_stock : item.opening_stock,
        'Minimum Stock': variant ? variant.minimum_stock : item.minimum_stock,
        'Rack Number': (variant ? variant.rack_number : item.rack_number) || '',
        Status: variant ? variant.status : item.status,

        // A. Variant Management
        'Variant Group': variant?.variant_group || '',
        'Variant Name': variant?.variant_name || '',
        'Variant Code': variant?.variant_code || '',
        'Variant Attributes': formatVariantAttributesString(variant),

        // B. Multi-Level Packing
        'Packing Level': packingLevel ? packingLevel.packing_level : '',
        'Packing Unit': packingLevel ? packingLevel.packing_unit : '',
        'Quantity per Parent Unit': packingLevel ? packingLevel.quantity_per_parent : '',
        'Base Unit Conversion': packingLevel ? packingLevel.base_unit_conversion : '',
        'Packing Barcode': packingLevel?.packing_barcode || '',

        // C. Purchase Units
        'Purchase Unit': effectivePurchaseUnit,
        'Purchase Unit Conversion': puConfig ? puConfig.purchase_unit_conversion : '',
        'Purchase Unit Rate': puConfig ? Number(Number(puConfig.purchase_unit_rate || 0).toFixed(2)) : '',
        'Default Purchase Unit': puConfig
          ? formatBoolLabel(puConfig.is_default)
          : idx === 0 && effectivePurchaseUnit
          ? 'Yes'
          : '',
        'Allow Fractional Purchase': puConfig ? formatBoolLabel(puConfig.allow_fractional) : '',
      });
    }
  }

  const worksheet = XLSX.utils.json_to_sheet(data, {
    header: EXCEL_COLUMNS.map((c) => c.header),
  });

  // Set column widths
  worksheet['!cols'] = EXCEL_COLUMNS.map((col) => ({ wch: col.width }));

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Items Master');

  XLSX.writeFile(workbook, filename);
}

/**
 * Download a standard template for bulk Excel import (all 33 columns including Tax Type, Tax Value, Variants, Multi-Level Packing, Purchase Units)
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
      'Purchase Price': 285.0,
      'Trade Price': 300.0,
      'Wholesale Price': 315.0,
      'Retail Price': 350.0,
      'Discount %': 5.0,
      'Tax Type': 'Percentage',
      'Tax Value': 10.0,
      'Tax %': 10.0,
      'Opening Stock': 200,
      'Minimum Stock': 50,
      'Rack Number': 'A-12',
      Status: 'Active',
      'Variant Group': '',
      'Variant Name': '',
      'Variant Code': '',
      'Variant Attributes': '',
      'Packing Level': 2,
      'Packing Unit': 'Box',
      'Quantity per Parent Unit': 1,
      'Base Unit Conversion': 200,
      'Packing Barcode': '8964000123456',
      'Purchase Unit': 'Box',
      'Purchase Unit Conversion': 200,
      'Purchase Unit Rate': 285.0,
      'Default Purchase Unit': 'Yes',
      'Allow Fractional Purchase': 'Yes',
    },
    {
      'Item Code': 'MED-002',
      'Company Name': 'Abbott Pakistan',
      'Item Name': 'Brufen Plus 400mg',
      'Generic Name': 'Ibuprofen',
      Category: 'Tablet',
      Packing: '10x10',
      Barcode: '8964000987651',
      'Purchase Price': 265.0,
      'Trade Price': 280.0,
      'Wholesale Price': 295.0,
      'Retail Price': 330.0,
      'Discount %': 0.0,
      'Tax Type': 'Amount',
      'Tax Value': 15.0,
      'Tax %': 0.0,
      'Opening Stock': 50,
      'Minimum Stock': 15,
      'Rack Number': 'B-04',
      Status: 'Active',
      'Variant Group': 'Flavour & Formulation',
      'Variant Name': 'Mint Coated',
      'Variant Code': 'MED-002-01',
      'Variant Attributes': 'Flavour: Mint; Type: Film-Coated',
      'Packing Level': 1,
      'Packing Unit': 'Carton',
      'Quantity per Parent Unit': 1,
      'Base Unit Conversion': 2000,
      'Packing Barcode': '8964000200001',
      'Purchase Unit': 'Carton',
      'Purchase Unit Conversion': 2000,
      'Purchase Unit Rate': 5200.0,
      'Default Purchase Unit': 'No',
      'Allow Fractional Purchase': 'No',
    },
    {
      'Item Code': 'MED-002',
      'Company Name': 'Abbott Pakistan',
      'Item Name': 'Brufen Plus 400mg',
      'Generic Name': 'Ibuprofen',
      Category: 'Tablet',
      Packing: '10x10',
      Barcode: '8964000987652',
      'Purchase Price': 265.0,
      'Trade Price': 280.0,
      'Wholesale Price': 295.0,
      'Retail Price': 330.0,
      'Discount %': 0.0,
      'Tax Type': 'Amount',
      'Tax Value': 15.0,
      'Tax %': 0.0,
      'Opening Stock': 50,
      'Minimum Stock': 15,
      'Rack Number': 'B-04',
      Status: 'Active',
      'Variant Group': 'Flavour & Formulation',
      'Variant Name': 'Strawberry Sugar-Free',
      'Variant Code': 'MED-002-02',
      'Variant Attributes': 'Flavour: Strawberry; Type: Sugar-Free',
      'Packing Level': 2,
      'Packing Unit': 'Box',
      'Quantity per Parent Unit': 20,
      'Base Unit Conversion': 100,
      'Packing Barcode': '8964000200002',
      'Purchase Unit': 'Box',
      'Purchase Unit Conversion': 100,
      'Purchase Unit Rate': 265.0,
      'Default Purchase Unit': 'Yes',
      'Allow Fractional Purchase': 'Yes',
    },
    {
      'Item Code': 'MED-002',
      'Company Name': 'Abbott Pakistan',
      'Item Name': 'Brufen Plus 400mg',
      'Generic Name': 'Ibuprofen',
      Category: 'Tablet',
      Packing: '10x10',
      Barcode: '',
      'Purchase Price': 265.0,
      'Trade Price': 280.0,
      'Wholesale Price': 295.0,
      'Retail Price': 330.0,
      'Discount %': 0.0,
      'Tax Type': 'Amount',
      'Tax Value': 15.0,
      'Tax %': 0.0,
      'Opening Stock': 0,
      'Minimum Stock': 0,
      'Rack Number': 'B-04',
      Status: 'Active',
      'Variant Group': '',
      'Variant Name': '',
      'Variant Code': '',
      'Variant Attributes': '',
      'Packing Level': 3,
      'Packing Unit': 'Strip',
      'Quantity per Parent Unit': 10,
      'Base Unit Conversion': 10,
      'Packing Barcode': '8964000200003',
      'Purchase Unit': 'Strip',
      'Purchase Unit Conversion': 10,
      'Purchase Unit Rate': 27.0,
      'Default Purchase Unit': 'No',
      'Allow Fractional Purchase': 'Yes',
    },
    {
      'Item Code': 'MED-002',
      'Company Name': 'Abbott Pakistan',
      'Item Name': 'Brufen Plus 400mg',
      'Generic Name': 'Ibuprofen',
      Category: 'Tablet',
      Packing: '10x10',
      Barcode: '',
      'Purchase Price': 265.0,
      'Trade Price': 280.0,
      'Wholesale Price': 295.0,
      'Retail Price': 330.0,
      'Discount %': 0.0,
      'Tax Type': 'Amount',
      'Tax Value': 15.0,
      'Tax %': 0.0,
      'Opening Stock': 0,
      'Minimum Stock': 0,
      'Rack Number': 'B-04',
      Status: 'Active',
      'Variant Group': '',
      'Variant Name': '',
      'Variant Code': '',
      'Variant Attributes': '',
      'Packing Level': 4,
      'Packing Unit': 'Tablet',
      'Quantity per Parent Unit': 10,
      'Base Unit Conversion': 1,
      'Packing Barcode': '8964000200004',
      'Purchase Unit': '',
      'Purchase Unit Conversion': '',
      'Purchase Unit Rate': '',
      'Default Purchase Unit': '',
      'Allow Fractional Purchase': '',
    },
  ];

  const worksheet = XLSX.utils.json_to_sheet(templateSampleData, {
    header: EXCEL_COLUMNS.map((c) => c.header),
  });
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
  tax_type: ItemTaxType;
  tax_value: number;
  tax_percent: number;
  opening_stock: number;
  minimum_stock: number;
  rack_number: string;
  status: 'Active' | 'Inactive';

  // A. Variant Management
  variant_group: string;
  variant_name: string;
  variant_code: string;
  variant_attributes: string;

  // B. Multi-Level Packing
  packing_level: number | null;
  packing_unit: string;
  quantity_per_parent: number | null;
  base_unit_conversion: number | null;
  packing_barcode: string;

  // C. Purchase Units
  purchase_unit: string;
  purchase_unit_conversion: number | null;
  purchase_unit_rate: number | null;
  default_purchase_unit: boolean | null;
  allow_fractional_purchase: boolean | null;

  _isValid: boolean;
  _errors: string[];
}

function parseOptionalNum(valStr: string, decimals: number = 2): number | null {
  const clean = String(valStr || '').trim();
  if (!clean) return null;
  const parsed = parseFloat(clean.replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(parsed)) return null;
  const factor = Math.pow(10, decimals);
  return Math.round((parsed + Number.EPSILON) * factor) / factor;
}

function parseOptionalIntFromText(valStr: string): number | null {
  const clean = String(valStr || '').trim();
  if (!clean) return null;
  const match = clean.match(/-?\d+/);
  if (!match) return null;
  const parsed = parseInt(match[0], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseOptionalBool(valStr: string): boolean | null {
  const clean = String(valStr || '').trim().toLowerCase();
  if (!clean) return null;
  if (['yes', 'y', 'true', '1', 'default'].includes(clean)) return true;
  if (['no', 'n', 'false', '0'].includes(clean)) return false;
  return null;
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

        const firstItemByCode = new Map<
          string,
          {
            company_name: string;
            item_name: string;
            generic_name: string;
            category: string;
            packing: string;
            purchase_price: number;
            trade_price: number;
            wholesale_price: number;
            retail_price: number;
            discount_percent: number;
            tax_type: ItemTaxType;
            tax_value: number;
            tax_percent: number;
            rack_number: string;
            status: 'Active' | 'Inactive';
          }
        >();
        const seenPlainRowCodes = new Set<string>();
        const seenVariantCodes = new Set<string>();

        const parsedRows: ParsedExcelRow[] = rawJson.map((row) => {
          const rowErrors: string[] = [];

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

          const parseNum = (keys: string[], defaultVal: number = 0): number => {
            const valStr = findVal(keys);
            if (!valStr) return defaultVal;
            const parsed = parseFloat(valStr.replace(/[^0-9.-]/g, ''));
            return isNaN(parsed) ? defaultVal : Math.round(parsed * 100) / 100;
          };

          const item_code = findVal(['Item Code', 'item_code', 'Code', 'ItemCode']);
          const upperCode = item_code.toUpperCase();
          const baseSnapshot = upperCode ? firstItemByCode.get(upperCode) : undefined;

          const rawCompany = findVal(['Company Name', 'company_name', 'Company', 'Manufacturer']);
          const rawItemName = findVal(['Item Name', 'item_name', 'Item', 'Medicine Name', 'Brand Name']);
          const rawGeneric = findVal(['Generic Name', 'generic_name', 'Generic', 'Formula']);
          const rawPacking = findVal(['Packing', 'packing', 'Pack', 'Pack Size']);
          const barcode = findVal(['Barcode', 'barcode']);
          const rawRack = findVal(['Rack Number', 'rack_number', 'Rack', 'Shelf']);
          const statusRaw = findVal(['Status', 'status']);

          // A. Variant Management
          const variant_group = findVal(['Variant Group', 'variant_group', 'VariantGroup']);
          const variant_name = findVal(['Variant Name', 'variant_name', 'VariantName']);
          const variant_code = findVal(['Variant Code', 'variant_code', 'VariantCode']);
          const variant_attributes = findVal([
            'Variant Attributes',
            'variant_attributes',
            'VariantAttributes',
            'Attributes',
          ]);

          // B. Multi-Level Packing
          const packingLevelStr = findVal(['Packing Level', 'packing_level', 'PackingLevel']);
          const packing_level = parseOptionalIntFromText(packingLevelStr);
          const packing_unit = findVal(['Packing Unit', 'packing_unit', 'PackingUnit']);
          const quantity_per_parent = parseOptionalNum(
            findVal([
              'Quantity per Parent Unit',
              'Quantity Per Parent Unit',
              'quantity_per_parent',
              'quantity_per_parent_unit',
              'Qty per Parent Unit',
            ]),
            4
          );
          const base_unit_conversion = parseOptionalNum(
            findVal(['Base Unit Conversion', 'base_unit_conversion', 'BaseUnitConversion']),
            4
          );
          const packing_barcode = findVal(['Packing Barcode', 'packing_barcode', 'PackingBarcode']);

          // C. Purchase Units
          const purchase_unit = findVal(['Purchase Unit', 'purchase_unit', 'PurchaseUnit']);
          const purchase_unit_conversion = parseOptionalNum(
            findVal([
              'Purchase Unit Conversion',
              'purchase_unit_conversion',
              'PurchaseUnitConversion',
            ]),
            4
          );
          const purchase_unit_rate = parseOptionalNum(
            findVal(['Purchase Unit Rate', 'purchase_unit_rate', 'PurchaseUnitRate']),
            2
          );
          const defaultPurchaseRaw = findVal([
            'Default Purchase Unit',
            'default_purchase_unit',
            'DefaultPurchaseUnit',
            'Is Default Purchase Unit',
          ]);
          const allowFractionalRaw = findVal([
            'Allow Fractional Purchase',
            'allow_fractional_purchase',
            'AllowFractionalPurchase',
            'Allow Fractional',
          ]);
          const default_purchase_unit = parseOptionalBool(defaultPurchaseRaw);
          const allow_fractional_purchase = parseOptionalBool(allowFractionalRaw);

          const hasVariantInfo = Boolean(variant_name || variant_code);
          const hasPackingLevelInfo = Boolean(packing_unit || packing_level !== null || packing_barcode);
          const hasPurchaseUnitInfo = Boolean(purchase_unit);
          const isExtensionRow = hasVariantInfo || hasPackingLevelInfo || hasPurchaseUnitInfo;

          const company_name = rawCompany || (baseSnapshot ? baseSnapshot.company_name : '');
          const item_name = rawItemName || (baseSnapshot ? baseSnapshot.item_name : '');
          const generic_name = rawGeneric || (baseSnapshot ? baseSnapshot.generic_name : '');
          const category = classifyItemCategory(item_name);
          const packing = rawPacking || (baseSnapshot ? baseSnapshot.packing : '1x1');
          const rack_number = rawRack || (baseSnapshot ? baseSnapshot.rack_number : '');
          const status: 'Active' | 'Inactive' = statusRaw
            ? statusRaw.toLowerCase() === 'inactive'
              ? 'Inactive'
              : 'Active'
            : baseSnapshot
            ? baseSnapshot.status
            : 'Active';

          const purchase_price =
            findVal(['Purchase Price', 'purchase_price', 'Cost Price', 'Purchase']) !== ''
              ? parseNum(['Purchase Price', 'purchase_price', 'Cost Price', 'Purchase'])
              : baseSnapshot?.purchase_price ?? 0;
          const trade_price =
            findVal(['Trade Price', 'trade_price', 'TP', 'Trade']) !== ''
              ? parseNum(['Trade Price', 'trade_price', 'TP', 'Trade'])
              : baseSnapshot?.trade_price ?? 0;
          const wholesale_price =
            findVal(['Wholesale Price', 'wholesale_price', 'Wholesale']) !== ''
              ? parseNum(['Wholesale Price', 'wholesale_price', 'Wholesale'])
              : baseSnapshot?.wholesale_price ?? 0;
          const retail_price =
            findVal(['Retail Price', 'retail_price', 'MRP', 'Retail', 'Sale Price']) !== ''
              ? parseNum(['Retail Price', 'retail_price', 'MRP', 'Retail', 'Sale Price'])
              : baseSnapshot?.retail_price ?? 0;
          const discount_percent =
            findVal(['Discount %', 'discount_percent', 'Discount', 'Disc%']) !== ''
              ? parseNum(['Discount %', 'discount_percent', 'Discount', 'Disc%'])
              : baseSnapshot?.discount_percent ?? 0;
          const rawTaxTypeStr = findVal(['Tax Type', 'tax_type', 'TaxType']);
          const rawTaxValueStr = findVal(['Tax Value', 'tax_value', 'TaxValue', 'Fixed Tax', 'Tax Amount']);
          const rawTaxPctStr = findVal(['Tax %', 'tax_percent', 'Tax', 'GST']);

          let tax_type: ItemTaxType = baseSnapshot?.tax_type ?? 'percentage';
          if (rawTaxTypeStr) {
            const lowerTaxType = rawTaxTypeStr.trim().toLowerCase();
            if (['amount', 'fixed', 'fixed amount', 'fixed tax', 'rs', 'rs.', 'pkr', 'flat'].includes(lowerTaxType)) {
              tax_type = 'amount';
            } else if (['percentage', 'percent', '%', 'pct'].includes(lowerTaxType)) {
              tax_type = 'percentage';
            } else {
              rowErrors.push(`Invalid Tax Type "${rawTaxTypeStr}" (use "Percentage" or "Amount")`);
            }
          }

          const rawTaxValueNum =
            rawTaxValueStr !== ''
              ? parseNum(['Tax Value', 'tax_value', 'TaxValue', 'Fixed Tax', 'Tax Amount'])
              : rawTaxPctStr !== ''
                ? parseNum(['Tax %', 'tax_percent', 'Tax', 'GST'])
                : baseSnapshot?.tax_value ?? 0;

          if (rawTaxValueNum < 0) {
            rowErrors.push('Tax Value cannot be negative');
          }

          const taxCfg = resolveItemTaxConfig({
            tax_type,
            tax_value: Math.max(0, rawTaxValueNum),
            tax_percent: rawTaxPctStr !== '' ? Math.max(0, parseNum(['Tax %', 'tax_percent', 'Tax', 'GST'])) : undefined,
          });
          const tax_value = taxCfg.tax_value;
          const tax_percent = taxCfg.tax_percent;
          const opening_stock = parseNum(['Opening Stock', 'opening_stock', 'Stock', 'Qty']);
          const minimum_stock = parseNum(['Minimum Stock', 'minimum_stock', 'Min Stock', 'Alert Qty']);

          // Validations
          if (!item_code) {
            rowErrors.push('Item Code is required');
          } else {
            if (!baseSnapshot) {
              firstItemByCode.set(upperCode, {
                company_name,
                item_name,
                generic_name,
                category,
                packing,
                purchase_price,
                trade_price,
                wholesale_price,
                retail_price,
                discount_percent,
                tax_type,
                tax_value,
                tax_percent,
                rack_number,
                status,
              });
              if (!isExtensionRow) {
                seenPlainRowCodes.add(upperCode);
              }
            } else if (!isExtensionRow) {
              if (seenPlainRowCodes.has(upperCode)) {
                rowErrors.push(`Duplicate Item Code "${item_code}" inside this spreadsheet`);
              } else {
                rowErrors.push(
                  `Duplicate Item Code "${item_code}" without Variant, Packing Level, or Purchase Unit`
                );
              }
            }
          }

          if (!company_name) {
            rowErrors.push('Company Name is required');
          }
          if (!item_name) {
            rowErrors.push('Item Name is required');
          }

          if (variant_code) {
            const vKey = variant_code.toUpperCase();
            if (seenVariantCodes.has(vKey) && !hasPackingLevelInfo && !hasPurchaseUnitInfo) {
              rowErrors.push(`Duplicate Variant Code "${variant_code}" inside this spreadsheet`);
            } else {
              seenVariantCodes.add(vKey);
            }
          }
          if ((variant_group || variant_attributes) && !variant_name && !variant_code) {
            rowErrors.push('Variant Name or Variant Code is required when Variant Group/Attributes is provided');
          }

          if (packing_level !== null && packing_level < 1) {
            rowErrors.push('Packing Level must be 1 or greater');
          }
          if (packingLevelStr && !packing_unit) {
            rowErrors.push('Packing Unit is required when Packing Level is specified');
          }
          if (quantity_per_parent !== null && quantity_per_parent <= 0) {
            rowErrors.push('Quantity per Parent Unit must be greater than 0');
          }
          if (base_unit_conversion !== null && base_unit_conversion <= 0) {
            rowErrors.push('Base Unit Conversion must be greater than 0');
          }
          if (purchase_unit_conversion !== null && purchase_unit_conversion <= 0) {
            rowErrors.push('Purchase Unit Conversion must be greater than 0');
          }
          if (purchase_unit_rate !== null && purchase_unit_rate < 0) {
            rowErrors.push('Purchase Unit Rate cannot be negative');
          }
          if (defaultPurchaseRaw && default_purchase_unit === null) {
            rowErrors.push('Default Purchase Unit must be Yes or No');
          }
          if (allowFractionalRaw && allow_fractional_purchase === null) {
            rowErrors.push('Allow Fractional Purchase must be Yes or No');
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
            tax_type,
            tax_value,
            tax_percent,
            opening_stock,
            minimum_stock,
            rack_number,
            status,
            variant_group,
            variant_name,
            variant_code,
            variant_attributes,
            packing_level,
            packing_unit,
            quantity_per_parent,
            base_unit_conversion,
            packing_barcode,
            purchase_unit,
            purchase_unit_conversion,
            purchase_unit_rate,
            default_purchase_unit,
            allow_fractional_purchase,
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
