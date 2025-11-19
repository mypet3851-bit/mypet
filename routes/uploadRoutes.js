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

// GET helper (browsers hitting the URL directly with GET will otherwise 404 via global handler).
// Respond with 405 Method Not Allowed and usage instructions.
router.get('/product-image', (req, res) => {
	try {
		// CORS headers already set by router.use above; just return guidance
		res.status(405).json({
			message: 'Use POST multipart/form-data with field name "file" at this endpoint. Include Authorization if required.'
		});
	} catch (e) {
		res.status(405).json({ message: 'Use POST multipart/form-data with field name "file".' });
	}
});

// POST /api/uploads/announcement-icon  (stores in 'announcements/icons' folder)
router.post('/announcement-icon', adminAuth, upload.single('file'), (req, res, next) => {
	// Inject default folder for announcement icons
	req.body = { ...(req.body || {}), folder: 'announcements/icons' };
	next();
}, async (req, res, next) => {
	try {
		// Delegate to common handler; respond directly with its payload
		await uploadProductImage(req, res, next);
	} catch (e) {
		next(e);
	}
});

export default router;