import express from 'express';
import { adminAuth } from '../middleware/auth.js';
import { listResources, listFolders, deleteResources, renameResource } from '../controllers/cloudinaryController.js';

const router = express.Router();

// All routes require admin
router.get('/resources', adminAuth, listResources);
router.get('/folders', adminAuth, listFolders);
router.post('/delete', adminAuth, deleteResources);
router.post('/rename', adminAuth, renameResource);

export default router;
