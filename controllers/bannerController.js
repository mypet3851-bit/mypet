import Banner from '../models/Banner.js';
import mongoose from 'mongoose';

export const getBanners = async (req, res) => {
  try {
    const banners = await Banner.find().sort('order').select('-__v');
    res.json(banners);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getActiveBanners = async (req, res) => {
  try {
    const now = new Date();
    const banners = await Banner.find({
      isActive: true,
      $and: [
        { $or: [{ startDate: null }, { startDate: { $lte: now } }] },
        { $or: [{ endDate: null }, { endDate: { $gte: now } }] }
      ]
    }).sort('order').select('-__v');
    res.json(banners);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const createBanner = async (req, res) => {
  try {
    const order = await Banner.countDocuments();
    const banner = new Banner({ ...req.body, order });
    const saved = await banner.save();
    res.status(201).json(saved);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

export const updateBanner = async (req, res) => {
  try {
    const banner = await Banner.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );
    if (!banner) return res.status(404).json({ message: 'Banner not found' });
    res.json(banner);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

export const deleteBanner = async (req, res) => {
  try {
    const banner = await Banner.findByIdAndDelete(req.params.id);
    if (!banner) return res.status(404).json({ message: 'Banner not found' });
    res.json({ message: 'Banner deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const reorderBanners = async (req, res) => {
  try {
    const payload = req.body?.banners || req.body?.items || req.body?.data;
    if (!Array.isArray(payload)) {
      return res.status(400).json({ message: 'Invalid payload: expected banners array' });
    }

    const updates = payload
      .map((raw) => {
        const id = raw?.id || raw?._id;
        const order = Number(raw?.order);
        return { id, order };
      })
      .filter((x) => x.id && mongoose.isValidObjectId(x.id) && Number.isFinite(x.order));

    if (updates.length === 0) {
      return res.status(400).json({ message: 'No valid banners provided for reorder' });
    }

    await Banner.bulkWrite(
      updates.map(({ id, order }) => ({
        updateOne: { filter: { _id: id }, update: { $set: { order } } }
      }))
    );

    res.json({ message: 'Banners reordered successfully', updated: updates.length });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
