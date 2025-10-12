import express from 'express';
import { createPayPalOrder, capturePayPalOrder } from '../controllers/paypalController.js';

const router = express.Router();

// Public endpoints for client-side SDK integration
router.post('/create-order', createPayPalOrder);
router.post('/capture-order', capturePayPalOrder);

export default router;
