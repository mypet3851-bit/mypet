import WarehouseMovement from '../models/WarehouseMovement.js';
import Inventory from '../models/Inventory.js';
import Product from '../models/Product.js';
import InventoryHistory from '../models/InventoryHistory.js';
import { StatusCodes } from 'http-status-codes';
import { ApiError } from '../utils/ApiError.js';
import { realTimeEventService } from './realTimeEventService.js';
import Settings from '../models/Settings.js';

class InventoryService {
  // Reserve items for an order across warehouses. Throws if insufficient stock unless allowNegativeStock.
  // items: [{ product, quantity, variantId? , size?, color? }]
  async reserveItems(items, userId, session = null) {
    if (!Array.isArray(items) || !items.length) return;
    const settings = await Settings.findOne().lean();
    const invCfg = settings?.inventory || {};
    const allowNegative = !!invCfg.allowNegativeStock;
    const affectedProducts = new Set();
    for (const it of items) {
      const { product, quantity } = it;
      if (!product || !quantity || quantity <= 0) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid reservation item');
      }
      const usingVariant = !!it.variantId;
      const baseFilter = usingVariant
        ? { product, variantId: it.variantId }
        : { product, size: it.size, color: it.color };

      // Load inventories sorted by quantity desc
      const invQuery = Inventory.find({ ...baseFilter }).sort({ quantity: -1 });
      const invs = session ? await invQuery.session(session) : await invQuery;
      const totalAvail = invs.reduce((s, x) => s + (Number(x.quantity) || 0), 0);
      if (!allowNegative && totalAvail < quantity) {
        throw new ApiError(StatusCodes.BAD_REQUEST, `Insufficient stock for product ${product}${usingVariant ? ' variant' : ''}. Available: ${totalAvail}, requested: ${quantity}`);
      }

      // Decrement across inventories greedily
      let remain = quantity;
      for (const inv of invs) {
        if (remain <= 0) break;
        const take = Math.min(remain, allowNegative ? remain : inv.quantity);
        inv.quantity -= take;
        remain -= take;
        if (session) await inv.save({ session }); else await inv.save();
      }
      // If still remaining and negatives allowed, create or use a synthetic negative bucket on the first inventory row
      if (remain > 0 && allowNegative) {
        if (invs.length) {
          const inv = invs[0];
          inv.quantity -= remain; // go negative
          if (session) await inv.save({ session }); else await inv.save();
        } else {
          // No inventory rows exist yet; create a placeholder row with negative quantity (requires a warehouse).
          // Choose any warehouse is not possible without context; instead, throw a targeted error suggesting to create a row.
          throw new ApiError(StatusCodes.BAD_REQUEST, 'No inventory rows found to record negative stock. Create at least one inventory entry for this item to allow negative stock.');
        }
        remain = 0;
      }

      // History record
      await this.#createHistoryRecord({
        product,
        type: 'decrease',
        quantity,
        reason: 'Order reservation',
        user: userId
      });
      affectedProducts.add(String(product));
    }

    // Recompute product and variant stocks
    for (const pid of affectedProducts) {
      await this.#updateProductStock(pid);
    }
  }

  // Increase back stock for items (used on cancel or return depending on settings)
  async incrementItems(items, userId, reason = 'Manual increase', session = null) {
    if (!Array.isArray(items) || !items.length) return;
    const affectedProducts = new Set();
    for (const it of items) {
      const { product, quantity } = it;
      if (!product || !quantity || quantity <= 0) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid increment item');
      }
      const usingVariant = !!it.variantId;
      const baseFilter = usingVariant
        ? { product, variantId: it.variantId }
        : { product, size: it.size, color: it.color };
      const invQuery = Inventory.find({ ...baseFilter }).sort({ quantity: 1 }); // smallest first
      const invs = session ? await invQuery.session(session) : await invQuery;
      let remain = quantity;
      for (const inv of invs) {
        if (remain <= 0) break;
        const add = remain;
        inv.quantity += add;
        remain -= add;
        if (session) await inv.save({ session }); else await inv.save();
      }
      if (remain > 0) {
        // If no rows existed, we cannot create without size/color/warehouse context in this generic method.
        // Let caller use addInventory to create missing rows explicitly.
      }
      await this.#createHistoryRecord({ product, type: 'increase', quantity, reason, user: userId });
      affectedProducts.add(String(product));
    }
    for (const pid of affectedProducts) await this.#updateProductStock(pid);
  }
  // Move stock between warehouses
  async moveStockBetweenWarehouses({ product, size, color, variantId, quantity, fromWarehouse, toWarehouse, userId, reason }) {
    if (!product || !fromWarehouse || !toWarehouse || !userId || !quantity || quantity <= 0) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'All fields are required and quantity must be > 0');
    }
    if (!variantId && (!size || !color)) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'Either variantId or both size and color are required');
    }

    const baseQuery = variantId
      ? { product, variantId, warehouse: fromWarehouse }
      : { product, size, color, warehouse: fromWarehouse };
    // Find source inventory
    const sourceInv = await Inventory.findOne(baseQuery);
    if (!sourceInv || sourceInv.quantity < quantity) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'Insufficient stock in source warehouse');
    }

    // Find or create destination inventory
    let destQuery = variantId
      ? { product, variantId, warehouse: toWarehouse }
      : { product, size, color, warehouse: toWarehouse };
    let destInv = await Inventory.findOne(destQuery);
    if (!destInv) {
      destInv = new Inventory({ product, size, color, variantId, warehouse: toWarehouse, quantity: 0 });
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
      // Allow either variantId OR size+color combo
      const usingVariant = !!data.variantId;
      if (!usingVariant) {
        if (!data.size) throw new ApiError(StatusCodes.BAD_REQUEST, 'Size is required');
        if (!data.color) throw new ApiError(StatusCodes.BAD_REQUEST, 'Color is required');
      }
      if (!data.warehouse) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'Warehouse is required');
      }
      if (data.quantity === undefined || data.quantity === null || data.quantity < 0) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'Valid quantity is required');
      }

      // Check if inventory item already exists for this product/size/color combination
      const existingInventory = await Inventory.findOne(
        usingVariant
          ? { product: data.product, variantId: data.variantId, warehouse: data.warehouse }
          : { product: data.product, size: data.size, color: data.color, warehouse: data.warehouse }
      );

      if (existingInventory) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 
          usingVariant
            ? 'Inventory already exists for this product variant in this warehouse. Please update the existing inventory instead.'
            : `Inventory already exists for this product, size (${data.size}), and color (${data.color}) combination in this warehouse. Please update the existing inventory instead.`);
      }

      // If variant path, optionally attach attribute snapshot for quick reference
      let attributesSnapshot = undefined;
      if (usingVariant) {
        const prod = await Product.findById(data.product).select('variants');
        const v = prod?.variants?.id?.(data.variantId);
        if (v && Array.isArray(v.attributes)) attributesSnapshot = v.attributes;
      }

      const inventory = new Inventory({
        product: data.product,
        variantId: data.variantId,
        size: usingVariant ? undefined : data.size,
        color: usingVariant ? undefined : data.color,
        quantity: data.quantity,
        warehouse: data.warehouse,
        location: data.location,
        lowStockThreshold: data.lowStockThreshold ?? 5,
        attributesSnapshot
      });
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
      const totalStock = inventoryItems.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);

      // Update variant stocks by summing inventory by variantId
      const perVariant = new Map();
      for (const item of inventoryItems) {
        if (item.variantId) {
          const key = String(item.variantId);
          perVariant.set(key, (perVariant.get(key) || 0) + (Number(item.quantity) || 0));
        }
      }

      const product = await Product.findById(productId);
      if (product) {
        if (Array.isArray(product.variants) && product.variants.length) {
          for (const v of product.variants) {
            const key = String(v._id);
            if (perVariant.has(key)) {
              v.stock = perVariant.get(key);
            }
          }
          // Recompute product stock as sum of variant stocks for consistency
          const sumVariants = product.variants.reduce((s, v) => s + (Number(v.stock) || 0), 0);
          product.stock = sumVariants;
        } else {
          // No variants: use total inventory sum
          product.stock = totalStock;
        }
        await product.save();
      } else {
        // Fallback: update stock field directly if product not loaded
        await Product.findByIdAndUpdate(productId, { stock: totalStock });
      }
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