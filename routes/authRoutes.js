import express from 'express';
import { login, register, getCurrentUser, promoteToAdmin, isAdmin, refresh, logout, checkIdentifier } from '../controllers/authController.js';
import { googleAuth } from '../controllers/googleAuthController.js';
import { facebookAuth } from '../controllers/facebookAuthController.js';
import Settings from '../models/Settings.js';
import { auth } from '../middleware/auth.js';

const router = express.Router();

router.post('/login', login);
router.post('/register', register);
router.post('/check-identifier', checkIdentifier);
// Google OAuth (One-Tap / Button) - expects { credential }
router.post('/google', googleAuth);
router.post('/facebook', facebookAuth);
router.post('/refresh', refresh);
router.post('/logout', auth, logout);
// Public auth config (currently only Google)
router.get('/config', async (req, res) => {
	try {
		const settings = await Settings.findOne();
		const googleAuth = settings?.googleAuth || { enabled: false, clientId: '' };
		const facebookAuth = settings?.facebookAuth || { enabled: false, appId: '' };
		res.json({
			google: { enabled: !!googleAuth.enabled, clientId: googleAuth.clientId || '' },
			facebook: { enabled: !!facebookAuth.enabled, appId: facebookAuth.appId || '' }
		});
	} catch (e) {
		res.status(500).json({ message: 'Failed to load auth config' });
	}
});
router.get('/me', auth, getCurrentUser);
router.get('/is-admin', auth, isAdmin);
// Bootstrap/recovery: promote a user to admin.
// Requires ADMIN_SETUP_TOKEN env or absence of existing admin users.
router.post('/promote', promoteToAdmin);

export default router;