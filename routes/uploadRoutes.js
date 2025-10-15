import express from 'express';
import { adminAuth } from '../middleware/auth.js';
import { upload, uploadProductImage, uploadMobileNavIcon } from '../controllers/uploadController.js';

const router = express.Router();

// POST /api/uploads/product-image
router.post('/product-image', adminAuth, upload.single('file'), uploadProductImage);
// POST /api/uploads/mobile-nav-icon
router.post('/mobile-nav-icon', adminAuth, upload.single('file'), uploadMobileNavIcon);

export default router;