import express from 'express';
import { getMobileBanners, getMobileBannersByCategory } from '../controllers/bannerController.js';

const router = express.Router();

// Public mobile-optimized banner endpoints
router.get('/', getMobileBanners);
router.get('/by-category/:slug', getMobileBannersByCategory);

export default router;
