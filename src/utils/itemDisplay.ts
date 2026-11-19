/**
 * Combines an item's base name with its row-level remarks for display ONLY.
 * Never mutates the underlying item_name or database record.
 *
 * Example:
 *   formatItemNameWithRemarks('Panadol Tab', 'Finished') => 'Panadol Tab (Finished)'
 *   formatItemNameWithRemarks('Panadol Tab', '')         => 'Panadol Tab'
 */
export function formatItemNameWithRemarks(
  itemName: string | null | undefined,
  remarks?: string | null
): string {
  const base = String(itemName || '').trim();
  const note = String(remarks || '').trim();
  if (!base) return '';
  if (!note) return base;
  const suffix = `(${note})`;
  if (base.endsWith(suffix)) return base;
  return `${base} ${suffix}`;
}

/**
 * Case-insensitive trimmed check for whether an item's company matches the selected company filter.
 * When selectedCompany is empty/whitespace, returns true (all companies).
 */
export function matchesSelectedCompany(
  itemCompany: string | null | undefined,
  selectedCompany: string | null | undefined
): boolean {
  const target = String(selectedCompany || '').trim().toLowerCase();
  if (!target) return true;
  return String(itemCompany || '').trim().toLowerCase() === target;
}

/**
 * Merges Company Master names with any companies present in loaded items,
 * deduplicating case-insensitively and sorting alphabetically A–Z.
 */
export function mergeCompanyMasterOptions(
  masterCompanies: Array<string | null | undefined>,
  items: Array<{ company_name?: string | null }>
): string[] {
  const byKey = new Map<string, string>();
  const add = (raw: string | null | undefined) => {
    const clean = String(raw || '').trim().replace(/\s+/g, ' ');
    if (!clean) return;
    const key = clean.toLowerCase();
    if (!byKey.has(key)) {
      byKey.set(key, clean);
    }
  };
  for (const c of masterCompanies || []) add(c);
  for (const it of items || []) add(it?.company_name);
  return Array.from(byKey.values()).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' })
  );
}
