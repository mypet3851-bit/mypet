import WarehouseMovement from '../models/WarehouseMovement.js';
import Inventory from '../models/Inventory.js';
import Product from '../models/Product.js';
import InventoryHistory from '../models/InventoryHistory.js';
import { StatusCodes } from 'http-status-codes';
import { ApiError } from '../utils/ApiError.js';
import { realTimeEventService } from './realTimeEventService.js';

class InventoryService {
  // Move stock between warehouses
  async moveStockBetweenWarehouses({ product, size, color, quantity, fromWarehouse, toWarehouse, userId, reason }) {
    if (!product || !size || !color || !fromWarehouse || !toWarehouse || !userId || !quantity || quantity <= 0) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'All fields are required and quantity must be > 0');
    }

    // Find source inventory
    const sourceInv = await Inventory.findOne({ product, size, color, warehouse: fromWarehouse });
    if (!sourceInv || sourceInv.quantity < quantity) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'Insufficient stock in source warehouse');
    }

    // Find or create destination inventory
    let destInv = await Inventory.findOne({ product, size, color, warehouse: toWarehouse });
    if (!destInv) {
      destInv = new Inventory({ product, size, color, warehouse: toWarehouse, quantity: 0 });
    }

    // Update quantities
    sourceInv.quantity -= quantity;
    destInv.quantity += quantity;
    await sourceInv.save();
    await destInv.save();

    // Log movement
    await WarehouseMovement.create({
      product,
      size,
      color,
      quantity,
      fromWarehouse,
      toWarehouse,
      user: userId,
      reason
    });

    // Optionally, update product total stock if needed
    await this.#updateProductStock(product);

    return { from: sourceInv, to: destInv };
  }
  async getAllInventory() {
    try {
      const inventory = await Inventory.find()
        .populate('product', 'name images')
        .sort({ 'product.name': 1, size: 1, color: 1 });
      return inventory;
    } catch (error) {
      throw new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, 'Error fetching inventory');
    }
  }

  async getProductInventory(productId) {
    try {
      const inventory = await Inventory.find({ product: productId })
        .populate('product', 'name images')
        .sort('size color');
      return inventory;
    } catch (error) {
      throw new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, 'Error fetching product inventory');
    }
  }

  async updateInventory(id, quantity, userId) {
    try {
      // Get the previous inventory to compare quantity
      const prevInventory = await Inventory.findById(id);
      if (!prevInventory) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Inventory record not found');
      }

      const inventory = await Inventory.findByIdAndUpdate(
        id,
        { quantity },
        { new: true, runValidators: true }
      ).populate('product', 'name');

      // Update product total stock
      await this.#updateProductStock(inventory.product._id);

      // Check for low stock alerts
      await this.#checkLowStockAlert(inventory);

      // Determine type for history: 'increase' or 'decrease'
      let type = 'increase';
      if (typeof prevInventory.quantity === 'number' && typeof quantity === 'number') {
        type = quantity > prevInventory.quantity ? 'increase' : 'decrease';
      }

      // Create history record
      const historyData = {
        product: inventory.product._id,
        type,
        quantity,
        reason: 'Manual update',
        user: userId
      };
      console.log('About to create InventoryHistory with:', historyData);
      await this.#createHistoryRecord(historyData);

      return inventory;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, error.message);
    }
  }

  async addInventory(data, userId) {
    try {
      // Validate required fields
      if (!data.product) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'Product is required');
      }
      if (!data.size) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'Size is required');
      }
      if (!data.color) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'Color is required');
      }
      if (!data.warehouse) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'Warehouse is required');
      }
      if (data.quantity === undefined || data.quantity === null || data.quantity < 0) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'Valid quantity is required');
      }

      // Check if inventory item already exists for this product/size/color combination
      const existingInventory = await Inventory.findOne({
        product: data.product,
        size: data.size,
        color: data.color,
        warehouse: data.warehouse
      });

      if (existingInventory) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 
          `Inventory already exists for this product, size (${data.size}), and color (${data.color}) combination. Please update the existing inventory instead.`);
      }

      const inventory = new Inventory(data);
      const savedInventory = await inventory.save();
      
      // Update product total stock
      await this.#updateProductStock(savedInventory.product);

      // Create history record
      await this.#createHistoryRecord({
        product: savedInventory.product,
        type: 'increase',
        quantity: savedInventory.quantity,
        reason: 'Initial stock',
        user: userId
      });

      return savedInventory;
    } catch (error) {
      // If it's already an ApiError, just re-throw it
      if (error instanceof ApiError) {
        throw error;
      }

      // Handle MongoDB validation errors
      if (error.name === 'ValidationError') {
        const errorMessages = Object.values(error.errors).map(err => err.message);
        throw new ApiError(StatusCodes.BAD_REQUEST, `Validation error: ${errorMessages.join(', ')}`);
      }

      // Handle MongoDB duplicate key errors
      if (error.code === 11000) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 
          'Inventory already exists for this product, size, and color combination. Please update the existing inventory instead.');
      }

      // Handle other errors
      console.error('Error adding inventory:', error);
      throw new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, 'Internal server error while adding inventory');
    }
  }

  async getLowStockItems() {
    try {
      return await Inventory.find({ status: 'low_stock' })
        .populate('product', 'name images')
        .sort('quantity');
    } catch (error) {
      throw new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, 'Error fetching low stock items');
    }
  }

  async bulkUpdateInventory(items, userId) {
    try {
      const updates = items.map(async (item) => {
        const inventory = await Inventory.findByIdAndUpdate(
          item._id,
          { quantity: item.quantity },
          { new: true }
        ).populate('product', 'name');

        if (inventory) {
          await this.#updateProductStock(inventory.product);
          await this.#checkLowStockAlert(inventory);
          await this.#createHistoryRecord({
            product: inventory.product,
            type: 'update',
            quantity: item.quantity,
            reason: 'Bulk update',
            user: userId
          });
        }
      });

      await Promise.all(updates);
    } catch (error) {
      throw new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, 'Error performing bulk update');
    }
  }

  async #checkLowStockAlert(inventory) {
    try {
      const lowStockThreshold = 10; // Default threshold
      const criticalStockThreshold = 5; // Critical threshold
      
      if (inventory.quantity <= 0) {
        // Out of stock alert
        realTimeEventService.emitInventoryAlert({
          message: `Out of stock: ${inventory.product.name} (${inventory.size}, ${inventory.color})`,
          severity: 'critical',
          productId: inventory.product._id.toString(),
          currentStock: inventory.quantity
        });
      } else if (inventory.quantity <= criticalStockThreshold) {
        // Critical low stock alert
        realTimeEventService.emitInventoryAlert({
          message: `Critical low stock: ${inventory.product.name} (${inventory.size}, ${inventory.color}) - Only ${inventory.quantity} remaining`,
          severity: 'high',
          productId: inventory.product._id.toString(),
          currentStock: inventory.quantity
        });
      } else if (inventory.quantity <= lowStockThreshold) {
        // Low stock alert
        realTimeEventService.emitInventoryAlert({
          message: `Low stock alert: ${inventory.product.name} (${inventory.size}, ${inventory.color}) running low - ${inventory.quantity} remaining`,
          severity: 'medium',
          productId: inventory.product._id.toString(),
          currentStock: inventory.quantity
        });
      }
    } catch (error) {
      console.error('Error checking low stock alert:', error);
    }
  }

  async #updateProductStock(productId) {
    try {
      const inventoryItems = await Inventory.find({ product: productId });
      const totalStock = inventoryItems.reduce((sum, item) => sum + item.quantity, 0);
      await Product.findByIdAndUpdate(productId, { stock: totalStock });
    } catch (error) {
      throw new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, 'Error updating product stock');
    }
  }

  async #createHistoryRecord(data) {
    try {
      console.log('Creating InventoryHistory record with data:', data);
      await new InventoryHistory(data).save();
    } catch (error) {
      console.error('Error in #createHistoryRecord:', error);
      console.error('Data that caused error:', data);
      throw new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, 'Error creating history record');
    }
  }
}

export const inventoryService = new InventoryService();