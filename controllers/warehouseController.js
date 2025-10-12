import Warehouse from '../models/Warehouse.js';

// List all warehouses
export const getWarehouses = async (req, res) => {
  try {
    const warehouses = await Warehouse.find();
    res.json(warehouses);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch warehouses' });
  }
};

// Get a single warehouse by ID
export const getWarehouseById = async (req, res) => {
  try {
    const warehouse = await Warehouse.findById(req.params.id);
    if (!warehouse) return res.status(404).json({ error: 'Warehouse not found' });
    res.json(warehouse);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch warehouse' });
  }
};

// Create a new warehouse
export const createWarehouse = async (req, res) => {
  try {
    const warehouse = new Warehouse(req.body);
    await warehouse.save();
    res.status(201).json(warehouse);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// Update a warehouse
export const updateWarehouse = async (req, res) => {
  try {
    const warehouse = await Warehouse.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!warehouse) return res.status(404).json({ error: 'Warehouse not found' });
    res.json(warehouse);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// Delete a warehouse
export const deleteWarehouse = async (req, res) => {
  try {
    const warehouse = await Warehouse.findByIdAndDelete(req.params.id);
    if (!warehouse) return res.status(404).json({ error: 'Warehouse not found' });
    res.json({ message: 'Warehouse deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete warehouse' });
  }
};
