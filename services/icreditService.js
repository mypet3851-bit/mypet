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
