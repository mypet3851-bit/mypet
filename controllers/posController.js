import mongoose from 'mongoose';
import POSRegister from '../models/POSRegister.js';
import POSSession from '../models/POSSession.js';
import POSTransaction from '../models/POSTransaction.js';
import POSUser from '../models/POSUser.js';
import Product from '../models/Product.js';
import Inventory from '../models/Inventory.js';
import { inventoryService } from '../services/inventoryService.js';
import { posService } from '../services/posService.js';

// Register Management
export const createRegister = async (req, res) => {
  try {
    const { name, location, description, openingBalance, currency, settings } = req.body;

    const register = new POSRegister({
      name,
      location,
      description,
      openingBalance: openingBalance || 0,
      currentBalance: openingBalance || 0,
      currency: currency || 'USD',
      settings: settings || {}
    });

    await register.save();
    res.status(201).json({ message: 'POS Register created successfully', register });
  } catch (error) {
    console.error('Error creating POS register:', error);
    res.status(500).json({ message: 'Error creating POS register', error: error.message });
  }
};

export const getRegisters = async (req, res) => {
  try {
    const { isActive } = req.query;
    const filter = {};
    if (isActive !== undefined) filter.isActive = isActive === 'true';

    const registers = await POSRegister.find(filter)
      .populate('lastOpenedBy', 'firstName lastName')
      .populate('lastClosedBy', 'firstName lastName')
      .sort({ createdAt: -1 });

    res.json(registers);
  } catch (error) {
    console.error('Error fetching POS registers:', error);
    res.status(500).json({ message: 'Error fetching POS registers', error: error.message });
  }
};

export const getRegister = async (req, res) => {
  try {
    const { id } = req.params;
    const register = await POSRegister.findById(id)
      .populate('lastOpenedBy', 'firstName lastName')
      .populate('lastClosedBy', 'firstName lastName');

    if (!register) {
      return res.status(404).json({ message: 'POS Register not found' });
    }

    res.json(register);
  } catch (error) {
    console.error('Error fetching POS register:', error);
    res.status(500).json({ message: 'Error fetching POS register', error: error.message });
  }
};

export const updateRegister = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const register = await POSRegister.findByIdAndUpdate(
      id,
      { $set: updates },
      { new: true, runValidators: true }
    );

    if (!register) {
      return res.status(404).json({ message: 'POS Register not found' });
    }

    res.json({ message: 'POS Register updated successfully', register });
  } catch (error) {
    console.error('Error updating POS register:', error);
    res.status(500).json({ message: 'Error updating POS register', error: error.message });
  }
};

// Session Management
export const openSession = async (req, res) => {
  try {
    const { registerId, openingBalance, notes } = req.body;
    const userId = req.user.id;

    // Check if register exists and is active
    const register = await POSRegister.findById(registerId);
    if (!register) {
      return res.status(404).json({ message: 'POS Register not found' });
    }
    if (!register.isActive) {
      return res.status(400).json({ message: 'POS Register is not active' });
    }

    // Check if there's already an open session for this register
    const existingSession = await POSSession.findOne({
      register: registerId,
      status: 'open'
    });
    if (existingSession) {
      return res.status(400).json({ message: 'Register already has an open session' });
    }

    // Check user permissions
    const posUser = await POSUser.findOne({ user: userId });
    if (posUser && !posUser.canAccessRegister(registerId)) {
      return res.status(403).json({ message: 'Access denied to this register' });
    }

    const session = new POSSession({
      register: registerId,
      openedBy: userId,
      openingBalance: openingBalance || 0,
      openingNotes: notes,
      currency: register.currency
    });

    await session.save();

    // Update register
    register.lastOpenedBy = userId;
    register.lastOpenedAt = new Date();
    register.currentBalance = openingBalance || 0;
    await register.save();

    // Update POS user current session
    if (posUser) {
      posUser.currentSession = session._id;
      posUser.lastLoginAt = new Date();
      await posUser.save();
    }

    res.status(201).json({ message: 'POS Session opened successfully', session });
  } catch (error) {
    console.error('Error opening POS session:', error);
    res.status(500).json({ message: 'Error opening POS session', error: error.message });
  }
};

export const closeSession = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { closingBalance, notes } = req.body;
    const userId = req.user.id;

    const session = await POSSession.findById(sessionId).populate('register');
    if (!session) {
      return res.status(404).json({ message: 'POS Session not found' });
    }

    if (session.status !== 'open') {
      return res.status(400).json({ message: 'Session is not open' });
    }

    // Calculate session totals from transactions
    const sessionTotals = await posService.calculateSessionTotals(sessionId);

    session.closedBy = userId;
    session.closedAt = new Date();
    session.status = 'closed';
    session.closingBalance = closingBalance;
    session.expectedClosingBalance = session.openingBalance + sessionTotals.netSales;
    session.variance = closingBalance - session.expectedClosingBalance;
    session.closingNotes = notes;
    
    // Update totals from calculations
    Object.assign(session, sessionTotals);

    await session.save();

    // Update register
    const register = session.register;
    register.lastClosedBy = userId;
    register.lastClosedAt = new Date();
    register.currentBalance = closingBalance;
    await register.save();

    // Clear current session from POS user
    const posUser = await POSUser.findOne({ user: userId });
    if (posUser && posUser.currentSession?.toString() === sessionId) {
      posUser.currentSession = null;
      await posUser.save();
    }

    res.json({ message: 'POS Session closed successfully', session });
  } catch (error) {
    console.error('Error closing POS session:', error);
    res.status(500).json({ message: 'Error closing POS session', error: error.message });
  }
};

export const getCurrentSession = async (req, res) => {
  try {
    const { registerId } = req.params;
    
    const session = await POSSession.findOne({
      register: registerId,
      status: 'open'
    }).populate('register openedBy', 'firstName lastName name location');

    if (!session) {
      return res.status(404).json({ message: 'No active session found for this register' });
    }

    res.json(session);
  } catch (error) {
    console.error('Error fetching current session:', error);
    res.status(500).json({ message: 'Error fetching current session', error: error.message });
  }
};

// Transaction Management
export const createTransaction = async (req, res) => {
  try {
    const { sessionId, items, paymentMethod, payments, customerInfo, discounts, notes } = req.body;
    const userId = req.user.id;

    // Validate session
    const session = await POSSession.findById(sessionId).populate('register');
    if (!session || session.status !== 'open') {
      return res.status(400).json({ message: 'Invalid or closed session' });
    }

    // Validate and calculate transaction
    const transactionData = await posService.validateAndCalculateTransaction({
      items,
      paymentMethod,
      payments,
      customerInfo,
      discounts,
      currency: session.currency
    });

    // Check inventory availability
    for (const item of items) {
      const availability = await inventoryService.checkAvailability(item.product, item.variant, item.quantity);
      if (!availability.available) {
        return res.status(400).json({ 
          message: `Insufficient inventory for ${availability.productName}`,
          availableQuantity: availability.availableQuantity
        });
      }
    }

    const transaction = new POSTransaction({
      session: sessionId,
      register: session.register._id,
      cashier: userId,
      items: transactionData.items,
      subtotal: transactionData.subtotal,
      totalDiscount: transactionData.totalDiscount,
      totalTax: transactionData.totalTax,
      total: transactionData.total,
      paymentMethod,
      payments: payments || [],
      amountPaid: transactionData.amountPaid,
      change: transactionData.change,
      customerInfo,
      currency: session.currency,
      notes
    });

    await transaction.save();

    // Update inventory
    for (const item of items) {
      await inventoryService.decreaseStock(item.product, item.variant, item.quantity, {
        reason: 'pos_sale',
        reference: transaction._id,
        notes: `POS Sale - Transaction ${transaction.transactionNumber}`
      });
    }

    // Update session totals
    await posService.updateSessionTotals(sessionId, transaction);

    // Update POS user performance metrics
    const posUser = await POSUser.findOne({ user: userId });
    if (posUser) {
      await posUser.updatePerformanceMetrics(transaction.total);
    }

    res.status(201).json({ 
      message: 'Transaction completed successfully', 
      transaction: await transaction.populate('items.product', 'name sku')
    });
  } catch (error) {
    console.error('Error creating POS transaction:', error);
    res.status(500).json({ message: 'Error creating POS transaction', error: error.message });
  }
};

export const getTransactions = async (req, res) => {
  try {
    const { sessionId, registerId, dateFrom, dateTo, type, status, limit = 50, page = 1 } = req.query;

    const filter = {};
    if (sessionId) filter.session = sessionId;
    if (registerId) filter.register = registerId;
    if (type) filter.type = type;
    if (status) filter.status = status;
    
    if (dateFrom || dateTo) {
      filter.createdAt = {};
      if (dateFrom) filter.createdAt.$gte = new Date(dateFrom);
      if (dateTo) filter.createdAt.$lte = new Date(dateTo);
    }

    const transactions = await POSTransaction.find(filter)
      .populate('cashier', 'firstName lastName')
      .populate('items.product', 'name sku')
      .populate('session', 'openedAt')
      .populate('register', 'name location')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit));

    const total = await POSTransaction.countDocuments(filter);

    res.json({
      transactions,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Error fetching POS transactions:', error);
    res.status(500).json({ message: 'Error fetching POS transactions', error: error.message });
  }
};

export const getTransaction = async (req, res) => {
  try {
    const { id } = req.params;
    
    const transaction = await POSTransaction.findById(id)
      .populate('cashier', 'firstName lastName email')
      .populate('items.product', 'name sku images')
      .populate('session', 'openedAt closedAt')
      .populate('register', 'name location')
      .populate('customer', 'firstName lastName email phone');

    if (!transaction) {
      return res.status(404).json({ message: 'Transaction not found' });
    }

    res.json(transaction);
  } catch (error) {
    console.error('Error fetching POS transaction:', error);
    res.status(500).json({ message: 'Error fetching POS transaction', error: error.message });
  }
};

// Refund and void operations
export const refundTransaction = async (req, res) => {
  try {
    const { transactionId } = req.params;
    const { reason, refundAmount } = req.body;
    const userId = req.user.id;

    const originalTransaction = await POSTransaction.findById(transactionId)
      .populate('session register');

    if (!originalTransaction) {
      return res.status(404).json({ message: 'Original transaction not found' });
    }

    if (originalTransaction.status === 'voided' || originalTransaction.status === 'refunded') {
      return res.status(400).json({ message: 'Transaction already voided or refunded' });
    }

    // Check if there's an open session for the same register
    const currentSession = await POSSession.findOne({
      register: originalTransaction.register._id,
      status: 'open'
    });

    if (!currentSession) {
      return res.status(400).json({ message: 'No open session available for refund processing' });
    }

    const refundTransaction = new POSTransaction({
      session: currentSession._id,
      register: originalTransaction.register._id,
      cashier: userId,
      type: 'refund',
      items: originalTransaction.items,
      subtotal: -Math.abs(refundAmount || originalTransaction.total),
      total: -Math.abs(refundAmount || originalTransaction.total),
      paymentMethod: originalTransaction.paymentMethod,
      originalTransaction: transactionId,
      currency: originalTransaction.currency,
      notes: reason
    });

    await refundTransaction.save();

    // Restore inventory
    for (const item of originalTransaction.items) {
      await inventoryService.increaseStock(item.product, item.variant, item.quantity, {
        reason: 'pos_refund',
        reference: refundTransaction._id,
        notes: `POS Refund - Transaction ${refundTransaction.transactionNumber}`
      });
    }

    // Update original transaction status
    originalTransaction.status = 'refunded';
    await originalTransaction.save();

    // Update session totals
    await posService.updateSessionTotals(currentSession._id, refundTransaction);

    res.json({ 
      message: 'Transaction refunded successfully', 
      refundTransaction,
      originalTransaction 
    });
  } catch (error) {
    console.error('Error processing refund:', error);
    res.status(500).json({ message: 'Error processing refund', error: error.message });
  }
};

// Reports
export const getSessionReport = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const report = await posService.generateSessionReport(sessionId);
    res.json(report);
  } catch (error) {
    console.error('Error generating session report:', error);
    res.status(500).json({ message: 'Error generating session report', error: error.message });
  }
};

export const getSalesReport = async (req, res) => {
  try {
    const { registerId, dateFrom, dateTo, groupBy = 'day' } = req.query;
    const report = await posService.generateSalesReport({
      registerId,
      dateFrom,
      dateTo,
      groupBy
    });
    res.json(report);
  } catch (error) {
    console.error('Error generating sales report:', error);
    res.status(500).json({ message: 'Error generating sales report', error: error.message });
  }
};