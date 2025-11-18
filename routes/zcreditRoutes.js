import express from 'express';
import {
  createSessionHandler,
  getStatusHandler,
  resendNotificationHandler,
  successCallbackHandler,
  failureCallbackHandler
} from '../controllers/zcreditController.js';

const router = express.Router();

// Create WebCheckout session
router.post('/session', createSessionHandler);

// Get session status
router.post('/status', getStatusHandler);

// Resend callback notification
router.post('/resend', resendNotificationHandler);

// Z-Credit server-to-server callbacks (success/failure)
router.post('/callback/success', successCallbackHandler);
router.post('/callback/failure', failureCallbackHandler);

export default router;
