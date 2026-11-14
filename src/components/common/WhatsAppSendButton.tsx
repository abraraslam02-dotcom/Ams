import React, { useState, useEffect } from 'react';
import { MessageCircle, CheckCircle2, AlertTriangle, RotateCcw, Send, X, Phone } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';
import {
  normalizeWhatsAppNumber,
  WhatsAppDocumentPayload,
} from '../../utils/whatsapp';

export interface WhatsAppSendButtonProps {
  payload: WhatsAppDocumentPayload;
  compact?: boolean;
  label?: string;
  className?: string;
  autoTriggerKey?: string | number | null;
  onPhoneSaved?: (newPhone: string) => void;
}

export const WhatsAppSendButton: React.FC<WhatsAppSendButtonProps> = ({
  payload,
  compact = false,
  label = 'WhatsApp',
  className = '',
  autoTriggerKey = null,
  onPhoneSaved,
}) => {
  const { hasPermission } = useAuth();
  const canSend =
    hasPermission('sales', 'export') ||
    hasPermission('sales', 'create') ||
    hasPermission('sales', 'view');

  const [savedPhone, setSavedPhone] = useState<string>(payload.customerPhone || '');
  const [sendStatus, setSendStatus] = useState<'idle' | 'sending' | 'Sent' | 'Failed'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Modals for one-time phone entry or duplicate send confirmation
  const [showPhoneModal, setShowPhoneModal] = useState<boolean>(false);
  const [phoneInput, setPhoneInput] = useState<string>('');
  const [phoneModalError, setPhoneModalError] = useState<string | null>(null);
  const [savingPhone, setSavingPhone] = useState<boolean>(false);
  const [pendingMode, setPendingMode] = useState<'phase1' | 'phase2'>('phase2');

  const [showDuplicateConfirm, setShowDuplicateConfirm] = useState<boolean>(false);
  const [autoTriggeredRef, setAutoTriggeredRef] = useState<string | number | null>(null);

  useEffect(() => {
    setSavedPhone(payload.customerPhone || '');
  }, [payload.customerPhone, payload.customerAccountId, payload.documentNumber]);

  // Check existing whatsapp_log status for this invoice/document
  useEffect(() => {
    if (!canSend || (!payload.invoiceId && !payload.documentNumber)) return;
    let mounted = true;
    api
      .getWhatsAppLogs({
        invoiceId: payload.invoiceId || undefined,
        documentNumber: !payload.invoiceId ? payload.documentNumber : undefined,
      })
      .then((res) => {
        if (!mounted) return;
        const logs = Array.isArray(res.logs) ? res.logs : [];
        if (logs.length > 0) {
          const latest = logs[0];
          if (latest.status === 'Sent' || latest.status === 'Failed') {
            setSendStatus(latest.status);
            setErrorMessage(latest.error || null);
          }
        } else {
          setSendStatus('idle');
          setErrorMessage(null);
        }
      })
      .catch(() => {
        // ignore
      });
    return () => {
      mounted = false;
    };
  }, [canSend, payload.invoiceId, payload.documentNumber]);

  // Optional auto-trigger when autoTriggerKey changes (for Auto-send on save)
  useEffect(() => {
    if (
      autoTriggerKey &&
      autoTriggerKey !== autoTriggeredRef &&
      canSend &&
      payload.documentNumber
    ) {
      setAutoTriggeredRef(autoTriggerKey);
      handleInitiateSend('phase2', true);
    }
  }, [autoTriggerKey]);

  if (!canSend) return null;

  const isWalkInCustomer =
    !payload.customerAccountId ||
    Number(payload.customerAccountId) <= 0 ||
    payload.customerName.toLowerCase().includes('walk-in');

  const executeSendWithNumber = async (
    normalizedNumber: string,
    rawPhoneUsed: string,
    mode: 'phase1' | 'phase2'
  ) => {
    setSendStatus('sending');
    setErrorMessage(null);

    const enrichedPayload: WhatsAppDocumentPayload = {
      ...payload,
      customerPhone: rawPhoneUsed || normalizedNumber,
    };

    if (mode === 'phase2') {
      try {
        const res = await api.sendWhatsAppCloudApi({
          invoiceId: payload.invoiceId || null,
          reportType: payload.documentType,
          params: enrichedPayload,
        });
        setSendStatus(res.status === 'Sent' ? 'Sent' : 'Failed');
        setErrorMessage(null);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setSendStatus('Failed');
        setErrorMessage(msg);
      }
      return;
    }

    // Phase 1 (Free: wa.me + PDF Share/Download)
    try {
      await shareOrOpenWhatsAppPhase1(normalizedNumber, enrichedPayload);
      await api
        .logWhatsAppSend({
          invoiceId: payload.invoiceId || null,
          documentType: payload.documentType,
          documentNumber: payload.documentNumber,
          customerAccountId: payload.customerAccountId || null,
          customerName: payload.customerName,
          number: normalizedNumber,
          mode: 'phase1_wa_me',
          status: 'Sent',
        })
        .catch(() => null);
      setSendStatus('Sent');
      setErrorMessage(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setSendStatus('Failed');
      setErrorMessage(msg);
      await api
        .logWhatsAppSend({
          invoiceId: payload.invoiceId || null,
          documentType: payload.documentType,
          documentNumber: payload.documentNumber,
          customerAccountId: payload.customerAccountId || null,
          customerName: payload.customerName,
          number: normalizedNumber,
          mode: 'phase1_wa_me',
          status: 'Failed',
          error: msg,
        })
        .catch(() => null);
    }
  };

  const handleInitiateSend = (mode: 'phase1' | 'phase2' = 'phase1', bypassDuplicate = false) => {
    setPendingMode(mode);

    // Prevent duplicate sends without confirmation prompt
    if (sendStatus === 'Sent' && !bypassDuplicate) {
      setShowDuplicateConfirm(true);
      return;
    }

    const normalized = normalizeWhatsAppNumber(savedPhone);
    if (!normalized) {
      setPhoneInput(savedPhone || '');
      setPhoneModalError(
        savedPhone
          ? `Saved number "${savedPhone}" is invalid. Please enter a valid Pakistani mobile number (e.g. 03001234567).`
          : isWalkInCustomer
          ? 'Walk-in / Cash customer has no saved mobile number. Enter a WhatsApp number for this one-time send:'
          : `No WhatsApp number is saved for "${payload.customerName}". Enter it once below and it will be saved to their customer record automatically:`
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
      // If linked to a customer account, save it permanently to the customer record
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
      <div className={`inline-flex items-center gap-1 ${className}`}>
        <button
          type="button"
          disabled={sendStatus === 'sending'}
          onClick={(e) => {
            e.stopPropagation();
            handleInitiateSend('phase2', false);
          }}
          title={
            savedPhone
              ? `Send invoice PDF directly via WhatsApp (${normalizeWhatsAppNumber(savedPhone) || savedPhone})`
              : 'Send invoice PDF directly via WhatsApp (Prompt for Customer Number)'
          }
          className={
            compact
              ? 'px-2 py-1 rounded bg-green-600 hover:bg-green-500 text-white text-[10px] font-bold inline-flex items-center gap-1 cursor-pointer shadow-2xs disabled:opacity-50'
              : 'px-2.5 py-1 rounded bg-green-600 hover:bg-green-500 text-white text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer shadow-2xs disabled:opacity-50'
          }
        >
          <MessageCircle className="w-3 h-3" />
          <span>{sendStatus === 'sending' ? 'Sending...' : label}</span>
        </button>



        {sendStatus === 'Sent' && (
          <span
            className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-300 text-[9px] font-bold inline-flex items-center gap-0.5"
            title="WhatsApp message & PDF sent"
          >
            <CheckCircle2 className="w-2.5 h-2.5 text-emerald-600" />
            <span>Sent</span>
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

      {/* One-Time Phone Entry & Save Modal (when customer phone is missing or invalid) */}
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
                    ? 'Walk-in Customer WhatsApp Number'
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
                  Customer Mobile / WhatsApp Number (Pakistan):
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

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200">
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
                      : 'Save to Customer & Send'}
                  </span>
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
    </>
  );
};
