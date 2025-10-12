export const moveStockBetweenWarehouses = asyncHandler(async (req, res) => {
  const { product, size, color, quantity, fromWarehouse, toWarehouse, reason } = req.body;
  const userId = req.user?._id;
  if (!userId) {
    return res.status(StatusCodes.UNAUTHORIZED).json({ message: 'User required' });
  }
  try {
    const result = await inventoryService.moveStockBetweenWarehouses({
      product,
      size,
      color,
      quantity,
      fromWarehouse,
      toWarehouse,
      userId,
      reason
    });
    res.status(StatusCodes.OK).json({ message: 'Stock moved successfully', result });
  } catch (error) {
    res.status(error.statusCode || 500).json({ message: error.message });
  }
});
// Update inventory by product, color, and size
import Inventory from '../models/Inventory.js';
export const updateInventoryByProductColorSize = asyncHandler(async (req, res) => {
  const { productId, color, size } = req.body;
  const { quantity } = req.body;
  if (!productId || !color || !size || typeof quantity !== 'number') {
    return res.status(StatusCodes.BAD_REQUEST).json({ message: 'productId, color, size, and quantity are required' });
  }
  const inventory = await Inventory.findOneAndUpdate(
    { product: productId, color, size },
    { quantity },
    { new: true, runValidators: true }
  );
  if (!inventory) {
    return res.status(StatusCodes.NOT_FOUND).json({ message: 'Inventory record not found' });
  }
  res.status(StatusCodes.OK).json(inventory);
});
import asyncHandler from 'express-async-handler';
import { inventoryService } from '../services/inventoryService.js';
import { StatusCodes } from 'http-status-codes';

export const getInventory = asyncHandler(async (req, res) => {
  console.log('getInventory controller called');
  console.log('User:', req.user?._id, req.user?.role);
  
  const inventory = await inventoryService.getAllInventory();
  console.log('Inventory fetched, count:', inventory.length);
  res.status(StatusCodes.OK).json(inventory);
});

export const getProductInventory = asyncHandler(async (req, res) => {
  const inventory = await inventoryService.getProductInventory(req.params.productId);
  res.status(StatusCodes.OK).json(inventory);
});

export const updateInventory = asyncHandler(async (req, res) => {
  try {
    console.log('updateInventory called');
    console.log('params:', req.params);
    console.log('body:', req.body);
    console.log('user:', req.user?._id);
    const inventory = await inventoryService.updateInventory(
      req.params.id,
      req.body.quantity,
      req.user._id
    );
    res.status(StatusCodes.OK).json(inventory);
  } catch (err) {
    console.error('Error in updateInventory:', err);
    res.status(500).json({ error: err.message || 'Unknown error' });
  }
});

export const addInventory = asyncHandler(async (req, res) => {
  console.log('addInventory controller called');
  console.log('Request body:', JSON.stringify(req.body, null, 2));
  console.log('User:', req.user?._id, req.user?.role);
  
  const inventory = await inventoryService.addInventory(req.body, req.user._id);
  res.status(StatusCodes.CREATED).json(inventory);
});

export const getLowStockItems = asyncHandler(async (req, res) => {
  const items = await inventoryService.getLowStockItems();
  res.status(StatusCodes.OK).json(items);
});

export const bulkUpdateInventory = asyncHandler(async (req, res) => {
  await inventoryService.bulkUpdateInventory(req.body.items, req.user._id);
  res.status(StatusCodes.OK).json({ 
    success: true,
    message: 'Inventory updated successfully' 
  });
});