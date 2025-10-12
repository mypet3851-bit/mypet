import mongoose from 'mongoose';
import Order from '../models/Order.js';
import Product from '../models/Product.js';
import Recipient from '../models/Recipient.js';
import Inventory from '../models/Inventory.js';
import { inventoryService } from '../services/inventoryService.js';
import { SUPPORTED_CURRENCIES } from '../utils/currency.js';
import { realTimeEventService } from '../services/realTimeEventService.js';
import { sendPushToAll, sendPushToAdmins } from '../services/pushService.js';
import { whatsappFallbackForNewOrder } from '../services/whatsappFallbackService.js';
import Settings from '../models/Settings.js';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { calculateShippingFee as calcShipFee } from '../services/shippingService.js';
import DeliveryCompany from '../models/DeliveryCompany.js';
import { sendToCompany, mapStatus, validateRequiredMappings, validateCompanyConfiguration } from '../services/deliveryIntegrationService.js';

// Update (admin) - update recipient/customer info, shipping address (city/street), status, and optionally shipping fee
export const updateOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      customerInfo: ci,
      shippingAddress: sa,
      status,
      shippingFee,
      deliveryFee
    } = req.body || {};

    const order = await Order.findById(id);
    if (!order) return res.status(404).json({ message: 'Order not found' });

    // Update customer info fields if provided
    if (ci && typeof ci === 'object') {
      order.customerInfo = {
        ...order.customerInfo?.toObject?.() || order.customerInfo || {},
        ...(ci.firstName ? { firstName: ci.firstName } : {}),
        ...(ci.lastName ? { lastName: ci.lastName } : {}),
        ...(ci.email ? { email: ci.email } : {}),
        ...(ci.mobile ? { mobile: ci.mobile } : {}),
        ...(ci.secondaryMobile ? { secondaryMobile: ci.secondaryMobile } : {})
      };
    }

    // Update shipping address (only allow street & city; never allow changing country for now)
    if (sa && typeof sa === 'object') {
      const next = { ...(order.shippingAddress || {}) };
      if (sa.street) next.street = sa.street;
      if (sa.city) next.city = sa.city; // critical fix for city not persisting
      order.shippingAddress = next;
    }

    // Status update
    if (status && typeof status === 'string' && status !== order.status) {
      order.status = status;
    }

    // Optional shipping fee override (mirror logic with pre-save hook)
    if (typeof shippingFee === 'number' && shippingFee >= 0) {
      order.shippingFee = shippingFee;
    } else if (typeof deliveryFee === 'number' && deliveryFee >= 0) {
      // legacy field
      order.deliveryFee = deliveryFee;
    }

    await order.save();

    // Emit real-time event so admin dashboards refresh
    try { realTimeEventService.emitOrderUpdate(order); } catch {}

    res.json({ message: 'Order updated', order });
  } catch (error) {
    console.error('Error updating order (admin):', error);
    res.status(500).json({ message: 'Failed to update order', error: error?.message });
  }
};

// Create order
export const createOrder = async (req, res) => {
  const session = await mongoose.startSession();
  let useTransaction = false;

  try {
    console.log('createOrder called with body:', JSON.stringify(req.body, null, 2));
  const { items, shippingAddress, paymentMethod, customerInfo } = req.body;

    // If the request includes a Bearer token, attempt to associate the order with the authenticated user
    try {
      const authHeader = req.header('Authorization');
      const token = authHeader?.startsWith('Bearer ') ? authHeader.replace('Bearer ', '') : null;
      if (token) {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.userId);
        if (user) {
          // Attach to request for downstream usage
          req.user = user;
        }
      }
    } catch (e) {
      // Silently ignore token errors to allow guest checkout
      console.warn('Optional auth token invalid for createOrder; proceeding as guest if needed.');
    }

    // Single store currency mode: trust incoming currency if matches store setting; else force store currency
    let currency = req.body?.currency;
    try {
      const storeSettings = await Settings.findOne();
      const storeCurrency = storeSettings?.currency || process.env.STORE_CURRENCY || 'USD';
      if (!currency || currency !== storeCurrency) {
        currency = storeCurrency;
      }
    } catch {
      currency = process.env.STORE_CURRENCY || currency || 'USD';
    }

    // Validate required fields
    if (!items?.length) {
      return res.status(400).json({ message: 'Order must contain at least one item' });
    }

    if (!customerInfo?.email || !customerInfo?.mobile) {
      return res.status(400).json({ message: 'Customer email and mobile number are required' });
    }

    if (!shippingAddress?.street || !shippingAddress?.city || !shippingAddress?.country) {
      return res.status(400).json({ message: 'Complete shipping address is required' });
    }

    // In single-currency mode we only validate equality with store currency; SUPPORTED_CURRENCIES retained for backward compatibility.
    if (!SUPPORTED_CURRENCIES[currency]) {
      return res.status(400).json({ message: 'Store currency not recognized in configuration' });
    }

    // Attempt to start transaction; if not supported (e.g., standalone Mongo), continue without it
    try {
      await session.startTransaction();
      useTransaction = true;
    } catch (txnErr) {
      console.warn('MongoDB transactions not supported in current environment; proceeding without transaction. Reason:', txnErr?.message || txnErr);
    }

    // Calculate total and validate stock
    // We now treat catalog product.price as already expressed in the chosen store currency.
    // Previous implementation multiplied by an exchangeRate (assuming a USD base) which caused inflated totals
    // when catalog prices were already in the display currency. We set exchangeRate=1 for backward compatibility.
    let totalAmount = 0;
    const orderItems = [];
    const exchangeRate = 1; // No runtime FX conversion; prices stored as-is
    const stockUpdates = []; // Track stock updates for rollback

    for (const item of items) {
      const baseProductQuery = Product.findById(item.product);
      const product = useTransaction ? await baseProductQuery.session(session) : await baseProductQuery;

      if (!product) {
        if (session.inTransaction()) await session.abortTransaction();
        return res.status(404).json({ message: `Product not found: ${item.product}` });
      }

      const qty = Number(item.quantity) || 0;
      if (qty <= 0) {
        if (session.inTransaction()) await session.abortTransaction();
        return res.status(400).json({ message: `Invalid quantity for product ${product.name}` });
      }

      const sizeName = item.size;
      const hasSizes = Array.isArray(product.sizes) && product.sizes.length > 0;

      if (sizeName && hasSizes) {
        const sizeIndex = product.sizes.findIndex((s) => s.name === sizeName);
        if (sizeIndex === -1) {
          if (session.inTransaction()) await session.abortTransaction();
          return res.status(400).json({ message: `Size '${sizeName}' not found for product ${product.name}` });
        }
        const available = Number(product.sizes[sizeIndex].stock) || 0;
        if (available < qty) {
          if (session.inTransaction()) await session.abortTransaction();
          return res.status(400).json({ message: `Insufficient stock for ${product.name} (size: ${sizeName}). Available: ${available}, Requested: ${qty}` });
        }
        // Decrement size stock
        product.sizes[sizeIndex].stock = available - qty;
      } else {
        // No size specified, check main stock
        const mainStock = Number(product.stock) || 0;
        if (mainStock < qty) {
          if (session.inTransaction()) await session.abortTransaction();
          return res.status(400).json({ message: `Insufficient stock for ${product.name}. Available: ${mainStock}, Requested: ${qty}` });
        }
        // Decrement main stock
        product.stock = mainStock - qty;
      }

      // Use catalog price directly (already in store currency)
      const catalogPrice = Number(product.price);
      if (!isFinite(catalogPrice)) {
        if (session.inTransaction()) await session.abortTransaction();
        return res.status(400).json({ message: `Product ${product.name} has invalid price` });
      }
      totalAmount += catalogPrice * qty;

      orderItems.push({
        product: product._id,
        quantity: qty,
        price: catalogPrice, // store unmodified
        name: product.name,
        image: Array.isArray(product.images) && product.images.length ? product.images[0] : undefined,
        size: hasSizes ? (sizeName || undefined) : undefined
      });

      // Track stock update for this product
      stockUpdates.push({
        productId: product._id,
        originalStock: Number(product.stock) || 0,
        newStock: Number(product.stock) || 0 // This value is informational; actual inventory handled elsewhere
      });

      // Persist product stock changes
      if (useTransaction) {
        await product.save({ session });
      } else {
        await product.save();
      }
    }

    // Save or update recipient in Recipient collection
    const recipientQuery = {
      email: customerInfo.email,
      mobile: customerInfo.mobile
    };
    const recipientUpdate = {
      firstName: customerInfo.firstName,
      lastName: customerInfo.lastName,
      email: customerInfo.email,
      mobile: customerInfo.mobile,
      secondaryMobile: customerInfo.secondaryMobile,
      address: {
        street: shippingAddress.street,
        city: shippingAddress.city,
        country: shippingAddress.country
      }
    };
    if (useTransaction) {
      await Recipient.findOneAndUpdate(recipientQuery, recipientUpdate, { upsert: true, new: true, session });
    } else {
      await Recipient.findOneAndUpdate(recipientQuery, recipientUpdate, { upsert: true, new: true });
    }

    // --- Shipping Fee Resolution ---
    // Priority:
    // 1. If client explicitly sent a positive shippingFee (flat fee UI) trust it (configurable via ALLOW_CLIENT_SHIPPING_FEE=true)
    // 2. Else attempt dynamic calculation via shipping service
    // 3. If calc fails OR returns 0 while client provided a positive hint in totalWithShipping, derive difference
    // 4. Final fallback: DEFAULT_SHIPPING_FEE env or 50
    let shippingFee = 0;
    let shippingMeta = {
      city: shippingAddress?.city,
      rateId: null,
      zoneId: null,
      methodName: null,
      costComponents: []
    };
    const allowClientProvided = String(process.env.ALLOW_CLIENT_SHIPPING_FEE || 'true').toLowerCase() !== 'false';
  const rawShippingFee = req.body?.shippingFee;
  const rawClientShippingFee = req.body?.clientShippingFee;
  const rawDeliveryFee = req.body?.deliveryFee;
  const clientShippingFee = Number(rawShippingFee);
  const clientAltFee = Number(rawClientShippingFee);
  const clientDeliveryFee = Number(rawDeliveryFee);
  const clientTotalWithShipping = Number(req.body?.totalWithShipping);
    const clientProvidedValid = allowClientProvided && isFinite(clientShippingFee) && clientShippingFee > 0;

    if (clientProvidedValid) {
      shippingFee = clientShippingFee;
    } else if (allowClientProvided && isFinite(clientAltFee) && clientAltFee > 0) {
      // Fallback: some clients send clientShippingFee only
      shippingFee = clientAltFee;
    } else if (allowClientProvided && isFinite(clientDeliveryFee) && clientDeliveryFee > 0) {
      // Legacy / alternate field
      shippingFee = clientDeliveryFee;
    } else {
      try {
        const addressCountry = shippingAddress.country;
        const addressCity = shippingAddress.city;
        shippingFee = await calcShipFee({ subtotal: totalAmount, weight: 0, country: addressCountry, region: undefined, city: addressCity });
        if (!isFinite(shippingFee) || shippingFee < 0) shippingFee = 0;
      } catch (e) {
        console.warn('Shipping fee calculation failed, will use fallback logic:', e?.message || e);
        shippingFee = 0; // trigger fallback below
      }
    }

    console.log('[ShippingResolution]', {
      rawShippingFee,
      rawClientShippingFee,
      rawDeliveryFee,
      clientShippingFeeParsed: clientShippingFee,
      clientAltFeeParsed: clientAltFee,
      clientDeliveryFeeParsed: clientDeliveryFee,
      clientTotalWithShipping,
      chosenShippingFee: shippingFee,
      allowClientProvided
    });

    // Hard override safeguard: if all logic above yielded 0 but request clearly sent a positive numeric value, adopt it now.
    if (shippingFee === 0) {
      const rawCandidates = [rawShippingFee, rawClientShippingFee, rawDeliveryFee]
        .map(v => (typeof v === 'string' ? v.trim() : v))
        .map(v => Number(v))
        .filter(v => isFinite(v) && v > 0);
      if (rawCandidates.length) {
        const forced = Math.max(...rawCandidates);
        shippingFee = forced;
        console.log('[ShippingResolution][HardOverrideApplied]', { forced, rawCandidates });
      }
    }

    if (shippingFee === 0) {
      // Attempt to infer from client totalWithShipping if provided
      if (clientTotalWithShipping && clientTotalWithShipping > totalAmount) {
        const inferred = clientTotalWithShipping - totalAmount;
        if (isFinite(inferred) && inferred > 0) shippingFee = inferred;
      }
    }

    if (shippingFee === 0) {
      // Final fallback
      const fallback = Number(process.env.DEFAULT_SHIPPING_FEE || 50);
      if (isFinite(fallback) && fallback > 0) shippingFee = fallback;
    }

    // Last-chance rescue: if still 0 but any raw positive values were provided, take the maximum raw positive
    if (shippingFee === 0) {
      const candidates = [clientShippingFee, clientAltFee, clientDeliveryFee].filter(v => isFinite(v) && v > 0);
      if (candidates.length) {
        shippingFee = Math.max(...candidates);
        console.log('[ShippingResolution][RescueApplied]', { rescueChosen: shippingFee, candidates });
      }
    }

  // Final assertion: log before create
  console.log('[ShippingResolution][Final]', { shippingFee, deliveryFeeMirror: shippingFee });
  if (shippingFee === 0) {
    const rawPositives = [rawShippingFee, rawClientShippingFee, rawDeliveryFee].map(v => Number(v)).filter(v => isFinite(v) && v > 0);
    if (rawPositives.length) {
      console.warn('[ShippingResolution][Anomaly] Raw positive fee(s) provided but computed/final shippingFee resolved to 0. Raw values:', {
        rawShippingFee,
        rawClientShippingFee,
        rawDeliveryFee,
        parsed: rawPositives
      });
    }
  }
  // Absolute final guard: if request body had a positive shippingFee value, force it.
  if (shippingFee === 0 && isFinite(Number(rawShippingFee)) && Number(rawShippingFee) > 0) {
    console.warn('[ShippingResolution][ForceFromRawBody] Forcing shippingFee from raw body value', { rawShippingFee });
    shippingFee = Number(rawShippingFee);
  }
  // Create order with auto-generated order number (include shipping & delivery fee fields)
    const order = new Order({
      user: req.user?._id || undefined,
      items: orderItems,
      totalAmount,
      currency,
      exchangeRate,
      shippingAddress,
      paymentMethod,
      customerInfo: {
        firstName: customerInfo.firstName,
        lastName: customerInfo.lastName,
        email: customerInfo.email,
        mobile: customerInfo.mobile,
        secondaryMobile: customerInfo.secondaryMobile
      },
      status: 'pending',
      orderNumber: `ORD${Date.now()}`,
      // Persist only one authoritative shipping fee and mirror it to deliveryFee for legacy consumers.
      shippingFee,
      deliveryFee: shippingFee,
      shippingCity: shippingMeta.city,
      shippingZoneId: shippingMeta.zoneId,
      shippingRateId: shippingMeta.rateId,
      shippingMethodName: shippingMeta.methodName,
      shippingCostComponents: shippingMeta.costComponents,
      shippingCalculation: {
        subtotal: totalAmount,
        country: shippingAddress.country,
        city: shippingAddress.city,
        weight: 0
      },
      // For online payments (card/paypal), mark as pending until provider capture completes
      paymentStatus: paymentMethod === 'cod' ? 'pending' : 'pending'
    });

    let savedOrder;
    try {
      if (useTransaction) {
        savedOrder = await order.save({ session });
      } else {
        savedOrder = await order.save();
      }
    } catch (err) {
      // Handle duplicate orderNumber edge case: regenerate and retry once
      if (err && err.code === 11000 && err.keyPattern && err.keyPattern.orderNumber) {
        order.orderNumber = `ORD${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        if (useTransaction) {
          savedOrder = await order.save({ session });
        } else {
          savedOrder = await order.save();
        }
      } else {
        if (session.inTransaction()) {
          await session.abortTransaction();
        }
        throw err;
      }
    }

    // Commit the transaction
    if (session.inTransaction()) {
      await session.commitTransaction();
    }

    // Emit real-time event for new order
    realTimeEventService.emitNewOrder(savedOrder);

    // Fire a web push notification targeted to admins (fallback broadcast if none subscribed)
    let pushSent = 0;
    try {
      const contactEnabled = String(process.env.WHATSAPP_CONTACT_IN_PUSH || 'false').toLowerCase() === 'true';
      const primaryContact = process.env.WHATSAPP_PRIMARY_CONTACT_NUMBER || '';
      const contactLine = (contactEnabled && primaryContact) ? ` • WhatsApp: ${primaryContact}` : '';
      const icon = '/favicon.svg';
      const orderAdminUrl = `/admin/orders/${savedOrder._id}`; // more specific deep-link
      const payload = {
        title: 'New Order Received',
        body: `Order ${savedOrder.orderNumber} • ${savedOrder.items.length} item(s) • ${savedOrder.totalAmount} ${savedOrder.currency}${contactLine}`,
        url: orderAdminUrl,
        tag: 'new-order',
        requireInteraction: true,
        icon,
        badge: icon,
        silent: false,
        vibrate: [200,100,200]
      };
      console.log('[Push][NewOrder] Prepared payload', payload);
      const adminResult = await sendPushToAdmins(payload);
      console.log('[Push][NewOrder] Admin result', adminResult);
      pushSent = adminResult.sent || 0;
      if (pushSent === 0) {
        const allResult = await sendPushToAll(payload);
        console.log('[Push][NewOrder] Fallback broadcast result', allResult);
        pushSent = allResult.sent || 0;
      }
    } catch (pushErr) {
      console.warn('Failed to send push for new order', pushErr);
    }

    // If no push delivered, generate WhatsApp manual notification links (internal logging only)
    if (pushSent === 0) {
      try {
        await whatsappFallbackForNewOrder(savedOrder);
      } catch (waErr) {
        console.warn('WhatsApp fallback generation failed (non-fatal)', waErr);
      }
    }

    // Attempt auto-dispatch to delivery company if configuration enables it.
    let autoDispatchResult = null;
    try {
      // Find an active delivery company with autoDispatchOnOrderCreate enabled.
      const autoCompany = await DeliveryCompany.findOne({ isActive: true, autoDispatchOnOrderCreate: true }).sort('-isDefault');
      if (autoCompany) {
        const statuses = Array.isArray(autoCompany.autoDispatchStatuses) && autoCompany.autoDispatchStatuses.length
          ? autoCompany.autoDispatchStatuses
          : ['pending'];
        if (statuses.includes(savedOrder.status)) {
          // Validate configuration before sending
          const cfg = validateCompanyConfiguration(autoCompany.toObject());
          if (cfg.ok) {
            const mappingCheck = validateRequiredMappings(savedOrder.toObject(), autoCompany.toObject());
            if (mappingCheck.ok) {
              const deliveryFee = savedOrder.shippingFee || savedOrder.deliveryFee || 0;
              const { trackingNumber, providerResponse, providerStatus } = await sendToCompany(savedOrder.toObject(), autoCompany.toObject(), { deliveryFee });
              savedOrder.deliveryCompany = autoCompany._id;
              savedOrder.deliveryStatus = mapStatus(autoCompany, providerStatus || 'assigned');
              savedOrder.deliveryTrackingNumber = trackingNumber;
              savedOrder.trackingNumber = trackingNumber; // legacy
              savedOrder.deliveryAssignedAt = new Date();
              savedOrder.deliveryFee = deliveryFee || savedOrder.deliveryFee || 0;
              savedOrder.deliveryResponse = providerResponse;
              await savedOrder.save();
              autoDispatchResult = {
                success: true,
                companyId: String(autoCompany._id),
                trackingNumber,
                status: savedOrder.deliveryStatus,
                providerStatus: providerStatus || 'assigned'
              };
            } else {
              autoDispatchResult = { success: false, reason: 'MISSING_MAPPINGS', missing: mappingCheck.missing };
            }
          } else {
            autoDispatchResult = { success: false, reason: 'INVALID_CONFIGURATION', issues: cfg.issues };
          }
        } else {
          autoDispatchResult = { success: false, reason: 'STATUS_NOT_ELIGIBLE', orderStatus: savedOrder.status };
        }
      } else {
        autoDispatchResult = { success: false, reason: 'NO_AUTO_COMPANY' };
      }
    } catch (autoErr) {
      console.warn('Auto-dispatch failed (non-fatal):', autoErr);
      autoDispatchResult = { success: false, reason: 'AUTO_DISPATCH_ERROR', error: autoErr?.message };
    }

    res.status(201).json({
      message: 'Order created successfully',
      order: {
        _id: savedOrder._id,
        orderNumber: savedOrder.orderNumber,
        totalAmount: savedOrder.totalAmount,
        currency: savedOrder.currency,
        status: savedOrder.status,
        deliveryFee: savedOrder.deliveryFee || 0,
        shippingFee: savedOrder.shippingFee || savedOrder.deliveryFee || 0,
        deliveryStatus: savedOrder.deliveryStatus || null,
        deliveryTrackingNumber: savedOrder.deliveryTrackingNumber || savedOrder.trackingNumber || null,
        autoDispatch: autoDispatchResult,
        totalWithShipping: (() => {
          const base = savedOrder.totalAmount || 0;
          const ship = savedOrder.shippingFee || savedOrder.deliveryFee || 0;
          // Reuse same heuristic as model virtual (without recomputing items to avoid duplication)
          // If items subtotal can be derived and base already includes ship, return base.
          let reconstructedSubtotal = 0;
          try {
            if (Array.isArray(savedOrder.items)) {
              for (const it of savedOrder.items) {
                if (it && typeof it.price === 'number' && typeof it.quantity === 'number') {
                  reconstructedSubtotal += (it.price * it.quantity);
                }
              }
            }
          } catch {}
          if (reconstructedSubtotal > 0) {
            const diff = Math.abs((base - reconstructedSubtotal) - ship);
            if (diff < 0.0001) return base;
          }
          return base + ship;
        })()
      }
    });
  } catch (error) {
    // Ensure transaction is aborted if still active
    if (session.inTransaction()) {
      await session.abortTransaction();
    }

    console.error('Error creating order:', error);
    const message = error?.message || 'Failed to create order';
    res.status(500).json({
      message,
      error: message
    });
  } finally {
    // End the session
    await session.endSession();
  }
};

// Get user orders
export const getUserOrders = async (req, res) => {
  try {
    const userId = req.user?._id;
    const userEmail = (req.user?.email || '').toLowerCase();

    // Filter orders to those created by this user or (legacy) guest orders matching their email
    const emailFilter = userEmail
      ? { 'customerInfo.email': new RegExp(`^${userEmail}$`, 'i') }
      : null;

    const query = emailFilter
      ? { $or: [ { user: userId }, emailFilter ] }
      : { user: userId };

    const ordersDocs = await Order.find(query)
      .populate('items.product')
      .populate('deliveryCompany')
      .sort('-createdAt');
    // Ensure virtuals present and add explicit totalWithShipping in case consumer relies on it
    const orders = ordersDocs.map(o => {
      const obj = o.toObject({ virtuals: true });
      return {
        ...obj,
        // effectiveShippingFee virtual already resolves shipping vs delivery
        effectiveShippingFee: obj.effectiveShippingFee ?? (obj.shippingFee || obj.deliveryFee || 0),
        totalWithShipping: obj.totalWithShipping ?? ((obj.totalAmount || 0) + (obj.shippingFee || obj.deliveryFee || 0))
      };
    });
    res.json(orders);
  } catch (error) {
    console.error('Error fetching user orders:', error);
    res.status(500).json({ message: 'Failed to fetch orders' });
  }
};

// Get all orders (admin)
export const getAllOrders = async (req, res) => {
  try {
    const ordersDocs = await Order.find()
      .populate('items.product')
      .populate('deliveryCompany')
      .sort('-createdAt');
    const orders = ordersDocs.map(o => {
      const obj = o.toObject({ virtuals: true });
      return {
        ...obj,
        effectiveShippingFee: obj.effectiveShippingFee ?? (obj.shippingFee || obj.deliveryFee || 0),
        totalWithShipping: obj.totalWithShipping ?? ((obj.totalAmount || 0) + (obj.shippingFee || obj.deliveryFee || 0))
      };
    });
    res.json(orders);
  } catch (error) {
    console.error('Error fetching all orders:', error);
    res.status(500).json({ message: 'Failed to fetch orders' });
  }
};

// Update order status
export const updateOrderStatus = async (req, res) => {
  try {
    const { status } = req.body;
    // Find the order first to check previous status
    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }
    const prevStatus = order.status;

    // Update status
    order.status = status;
    await order.save();

    // Only auto-decrement inventory if status is first set to 'delivered' (or 'fulfilled')
    if ((status === 'delivered' || status === 'fulfilled') && prevStatus !== status) {
      for (const item of order.items) {
        // Find inventory record for product, size, color
        const inv = await Inventory.findOne({
          product: item.product,
          size: item.size || '',
          color: item.color || ''
        });
        if (inv) {
          const newQty = Math.max(0, inv.quantity - item.quantity);
          await inventoryService.updateInventory(inv._id, newQty, req.user?._id || null);
        }
      }
    }

    // Emit real-time event for order update
    realTimeEventService.emitOrderUpdate(order);

    res.json({
      message: 'Order status updated successfully',
      order
    });
  } catch (error) {
    console.error('Error updating order status:', error);
    res.status(500).json({ message: 'Failed to update order status' });
  }
};

// Request delivery assignment for user's own order
export const requestDeliveryAssignment = async (req, res) => {
  return res.status(400).json({ 
    message: 'Delivery company assignment is no longer available' 
  });
};

// Recalculate shipping for an existing order (admin)
export const recalculateShipping = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found' });

    const city = order.shippingAddress?.city;
    const country = order.shippingAddress?.country;
    const subtotal = order.totalAmount || 0;
    let newFee = 0;
    try {
      newFee = await calcShipFee({ subtotal, weight: 0, country, region: undefined, city });
    } catch (e) {
      return res.status(400).json({ message: 'Failed to calculate shipping', error: e?.message });
    }

    order.shippingFee = newFee;
    order.deliveryFee = newFee;
    order.shippingCity = city;
    order.shippingCalculation = { subtotal, country, city, weight: 0, recalculatedAt: new Date() };
    await order.save();

    res.json({
      message: 'Shipping recalculated',
      shippingFee: newFee,
      orderId: order._id
    });
  } catch (error) {
    console.error('Error recalculating shipping:', error);
    res.status(500).json({ message: 'Failed to recalculate shipping' });
  }
};