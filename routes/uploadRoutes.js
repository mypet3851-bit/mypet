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
}, async (req, res, next) => {
	try {
		// Delegate to common handler
		await uploadProductImage(req, {
			json: (payload) => {
				try {
					// Ensure url uses server-exposed /api/uploads for client consumption
					let url = payload?.url || '';
					if (typeof url === 'string') {
						if (/^\/uploads\//.test(url)) {
							url = `/api${url}`;
						}
					}
					res.json({ ...payload, url });
				} catch {
					res.json(payload);
				}
			}
		}, next);
	} catch (e) {
		next(e);
	}
});

export default router;