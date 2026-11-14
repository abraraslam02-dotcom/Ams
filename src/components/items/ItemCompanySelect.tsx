import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Building2, ChevronDown, Plus, Check, X, AlertCircle } from 'lucide-react';
import { api } from '../../services/api';

interface ItemCompanySelectProps {
  value: string;
  onChange: (company: string) => void;
  onCompanyCreated?: (companies: string[]) => void;
  placeholder?: string;
  className?: string;
  required?: boolean;
}

export function normalizeCompanyLabel(raw: string): string {
  return String(raw || '')
    .trim()
    .replace(/\s+/g, ' ');
}

export const ItemCompanySelect: React.FC<ItemCompanySelectProps> = ({
  value,
  onChange,
  onCompanyCreated,
  placeholder = 'Search or select company...',
  className = '',
  required = false,
}) => {
  const [companies, setCompanies] = useState<string[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [searchText, setSearchText] = useState(value || '');
  const [highlightedIndex, setHighlightedIndex] = useState<number>(0);

  // Small popup state for "Add New Company"
  const [showAddPopup, setShowAddPopup] = useState(false);
  const [newCompanyInput, setNewCompanyInput] = useState('');
  const [savingCompany, setSavingCompany] = useState(false);
  const [popupError, setPopupError] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const popupInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Sync external value into input when editing or opening modal
  useEffect(() => {
    setSearchText(value || '');
  }, [value]);

  const loadCompanies = async () => {
    try {
      const res = await api.getItemCompanies();
      if (Array.isArray(res.companies)) {
        setCompanies(res.companies);
      }
    } catch {
      // Offline / error handled in api.getItemCompanies
    }
  };

  useEffect(() => {
    loadCompanies();
  }, []);

  // Close dropdown on outside click (do not close if Add Company popup is open)
  useEffect(() => {
    if (!isOpen || showAddPopup) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, showAddPopup]);

  const normalizedQuery = normalizeCompanyLabel(searchText);

  const filteredCompanies = useMemo(() => {
    if (!normalizedQuery) return companies;
    const qLower = normalizedQuery.toLowerCase();
    return companies.filter((c) => c.toLowerCase().includes(qLower));
  }, [companies, normalizedQuery]);

  const exactMatchCompany = useMemo(() => {
    if (!normalizedQuery) return null;
    const qLower = normalizedQuery.toLowerCase();
    return companies.find((c) => c.toLowerCase() === qLower) || null;
  }, [companies, normalizedQuery]);

  useEffect(() => {
    setHighlightedIndex(0);
  }, [filteredCompanies.length, normalizedQuery]);

  useEffect(() => {
    if (!isOpen || !listRef.current) return;
    const activeEl = listRef.current.querySelector(
      `[data-company-idx="${highlightedIndex}"]`
    ) as HTMLElement | null;
    if (activeEl) {
      activeEl.scrollIntoView({ block: 'nearest' });
    }
  }, [highlightedIndex, isOpen]);

  const handleSelectCompany = (company: string) => {
    const clean = normalizeCompanyLabel(company);
    setSearchText(clean);
    onChange(clean);
    setIsOpen(false);
  };

  const handleOpenAddCompanyPopup = () => {
    setPopupError(null);
    setNewCompanyInput(normalizedQuery && !exactMatchCompany ? normalizedQuery : '');
    setShowAddPopup(true);
    setTimeout(() => {
      popupInputRef.current?.focus();
      popupInputRef.current?.select();
    }, 25);
  };

  const handleCloseAddCompanyPopup = () => {
    setShowAddPopup(false);
    setPopupError(null);
    setNewCompanyInput('');
  };

  const handleSaveNewCompany = async (rawCandidate: string) => {
    const candidate = normalizeCompanyLabel(rawCandidate);
    setPopupError(null);

    if (!candidate) {
      setPopupError('Please enter a company name.');
      return;
    }

    // Strict case-insensitive duplicate prevention against existing Company Master
    const existingDup = companies.find((c) => c.toLowerCase() === candidate.toLowerCase());
    if (existingDup) {
      setPopupError(
        `Company "${existingDup}" already exists. Duplicate company names are not allowed.`
      );
      return;
    }

    try {
      setSavingCompany(true);
      const res = await api.createItemCompany(candidate);
      const savedCompany = res.company || candidate;
      const updatedList = Array.isArray(res.companies)
        ? res.companies
        : [...companies, savedCompany].sort((a, b) =>
            a.localeCompare(b, undefined, { sensitivity: 'base' })
          );
      setCompanies(updatedList);
      onCompanyCreated?.(updatedList);
      setSearchText(savedCompany);
      onChange(savedCompany);
      setShowAddPopup(false);
      setIsOpen(false);
      setNewCompanyInput('');
      setPopupError(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setPopupError(msg);
    } finally {
      setSavingCompany(false);
    }
  };

  const totalOptions = filteredCompanies.length + 1;
  const addNewOptionIndex = filteredCompanies.length;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        setHighlightedIndex(0);
      } else {
        setHighlightedIndex((prev) => (prev + 1) % Math.max(1, totalOptions));
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        setHighlightedIndex(0);
      } else {
        setHighlightedIndex(
          (prev) => (prev - 1 + Math.max(1, totalOptions)) % Math.max(1, totalOptions)
        );
      }
    } else if (e.key === 'Enter') {
      if (isOpen) {
        e.preventDefault();
        if (highlightedIndex >= 0 && highlightedIndex < filteredCompanies.length) {
          handleSelectCompany(filteredCompanies[highlightedIndex]);
        } else if (highlightedIndex === addNewOptionIndex) {
          handleOpenAddCompanyPopup();
        } else if (exactMatchCompany) {
          handleSelectCompany(exactMatchCompany);
        }
      }
    } else if (e.key === 'Escape') {
      if (isOpen) {
        e.preventDefault();
        e.stopPropagation();
        setIsOpen(false);
      }
    } else if (e.key === 'Tab') {
      if (isOpen) {
        setIsOpen(false);
      }
    }
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div className="relative flex items-center">
        <input
          ref={inputRef}
          type="text"
          required={required}
          value={searchText}
          onChange={(e) => {
            const val = e.target.value;
            setSearchText(val);
            onChange(val);
            if (!isOpen) {
              setIsOpen(true);
            }
          }}
          onFocus={() => {
            if (!isOpen) {
              setIsOpen(true);
            }
          }}
          onClick={() => {
            if (!isOpen) {
              setIsOpen(true);
            }
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          autoComplete="off"
          aria-label="Company Name"
          className="w-full pl-3 pr-12 py-1.5 text-xs rounded-lg border border-slate-300 bg-slate-50 focus:bg-white text-slate-900 focus:outline-none focus:ring-1 focus:ring-emerald-500"
        />
        {searchText && (
          <button
            type="button"
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation();
              setSearchText('');
              onChange('');
              setIsOpen(true);
              inputRef.current?.focus();
            }}
            className="absolute right-6 p-0.5 text-slate-400 hover:text-slate-600 cursor-pointer"
            title="Clear company"
          >
            <X className="w-3 h-3" />
          </button>
        )}
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setIsOpen((prev) => !prev)}
          className="absolute right-1.5 p-1 text-slate-500 hover:text-slate-800 cursor-pointer"
          title="Toggle company list"
        >
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {/* Searchable Dropdown List */}
      {isOpen && (
        <div
          ref={listRef}
          className="absolute left-0 right-0 z-50 mt-1 bg-white rounded-lg border border-slate-300 shadow-xl overflow-hidden"
        >
          <div className="max-h-48 overflow-y-auto divide-y divide-slate-100">
            {filteredCompanies.length > 0 ? (
              filteredCompanies.map((company, idx) => {
                const isSelected = value && value.trim().toLowerCase() === company.toLowerCase();
                const isHighlighted = idx === highlightedIndex;
                return (
                  <button
                    key={company}
                    type="button"
                    data-company-idx={idx}
                    onMouseEnter={() => setHighlightedIndex(idx)}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      handleSelectCompany(company);
                    }}
                    className={`w-full px-3 py-1.5 text-left text-xs flex items-center justify-between transition-colors cursor-pointer ${
                      isHighlighted
                        ? 'bg-emerald-600 text-white font-semibold'
                        : isSelected
                        ? 'bg-emerald-50 text-emerald-900 font-semibold'
                        : 'text-slate-800 hover:bg-slate-50'
                    }`}
                  >
                    <span className="flex items-center gap-1.5 truncate">
                      <Building2
                        className={`w-3 h-3 shrink-0 ${
                          isHighlighted ? 'text-emerald-100' : 'text-emerald-600'
                        }`}
                      />
                      <span className="truncate">{company}</span>
                    </span>
                    {isSelected && (
                      <Check
                        className={`w-3.5 h-3.5 shrink-0 ${
                          isHighlighted ? 'text-white' : 'text-emerald-600'
                        }`}
                      />
                    )}
                  </button>
                );
              })
            ) : (
              <div className="px-3 py-2 text-[11px] text-slate-500">
                {normalizedQuery
                  ? `No existing company matching "${normalizedQuery}".`
                  : 'No companies saved yet. Click "Add New Company" below.'}
              </div>
            )}
          </div>

          {/* Add New Company Trigger inside Dropdown */}
          <div className="border-t border-slate-200 bg-slate-50 p-1.5">
            <button
              type="button"
              data-company-idx={addNewOptionIndex}
              onMouseEnter={() => setHighlightedIndex(addNewOptionIndex)}
              onMouseDown={(e) => {
                e.preventDefault();
                handleOpenAddCompanyPopup();
              }}
              className={`w-full px-2.5 py-1.5 rounded-md text-xs font-bold flex items-center justify-between transition-colors cursor-pointer ${
                highlightedIndex === addNewOptionIndex
                  ? 'bg-emerald-700 text-white'
                  : 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100 border border-emerald-200'
              }`}
            >
              <span className="flex items-center gap-1.5 truncate">
                <Plus className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">
                  {normalizedQuery && !exactMatchCompany
                    ? `Add New Company "${normalizedQuery}"`
                    : 'Add New Company'}
                </span>
              </span>
              <span className="text-[10px] font-normal opacity-80 shrink-0 ml-2">Popup</span>
            </button>
          </div>
        </div>
      )}

      {/* Small Popup Modal to Enter & Save New Company */}
      {showAddPopup && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/50 backdrop-blur-[1px] p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              handleCloseAddCompanyPopup();
            }
          }}
        >
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-sm overflow-hidden">
            <div className="bg-slate-900 text-white px-4 py-2.5 flex items-center justify-between border-b border-slate-700">
              <div className="flex items-center gap-2">
                <Building2 className="w-4 h-4 text-emerald-400" />
                <h4 className="text-xs font-bold uppercase tracking-wider">Add New Company</h4>
              </div>
              <button
                type="button"
                onClick={handleCloseAddCompanyPopup}
                className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-3">
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-slate-700">
                  Company Name <span className="text-rose-500">*</span>
                </label>
                <input
                  ref={popupInputRef}
                  type="text"
                  value={newCompanyInput}
                  onChange={(e) => {
                    setNewCompanyInput(e.target.value);
                    setPopupError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      e.stopPropagation();
                      handleSaveNewCompany(newCompanyInput);
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      e.stopPropagation();
                      handleCloseAddCompanyPopup();
                    }
                  }}
                  placeholder="e.g. GSK, Abbott, Getz Pharma, Searle"
                  className="w-full px-3 py-2 text-xs font-semibold rounded-lg border border-slate-300 bg-slate-50 focus:bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
                <p className="text-[11px] text-slate-500">
                  Saved permanently to Company Master and auto-selected for this item.
                </p>
              </div>

              {popupError && (
                <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <span className="font-medium leading-snug">{popupError}</span>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1 border-t border-slate-100">
                <button
                  type="button"
                  onClick={handleCloseAddCompanyPopup}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-100 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={savingCompany}
                  onClick={() => handleSaveNewCompany(newCompanyInput)}
                  className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-xs"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{savingCompany ? 'Saving...' : 'Save Company'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
