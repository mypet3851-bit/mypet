import express from 'express';
import { adminAuth } from '../middleware/auth.js';
import {
  listAttributes,
  getAttribute,
  createAttribute,
  updateAttribute,
  deleteAttribute,
  listValues,
  createValue,
  updateValue,
  deleteValue
} from '../controllers/attributeController.js';

const router = express.Router();

// Attribute CRUD
router.get('/', adminAuth, listAttributes);
router.get('/:id', adminAuth, getAttribute);
router.post('/', adminAuth, createAttribute);
router.put('/:id', adminAuth, updateAttribute);
router.delete('/:id', adminAuth, deleteAttribute);

// Values nested under attribute
router.get('/:attributeId/values', adminAuth, listValues);
router.post('/:attributeId/values', adminAuth, createValue);
// Manage individual value by id
router.put('/values/:id', adminAuth, updateValue);
router.delete('/values/:id', adminAuth, deleteValue);

export default router;
