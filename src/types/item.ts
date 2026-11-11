export interface Item {
  id: number;
  item_code: string;
  company_name: string;
  item_name: string;
  generic_name: string | null;
  category: string;
  packing: string;
  barcode: string | null;
  purchase_price: number;
  trade_price: number;
  wholesale_price: number;
  retail_price: number;
  loose_rate?: number;
  discount_percent: number;
  tax_percent: number;
  opening_stock: number;
  minimum_stock: number;
  rack_number: string | null;
  status: 'Active' | 'Inactive';
  created_at: string;
  updated_at: string;
}

export type ItemFormData = Omit<Item, 'id' | 'created_at' | 'updated_at'>;

export interface ItemStats {
  totalItems: number;
  activeItems: number;
  lowStockItems: number;
  totalTradeValue: number;
  totalRetailValue: number;
  totalStockUnits: number;
}

export interface ItemsResponse {
  success: boolean;
  items: Item[];
  count: number;
  stats: ItemStats;
  filters: {
    categories: string[];
    companies: string[];
  };
  error?: string;
}
