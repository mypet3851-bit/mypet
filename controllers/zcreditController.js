import asyncHandler from 'express-async-handler';
import { createSession, getSessionStatus, resendNotification } from '../services/zcreditService.js';

function buildDefaultUrls(req) {
  const publicBase = process.env.PUBLIC_WEB_URL || '';
  const apiBase = process.env.PUBLIC_API_URL || publicBase || '';
  const defaultSuccess = publicBase ? `${publicBase}/checkout/success` : '';
  const defaultCancel = publicBase ? `${publicBase}/checkout/cancel` : '';
  const defaultSuccessCb = apiBase ? `${apiBase}/api/zcredit/callback/success` : '';
  const defaultFailureCb = apiBase ? `${apiBase}/api/zcredit/callback/failure` : '';
  return { defaultSuccess, defaultCancel, defaultSuccessCb, defaultFailureCb };
}

export const createSessionHandler = asyncHandler(async (req, res) => {
  const {
    uniqueId,
    orderNumber,
    cartItems,
    customer,
    paymentType = 'regular',
    installments,
    currency: reqCurrency,
    successUrl,
    cancelUrl,
    callbackUrl,
    failureCallbackUrl,
    failureRedirectUrl,
    numberOfFailures
  } = req.body || {};

  if (!Array.isArray(cartItems) || cartItems.length === 0) {
    res.status(400).json({ message: 'cartItems required' });
    return;
  }

  const { defaultSuccess, defaultCancel, defaultSuccessCb, defaultFailureCb } = buildDefaultUrls(req);

  // Normalize cart items to include Amount and Currency as required by Z-Credit
  const fallbackCurrency = (typeof reqCurrency === 'string' && reqCurrency) || process.env.STORE_CURRENCY || 'ILS';
  const normalizedCartItems = cartItems.map((it) => {
    const qty = Number(it?.Quantity ?? it?.quantity ?? 1) || 1;
    const amountRaw = it?.Amount ?? it?.amount ?? it?.Price ?? it?.price;
    const amt = Number(amountRaw);
    const amount = Number.isFinite(amt) && amt > 0 ? +amt.toFixed(2) : 0;
    const name = it?.Name || it?.name || 'Item';
    const desc = it?.Description || it?.description || '';
    let image = it?.Image || it?.image || '';
    const currency = it?.Currency || it?.currency || fallbackCurrency;
    if (typeof image === 'string') {
      image = image.trim();
      if (image) {
        if (image.startsWith('http://')) {
          image = 'https://' + image.slice('http://'.length);
        } else if (image.startsWith('/')) {
          const base = process.env.PUBLIC_WEB_URL || process.env.STORE_BASE_URL || ((req.protocol === 'https' ? 'https://' : 'http://') + req.get('host'));
          image = base.replace(/\/$/, '') + image;
        }
        if (!image.startsWith('https://')) {
          // If still not https, omit to avoid provider input error
          image = undefined;
        }
      } else {
        image = undefined;
      }
    } else {
      image = undefined;
    }
    return {
      Amount: amount,
      Currency: currency,
      Name: name,
      Description: desc,
      Quantity: qty,
      Image: image, // Will be omitted if undefined when serialized
      IsTaxFree: Boolean(it?.IsTaxFree ?? it?.isTaxFree ?? false),
      AdjustAmount: Boolean(it?.AdjustAmount ?? it?.adjustAmount ?? false)
    };
  });

  // Final sanitization: drop any Image not strictly starting with https://
  for (const item of normalizedCartItems) {
    if (item.Image && !item.Image.startsWith('https://')) {
      delete item.Image;
    }
  }

  // Debug log (can be toggled off later)
  if (process.env.NODE_ENV !== 'production') {
    console.log('[zcredit][createSession] sanitized cart images:', normalizedCartItems.map(i => i.Image));
  }

  const total = normalizedCartItems.reduce((s, it) => s + (Number(it.Amount) || 0) * (Number(it.Quantity) || 0), 0);
  if (!(total > 0)) {
    return res.status(400).json({ message: 'Total cart amount must be greater than zero' });
  }

  // Cap NumberOfFailures per provider constraint (error when >5)
  const maxFailures = 5;
  const requestedFailures = typeof numberOfFailures === 'number' ? numberOfFailures : 99;
  const effectiveFailures = Math.min(Math.max(1, requestedFailures), maxFailures);
  if (requestedFailures !== effectiveFailures) {
    try { console.warn('[zcredit][createSession] Adjusted NumberOfFailures from %s to %s (provider cap=%s)', requestedFailures, effectiveFailures, maxFailures); } catch {}
  }

  const payload = {
    Local: req.body?.local || 'He',
    UniqueId: orderNumber || uniqueId || `wc_${Date.now()}`,
    SuccessUrl: successUrl || defaultSuccess,
    CancelUrl: cancelUrl || defaultCancel,
    CallbackUrl: callbackUrl || defaultSuccessCb,
    FailureCallBackUrl: failureCallbackUrl || defaultFailureCb,
    FailureRedirectUrl: failureRedirectUrl || '',
    NumberOfFailures: effectiveFailures,
    PaymentType: paymentType,
    CreateInvoice: req.body?.createInvoice ?? false,
    AdditionalText: req.body?.additionalText || '',
    ShowCart: req.body?.showCart ?? true,
    ThemeColor: req.body?.themeColor || '005ebb',
    BitButtonEnabled: req.body?.bitButtonEnabled ?? true,
    ApplePayButtonEnabled: req.body?.applePayButtonEnabled ?? true,
    GooglePayButtonEnabled: req.body?.googlePayButtonEnabled ?? true,
    Installments: installments || undefined,
    Customer: customer || undefined,
    CartItems: normalizedCartItems,
    FocusType: req.body?.focusType || 'None',
    CardsIcons: req.body?.cardsIcons || undefined,
    IssuerWhiteList: req.body?.issuerWhiteList || undefined,
    BrandWhiteList: req.body?.brandWhiteList || undefined,
    UseLightMode: req.body?.useLightMode ?? false,
    UseCustomCSS: req.body?.useCustomCSS ?? false,
    BackgroundColor: req.body?.backgroundColor || 'FFFFFF',
    ShowTotalSumInPayButton: req.body?.showTotalSumInPayButton ?? true,
    ForceCaptcha: req.body?.forceCaptcha ?? false,
    CustomCSS: req.body?.customCSS || '',
    Bypass3DS: req.body?.bypass3DS ?? false
  };

  const data = await createSession(payload);
  res.json(data);
});

export const getStatusHandler = asyncHandler(async (req, res) => {
  const { sessionId } = req.body || {};
  if (!sessionId) {
    res.status(400).json({ message: 'sessionId required' });
    return;
  }
  const data = await getSessionStatus(sessionId);
  res.json(data);
});

export const resendNotificationHandler = asyncHandler(async (req, res) => {
  const { sessionId } = req.body || {};
  if (!sessionId) {
    res.status(400).json({ message: 'sessionId required' });
    return;
  }
  const data = await resendNotification(sessionId);
  res.json(data);
});

export const successCallbackHandler = asyncHandler(async (req, res) => {
  try {
    console.log('[zcredit][callback][success]', JSON.stringify(req.body));
  } catch {}

  // Attempt to reconcile with existing order using UniqueID -> orderNumber
  if (process.env.SKIP_DB === '1') {
    return res.json({ ok: true, note: 'SKIP_DB=1; reconciliation skipped' });
  }

  try {
    const { default: Order } = await import('../models/Order.js');
    const uid = req.body?.UniqueID || req.body?.UniqueId || req.body?.uniqueId || '';
    if (!uid) {
      return res.json({ ok: true, warning: 'UniqueID missing in callback; order reconciliation skipped' });
    }
    const order = await Order.findOne({ orderNumber: uid });
    if (!order) {
      return res.json({ ok: true, warning: `Order not found by orderNumber=${uid}` });
    }

    // Update order payment fields
    order.paymentMethod = order.paymentMethod || 'card';
    order.paymentStatus = 'completed';
    order.paymentReference = req.body?.ReferenceNumber || order.paymentReference;
    const prevDetails = (order.paymentDetails && typeof order.paymentDetails === 'object') ? order.paymentDetails : {};
    order.paymentDetails = {
      ...prevDetails,
      gateway: 'zcredit',
      zcredit: {
        SessionId: req.body?.SessionId,
        ReferenceNumber: req.body?.ReferenceNumber,
        ApprovalNumber: req.body?.ApprovalNumber,
        Token: req.body?.Token,
        VoucherNumber: req.body?.VoucherNumber,
        InvoiceRecieptDocumentNumber: req.body?.InvoiceRecieptDocumentNumber,
        InvoiceRecieptNumber: req.body?.InvoiceRecieptNumber,
        CardNum: req.body?.CardNum,
        ExpDate_MMYY: req.body?.ExpDate_MMYY,
        PaymentMethod: req.body?.PaymentMethod
      }
    };
    await order.save();

    try {
      const { realTimeEventService } = await import('../services/realTimeEventService.js');
      realTimeEventService.emitOrderUpdate(order);
    } catch {}

    return res.json({ ok: true, orderId: order._id, orderNumber: order.orderNumber });
  } catch (e) {
    console.error('[zcredit][callback][success][reconcile] error', e?.message || e);
    // Always 200 for provider; include note
    return res.json({ ok: true, error: 'reconcile_failed' });
  }
});

export const failureCallbackHandler = asyncHandler(async (req, res) => {
  try {
    console.warn('[zcredit][callback][failure]', JSON.stringify(req.body));
  } catch {}

  if (process.env.SKIP_DB === '1') {
    return res.json({ ok: true, note: 'SKIP_DB=1; reconciliation skipped' });
  }

  try {
    const { default: Order } = await import('../models/Order.js');
    const uid = req.body?.UniqueID || req.body?.UniqueId || req.body?.uniqueId || '';
    if (!uid) {
      return res.json({ ok: true, warning: 'UniqueID missing in failure callback; order reconciliation skipped' });
    }
    const order = await Order.findOne({ orderNumber: uid });
    if (!order) {
      return res.json({ ok: true, warning: `Order not found by orderNumber=${uid}` });
    }
    order.paymentStatus = 'failed';
    const prevDetails = (order.paymentDetails && typeof order.paymentDetails === 'object') ? order.paymentDetails : {};
    order.paymentDetails = {
      ...prevDetails,
      gateway: 'zcredit',
      zcreditFailure: {
        ReturnCode: req.body?.ReturnCode,
        ReturnMessage: req.body?.ReturnMessage
      }
    };
    await order.save();
    try {
      const { realTimeEventService } = await import('../services/realTimeEventService.js');
      realTimeEventService.emitOrderUpdate(order);
    } catch {}
    return res.json({ ok: true, orderId: order._id, orderNumber: order.orderNumber });
  } catch (e) {
    console.error('[zcredit][callback][failure][reconcile] error', e?.message || e);
    return res.json({ ok: true, error: 'reconcile_failed' });
  }
});

export default {
  createSessionHandler,
  getStatusHandler,
  resendNotificationHandler,
  successCallbackHandler,
  failureCallbackHandler
};
