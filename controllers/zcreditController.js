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
    cartItems,
    customer,
    paymentType = 'regular',
    installments,
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

  const payload = {
    Local: req.body?.local || 'He',
    UniqueId: uniqueId || `wc_${Date.now()}`,
    SuccessUrl: successUrl || defaultSuccess,
    CancelUrl: cancelUrl || defaultCancel,
    CallbackUrl: callbackUrl || defaultSuccessCb,
    FailureCallBackUrl: failureCallbackUrl || defaultFailureCb,
    FailureRedirectUrl: failureRedirectUrl || '',
    NumberOfFailures: typeof numberOfFailures === 'number' ? numberOfFailures : 99,
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
    CartItems: cartItems,
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
  res.json({ ok: true });
});

export const failureCallbackHandler = asyncHandler(async (req, res) => {
  try {
    console.warn('[zcredit][callback][failure]', JSON.stringify(req.body));
  } catch {}
  res.json({ ok: true });
});

export default {
  createSessionHandler,
  getStatusHandler,
  resendNotificationHandler,
  successCallbackHandler,
  failureCallbackHandler
};
