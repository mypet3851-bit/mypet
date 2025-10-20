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

// POS User Management Routes (basic implementation)
router.get('/users/current', async (req, res) => {
  try {
    // Return basic user data for now
    res.json({
      user: req.user.id,
      permissions: {
        canAccessAllRegisters: true,
        canOpenRegister: true,
        canCloseRegister: true,
        canProcessSales: true,
        canProcessRefunds: true,
        canVoidTransactions: true,
        canApplyDiscounts: true,
        canViewReports: true,
        canManageInventory: true
      },
      assignedRegisters: [],
      preferences: {}
    });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching POS user profile', error: error.message });
  }
});

// Product search for POS (basic implementation)
router.get('/products/search', async (req, res) => {
  try {
    // Return empty array for now
    res.json([]);
  } catch (error) {
    res.status(500).json({ message: 'Error searching products', error: error.message });
  }
});

// Quick inventory check (basic implementation)
router.get('/inventory/:productId/check', async (req, res) => {
  try {
    const { productId } = req.params;
    const { variantId, quantity = 1 } = req.query;
    
    // Return basic availability info
    res.json({
      available: true,
      availableQuantity: 100,
      productName: 'Sample Product'
    });
  } catch (error) {
    res.status(500).json({ message: 'Error checking inventory', error: error.message });
  }
});

// POS-specific settings (basic implementation)
router.get('/settings', async (req, res) => {
  try {
    const posSettings = {
      currency: 'USD',
      taxRate: 0,
      allowNegativeInventory: false,
      requireReceiptPrint: false,
      autoLogoutMinutes: 30
    };
    
    res.json(posSettings);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching POS settings', error: error.message });
  }
});

export default router;