import express from 'express';
import { adminAuth } from '../middleware/auth.js';
import { upload, uploadProductImage } from '../controllers/uploadController.js';

const router = express.Router();

// POST /api/uploads/product-image
router.post('/product-image', adminAuth, upload.single('file'), uploadProductImage);

export default router;