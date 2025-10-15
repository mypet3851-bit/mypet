import express from 'express';
import { adminAuth } from '../middleware/auth.js';
import { upload, uploadProductImage } from '../controllers/uploadController.js';

const router = express.Router();

// POST /api/uploads/product-image
router.post('/product-image', adminAuth, upload.single('file'), uploadProductImage);

// POST /api/uploads/announcement-icon  (stores in 'announcements/icons' folder)
router.post('/announcement-icon', adminAuth, upload.single('file'), (req, res, next) => {
	// Inject default folder for announcement icons
	req.body = { ...(req.body || {}), folder: 'announcements/icons' };
	next();
}, uploadProductImage);

export default router;