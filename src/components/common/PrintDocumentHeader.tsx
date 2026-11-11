import React, { useState, useEffect } from 'react';
import { api } from '../../services/api';
import { CompanySettings } from '../../types/system';

export interface PrintMetaItem {
  label: string;
  value: string | number;
}

export interface PrintDocumentHeaderProps {
  title: string;
  subtitle?: string;
  metaItems?: PrintMetaItem[];
  metaFields?: PrintMetaItem[];
  dateRange?: { fromDate?: string; toDate?: string };
  showInPreview?: boolean;
  settings?: CompanySettings | null;
}

export const PrintDocumentHeader: React.FC<PrintDocumentHeaderProps> = ({
  title,
  subtitle,
  metaItems = [],
  metaFields = [],
  dateRange,
  showInPreview = false,
  settings: propSettings,
}) => {
  const [settings, setSettings] = useState<CompanySettings | null>(propSettings || null);

  const effectiveMetaItems: PrintMetaItem[] = [
    ...(dateRange?.fromDate || dateRange?.toDate
      ? [{ label: 'Date Range', value: `${dateRange.fromDate || 'Start'} to ${dateRange.toDate || 'Present'}` }]
      : []),
    ...metaItems,
    ...metaFields,
  ];

  useEffect(() => {
    if (propSettings) {
      setSettings(propSettings);
      return;
    }
    let mounted = true;
    api
      .getCompanySettings()
      .then((res) => {
        if (mounted && res?.data) {
          setSettings(res.data);
        }
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [propSettings]);

  const storeName = settings?.store_name || 'ABRAR MEDICAL STORE';
  const legalName = settings?.legal_name || 'Retail & Wholesale Chemists & Pharmacists';
  const drugLicense = settings?.drug_license_number || 'DL-PK-LHR-2026-0891';
  const ntnNumber = settings?.ntn_tax_number || 'NTN-PK-9812450-7';
  const address = settings?.address || 'Main Commercial Market, Lahore, Punjab, Pakistan';
  const phone = settings?.phone || '+92 42 35789000';
  const mobile = settings?.mobile || '';
  const logoUrl = settings?.logo_data_url || '';

  const nowFormatted = new Date().toLocaleString('en-PK', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  return (
    <div
      className={`ams-print-document-header w-full border-b-2 border-slate-900 pb-3 mb-4 ${
        showInPreview ? 'block' : 'hidden print:block'
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        {/* Left: Pharmacy Brand & Registration */}
        <div className="flex items-start gap-3">
          {logoUrl ? (
            <img
              src={logoUrl}
              alt={storeName}
              className="w-14 h-14 object-contain rounded border border-slate-300 p-0.5 shrink-0"
            />
          ) : (
            <div className="w-12 h-12 bg-slate-900 text-white rounded flex items-center justify-center font-extrabold text-xl shrink-0">
              AMS
            </div>
          )}
          <div>
            <h1 className="text-xl font-black tracking-tight text-slate-900 uppercase">
              {storeName}
            </h1>
            <p className="text-xs font-semibold text-slate-700">{legalName}</p>
            <p className="text-[11px] text-slate-600 mt-0.5">{address}</p>
            <div className="flex flex-wrap items-center gap-x-3 text-[10px] font-mono font-medium text-slate-600 mt-0.5">
              <span>Tel: {phone}</span>
              {mobile && <span>Mob: {mobile}</span>}
              <span className="font-bold text-slate-800">Drug License: {drugLicense}</span>
              <span className="font-bold text-slate-800">NTN: {ntnNumber}</span>
            </div>
          </div>
        </div>

        {/* Right: Document Title & Timestamp */}
        <div className="text-right shrink-0">
          <div className="inline-block px-3 py-1 bg-slate-900 text-white font-extrabold text-xs uppercase tracking-wider rounded">
            {title}
          </div>
          {subtitle && (
            <div className="text-[11px] font-semibold text-slate-700 mt-1">{subtitle}</div>
          )}
          <div className="text-[9px] text-slate-500 font-mono mt-1">
            Generated: {nowFormatted}
          </div>
        </div>
      </div>

      {/* Meta Items Filter Strip (Account, Date Range, etc.) */}
      {effectiveMetaItems.length > 0 && (
        <div className="mt-2.5 pt-2 border-t border-slate-200 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]">
          {effectiveMetaItems.map((item, idx) => (
            <div key={idx} className="bg-slate-50 border border-slate-200 rounded px-2 py-1">
              <span className="text-slate-500 font-bold block uppercase text-[9px]">
                {item.label}:
              </span>
              <span className="font-semibold text-slate-900 truncate block">
                {String(item.value)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
