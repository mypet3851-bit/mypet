import express from 'express';
import {
  // Register management
  createRegister,
  getRegisters,
  getRegister,
  updateRegister,
  
  // Session management
  openSession,
  closeSession,
  getCurrentSession,
  
  // Transaction management
  createTransaction,
  getTransactions,
  getTransaction,
  refundTransaction,
  
  // Reports
  getSessionReport,
  getSalesReport
} from '../controllers/posController.js';
import { auth, adminAuth } from '../middleware/auth.js';

const router = express.Router();

// All POS routes require authentication
router.use(auth);

// Register Management Routes (Admin only)
router.post('/registers', adminAuth, createRegister);
router.get('/registers', adminAuth, getRegisters);
router.get('/registers/:id', adminAuth, getRegister);
router.put('/registers/:id', adminAuth, updateRegister);

// Session Management Routes
router.post('/sessions/open', openSession);
router.put('/sessions/:sessionId/close', closeSession);
router.get('/registers/:registerId/current-session', getCurrentSession);

// Transaction Management Routes
router.post('/transactions', createTransaction);
router.get('/transactions', getTransactions);
router.get('/transactions/:id', getTransaction);
router.post('/transactions/:transactionId/refund', refundTransaction);

// Report Routes
router.get('/sessions/:sessionId/report', getSessionReport);
router.get('/reports/sales', getSalesReport);

// POS User Management Routes (will be added to posUserController)
router.get('/users/current', async (req, res) => {
  try {
    const POSUser = (await import('../models/POSUser.js')).default;
    const posUser = await POSUser.findOne({ user: req.user.id })
      .populate('assignedRegisters', 'name location')
      .populate('currentSession', 'register openedAt')
      .populate('preferences.defaultRegister', 'name location');
    
    if (!posUser) {
      return res.status(404).json({ message: 'POS User profile not found' });
    }
    
    res.json(posUser);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching POS user profile', error: error.message });
  }
});

// Product search for POS (optimized for quick lookup)
router.get('/products/search', async (req, res) => {
  try {
    const { q, barcode, limit = 20 } = req.query;
    const Product = (await import('../models/Product.js')).default;
    const Inventory = (await import('../models/Inventory.js')).default;
    
    let filter = { isActive: true };
    
    if (barcode) {
      filter.$or = [
        { sku: barcode },
        { barcode: barcode },
        { 'variants.sku': barcode },
        { 'variants.barcode': barcode }
      ];
    } else if (q) {
      filter.$or = [
        { name: { $regex: q, $options: 'i' } },
        { sku: { $regex: q, $options: 'i' } },
        { barcode: { $regex: q, $options: 'i' } }
      ];
    }
    
    const products = await Product.find(filter)
      .select('name sku barcode price images variants isActive')
      .limit(parseInt(limit))
      .lean();
    
    // Get inventory data for each product
    const productsWithInventory = await Promise.all(
      products.map(async (product) => {
        const inventory = await Inventory.findOne({ product: product._id });
        return {
          ...product,
          inventory: {
            inStock: inventory?.inStock || 0,
            availableQuantity: inventory?.availableQuantity || 0,
            lowStockThreshold: inventory?.lowStockThreshold || 0
          }
        };
      })
    );
    
    res.json(productsWithInventory);
  } catch (error) {
    res.status(500).json({ message: 'Error searching products', error: error.message });
  }
});

// Quick inventory check
router.get('/inventory/:productId/check', async (req, res) => {
  try {
    const { productId } = req.params;
    const { variantId, quantity = 1 } = req.query;
    
    const { inventoryService } = await import('../services/inventoryService.js');
    const availability = await inventoryService.checkAvailability(
      productId, 
      variantId, 
      parseInt(quantity)
    );
    
    res.json(availability);
  } catch (error) {
    res.status(500).json({ message: 'Error checking inventory', error: error.message });
  }
});

// POS-specific settings
router.get('/settings', async (req, res) => {
  try {
    const Settings = (await import('../models/Settings.js')).default;
    const settings = await Settings.findOne() || {};
    
    const posSettings = {
      currency: settings.currency || 'USD',
      taxRate: settings.taxRate || 0,
      allowNegativeInventory: settings.allowNegativeInventory || false,
      requireReceiptPrint: settings.requireReceiptPrint || false,
      autoLogoutMinutes: settings.posAutoLogoutMinutes || 30
    };
    
    res.json(posSettings);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching POS settings', error: error.message });
  }
});

export default router;