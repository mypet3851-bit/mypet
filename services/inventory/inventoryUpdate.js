import Inventory from '../../models/Inventory.js';
import { StatusCodes } from 'http-status-codes';
import { ApiError } from '../../utils/ApiError.js';

export class InventoryUpdate {
  async create(data) {
    const inventory = new Inventory(data);
    const savedInventory = await inventory.save();
    return savedInventory;
  }

  async updateQuantity(id, quantity) {
    const inventory = await Inventory.findByIdAndUpdate(
      id,
      { quantity },
      { new: true, runValidators: true }
    ).populate('product', 'name');

    if (!inventory) {
      throw new ApiError(StatusCodes.NOT_FOUND, 'Inventory record not found');
    }

    return inventory;
  }
}