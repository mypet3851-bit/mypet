
import express from 'express';
import { adminAuth, inventoryAuth } from '../middleware/auth.js';
import { updateInventoryByProductColorSize, getInventory, getProductInventory, updateInventory, addInventory, getLowStockItems, bulkUpdateInventory, moveStockBetweenWarehouses, updateInventoryByVariant, getVariantStockSummary } from '../controllers/inventoryController.js';
import { getInventoryAnalytics, getStockMovements, getTurnoverAnalysis, getCategoryBreakdown, getLocationAnalysis, getInventoryAlerts, exportInventoryAnalytics, getPredictiveAnalytics, getSeasonalAnalysis, getCostAnalysis, getSupplierPerformance, getAdvancedMetrics } from '../controllers/inventoryAnalyticsController.js';

const router = express.Router();

// Move stock between warehouses
router.post('/move', inventoryAuth, moveStockBetweenWarehouses);

// Update inventory by product, color, and size (or variantId)
router.put('/by-combo', inventoryAuth, updateInventoryByProductColorSize);

// Basic inventory operations
router.get('/', inventoryAuth, getInventory);
router.get('/product/:productId', inventoryAuth, getProductInventory);
router.get('/product/:productId/variants/summary', inventoryAuth, getVariantStockSummary);
router.get('/low-stock', inventoryAuth, getLowStockItems);
router.post('/', inventoryAuth, addInventory);
// IMPORTANT: Register specific routes BEFORE generic param routes like '/:id'
// Update inventory quantity for a specific variant in a warehouse
router.put('/by-variant', inventoryAuth, updateInventoryByVariant);
// Generic update by inventory document id (must come after specific PUTs)
router.put('/:id', inventoryAuth, updateInventory);
router.post('/bulk', inventoryAuth, bulkUpdateInventory);

// Analytics endpoints
router.get('/analytics', inventoryAuth, getInventoryAnalytics);
router.get('/movements', inventoryAuth, getStockMovements);
router.get('/turnover', inventoryAuth, getTurnoverAnalysis);
router.get('/categories', inventoryAuth, getCategoryBreakdown);
router.get('/locations', inventoryAuth, getLocationAnalysis);
router.get('/alerts', inventoryAuth, getInventoryAlerts);
router.get('/export', inventoryAuth, exportInventoryAnalytics);

// Enhanced analytics endpoints
router.get('/analytics/predictive', inventoryAuth, getPredictiveAnalytics);
router.get('/analytics/seasonal', inventoryAuth, getSeasonalAnalysis);
router.get('/analytics/cost', inventoryAuth, getCostAnalysis);
router.get('/analytics/suppliers', inventoryAuth, getSupplierPerformance);
router.get('/analytics/advanced', inventoryAuth, getAdvancedMetrics);

export default router;