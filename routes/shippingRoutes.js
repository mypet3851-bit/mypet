import express from 'express';
import { adminAuth } from '../middleware/auth.js';
import {
  getShippingZones,
  getShippingZone,
  createShippingZone,
  updateShippingZone,
  deleteShippingZone,
  getShippingRates,
  getShippingRate,
  createShippingRate,
  updateShippingRate,
  deleteShippingRate,
  calculateShippingFee,
  getShippingOptions,
  getConfiguredCities,
} from '../controllers/shippingController.js';

const router = express.Router();

// Shipping Zone Routes
router.route('/zones')
  .get(getShippingZones) // Get all shipping zones
  .post(adminAuth, createShippingZone); // Admin-only: Create a new shipping zone

router.route('/zones/:id')
  .get(getShippingZone) // Get a single shipping zone by ID
  .put(adminAuth, updateShippingZone) // Admin-only: Update a shipping zone by ID
  .delete(adminAuth, deleteShippingZone); // Admin-only: Delete a shipping zone by ID

// Shipping Rate Routes
router.route('/rates')
  .get(getShippingRates) // Get all shipping rates
  .post(adminAuth, createShippingRate); // Admin-only: Create a new shipping rate

router.route('/rates/:id')
  .get(getShippingRate) // Get a single shipping rate by ID
  .put(adminAuth, updateShippingRate) // Admin-only: Update a shipping rate by ID
  .delete(adminAuth, deleteShippingRate); // Admin-only: Delete a shipping rate by ID

// Shipping Fee Calculation Route (supports city)
router.post('/calculate', calculateShippingFee);

// Get options for a location (query params)
router.get('/options', getShippingOptions);

// Get distinct configured cities (admin only)
router.get('/cities', adminAuth, getConfiguredCities);

export default router;
