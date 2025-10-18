import express from 'express';
import { adminAuth } from '../middleware/auth.js';
import { upload, uploadProductImage } from '../controllers/uploadController.js';

const router = express.Router();

// Ensure robust CORS for uploads (browsers send preflight for multipart/form-data)
router.use((req, res, next) => {
	try {
		const origin = req.headers.origin;
		if (origin) {
			if (!res.getHeader('Access-Control-Allow-Origin')) {
				res.setHeader('Access-Control-Allow-Origin', origin);
			}
			res.setHeader('Access-Control-Allow-Credentials', 'true');
			const vary = res.getHeader('Vary');
			if (!vary) res.setHeader('Vary', 'Origin');
			else if (!String(vary).includes('Origin')) res.setHeader('Vary', vary + ', Origin');
		}
		res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
		res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
		if (req.method === 'OPTIONS') {
			return res.sendStatus(204);
		}
	} catch {}
	next();
});

// POST /api/uploads/product-image
router.post('/product-image', adminAuth, upload.single('file'), uploadProductImage);

// POST /api/uploads/announcement-icon  (stores in 'announcements/icons' folder)
router.post('/announcement-icon', adminAuth, upload.single('file'), (req, res, next) => {
	// Inject default folder for announcement icons
	req.body = { ...(req.body || {}), folder: 'announcements/icons' };
	next();
}, uploadProductImage);

export default router;