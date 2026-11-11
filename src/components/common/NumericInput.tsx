import React, { useState, useEffect, useRef } from 'react';

export interface NumericInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  allowNegative?: boolean;
}

function formatPropToDisplay(val: unknown): string {
  if (val === null || val === undefined || val === '') return '';
  const str = String(val).trim();
  if (str === '' || str === '0' || str === '0.0' || str === '0.00') return '';
  const num = Number(str);
  if (!Number.isFinite(num) || num === 0) return '';
  return str;
}

export const NumericInput = React.forwardRef<HTMLInputElement, NumericInputProps>(
  ({ value, onChange, onFocus, onBlur, placeholder, allowNegative = false, required: _required, ...rest }, ref) => {
    const [textValue, setTextValue] = useState<string>(() => formatPropToDisplay(value));
    const isFocusedRef = useRef<boolean>(false);
    const initialNum = Number(value || 0);
    const lastEmittedNumRef = useRef<number>(Number.isFinite(initialNum) ? initialNum : 0);

    useEffect(() => {
      const incomingNum = value === '' || value === null || value === undefined ? 0 : Number(value);
      const safeIncomingNum = Number.isFinite(incomingNum) ? incomingNum : 0;

      if (!isFocusedRef.current || safeIncomingNum !== lastEmittedNumRef.current) {
        lastEmittedNumRef.current = safeIncomingNum;
        setTextValue(formatPropToDisplay(value));
      }
    }, [value]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value;
      const pattern = allowNegative ? /^-?\d*\.?\d*$/ : /^\d*\.?\d*$/;
      if (raw !== '' && !pattern.test(raw)) {
        return;
      }
      setTextValue(raw);
      const parsed = raw === '' || raw === '-' || raw === '.' || raw === '-.' ? 0 : Number(raw);
      lastEmittedNumRef.current = Number.isFinite(parsed) ? parsed : 0;
      if (onChange) {
        onChange(e);
      }
    };

    const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
      isFocusedRef.current = true;
      if (onFocus) {
        onFocus(e);
      }
    };

    const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
      isFocusedRef.current = false;
      const num = textValue.trim() === '' ? 0 : Number(textValue);
      if (!Number.isFinite(num) || num === 0) {
        setTextValue('');
        lastEmittedNumRef.current = 0;
      } else {
        const cleanStr = String(num);
        setTextValue(cleanStr);
        lastEmittedNumRef.current = num;
      }
      if (onBlur) {
        onBlur(e);
      }
    };

    const cleanPlaceholder =
      placeholder === '0' || placeholder === '0.0' || placeholder === '0.00' ? '' : placeholder;

    return (
      <input
        ref={ref}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={textValue}
        placeholder={cleanPlaceholder}
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        {...rest}
      />
    );
  }
);

NumericInput.displayName = 'NumericInput';
