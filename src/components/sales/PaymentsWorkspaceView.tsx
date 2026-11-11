import React, { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../../services/api';
import { PaymentVoucherRecord } from '../../types/sales';
import { formatPKR } from '../../utils/formatters';
import { Banknote, CheckCircle2, AlertCircle, Printer } from 'lucide-react';
import { NumericInput } from '../common/NumericInput';
import { PrintDocumentHeader } from '../common/PrintDocumentHeader';
import { printReportDocument } from '../../utils/printEngine';

interface PaymentsWorkspaceViewProps {
  initialVoucherType?: 'receive_payment' | 'customer_receipt' | 'cash_payment' | 'bank_payment';
}

export const PaymentsWorkspaceView: React.FC<PaymentsWorkspaceViewProps> = ({
  initialVoucherType = 'receive_payment',
}) => {
  const [voucherType, setVoucherType] = useState<
    'receive_payment' | 'customer_receipt' | 'cash_payment' | 'bank_payment'
  >(initialVoucherType);

  const [voucherNumber, setVoucherNumber] = useState<string>('VCH-2026-0001');
  const [voucherDate, setVoucherDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [partyAccountId, setPartyAccountId] = useState<number>(0);
  const [financialAccountId, setFinancialAccountId] = useState<number>(0);
  const [amount, setAmount] = useState<string>('');
  const [paymentMethod, setPaymentMethod] = useState<'Cash' | 'Bank Transfer' | 'Cheque' | 'Online'>('Cash');
  const [referenceNumber, setReferenceNumber] = useState<string>('');
  const [description, setDescription] = useState<string>('');

  const [partyAccounts, setPartyAccounts] = useState<Array<Record<string, any>>>([]);
  const [financialAccounts, setFinancialAccounts] = useState<Array<Record<string, any>>>([]);
  const [vouchers, setVouchers] = useState<PaymentVoucherRecord[]>([]);

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const paymentsPrintRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setVoucherType(initialVoucherType);
    if (initialVoucherType === 'bank_payment') {
      setPaymentMethod('Bank Transfer');
    } else if (initialVoucherType === 'cash_payment') {
      setPaymentMethod('Cash');
    }
  }, [initialVoucherType]);

  const loadData = useCallback(async () => {
    try {
      const [accRes, nextRes, vchRes] = await Promise.all([
        api.getAccounts({ status: 'Active' }),
        api.getNextSalesNumbers(),
        api.getPaymentVouchers(),
      ]);

      const allAccs = accRes.accounts || accRes.data || [];
      const isReceipt = voucherType === 'receive_payment' || voucherType === 'customer_receipt';

      const eligibleParties = allAccs.filter((a: any) =>
        isReceipt
          ? ['Customer', 'Customer & Supplier'].includes(a.account_group)
          : !['Cash in Hand', 'Bank'].includes(a.account_group)
      );

      const eligibleFin = allAccs.filter((a: any) =>
        ['Cash in Hand', 'Bank'].includes(a.account_group)
      );

      setPartyAccounts(eligibleParties);
      setFinancialAccounts(eligibleFin);
      setVoucherNumber(nextRes.nextVoucherNumber);
      setVouchers(vchRes.data || []);

      if (eligibleParties[0]) setPartyAccountId(Number(eligibleParties[0].id));
      const targetFin =
        voucherType === 'bank_payment'
          ? eligibleFin.find((f: any) => f.account_group === 'Bank') || eligibleFin[0]
          : eligibleFin.find((f: any) => f.account_group === 'Cash in Hand') || eligibleFin[0];
      if (targetFin) setFinancialAccountId(Number(targetFin.id));
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  }, [voucherType]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSubmitting(true);
      setErrorMsg(null);
      setSuccessMsg(null);

      const res = await api.createPaymentVoucher({
        voucher_number: voucherNumber,
        voucher_date: voucherDate,
        voucher_type: voucherType,
        party_account_id: partyAccountId,
        financial_account_id: financialAccountId,
        amount: Number(amount || 0),
        payment_method: paymentMethod,
        reference_number: referenceNumber,
        description,
      });

      setSuccessMsg(
        `Voucher ${res.data.voucher_number} (${formatPKR(res.data.amount)}) posted with balanced Double-Entry lines!`
      );
      setAmount('');
      setReferenceNumber('');
      setDescription('');
      await loadData();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const selectedParty = partyAccounts.find((p) => Number(p.id) === Number(partyAccountId));

  return (
    <div className="space-y-4">
      {/* Voucher Type Tabs */}
      <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-xs flex flex-wrap items-center justify-between gap-2 print:hidden">
        <div className="flex items-center gap-2">
          <Banknote className="w-4 h-4 text-emerald-600" />
          <h3 className="text-sm font-bold text-slate-900">
            Payments & Receipts Double-Entry Voucher Desk
          </h3>
        </div>
        <div className="inline-flex rounded-lg bg-slate-100 p-1 border border-slate-200 text-xs font-bold">
          {(
            [
              { id: 'receive_payment', label: 'Receive Payment' },
              { id: 'customer_receipt', label: 'Customer Receipt' },
              { id: 'cash_payment', label: 'Cash Payment' },
              { id: 'bank_payment', label: 'Bank Payment' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setVoucherType(tab.id)}
              className={`px-3 py-1 rounded-md cursor-pointer ${
                voucherType === tab.id
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {errorMsg && (
        <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 font-medium">
            <AlertCircle className="w-4 h-4 text-rose-600" />
            <span>{errorMsg}</span>
          </div>
          <button onClick={() => setErrorMsg(null)} className="font-bold cursor-pointer">
            ✕
          </button>
        </div>
      )}

      {successMsg && (
        <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 font-semibold">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <span>{successMsg}</span>
          </div>
          <button onClick={() => setSuccessMsg(null)} className="font-bold cursor-pointer">
            ✕
          </button>
        </div>
      )}

      {/* Voucher Entry Form */}
      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs space-y-4 text-xs print:hidden"
      >
        <div className="grid grid-cols-4 gap-3">
          <div>
            <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
              Voucher Number
            </label>
            <input
              type="text"
              value={voucherNumber}
              onChange={(e) => setVoucherNumber(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 font-mono font-bold bg-slate-50"
            />
          </div>

          <div>
            <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
              Voucher Date
            </label>
            <input
              type="date"
              value={voucherDate}
              onChange={(e) => setVoucherDate(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 font-mono"
            />
          </div>

          <div>
            <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
              {voucherType === 'receive_payment' || voucherType === 'customer_receipt'
                ? 'Customer Account (Credit)'
                : 'Payee / Supplier / Expense Account (Debit)'}
            </label>
            <select
              value={partyAccountId}
              onChange={(e) => setPartyAccountId(Number(e.target.value))}
              className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white font-bold"
            >
              {partyAccounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {acc.account_name} ({acc.account_code}) — {formatPKR(acc.current_balance)}{' '}
                  {acc.current_balance_type}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
              {voucherType === 'receive_payment' || voucherType === 'customer_receipt'
                ? 'Deposit Into Cash / Bank (Debit)'
                : 'Pay From Cash / Bank (Credit)'}
            </label>
            <select
              value={financialAccountId}
              onChange={(e) => setFinancialAccountId(Number(e.target.value))}
              className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white font-bold"
            >
              {financialAccounts.map((fa) => (
                <option key={fa.id} value={fa.id}>
                  {fa.account_name} ({fa.account_code})
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-3 items-end">
          <div>
            <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
              Amount (PKR)
            </label>
            <NumericInput
              min="1"
              step="0.01"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-lg border border-emerald-500 font-mono font-black text-slate-900"
            />
          </div>

          <div>
            <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
              Payment Method
            </label>
            <select
              value={paymentMethod}
              onChange={(e) =>
                setPaymentMethod(
                  e.target.value as 'Cash' | 'Bank Transfer' | 'Cheque' | 'Online'
                )
              }
              className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white font-semibold"
            >
              <option value="Cash">Cash</option>
              <option value="Bank Transfer">Bank Transfer</option>
              <option value="Cheque">Cheque</option>
              <option value="Online">Online / RAAST</option>
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
              Cheque / Reference #
            </label>
            <input
              type="text"
              value={referenceNumber}
              onChange={(e) => setReferenceNumber(e.target.value)}
              placeholder="Optional slip / cheque #"
              className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 font-mono"
            />
          </div>

          <div>
            <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
              Selected Party Balance
            </label>
            <div className="px-3 py-1.5 rounded-lg bg-slate-100 border border-slate-300 font-mono font-bold">
              {formatPKR(selectedParty?.current_balance || 0)} (
              {selectedParty?.current_balance_type || 'Debit'})
            </div>
          </div>
        </div>

        <div className="flex items-end justify-between gap-4">
          <div className="flex-1">
            <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
              Narration / Description
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Enter voucher remarks..."
              className="w-full px-3 py-1.5 rounded-lg border border-slate-300"
            />
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold cursor-pointer shadow-xs"
          >
            Post Double-Entry Voucher
          </button>
        </div>
      </form>

      {/* Posted Vouchers History */}
      <div ref={paymentsPrintRef} className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <PrintDocumentHeader
          title="PAYMENTS & RECEIPTS REGISTER"
          subtitle="Chronological Cash, Bank & Counter Receipts Statement"
          metaItems={[
            { label: 'Register Type', value: 'Double-Entry Posted Vouchers' },
            { label: 'Total Recorded Vouchers', value: vouchers.length },
          ]}
        />
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between text-xs print:hidden">
          <span className="font-bold text-slate-800">Recent Payment & Receipt Vouchers</span>
          <button
            type="button"
            onClick={() => {
              if (paymentsPrintRef.current) {
                printReportDocument(
                  paymentsPrintRef.current,
                  'Abrar Medical Store - Payments and Receipts Register'
                );
              } else {
                window.print();
              }
            }}
            className="px-2.5 py-1 rounded bg-slate-900 text-white font-bold flex items-center gap-1 cursor-pointer"
          >
            <Printer className="w-3 h-3" />
            Print Register
          </button>
        </div>

        <table className="w-full text-left border-collapse text-xs">
          <thead className="bg-slate-900 text-white uppercase text-[10px]">
            <tr>
              <th className="px-3 py-2.5">Voucher #</th>
              <th className="px-3 py-2.5">Date</th>
              <th className="px-3 py-2.5">Type</th>
              <th className="px-3 py-2.5">Party Account</th>
              <th className="px-3 py-2.5">Cash / Bank Account</th>
              <th className="px-3 py-2.5">Method / Ref</th>
              <th className="px-3 py-2.5 text-right">Amount (PKR)</th>
              <th className="px-3 py-2.5">Narration</th>
            </tr>
          </thead>
          <tbody>
            {vouchers.length === 0 ? (
              <tr>
                <td colSpan={8} className="p-6 text-center text-slate-400">
                  No payment or receipt vouchers posted yet.
                </td>
              </tr>
            ) : (
              vouchers.map((v) => (
                <tr key={v.id} className="border-b border-slate-200 hover:bg-slate-50">
                  <td className="px-3 py-2 font-mono font-bold text-slate-900">
                    {v.voucher_number}
                  </td>
                  <td className="px-3 py-2 font-mono">{v.voucher_date}</td>
                  <td className="px-3 py-2 uppercase font-bold text-[10px] text-emerald-700">
                    {v.voucher_type.replace('_', ' ')}
                  </td>
                  <td className="px-3 py-2 font-bold">
                    {v.party_name} ({v.party_code})
                  </td>
                  <td className="px-3 py-2">
                    {v.financial_name} ({v.financial_code})
                  </td>
                  <td className="px-3 py-2 font-mono">
                    {v.payment_method} {v.reference_number ? `• ${v.reference_number}` : ''}
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-black text-slate-900">
                    {formatPKR(v.amount)}
                  </td>
                  <td className="px-3 py-2 text-slate-600">{v.description}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
