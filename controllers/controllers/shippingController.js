import ShippingZone from '../models/ShippingZone.js';
import ShippingRate from '../models/ShippingRate.js';
import { calculateShippingFee as calculateFee, getAvailableShippingOptions } from '../services/shippingService.js';
import { StatusCodes } from 'http-status-codes';
import { ApiError } from '../utils/ApiError.js';

// Zone Controllers
export const getShippingZones = async (req, res) => {
  try {
    const zones = await ShippingZone.find().sort('order');
    res.json(zones);
  } catch (error) {
    throw new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, 'Failed to fetch shipping zones');
  }
};

export const getShippingZone = async (req, res) => {
  try {
    const zone = await ShippingZone.findById(req.params.id);
    if (!zone) {
      throw new ApiError(StatusCodes.NOT_FOUND, 'Shipping zone not found');
    }
    res.json(zone);
  } catch (error) {
    throw new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, 'Failed to fetch shipping zone');
  }
};

export const createShippingZone = async (req, res) => {
  try {
    const zone = new ShippingZone(req.body);
    await zone.save();
    res.status(StatusCodes.CREATED).json(zone);
  } catch (error) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Failed to create shipping zone');
  }
};

export const updateShippingZone = async (req, res) => {
  try {
    const zone = await ShippingZone.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );
    if (!zone) {
      throw new ApiError(StatusCodes.NOT_FOUND, 'Shipping zone not found');
    }
    res.json(zone);
  } catch (error) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Failed to update shipping zone');
  }
};

export const deleteShippingZone = async (req, res) => {
  try {
    const zone = await ShippingZone.findByIdAndDelete(req.params.id);
    if (!zone) {
      throw new ApiError(StatusCodes.NOT_FOUND, 'Shipping zone not found');
    }
    res.json({ message: 'Shipping zone deleted successfully' });
  } catch (error) {
    throw new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, 'Failed to delete shipping zone');
  }
};

// Rate Controllers
export const getShippingRates = async (req, res) => {
  try {
    const rates = await ShippingRate.find()
      .populate('zone')
      .sort('zone');
    res.json(rates);
  } catch (error) {
    throw new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, 'Failed to fetch shipping rates');
  }
};

export const getShippingRate = async (req, res) => {
  try {
    const rate = await ShippingRate.findById(req.params.id)
      .populate('zone');
    if (!rate) {
      throw new ApiError(StatusCodes.NOT_FOUND, 'Shipping rate not found');
    }
    res.json(rate);
  } catch (error) {
    throw new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, 'Failed to fetch shipping rate');
  }
};

export const createShippingRate = async (req, res) => {
  try {
    const rate = new ShippingRate(req.body);
    await rate.save();
    res.status(StatusCodes.CREATED).json(rate);
  } catch (error) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Failed to create shipping rate');
  }
};

export const updateShippingRate = async (req, res) => {
  try {
    const rate = await ShippingRate.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );
    if (!rate) {
      throw new ApiError(StatusCodes.NOT_FOUND, 'Shipping rate not found');
    }
    res.json(rate);
  } catch (error) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Failed to update shipping rate');
  }
};

export const deleteShippingRate = async (req, res) => {
  try {
    const rate = await ShippingRate.findByIdAndDelete(req.params.id);
    if (!rate) {
      throw new ApiError(StatusCodes.NOT_FOUND, 'Shipping rate not found');
    }
    res.json({ message: 'Shipping rate deleted successfully' });
  } catch (error) {
    throw new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, 'Failed to delete shipping rate');
  }
};

// Fee Calculation
export const calculateShippingFee = async (req, res) => {
  try {
    const { subtotal, weight, country, region, city } = req.body;
    const fee = await calculateFee({ subtotal, weight, country, region, city });
    res.json({ fee, cityApplied: !!city });
  } catch (error) {
    throw new ApiError(StatusCodes.BAD_REQUEST, error.message || 'Failed to calculate shipping fee');
  }
};

// Get options (including city overrides) for UI selection
export const getShippingOptions = async (req, res) => {
  try {
    const { country, region, city, subtotal, weight } = req.query;
    if (!city && !country) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'city or country is required');
    }
    const options = await getAvailableShippingOptions({ country, region, city, subtotal: Number(subtotal) || 0, weight: Number(weight) || 0 });
    res.json({ options });
  } catch (error) {
    throw new ApiError(StatusCodes.BAD_REQUEST, error.message || 'Failed to get shipping options');
  }
};

// List distinct cities configured in any ShippingRate (for settings screen)
export const getConfiguredCities = async (req, res) => {
  try {
    const rates = await ShippingRate.find({ 'cities.0': { $exists: true } }, { cities: 1 });
    const citySet = new Set();
    rates.forEach(r => (r.cities || []).forEach(c => c.name && citySet.add(c.name)));
    res.json({ cities: Array.from(citySet).sort() });
  } catch (error) {
    throw new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, 'Failed to fetch cities');
  }
};
