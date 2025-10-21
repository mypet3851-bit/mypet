import Settings from '../models/Settings.js';

export function buildICreditRequest({ order, settings, overrides = {} }) {
  if (!order) throw new Error('order_required');
  const s = settings || {};
  const pay = s.payments || {};
  const ic = pay.icredit || {};
  if (!ic.groupPrivateToken) {
    throw new Error('Missing GroupPrivateToken in settings');
  }

  const val = (v, def) => (typeof v === 'undefined' || v === null ? def : v);

  const items = (order.items || []).map((it) => ({
    Id: 0,
    CatalogNumber: it.sku || it.variantId || String(it.product),
    UnitPrice: Number(it.price) || 0,
    Quantity: Number(it.quantity) || 0,
    Description: it.name || ''
  }));

  const body = {
    GroupPrivateToken: ic.groupPrivateToken,
    Items: items,
    RedirectURL: val(overrides.RedirectURL, ic.redirectURL || ''),
    IPNURL: val(overrides.IPNURL, ic.ipnURL || ''),
    ExemptVAT: val(overrides.ExemptVAT, !!ic.exemptVAT),
    MaxPayments: val(overrides.MaxPayments, ic.maxPayments || 1),
    CreditFromPayment: val(overrides.CreditFromPayment, ic.creditFromPayment || 0),
    EmailAddress: order.customerInfo?.email || '',
    CustomerLastName: order.customerInfo?.lastName || '',
    CustomerFirstName: order.customerInfo?.firstName || '',
    Address: order.shippingAddress?.street || '',
    City: order.shippingAddress?.city || '',
    Zipcode: overrides.Zipcode || '',
    PhoneNumber: order.customerInfo?.mobile || '',
    PhoneNumber2: '',
    FaxNumber: '',
    IdNumber: overrides.IdNumber || '',
    VatNumber: overrides.VatNumber || '',
    Comments: overrides.Comments || `Order ${order.orderNumber}`,
    HideItemList: val(overrides.HideItemList, !!ic.hideItemList),
    DocumentLanguage: val(overrides.DocumentLanguage, ic.documentLanguage || 'he'),
    CreateToken: val(overrides.CreateToken, !!ic.createToken),
    Discount: val(overrides.Discount, Number(ic.defaultDiscount || 0)),
    Custom1: overrides.Custom1 || order._id?.toString(),
    Custom2: overrides.Custom2 || '',
    Custom3: overrides.Custom3 || '',
    Custom4: overrides.Custom4 || '',
    Custom5: overrides.Custom5 || '',
    Custom6: overrides.Custom6 || '',
    Custom7: overrides.Custom7 || '',
    Custom8: overrides.Custom8 || '',
    Custom9: overrides.Custom9 || '',
    Reference: overrides.Reference || order.orderNumber,
    Order: overrides.Order || `Ecommerce order ${order.orderNumber}`,
    EmailBcc: val(overrides.EmailBcc, ic.emailBcc || ''),
    CustomerId: overrides.CustomerId || '',
    AgentId: overrides.AgentId || 0,
    ProjectId: overrides.ProjectId || 0
  };

  // Remove empty fields to keep payload tidy
  const clean = Object.fromEntries(Object.entries(body).filter(([_, v]) => v !== '' && v !== null && typeof v !== 'undefined'));
  return clean;
}

export async function loadSettings() {
  let settings = await Settings.findOne();
  if (!settings) settings = await Settings.create({});
  return settings;
}
// Utility to build iCredit Payment Page request body from settings + order
// Does not perform HTTP calls; controller/route can use this and then POST to c.apiUrl
import Settings from '../models/Settings.js';

export async function buildICreditRequest({ order, overrides = {} }) {
  if (!order) throw new Error('order is required');
  const settings = await Settings.findOne();
  const c = settings?.payments?.icredit || {};
  const items = Array.isArray(order.items) ? order.items : [];
  const address = order.shippingAddress || {};
  const cust = order.customerInfo || {}; // fallback if order schema differs

  const payload = {
    GroupPrivateToken: (overrides.GroupPrivateToken || c.groupPrivateToken || '').trim(),
    Items: items.map((it, idx) => ({
      Id: 0,
      CatalogNumber: it.sku || it.catalogNumber || it.product || '',
      UnitPrice: Number(it.price) || 0,
      Quantity: Number(it.quantity) || 1,
      Description: it.name || it.description || ''
    })),
    RedirectURL: overrides.RedirectURL || c.redirectURL || '',
    IPNURL: overrides.IPNURL || c.ipnURL || '',
    ExemptVAT: typeof overrides.ExemptVAT === 'boolean' ? overrides.ExemptVAT : !!c.exemptVAT,
    MaxPayments: Number.isFinite(Number(overrides.MaxPayments)) ? Number(overrides.MaxPayments) : (Number(c.maxPayments) || 1),
    CreditFromPayment: Number(overrides.CreditFromPayment) || Number(c.creditFromPayment) || 0,
    EmailAddress: order.email || cust.email || '',
    CustomerLastName: address.lastName || cust.lastName || '',
    CustomerFirstName: address.firstName || cust.firstName || '',
    Address: address.street || address.address || '',
    POB: Number(address.pob) || undefined,
    City: address.city || '',
    Zipcode: Number(address.zip) || Number(address.zipcode) || undefined,
    PhoneNumber: address.mobile || order.mobile || cust.mobile || '',
    PhoneNumber2: '',
    FaxNumber: '',
    IdNumber: Number(cust.idNumber) || undefined,
    VatNumber: Number(cust.vatNumber) || undefined,
    Comments: overrides.Comments || order.notes || '',
    HideItemList: typeof overrides.HideItemList === 'boolean' ? overrides.HideItemList : !!c.hideItemList,
    DocumentLanguage: overrides.DocumentLanguage || c.documentLanguage || 'he',
    CreateToken: typeof overrides.CreateToken === 'boolean' ? overrides.CreateToken : !!c.createToken,
    Discount: Number(overrides.Discount) || Number(c.defaultDiscount) || 0,
    Custom1: String(overrides.Custom1 || order._id || ''),
    Custom2: String(overrides.Custom2 || ''),
    Custom3: String(overrides.Custom3 || ''),
    Custom4: String(overrides.Custom4 || ''),
    Custom5: String(overrides.Custom5 || ''),
    Custom6: String(overrides.Custom6 || ''),
    Custom7: String(overrides.Custom7 || ''),
    Custom8: String(overrides.Custom8 || ''),
    Custom9: String(overrides.Custom9 || ''),
    Reference: Number(overrides.Reference) || undefined,
    Order: overrides.Order || `Order ${order._id || ''}`.trim(),
    EmailBcc: overrides.EmailBcc || c.emailBcc || '',
    CustomerId: Number(overrides.CustomerId) || undefined,
    AgentId: Number(overrides.AgentId) || 0,
    ProjectId: Number(overrides.ProjectId) || 0
  };

  // Remove undefined fields to keep payload clean
  Object.keys(payload).forEach(k => payload[k] === undefined && delete payload[k]);
  return payload;
}
