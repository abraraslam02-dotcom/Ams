export interface ItemVariantBarcode {
  id: number;
  item_id: number;
  variant_id: number | null;
  barcode: string;
  barcode_type: 'manufacturer' | 'generated';
  is_primary: number;
  created_at?: string;
}

export interface ItemVariant {
  id: number;
  parent_item_id: number;
  parent_item_code?: string;
  parent_item_name?: string;
  company_name?: string;
  category?: string;
  variant_code: string;
  variant_name: string;
  colour: string;
  flavour: string;
  variant_type: string;
  other_attributes: string;
  barcode: string;
  barcodes?: ItemVariantBarcode[];
  packing: string;
  effective_packing?: string;
  use_parent_pricing: number;
  purchase_price: number;
  trade_price: number;
  wholesale_price: number;
  retail_price: number;
  loose_rate: number;
  discount_percent: number;
  tax_percent: number;
  effective_purchase_price?: number;
  effective_trade_price?: number;
  effective_wholesale_price?: number;
  effective_retail_price?: number;
  effective_loose_rate?: number;
  effective_discount_percent?: number;
  effective_tax_percent?: number;
  opening_stock: number;
  minimum_stock: number;
  effective_minimum_stock?: number;
  rack_number: string;
  effective_rack_number?: string;
  image_id?: number | null;
  image_url?: string;
  thumbnail_url?: string;
  own_image_url?: string;
  own_thumbnail_url?: string;
  effective_image_url?: string;
  effective_thumbnail_url?: string;
  image_inherited?: boolean;
  current_stock_packs?: number;
  current_stock_units?: number;
  units_per_pack?: number;
  default_batch?: {
    inventory_id: number | null;
    batch_number: string;
    expiry_date: string;
    available_packs: number;
    available_units: number;
  };
  batches?: any[];
  status: 'Active' | 'Inactive';
  created_at?: string;
  updated_at?: string;
}

export type ItemPurchaseUnit = 'Carton' | 'Box' | 'Strip' | 'Tablet';

export interface Item {
  id: number;
  item_code: string;
  company_name: string;
  item_name: string;
  generic_name: string | null;
  category: string;
  packing: string;
  carton?: number | null;
  boxes_per_carton?: number | null;
  strips_per_box?: number | null;
  tablets_per_strip?: number | null;
  units_per_strip?: number;
  units_per_pack?: number;
  purchase_unit?: ItemPurchaseUnit | string | null;
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
  has_variants?: number | boolean;
  image_id?: number | null;
  image_url?: string | null;
  thumbnail_url?: string | null;
  variant_count?: number;
  active_variant_count?: number;
  consolidated_stock_packs?: number;
  variants?: ItemVariant[];
  status: 'Active' | 'Inactive';
  created_at: string;
  updated_at: string;
}

export type ItemFormData = Omit<
  Item,
  | 'id'
  | 'created_at'
  | 'updated_at'
  | 'variant_count'
  | 'active_variant_count'
  | 'consolidated_stock_packs'
  | 'variants'
>;

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
