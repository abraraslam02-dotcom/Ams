import React, { useState, useEffect } from 'react';
import {
  MessageCircle,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Send,
  X,
  Phone,
  ExternalLink,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';
import { PageOrientationOption, PaperSizeOption } from '../../utils/printEngine';
import {
  normalizeWhatsAppNumber,
  shareOrOpenWhatsAppPhase1,
  WhatsAppDocumentPayload,
} from '../../utils/whatsapp';

export interface WhatsAppSendButtonProps {
  payload: WhatsAppDocumentPayload;
  compact?: boolean;
  label?: string;
  className?: string;
  autoTriggerKey?: string | number | null;
  onPhoneSaved?: (newPhone: string) => void;
  onSendSuccess?: () => void;
  /** Printable DOM ref to render into a real PDF matching the current print layout */
  printElementRef?: React.RefObject<HTMLElement | null>;
  /** Optional getter for printable DOM element (useful when layout switches dynamically) */
  getPrintElement?: () => HTMLElement | null;
  /** Paper size matching the report/invoice print layout */
  paperSize?: PaperSizeOption;
  /** Orientation matching the report/invoice print layout */
  orientation?: PageOrientationOption;
  /** Optional fixed thermal height in mm (e.g. DSR thermal 297mm) */
  fixedThermalHeightMm?: number;
  /** Optional explicit PDF filename */
  pdfFilename?: string;
  /** Allow sharing general store reports/statements directly without requiring a customer mobile number */
  allowWithoutPhone?: boolean;
  /** Skip duplicate confirmation modal (useful for general filterable reports) */
  skipDuplicateCheck?: boolean;
  /** Optional disabled flag */
  disabled?: boolean;
}

export const WhatsAppSendButton: React.FC<WhatsAppSendButtonProps> = ({
  payload,
  compact = false,
  label = 'WhatsApp',
  className = '',
  autoTriggerKey = null,
  onPhoneSaved,
  onSendSuccess,
  printElementRef,
  getPrintElement,
  paperSize,
  orientation,
  fixedThermalHeightMm,
  pdfFilename,
  allowWithoutPhone = false,
  skipDuplicateCheck = false,
  disabled = false,
}) => {
  const { hasPermission } = useAuth();
  const canSend =
    allowWithoutPhone ||
    hasPermission('sales', 'export') ||
    hasPermission('sales', 'create') ||
    hasPermission('sales', 'view') ||
    hasPermission('purchases', 'view') ||
    hasPermission('accounting', 'view') ||
    hasPermission('inventory', 'view');

  const [savedPhone, setSavedPhone] = useState<string>(payload.customerPhone || '');
  const [sendStatus, setSendStatus] = useState<'idle' | 'sending' | 'Sent' | 'Failed'>('idle');
  const [previouslySent, setPreviouslySent] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [cloudConfigured, setCloudConfigured] = useState<boolean>(false);
  const [desktopNotice, setDesktopNotice] = useState<{
    filename: string;
    webFallbackUrl: string;
  } | null>(null);

  // Modals for one-time phone entry or duplicate send confirmation
  const [showPhoneModal, setShowPhoneModal] = useState<boolean>(false);
  const [phoneInput, setPhoneInput] = useState<string>('');
  const [phoneModalError, setPhoneModalError] = useState<string | null>(null);
  const [savingPhone, setSavingPhone] = useState<boolean>(false);
  const [pendingMode, setPendingMode] = useState<'phase1' | 'phase2'>('phase1');

  const [showDuplicateConfirm, setShowDuplicateConfirm] = useState<boolean>(false);
  const [autoTriggeredRef, setAutoTriggeredRef] = useState<string | number | null>(null);

  useEffect(() => {
    setSavedPhone(payload.customerPhone || '');
  }, [payload.customerPhone, payload.customerAccountId, payload.documentNumber]);

  // Check existing whatsapp_log status for party documents (skip for general reports)
  useEffect(() => {
    if (!canSend || allowWithoutPhone || skipDuplicateCheck) return;
    if (!payload.invoiceId && !payload.documentNumber) return;
    let mounted = true;
    api
      .getWhatsAppLogs({
        invoiceId: payload.invoiceId || undefined,
        documentNumber: !payload.invoiceId ? payload.documentNumber : undefined,
      })
      .then((res) => {
        if (!mounted) return;
        setCloudConfigured(Boolean(res.cloudConfigured));
        const logs = Array.isArray(res.logs) ? res.logs : [];
        if (logs.length > 0) {
          const latest = logs[0];
          if (latest.status === 'Failed') {
            setSendStatus('Failed');
            setPreviouslySent(false);
            setErrorMessage(latest.error || null);
          } else if (latest.status === 'Sent') {
            setSendStatus('idle');
            setPreviouslySent(true);
            setErrorMessage(null);
          } else {
            setSendStatus('idle');
            setPreviouslySent(false);
            setErrorMessage(null);
          }
        } else {
          setSendStatus('idle');
          setPreviouslySent(false);
          setErrorMessage(null);
        }
      })
      .catch(() => {
        // ignore
      });
    return () => {
      mounted = false;
    };
  }, [canSend, allowWithoutPhone, skipDuplicateCheck, payload.invoiceId, payload.documentNumber]);

  // Automatically dismiss transient 'Sent' badge after completion so no manual dismissal is needed
  useEffect(() => {
    if (sendStatus !== 'Sent') return;
    const timer = window.setTimeout(() => {
      setSendStatus('idle');
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [sendStatus]);

  // Auto-dismiss desktop fallback notice after 8 seconds
  useEffect(() => {
    if (!desktopNotice) return;
    const timer = window.setTimeout(() => {
      setDesktopNotice(null);
    }, 8000);
    return () => window.clearTimeout(timer);
  }, [desktopNotice]);

  // Manual send only: never auto-trigger WhatsApp on save/update/modify
  useEffect(() => {
    if (autoTriggerKey && autoTriggerKey !== autoTriggeredRef) {
      setAutoTriggeredRef(autoTriggerKey);
    }
  }, [autoTriggerKey, autoTriggeredRef]);

  if (!canSend) return null;

  const isWalkInCustomer =
    !payload.customerAccountId ||
    Number(payload.customerAccountId) <= 0 ||
    payload.customerName.toLowerCase().includes('walk-in');

  const resolvePrintElement = (): HTMLElement | null => {
    if (typeof getPrintElement === 'function') {
      return getPrintElement();
    }
    return printElementRef?.current || null;
  };

  const executeSendWithNumber = async (
    normalizedNumber: string | null,
    rawPhoneUsed: string,
    mode: 'phase1' | 'phase2'
  ) => {
    setSendStatus('sending');
    setErrorMessage(null);
    setDesktopNotice(null);

    const enrichedPayload: WhatsAppDocumentPayload = {
      ...payload,
      customerPhone: rawPhoneUsed || normalizedNumber || payload.customerPhone || '',
    };

    if (mode === 'phase2' && normalizedNumber) {
      try {
        const res = await api.sendWhatsAppCloudApi({
          invoiceId: payload.invoiceId || null,
          reportType: payload.documentType,
          params: enrichedPayload,
        });
        if (res.status === 'Sent') {
          setSendStatus('Sent');
          setPreviouslySent(true);
          setErrorMessage(null);
          onSendSuccess?.();
          window.dispatchEvent(
            new CustomEvent('ams-whatsapp-activity-completed', {
              detail: { invoiceId: payload.invoiceId, documentNumber: payload.documentNumber },
            })
          );
        } else {
          setSendStatus('Failed');
          setErrorMessage(null);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setSendStatus('Failed');
        setErrorMessage(msg);
      }
      return;
    }

    // Direct PDF generation from print layout + Native OS File Share or WhatsApp Desktop protocol
    try {
      const targetElement = resolvePrintElement();
      const result = await shareOrOpenWhatsAppPhase1(normalizedNumber, enrichedPayload, {
        printElement: targetElement,
        paperSize: paperSize || payload.paperSize || 'a4',
        orientation: orientation || 'portrait',
        fixedThermalHeightMm,
        pdfFilename,
      });

      if (result.method === 'cancelled') {
        setSendStatus('idle');
        return;
      }

      if (result.method === 'whatsapp_desktop_protocol') {
        setDesktopNotice({
          filename: result.filename,
          webFallbackUrl: result.webFallbackUrl,
        });
      }

      if (normalizedNumber) {
        await api
          .logWhatsAppSend({
            invoiceId: payload.invoiceId || null,
            documentType: payload.documentType,
            documentNumber: payload.documentNumber,
            customerAccountId: payload.customerAccountId || null,
            customerName: payload.customerName,
            number: normalizedNumber,
            mode:
              result.method === 'web_share_file'
                ? 'phase1_web_share_pdf'
                : 'phase1_whatsapp_desktop_pdf',
            status: 'Sent',
          })
          .catch(() => null);
      }

      setSendStatus('Sent');
      if (!skipDuplicateCheck && !allowWithoutPhone) {
        setPreviouslySent(true);
      }
      setErrorMessage(null);
      onSendSuccess?.();
      window.dispatchEvent(
        new CustomEvent('ams-whatsapp-activity-completed', {
          detail: { invoiceId: payload.invoiceId, documentNumber: payload.documentNumber },
        })
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setSendStatus('Failed');
      setErrorMessage(msg);
      if (normalizedNumber) {
        await api
          .logWhatsAppSend({
            invoiceId: payload.invoiceId || null,
            documentType: payload.documentType,
            documentNumber: payload.documentNumber,
            customerAccountId: payload.customerAccountId || null,
            customerName: payload.customerName,
            number: normalizedNumber,
            mode: 'phase1_whatsapp_pdf',
            status: 'Failed',
            error: msg,
          })
          .catch(() => null);
      }
    }
  };

  const handleInitiateSend = (mode: 'phase1' | 'phase2' = 'phase1', bypassDuplicate = false) => {
    setPendingMode(mode);

    // Prevent duplicate sends without confirmation prompt (for party invoices/ledgers)
    if (
      !skipDuplicateCheck &&
      !allowWithoutPhone &&
      (sendStatus === 'Sent' || previouslySent) &&
      !bypassDuplicate
    ) {
      setShowDuplicateConfirm(true);
      return;
    }

    const normalized = normalizeWhatsAppNumber(savedPhone);

    // For general store reports/statements (or when native OS file share is available without a phone),
    // share the PDF directly without nagging for a customer mobile number.
    if (!normalized && allowWithoutPhone && mode === 'phase1') {
      executeSendWithNumber(null, '', mode);
      return;
    }

    if (!normalized) {
      setPhoneInput(savedPhone || '');
      setPhoneModalError(
        savedPhone
          ? `Saved number "${savedPhone}" is invalid. Please enter a valid Pakistani mobile number (e.g. 03001234567).`
          : isWalkInCustomer
          ? 'No saved mobile number found. Enter a WhatsApp number for this one-time send, or share directly:'
          : `No WhatsApp number is saved for "${payload.customerName}". Enter it once below and it will be saved to their account automatically:`
      );
      setShowPhoneModal(true);
      return;
    }

    executeSendWithNumber(normalized, savedPhone, mode);
  };

  const handleConfirmPhoneEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    setPhoneModalError(null);

    const normalized = normalizeWhatsAppNumber(phoneInput);
    if (!normalized) {
      setPhoneModalError(
        'Please enter a valid Pakistani mobile number (e.g. 03001234567 or 923001234567).'
      );
      return;
    }

    try {
      setSavingPhone(true);
      // If linked to an account, save it permanently to the account record
      if (!isWalkInCustomer && payload.customerAccountId && payload.customerAccountId > 0) {
        await api.saveCustomerWhatsAppPhone(payload.customerAccountId, phoneInput.trim());
        onPhoneSaved?.(phoneInput.trim());
      }
      setSavedPhone(phoneInput.trim());
      setShowPhoneModal(false);
      await executeSendWithNumber(normalized, phoneInput.trim(), pendingMode);
    } catch (err: unknown) {
      setPhoneModalError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingPhone(false);
    }
  };

  return (
    <>
      <div className={`inline-flex items-center gap-1 print:hidden ${className}`}>
        <button
          type="button"
          disabled={disabled || sendStatus === 'sending'}
          onClick={(e) => {
            e.stopPropagation();
            handleInitiateSend('phase1', false);
          }}
          title={
            savedPhone
              ? `Send PDF to WhatsApp (${normalizeWhatsAppNumber(savedPhone) || savedPhone})`
              : allowWithoutPhone
              ? 'Generate PDF & Send to WhatsApp'
              : 'Send PDF to WhatsApp'
          }
          className={
            compact
              ? 'px-2 py-1 rounded bg-green-600 hover:bg-green-500 text-white text-[10px] font-bold inline-flex items-center gap-1 cursor-pointer shadow-2xs disabled:opacity-50 whitespace-nowrap shrink-0'
              : 'px-2.5 py-1.5 rounded-lg bg-green-600 hover:bg-green-500 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer shadow-2xs disabled:opacity-50 whitespace-nowrap shrink-0'
          }
        >
          <MessageCircle className={compact ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
          <span>{sendStatus === 'sending' ? 'Preparing PDF...' : label}</span>
        </button>

        {cloudConfigured && !allowWithoutPhone && (
          <button
            type="button"
            disabled={disabled || sendStatus === 'sending'}
            onClick={(e) => {
              e.stopPropagation();
              handleInitiateSend('phase2', false);
            }}
            title="Send PDF Directly via WhatsApp Business Cloud API"
            className="px-1.5 py-1 rounded bg-emerald-800 hover:bg-emerald-700 text-white text-[10px] font-bold inline-flex items-center gap-0.5 cursor-pointer whitespace-nowrap shrink-0"
          >
            <Send className="w-2.5 h-2.5" />
            <span>API</span>
          </button>
        )}

        {sendStatus === 'Sent' && (
          <span
            className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-300 text-[9px] font-bold inline-flex items-center gap-0.5"
            title="WhatsApp PDF shared"
          >
            <CheckCircle2 className="w-2.5 h-2.5 text-emerald-600" />
            <span>Shared</span>
          </span>
        )}

        {sendStatus === 'Failed' && (
          <div className="inline-flex items-center gap-1">
            <span
              className="px-1.5 py-0.5 rounded bg-rose-100 text-rose-800 border border-rose-300 text-[9px] font-bold inline-flex items-center gap-0.5"
              title={errorMessage || 'WhatsApp send failed'}
            >
              <AlertTriangle className="w-2.5 h-2.5 text-rose-600" />
              <span>Failed</span>
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleInitiateSend(pendingMode, true);
              }}
              className="px-1.5 py-0.5 rounded bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300 text-[9px] font-bold inline-flex items-center gap-0.5 cursor-pointer"
              title="Retry sending via WhatsApp"
            >
              <RotateCcw className="w-2.5 h-2.5" />
              <span>Retry</span>
            </button>
          </div>
        )}
      </div>

      {/* Non-blocking Desktop Fallback Toast (only shown when OS Web Share with files is unsupported) */}
      {desktopNotice && (
        <div
          className="fixed bottom-4 right-4 z-[70] max-w-sm bg-slate-900 text-white border border-emerald-500/60 rounded-xl shadow-2xl px-3.5 py-2.5 text-xs print:hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <div className="font-bold text-emerald-300">
                  WhatsApp Opened &amp; PDF Ready
                </div>
                <p className="text-[11px] text-slate-200 leading-snug">
                  PDF <span className="font-mono text-white">{desktopNotice.filename}</span> saved
                  for WhatsApp. Attach it directly in the opened WhatsApp chat.
                </p>
                <div className="pt-0.5 flex items-center gap-2">
                  <a
                    href={desktopNotice.webFallbackUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[10px] font-bold text-sky-300 hover:text-sky-200 underline"
                  >
                    <ExternalLink className="w-3 h-3" />
                    <span>Open WhatsApp Web instead</span>
                  </a>
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setDesktopNotice(null)}
              className="text-slate-400 hover:text-white cursor-pointer"
              title="Dismiss"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Duplicate Send Confirmation Modal */}
      {showDuplicateConfirm && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4 print:hidden"
          onClick={() => setShowDuplicateConfirm(false)}
        >
          <div
            className="bg-white rounded-lg border-2 border-slate-400 shadow-2xl w-full max-w-md overflow-hidden text-xs"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-slate-900 text-white px-3 py-2 flex items-center justify-between">
              <div className="flex items-center gap-1.5 font-bold">
                <MessageCircle className="w-3.5 h-3.5 text-green-400" />
                <span>Confirm Duplicate WhatsApp Send</span>
              </div>
              <button
                type="button"
                onClick={() => setShowDuplicateConfirm(false)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-3 text-slate-700">
              <p>
                Document <strong>{payload.documentNumber}</strong> for{' '}
                <strong>{payload.customerName}</strong> has already been marked as{' '}
                <span className="text-emerald-700 font-bold">Sent</span>.
              </p>
              <p>Do you want to send it again via WhatsApp?</p>
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowDuplicateConfirm(false)}
                  className="px-3 py-1.5 rounded border border-slate-300 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowDuplicateConfirm(false);
                    handleInitiateSend(pendingMode, true);
                  }}
                  className="px-3 py-1.5 rounded bg-green-600 hover:bg-green-500 text-white font-bold flex items-center gap-1 cursor-pointer"
                >
                  <MessageCircle className="w-3.5 h-3.5" />
                  <span>Yes, Send Again</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* One-Time Phone Entry & Save Modal (when party phone is missing or invalid) */}
      {showPhoneModal && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4 print:hidden"
          onClick={() => setShowPhoneModal(false)}
        >
          <form
            onSubmit={handleConfirmPhoneEntry}
            className="bg-white rounded-lg border-2 border-slate-400 shadow-2xl w-full max-w-md overflow-hidden text-xs"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-slate-900 text-white px-3 py-2 flex items-center justify-between">
              <div className="flex items-center gap-1.5 font-bold">
                <Phone className="w-3.5 h-3.5 text-green-400" />
                <span>
                  {isWalkInCustomer
                    ? 'WhatsApp Recipient Number'
                    : `Save WhatsApp Number — ${payload.customerName}`}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowPhoneModal(false)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-3">
              {phoneModalError && (
                <div className="p-2.5 rounded bg-amber-50 border border-amber-300 text-amber-900 text-[11px] font-medium">
                  {phoneModalError}
                </div>
              )}

              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Mobile / WhatsApp Number (Pakistan):
                </label>
                <input
                  type="text"
                  autoFocus
                  required
                  value={phoneInput}
                  onChange={(e) => setPhoneInput(e.target.value)}
                  placeholder="03001234567 or 923001234567"
                  className="w-full px-3 py-1.5 rounded border border-slate-300 font-mono font-bold text-slate-900 focus:outline-none focus:border-green-600"
                />
                <p className="text-[10px] text-slate-500 mt-1">
                  Automatically normalized to international format:{' '}
                  <strong className="font-mono text-slate-700">
                    {normalizeWhatsAppNumber(phoneInput) || '923xxxxxxxxx'}
                  </strong>
                </p>
              </div>

              <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => {
                    setShowPhoneModal(false);
                    executeSendWithNumber(null, '', 'phase1');
                  }}
                  className="px-2.5 py-1.5 rounded border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-900 font-bold cursor-pointer"
                  title="Share PDF directly and pick contact inside WhatsApp"
                >
                  Pick in WhatsApp
                </button>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowPhoneModal(false)}
                    className="px-3 py-1.5 rounded border border-slate-300 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={savingPhone}
                    className="px-3.5 py-1.5 rounded bg-green-600 hover:bg-green-500 text-white font-bold flex items-center gap-1 cursor-pointer disabled:opacity-50"
                  >
                    <MessageCircle className="w-3.5 h-3.5" />
                    <span>
                      {savingPhone
                        ? 'Saving...'
                        : isWalkInCustomer
                        ? 'Send via WhatsApp'
                        : 'Save & Send'}
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </form>
        </div>
      )}
    </>
  );
};
