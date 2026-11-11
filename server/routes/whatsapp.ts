import { Router } from 'express';
import type { Request, Response } from 'express';
import { getDatabase } from '../db/connection.ts';
import type { AuthenticatedRequest } from '../middleware/authMiddleware.ts';

export const whatsappRouter = Router();

/**
 * Server-side Pakistani WhatsApp number normalizer:
 * - Removes spaces, dashes, brackets, dots, and "+"
 * - 0300xxxxxxx -> 92300xxxxxxx
 * - 300xxxxxxx -> 92300xxxxxxx
 * - Numbers starting with 92 stay as-is
 */
export function normalizeWhatsAppNumberServer(phone?: string | null): string | null {
  if (!phone) return null;
  let cleaned = String(phone)
    .trim()
    .replace(/[\s\-().+]/g, '');

  if (!cleaned) return null;

  if (cleaned.startsWith('0092')) {
    cleaned = '92' + cleaned.slice(4);
  } else if (cleaned.startsWith('03') && cleaned.length === 11) {
    cleaned = '92' + cleaned.slice(1);
  } else if (cleaned.startsWith('3') && cleaned.length === 10) {
    cleaned = '92' + cleaned;
  } else if (cleaned.startsWith('0') && cleaned.length >= 10) {
    cleaned = '92' + cleaned.slice(1);
  }

  if (!/^\d{11,15}$/.test(cleaned)) {
    return null;
  }
  if (cleaned.startsWith('92') && cleaned.length !== 12) {
    return null;
  }
  return cleaned;
}

function escapePdfTextServer(text: string): string {
  return String(text || '')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function generateServerPdfBuffer(lines: string[]): Buffer {
  let y = 790;
  const ops: string[] = ['BT', '/F1 10 Tf'];
  lines.forEach((line, idx) => {
    const sz = idx === 0 ? 14 : 9.5;
    ops.push(`/F1 ${sz} Tf`);
    ops.push(`1 0 0 1 40 ${y} Tm (${escapePdfTextServer(line)}) Tj`);
    y -= idx === 0 ? 20 : 14;
  });
  ops.push('ET');
  const stream = ops.join('\n');

  const objs = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n',
    '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>\nendobj\n',
    `5 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`,
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (const o of objs) {
    offsets.push(pdf.length);
    pdf += o;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, 'utf-8');
}

function formatPKRServer(amount: number): string {
  const n = Number(amount || 0);
  return `Rs. ${n.toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDateDDMMYYYY(rawDate?: string | null): string {
  if (!rawDate) {
    const now = new Date();
    return `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
  }
  const m = String(rawDate).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return String(rawDate);
}

/**
 * GET /api/whatsapp/logs
 * Retrieves recent WhatsApp send logs for status display & duplicate detection.
 */
whatsappRouter.get('/logs', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const { invoiceId, documentNumber } = req.query;

    let sql = 'SELECT * FROM whatsapp_log WHERE 1=1';
    const params: Array<string | number> = [];

    if (invoiceId) {
      sql += ' AND invoice_id = ?';
      params.push(Number(invoiceId));
    }
    if (documentNumber) {
      sql += ' AND document_number = ?';
      params.push(String(documentNumber));
    }

    sql += ' ORDER BY id DESC LIMIT 100';
    const logs = db.prepare(sql).all(...params);
    const cloudConfigured = Boolean(
      process.env.WHATSAPP_CLOUD_API_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID
    );

    res.json({
      success: true,
      cloudConfigured,
      logs,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: msg });
  }
});

/**
 * PUT /api/whatsapp/customer-phone/:accountId
 * Saves a newly entered phone number directly to the customer record in accounts table
 * so the user never has to type it again.
 */
whatsappRouter.put('/customer-phone/:accountId', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const accountId = Number(req.params.accountId || 0);
    const rawPhone = String(req.body?.phone || '').trim();
    const normalized = normalizeWhatsAppNumberServer(rawPhone);

    if (!accountId || accountId <= 0) {
      return res.status(400).json({ success: false, error: 'Valid customer accountId is required.' });
    }
    if (!normalized) {
      return res.status(400).json({
        success: false,
        error: 'Invalid Pakistani WhatsApp number. Enter format 03001234567 or 923001234567.',
      });
    }

    const existing = db.prepare('SELECT id, account_name FROM accounts WHERE id = ?').get(accountId) as
      | { id: number; account_name: string }
      | undefined;
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Customer account not found.' });
    }

    db.prepare('UPDATE accounts SET phone = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
      rawPhone,
      accountId
    );

    res.json({
      success: true,
      accountId,
      phone: rawPhone,
      normalizedPhone: normalized,
      message: `Phone number saved to customer "${existing.account_name}".`,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: msg });
  }
});

/**
 * POST /api/whatsapp/log
 * Records a Phase 1 (wa.me + PDF) or manual WhatsApp send in whatsapp_log.
 */
whatsappRouter.post('/log', (req: AuthenticatedRequest, res: Response) => {
  try {
    const db = getDatabase();
    const body = req.body || {};
    const invoiceId = body.invoiceId ? Number(body.invoiceId) : null;
    const documentType = String(body.documentType || 'invoice');
    const documentNumber = String(body.documentNumber || '');
    const customerAccountId = body.customerAccountId ? Number(body.customerAccountId) : null;
    const customerName = String(body.customerName || 'Walk-in Customer');
    const phoneNumber = String(body.number || body.phoneNumber || '');
    const mode = String(body.mode || 'phase1_wa_me');
    const status = String(body.status || 'Sent');
    const errorMsg = body.error ? String(body.error) : null;
    const sentBy = req.user?.username || 'system';

    const insertRes = db
      .prepare(
        `
        INSERT INTO whatsapp_log (
          invoice_id, document_type, document_number, customer_account_id,
          customer_name, number, mode, status, error, sent_by, timestamp
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `
      )
      .run(
        invoiceId,
        documentType,
        documentNumber,
        customerAccountId,
        customerName,
        phoneNumber,
        mode,
        status,
        errorMsg,
        sentBy
      );

    const logRow = db
      .prepare('SELECT * FROM whatsapp_log WHERE id = ?')
      .get(Number(insertRes.lastInsertRowid));

    res.json({
      success: true,
      log: logRow,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: msg });
  }
});

/**
 * POST /api/whatsapp/send
 * Phase 2: Full automatic WhatsApp Business Cloud API sender.
 * Body: { invoiceId, reportType, params }
 * Generates the PDF, uploads it as a media/document message, and sends it to the customer's normalized number.
 * Logs every send in whatsapp_log table.
 */
whatsappRouter.post('/send', async (req: AuthenticatedRequest, res: Response) => {
  const db = getDatabase();
  const body = req.body || {};
  const invoiceId = body.invoiceId ? Number(body.invoiceId) : null;
  const reportType = String(body.reportType || 'invoice');
  const params = body.params || {};
  const sentBy = req.user?.username || 'system';

  try {
    const settings = db.prepare('SELECT * FROM company_settings LIMIT 1').get() as
      | Record<string, any>
      | undefined;
    const storeName = String(settings?.store_name || 'ABRAR MEDICAL STORE');

    let docNumber = String(params.documentNumber || '');
    let docDate = String(params.documentDate || '');
    let customerName = String(params.customerName || 'Walk-in Customer');
    let customerAccountId = params.customerAccountId ? Number(params.customerAccountId) : null;
    let rawPhone = String(params.customerPhone || '');
    let totalAmount = Number(params.totalAmount || 0);
    let paidAmount = Number(params.paidAmount || 0);
    let remainingBalance = Number(params.remainingBalance || 0);
    let lineItems: Array<Record<string, any>> = Array.isArray(params.items) ? params.items : [];

    // If invoiceId is provided, load authoritative invoice + customer phone from database
    if (invoiceId && invoiceId > 0) {
      const saleRow = db
        .prepare(
          `
          SELECT s.*, a.phone as account_phone, a.account_name as linked_account_name
          FROM sales s
          LEFT JOIN accounts a ON s.customer_account_id = a.id
          WHERE s.id = ?
        `
        )
        .get(invoiceId) as Record<string, any> | undefined;

      if (saleRow) {
        docNumber = String(saleRow.invoice_number || docNumber);
        docDate = String(saleRow.invoice_date || docDate);
        customerName = String(saleRow.customer_name || saleRow.linked_account_name || customerName);
        customerAccountId = saleRow.customer_account_id ? Number(saleRow.customer_account_id) : customerAccountId;
        rawPhone = String(rawPhone || saleRow.account_phone || '');
        totalAmount = Number(saleRow.net_total ?? totalAmount);
        paidAmount = Number(saleRow.paid_amount ?? paidAmount);
        remainingBalance = Number(saleRow.balance_amount ?? remainingBalance);
        lineItems = db
          .prepare('SELECT * FROM sale_items WHERE sale_id = ? ORDER BY id ASC')
          .all(invoiceId) as Array<Record<string, any>>;
      }
    } else if (customerAccountId && customerAccountId > 0 && !rawPhone) {
      const accRow = db
        .prepare('SELECT account_name, phone FROM accounts WHERE id = ?')
        .get(customerAccountId) as { account_name: string; phone: string } | undefined;
      if (accRow) {
        customerName = customerName || accRow.account_name;
        rawPhone = accRow.phone || '';
      }
    }

    const normalizedNumber = normalizeWhatsAppNumberServer(rawPhone);
    if (!normalizedNumber) {
      return res.status(400).json({
        success: false,
        status: 'Failed',
        error: 'Customer WhatsApp phone number is missing or invalid.',
      });
    }

    const token = process.env.WHATSAPP_CLOUD_API_TOKEN || '';
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || '';

    if (!token || !phoneNumberId) {
      const errText =
        'WhatsApp Cloud API credentials (WHATSAPP_CLOUD_API_TOKEN / WHATSAPP_PHONE_NUMBER_ID) are not configured on server. Use Phase 1 (Free WhatsApp Web/App) or configure Cloud API env vars.';
      const logInsert = db
        .prepare(
          `
          INSERT INTO whatsapp_log (
            invoice_id, document_type, document_number, customer_account_id,
            customer_name, number, mode, status, error, sent_by, timestamp
          ) VALUES (?, ?, ?, ?, ?, ?, 'phase2_cloud_api', 'Failed', ?, ?, CURRENT_TIMESTAMP)
        `
        )
        .run(
          invoiceId,
          reportType,
          docNumber,
          customerAccountId,
          customerName,
          normalizedNumber,
          errText,
          sentBy
        );

      const logRow = db
        .prepare('SELECT * FROM whatsapp_log WHERE id = ?')
        .get(Number(logInsert.lastInsertRowid));

      return res.status(400).json({
        success: false,
        status: 'Failed',
        cloudConfigured: false,
        error: errText,
        log: logRow,
      });
    }

    // Build PDF document buffer
    const pdfLines: string[] = [
      storeName.toUpperCase(),
      '------------------------------------------------------------------------',
      `Document Type : ${reportType.toUpperCase()}`,
      `Document No   : ${docNumber}`,
      `Date          : ${formatDateDDMMYYYY(docDate)}`,
      `Customer      : ${customerName}`,
      `WhatsApp No   : +${normalizedNumber}`,
      '------------------------------------------------------------------------',
    ];

    if (lineItems.length > 0) {
      pdfLines.push(' #  Medicine Name                     Qty        Rate        Total (PKR)');
      pdfLines.push('------------------------------------------------------------------------');
      lineItems.slice(0, 28).forEach((it, i) => {
        const idxStr = String(i + 1).padStart(2, ' ');
        const nm = String(it.item_name || 'Item').slice(0, 30).padEnd(32, ' ');
        const q = `${Number(it.quantity || 0)}P`.padEnd(9, ' ');
        const rt = Number(it.unit_price || 0).toFixed(2).padStart(10, ' ');
        const tot = Number(it.line_total || 0).toFixed(2).padStart(12, ' ');
        pdfLines.push(`${idxStr}  ${nm} ${q} ${rt} ${tot}`);
      });
      pdfLines.push('------------------------------------------------------------------------');
    }

    pdfLines.push(`Total Amount      : ${formatPKRServer(totalAmount)}`);
    pdfLines.push(`Paid Amount       : ${formatPKRServer(paidAmount)}`);
    pdfLines.push(`Remaining Balance : ${formatPKRServer(remainingBalance)}`);
    pdfLines.push('------------------------------------------------------------------------');
    pdfLines.push(`Thank you for choosing ${storeName}!`);

    const pdfBuffer = generateServerPdfBuffer(pdfLines);
    const filename = `${String(docNumber || 'Invoice').replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`;

    // Step 1: Upload PDF media to WhatsApp Business Cloud API
    const formData = new FormData();
    formData.append('messaging_product', 'whatsapp');
    formData.append(
      'file',
      new Blob([new Uint8Array(pdfBuffer)], { type: 'application/pdf' }),
      filename
    );
    formData.append('type', 'application/pdf');

    const mediaResp = await fetch(
      `https://graph.facebook.com/v19.0/${phoneNumberId}/media`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      }
    );

    const mediaJson = (await mediaResp.json()) as Record<string, any>;
    if (!mediaResp.ok || !mediaJson?.id) {
      throw new Error(
        mediaJson?.error?.message || `WhatsApp Media Upload failed (HTTP ${mediaResp.status})`
      );
    }

    const caption = [
      `*${storeName}*`,
      `Invoice No: ${docNumber}`,
      `Date: ${formatDateDDMMYYYY(docDate)}`,
      `Total: ${formatPKRServer(totalAmount)}`,
      `Paid: ${formatPKRServer(paidAmount)}`,
      `Remaining Balance: ${formatPKRServer(remainingBalance)}`,
      `Thank you for choosing ${storeName}!`,
    ].join('\n');

    // Step 2: Send Document Message to Customer's normalized WhatsApp number
    const msgResp = await fetch(
      `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: normalizedNumber,
          type: 'document',
          document: {
            id: mediaJson.id,
            caption,
            filename,
          },
        }),
      }
    );

    const msgJson = (await msgResp.json()) as Record<string, any>;
    if (!msgResp.ok) {
      throw new Error(
        msgJson?.error?.message || `WhatsApp Message Send failed (HTTP ${msgResp.status})`
      );
    }

    const logInsert = db
      .prepare(
        `
        INSERT INTO whatsapp_log (
          invoice_id, document_type, document_number, customer_account_id,
          customer_name, number, mode, status, error, sent_by, timestamp
        ) VALUES (?, ?, ?, ?, ?, ?, 'phase2_cloud_api', 'Sent', NULL, ?, CURRENT_TIMESTAMP)
      `
      )
      .run(
        invoiceId,
        reportType,
        docNumber,
        customerAccountId,
        customerName,
        normalizedNumber,
        sentBy
      );

    const logRow = db
      .prepare('SELECT * FROM whatsapp_log WHERE id = ?')
      .get(Number(logInsert.lastInsertRowid));

    return res.json({
      success: true,
      status: 'Sent',
      cloudConfigured: true,
      log: logRow,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const normalizedNumber = normalizeWhatsAppNumberServer(params.customerPhone) || String(params.customerPhone || '');

    const logInsert = db
      .prepare(
        `
        INSERT INTO whatsapp_log (
          invoice_id, document_type, document_number, customer_account_id,
          customer_name, number, mode, status, error, sent_by, timestamp
        ) VALUES (?, ?, ?, ?, ?, ?, 'phase2_cloud_api', 'Failed', ?, ?, CURRENT_TIMESTAMP)
      `
      )
      .run(
        invoiceId,
        reportType,
        String(params.documentNumber || ''),
        params.customerAccountId ? Number(params.customerAccountId) : null,
        String(params.customerName || 'Walk-in Customer'),
        normalizedNumber,
        errorMsg,
        sentBy
      );

    const logRow = db
      .prepare('SELECT * FROM whatsapp_log WHERE id = ?')
      .get(Number(logInsert.lastInsertRowid));

    return res.status(500).json({
      success: false,
      status: 'Failed',
      error: errorMsg,
      log: logRow,
    });
  }
});
