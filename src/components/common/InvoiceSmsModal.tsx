import React, { useEffect, useState } from 'react';
import {
  MessageSquare,
  Phone,
  Send,
  X,
  AlertCircle,
  CheckCircle2,
  RotateCcw,
  ShieldQuestion,
  ExternalLink,
  Copy,
  Check,
} from 'lucide-react';
import { buildDefaultSmsAppUri, normalizePakistaniSmsNumber } from '../../utils/invoiceSms';

export interface InvoiceSmsModalProps {
  isOpen: boolean;
  mode: 'sales' | 'purchase';
  title: string;
  initialPhone?: string;
  isPhoneFromAccounts?: boolean;
  customerLabel?: string;
  initialMessage: string;
  onClose: () => void;
}

export const InvoiceSmsModal: React.FC<InvoiceSmsModalProps> = ({
  isOpen,
  mode,
  title,
  initialPhone = '',
  isPhoneFromAccounts = false,
  customerLabel = '',
  initialMessage,
  onClose,
}) => {
  const [phoneInput, setPhoneInput] = useState<string>(initialPhone);
  const [allowOverrideRegisteredPhone, setAllowOverrideRegisteredPhone] = useState<boolean>(false);
  const [messageText, setMessageText] = useState<string>(initialMessage);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [showConfirmStep, setShowConfirmStep] = useState<boolean>(false);
  const [handedOffToSmsApp, setHandedOffToSmsApp] = useState<boolean>(false);
  const [copiedText, setCopiedText] = useState<boolean>(false);

  useEffect(() => {
    if (!isOpen) return;
    const preNormalized =
      mode === 'sales' && initialPhone
        ? normalizePakistaniSmsNumber(initialPhone) || initialPhone.trim()
        : '';
    setPhoneInput(mode === 'sales' ? preNormalized : '');
    setAllowOverrideRegisteredPhone(false);
    setMessageText(initialMessage);
    setValidationError(null);
    setShowConfirmStep(false);
    setHandedOffToSmsApp(false);
    setCopiedText(false);
  }, [isOpen, mode, initialPhone, initialMessage]);

  if (!isOpen) return null;

  const normalizedPhone = normalizePakistaniSmsNumber(phoneInput);
  const hasValidRegisteredCustomerPhone =
    mode === 'sales' &&
    isPhoneFromAccounts &&
    Boolean(normalizePakistaniSmsNumber(initialPhone)) &&
    !allowOverrideRegisteredPhone;

  const handleRequestSend = (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);

    if (!normalizedPhone) {
      setValidationError(
        'Please enter a valid Pakistani mobile number (e.g. +923001234567 or 03001234567).'
      );
      return;
    }

    if (!messageText.trim()) {
      setValidationError('SMS message cannot be empty.');
      return;
    }

    // Ask for confirmation before sending
    setShowConfirmStep(true);
  };

  const handleConfirmAndOpenDefaultSmsApp = () => {
    if (!normalizedPhone || !messageText.trim()) return;

    const smsUri = buildDefaultSmsAppUri(normalizedPhone, messageText);

    // Trigger the device's default SMS application via a temporary anchor element
    const link = document.createElement('a');
    link.href = smsUri;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // Never show a false "SMS Sent" message when no SMS gateway is configured;
    // clearly indicate that the device's default SMS application has been opened.
    setShowConfirmStep(false);
    setHandedOffToSmsApp(true);
  };

  const handleCopyMessage = async () => {
    try {
      await navigator.clipboard.writeText(messageText);
      setCopiedText(true);
      setTimeout(() => setCopiedText(false), 2000);
    } catch {
      // ignore clipboard errors
    }
  };

  return (
    <div
      className="print-modal-container fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-3 lg:p-4 print:hidden"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl border-2 border-slate-300 shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[92vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="bg-slate-900 text-white px-4 py-3 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/20 border border-indigo-400/40 flex items-center justify-center text-indigo-300">
              <MessageSquare className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold tracking-tight">{title}</h3>
              <p className="text-[11px] text-slate-400">
                {mode === 'sales'
                  ? 'Customer Sales Invoice SMS Preview & Verification'
                  : 'Purchase Order SMS Preview & Recipient Entry'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <form onSubmit={handleRequestSend} className="p-4 space-y-3.5 overflow-y-auto flex-1 text-xs">
          {validationError && (
            <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-300 text-rose-900 flex items-start gap-2 font-semibold">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span>{validationError}</span>
            </div>
          )}

          {/* Recipient Mobile Number Section */}
          <div className="space-y-1.5">
            <label className="block font-bold text-slate-800 text-xs">
              Recipient Mobile Number (Pakistan +92 Format):
            </label>

            {hasValidRegisteredCustomerPhone ? (
              <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-300 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <div>
                    <div className="text-[11px] font-bold text-emerald-950">
                      Auto-fetched from Accounts{customerLabel ? ` (${customerLabel})` : ''}
                    </div>
                    <div className="font-mono text-sm font-black text-emerald-800">
                      {normalizedPhone}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setAllowOverrideRegisteredPhone(true)}
                  className="px-2.5 py-1 rounded-lg bg-white hover:bg-emerald-100 text-emerald-900 border border-emerald-300 text-[11px] font-bold cursor-pointer shrink-0"
                >
                  Edit Number
                </button>
              </div>
            ) : (
              <div>
                {mode === 'sales' && !initialPhone && (
                  <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 mb-2 font-medium">
                    No registered mobile number found in Accounts
                    {customerLabel ? ` for "${customerLabel}"` : ''}. Please enter the customer
                    mobile number below:
                  </p>
                )}
                {mode === 'purchase' && (
                  <p className="text-[11px] text-slate-600 mb-1.5">
                    Manually enter the recipient&apos;s mobile number for this Purchase Order SMS:
                  </p>
                )}
                <div className="relative">
                  <Phone className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="tel"
                    autoFocus={!hasValidRegisteredCustomerPhone}
                    required
                    value={phoneInput}
                    onChange={(e) => {
                      setPhoneInput(e.target.value);
                      setValidationError(null);
                      setShowConfirmStep(false);
                      setHandedOffToSmsApp(false);
                    }}
                    placeholder="+923001234567 or 03001234567"
                    className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-300 font-mono text-sm font-bold text-slate-900 focus:outline-none focus:border-indigo-600 focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>
                <div className="flex items-center justify-between mt-1 text-[11px]">
                  <span className="text-slate-500">
                    Supports <strong className="font-mono">+923XXXXXXXXX</strong> or{' '}
                    <strong className="font-mono">03XXXXXXXXX</strong>
                  </span>
                  {phoneInput.trim() && (
                    <span
                      className={`font-mono font-bold ${
                        normalizedPhone ? 'text-emerald-700' : 'text-rose-600'
                      }`}
                    >
                      {normalizedPhone ? `Valid: ${normalizedPhone}` : 'Invalid mobile number'}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Editable SMS Message Preview */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="font-bold text-slate-800 text-xs">
                SMS Preview (Editable — 1 Item per Line):
              </label>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleCopyMessage}
                  className="px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer"
                  title="Copy SMS text to clipboard"
                >
                  {copiedText ? (
                    <>
                      <Check className="w-3 h-3 text-emerald-600" />
                      <span className="text-emerald-700">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
                {messageText !== initialMessage && (
                  <button
                    type="button"
                    onClick={() => {
                      setMessageText(initialMessage);
                      setShowConfirmStep(false);
                      setHandedOffToSmsApp(false);
                    }}
                    className="px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer"
                    title="Restore original generated SMS text"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Reset Text</span>
                  </button>
                )}
              </div>
            </div>

            <textarea
              rows={8}
              value={messageText}
              onChange={(e) => {
                setMessageText(e.target.value);
                setValidationError(null);
                setShowConfirmStep(false);
                setHandedOffToSmsApp(false);
              }}
              className="w-full p-3 rounded-xl border border-slate-300 bg-slate-50 font-mono text-xs leading-relaxed text-slate-950 focus:bg-white focus:outline-none focus:border-indigo-600 focus:ring-2 focus:ring-indigo-500/20 resize-y"
            />
            <div className="flex items-center justify-between text-[11px] text-slate-500">
              <span>
                Lines: <strong>{messageText.split('\n').filter((l) => l.trim()).length}</strong>
              </span>
              <span>
                Characters: <strong>{messageText.length}</strong>
              </span>
            </div>
          </div>

          {/* Confirmation Prompt Before Sending */}
          {showConfirmStep && normalizedPhone && (
            <div className="p-3 rounded-xl bg-amber-50 border-2 border-amber-400 space-y-2.5">
              <div className="flex items-start gap-2">
                <ShieldQuestion className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                <div className="text-amber-950">
                  <div className="font-bold text-xs">Confirm Sending SMS</div>
                  <p className="text-[11px] mt-0.5 leading-snug">
                    Are you sure you want to send this SMS to{' '}
                    <strong className="font-mono">{normalizedPhone}</strong>? Since no external SMS
                    gateway is configured, this will open your device&apos;s default SMS application
                    with the recipient number and prepared message.
                  </p>
                </div>
              </div>
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowConfirmStep(false)}
                  className="px-3 py-1.5 rounded-lg border border-amber-400 bg-white hover:bg-amber-100 text-amber-900 font-bold text-xs cursor-pointer"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={handleConfirmAndOpenDefaultSmsApp}
                  className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer shadow-xs"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Confirm &amp; Open SMS App</span>
                </button>
              </div>
            </div>
          )}

          {/* Honest Status After Opening Default SMS App (Never shows false gateway success) */}
          {handedOffToSmsApp && normalizedPhone && (
            <div className="p-3 rounded-xl bg-sky-50 border border-sky-300 text-sky-950 space-y-2">
              <div className="flex items-start gap-2">
                <ExternalLink className="w-4 h-4 text-sky-700 shrink-0 mt-0.5" />
                <div className="text-[11px] leading-snug">
                  <div className="font-bold text-xs text-sky-900">
                    Opened Default SMS Application (No SMS Gateway Configured)
                  </div>
                  <p className="mt-0.5">
                    Your device&apos;s default SMS application was requested with recipient{' '}
                    <strong className="font-mono">{normalizedPhone}</strong> and the prepared
                    message. The SMS is only delivered after you press <strong>Send</strong> inside
                    your SMS app.
                  </p>
                </div>
              </div>
              <div className="flex items-center justify-end gap-2">
                <a
                  href={buildDefaultSmsAppUri(normalizedPhone, messageText)}
                  className="px-3 py-1 rounded-lg bg-sky-700 hover:bg-sky-600 text-white font-bold text-[11px] inline-flex items-center gap-1"
                >
                  <ExternalLink className="w-3 h-3" />
                  <span>Open SMS App Again</span>
                </a>
              </div>
            </div>
          )}

          {/* Modal Footer Actions: Send & Cancel */}
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 rounded-xl border border-slate-300 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs cursor-pointer"
            >
              Cancel
            </button>
            {!showConfirmStep && (
              <button
                type="submit"
                className="px-4 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer shadow-xs"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Send</span>
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};
