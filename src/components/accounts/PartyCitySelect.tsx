import React, { useState, useEffect, useRef, useMemo } from 'react';
import { MapPin, ChevronDown, Plus, Check, X, AlertCircle } from 'lucide-react';
import { api } from '../../services/api';

interface PartyCitySelectProps {
  value: string;
  onChange: (city: string) => void;
  placeholder?: string;
  className?: string;
}

function normalizeCity(raw: string): string {
  return String(raw || '')
    .trim()
    .replace(/\s+/g, ' ');
}

export const PartyCitySelect: React.FC<PartyCitySelectProps> = ({
  value,
  onChange,
  placeholder = 'Search or select city...',
  className = '',
}) => {
  const [cities, setCities] = useState<string[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [searchText, setSearchText] = useState(value || '');
  const [highlightedIndex, setHighlightedIndex] = useState<number>(0);

  // Inline "Add New City" sub-mode when user clicks "+ Add New City" without typing first
  const [showAddNewBox, setShowAddNewBox] = useState(false);
  const [newCityInput, setNewCityInput] = useState('');
  const [addingCity, setAddingCity] = useState(false);
  const [cityError, setCityError] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const newCityInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Sync external value into search input when not actively editing
  useEffect(() => {
    setSearchText(value || '');
  }, [value]);

  // Load existing cities from persistent database & saved party records
  const loadCities = async () => {
    try {
      const res = await api.getPartyCities();
      if (Array.isArray(res.cities)) {
        setCities(res.cities);
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    loadCities();
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setShowAddNewBox(false);
        setCityError(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const normalizedQuery = normalizeCity(searchText);

  const filteredCities = useMemo(() => {
    if (!normalizedQuery) return cities;
    const qLower = normalizedQuery.toLowerCase();
    return cities.filter((c) => c.toLowerCase().includes(qLower));
  }, [cities, normalizedQuery]);

  const exactMatchCity = useMemo(() => {
    if (!normalizedQuery) return null;
    const qLower = normalizedQuery.toLowerCase();
    return cities.find((c) => c.toLowerCase() === qLower) || null;
  }, [cities, normalizedQuery]);

  // Reset highlighted index when filtered list changes
  useEffect(() => {
    setHighlightedIndex(0);
  }, [filteredCities.length, normalizedQuery]);

  // Keep highlighted option scrolled into view
  useEffect(() => {
    if (!isOpen || !listRef.current) return;
    const activeEl = listRef.current.querySelector(
      `[data-city-idx="${highlightedIndex}"]`
    ) as HTMLElement | null;
    if (activeEl) {
      activeEl.scrollIntoView({ block: 'nearest' });
    }
  }, [highlightedIndex, isOpen]);

  const handleSelectCity = (city: string) => {
    const clean = normalizeCity(city);
    setSearchText(clean);
    onChange(clean);
    setIsOpen(false);
    setShowAddNewBox(false);
    setCityError(null);
  };

  const handleSaveNewCity = async (rawCandidate: string) => {
    const candidate = normalizeCity(rawCandidate);
    setCityError(null);

    if (!candidate) {
      setCityError('Please enter a city name.');
      return;
    }

    // Check case-insensitive / whitespace duplicate locally first
    const existingDup = cities.find((c) => c.toLowerCase() === candidate.toLowerCase());
    if (existingDup) {
      setCityError(`City "${existingDup}" already exists.`);
      handleSelectCity(existingDup);
      return;
    }

    try {
      setAddingCity(true);
      const res = await api.createPartyCity(candidate);
      const savedCity = res.city || candidate;
      const updatedList = Array.isArray(res.cities)
        ? res.cities
        : [...cities, savedCity].sort((a, b) =>
            a.localeCompare(b, undefined, { sensitivity: 'base' })
          );
      setCities(updatedList);
      setNewCityInput('');
      setShowAddNewBox(false);
      handleSelectCity(savedCity);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setCityError(msg);
    } finally {
      setAddingCity(false);
    }
  };

  const handleOpenAddNewBox = () => {
    setCityError(null);
    if (normalizedQuery && !exactMatchCity) {
      // Directly save the typed city name or prefill it
      handleSaveNewCity(normalizedQuery);
      return;
    }
    setShowAddNewBox(true);
    setNewCityInput('');
    setTimeout(() => {
      newCityInputRef.current?.focus();
    }, 20);
  };

  // Total navigable items in dropdown: filteredCities + 1 ("Add New City" action)
  const totalOptions = filteredCities.length + 1;
  const addNewOptionIndex = filteredCities.length;

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
        if (highlightedIndex >= 0 && highlightedIndex < filteredCities.length) {
          handleSelectCity(filteredCities[highlightedIndex]);
        } else if (highlightedIndex === addNewOptionIndex) {
          handleOpenAddNewBox();
        } else if (exactMatchCity) {
          handleSelectCity(exactMatchCity);
        }
      }
    } else if (e.key === 'Escape') {
      if (isOpen) {
        e.preventDefault();
        e.stopPropagation();
        setIsOpen(false);
        setShowAddNewBox(false);
        setCityError(null);
      }
    } else if (e.key === 'Tab') {
      if (isOpen) {
        setIsOpen(false);
        setShowAddNewBox(false);
      }
    }
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div className="relative flex items-center">
        <input
          ref={inputRef}
          type="text"
          value={searchText}
          onChange={(e) => {
            const val = e.target.value;
            setSearchText(val);
            onChange(val);
            setCityError(null);
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
          className="w-full pl-3 pr-8 py-1.5 text-xs rounded-lg border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-1 focus:ring-emerald-500"
        />
        {searchText && (
          <button
            type="button"
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation();
              setSearchText('');
              onChange('');
              setCityError(null);
              inputRef.current?.focus();
            }}
            className="absolute right-6 p-0.5 text-slate-400 hover:text-slate-600 cursor-pointer"
            title="Clear city"
          >
            <X className="w-3 h-3" />
          </button>
        )}
        <button
          type="button"
          tabIndex={-1}
          onClick={() => {
            setIsOpen((prev) => !prev);
            setShowAddNewBox(false);
            setCityError(null);
          }}
          className="absolute right-1.5 p-1 text-slate-500 hover:text-slate-800 cursor-pointer"
          title="Toggle city list"
        >
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {isOpen && (
        <div
          ref={listRef}
          className="absolute left-0 right-0 z-50 mt-1 bg-white rounded-lg border border-slate-300 shadow-xl overflow-hidden"
        >
          <div className="max-h-48 overflow-y-auto divide-y divide-slate-100">
            {filteredCities.length > 0 ? (
              filteredCities.map((city, idx) => {
                const isSelected = value && value.trim().toLowerCase() === city.toLowerCase();
                const isHighlighted = idx === highlightedIndex && !showAddNewBox;
                return (
                  <button
                    key={city}
                    type="button"
                    data-city-idx={idx}
                    onMouseEnter={() => setHighlightedIndex(idx)}
                    onClick={() => handleSelectCity(city)}
                    className={`w-full px-3 py-1.5 text-left text-xs flex items-center justify-between transition-colors cursor-pointer ${
                      isHighlighted
                        ? 'bg-emerald-600 text-white font-semibold'
                        : isSelected
                        ? 'bg-emerald-50 text-emerald-900 font-semibold'
                        : 'text-slate-800 hover:bg-slate-50'
                    }`}
                  >
                    <span className="flex items-center gap-1.5 truncate">
                      <MapPin
                        className={`w-3 h-3 shrink-0 ${
                          isHighlighted ? 'text-emerald-100' : 'text-emerald-600'
                        }`}
                      />
                      <span className="truncate">{city}</span>
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
                  ? `No existing city matching "${normalizedQuery}".`
                  : 'No saved cities yet. Click "Add New City" below.'}
              </div>
            )}
          </div>

          {/* Add New City Action / Inline Form */}
          <div className="border-t border-slate-200 bg-slate-50 p-1.5">
            {!showAddNewBox ? (
              <button
                type="button"
                data-city-idx={addNewOptionIndex}
                onMouseEnter={() => setHighlightedIndex(addNewOptionIndex)}
                onClick={handleOpenAddNewBox}
                disabled={addingCity}
                className={`w-full px-2.5 py-1.5 rounded-md text-xs font-bold flex items-center justify-between transition-colors cursor-pointer ${
                  highlightedIndex === addNewOptionIndex
                    ? 'bg-emerald-700 text-white'
                    : 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100 border border-emerald-200'
                }`}
              >
                <span className="flex items-center gap-1.5 truncate">
                  <Plus className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">
                    {normalizedQuery && !exactMatchCity
                      ? `Add New City "${normalizedQuery}"`
                      : 'Add New City'}
                  </span>
                </span>
                <span className="text-[10px] font-normal opacity-80 shrink-0 ml-2">Save to DB</span>
              </button>
            ) : (
              <div className="space-y-1.5 p-1">
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-600">
                  Enter New City Name
                </label>
                <div className="flex items-center gap-1.5">
                  <input
                    ref={newCityInputRef}
                    type="text"
                    value={newCityInput}
                    onChange={(e) => {
                      setNewCityInput(e.target.value);
                      setCityError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        e.stopPropagation();
                        handleSaveNewCity(newCityInput);
                      } else if (e.key === 'Escape') {
                        e.preventDefault();
                        e.stopPropagation();
                        setShowAddNewBox(false);
                        setCityError(null);
                      }
                    }}
                    placeholder="e.g. Dolatpur, Nawabshah..."
                    className="flex-1 px-2.5 py-1 text-xs rounded border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                  <button
                    type="button"
                    disabled={addingCity}
                    onClick={() => handleSaveNewCity(newCityInput)}
                    className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
                  >
                    {addingCity ? 'Saving...' : 'Save'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddNewBox(false);
                      setCityError(null);
                    }}
                    className="p-1 rounded text-slate-500 hover:bg-slate-200 cursor-pointer"
                    title="Cancel"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}

            {cityError && (
              <div className="mt-1 px-2 py-1 rounded bg-rose-50 border border-rose-200 text-rose-700 text-[10px] flex items-center gap-1">
                <AlertCircle className="w-3 h-3 shrink-0 text-rose-600" />
                <span>{cityError}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
