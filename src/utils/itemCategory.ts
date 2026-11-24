export const ITEM_CATEGORIES = [
  'Drop',
  'Cream/ointment',
  'Syp/suspention',
  'Tablet',
  'Capsule',
  'Injection',
  'Infusion/drip',
  'Powder/sachets',
  'Other',
] as const;

export type ItemCategory = (typeof ITEM_CATEGORIES)[number];

/**
 * Automatically classifies an item's category based on keywords anywhere
 * within ITEMNAME (case-insensitive) using strict priority order.
 *
 * Rules:
 * 1. DROP or DROPS -> Drop
 * 2. CREAM, OINTMENT, OINT, or GEL (excluding SOFTGEL) -> Cream/ointment
 * 3. SYP, SYRUP, or SUSPENSION -> Syp/suspention
 * 4. TAB or TABLET -> Tablet
 * 5. CAP, CAPSULE, or SOFTGEL -> Capsule
 * 6. INJ or INJECTION -> Injection
 * 7. INFUSION or DRIP -> Infusion/drip
 * 8. SACHET or SCHET -> Powder/sachets
 * 9. Otherwise -> Other
 */
export function classifyItemCategory(itemName?: string | null): ItemCategory {
  const upper = String(itemName ?? '').toUpperCase();

  if (upper.includes('DROP')) {
    return 'Drop';
  }

  if (
    upper.includes('CREAM') ||
    upper.includes('OINTMENT') ||
    upper.includes('OINT') ||
    upper.replace(/SOFTGEL/g, '').includes('GEL')
  ) {
    return 'Cream/ointment';
  }

  if (upper.includes('SYP') || upper.includes('SYRUP') || upper.includes('SUSPENSION')) {
    return 'Syp/suspention';
  }

  if (upper.includes('TAB') || upper.includes('TABLET')) {
    return 'Tablet';
  }

  if (upper.includes('CAP') || upper.includes('CAPSULE') || upper.includes('SOFTGEL')) {
    return 'Capsule';
  }

  if (upper.includes('INJ') || upper.includes('INJECTION')) {
    return 'Injection';
  }

  if (upper.includes('INFUSION') || upper.includes('DRIP')) {
    return 'Infusion/drip';
  }

  if (upper.includes('SACHET') || upper.includes('SCHET')) {
    return 'Powder/sachets';
  }

  return 'Other';
}
