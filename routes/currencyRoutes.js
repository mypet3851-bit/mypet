import express from 'express';
import { convertCurrency } from '../controllers/currencyController.js';

const router = express.Router();

router.post('/convert', convertCurrency);

export default router;