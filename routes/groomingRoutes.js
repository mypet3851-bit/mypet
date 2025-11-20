import express from 'express';
import { getAvailability, createBooking, listBookings, updateBookingStatus, getBookingById, cancelBooking, getBookingAudit } from '../controllers/groomingController.js';
import { adminAuth } from '../middleware/auth.js';
import { protectOptional } from '../middleware/authOptional.js';

const router = express.Router();

// Optional auth: allow logged-in user association, but not required
router.get('/availability', getAvailability);
router.post('/book', protectOptional, createBooking);
// Admin management endpoints
router.get('/bookings', adminAuth, listBookings);
router.get('/bookings/:id', adminAuth, getBookingById);
router.patch('/bookings/:id', adminAuth, updateBookingStatus);
router.post('/bookings/:id/cancel', protectOptional, cancelBooking); // user or admin
router.get('/bookings/:id/audit', adminAuth, getBookingAudit);

export default router;