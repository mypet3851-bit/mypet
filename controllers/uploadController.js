import multer from 'multer';
import cloudinary from '../services/cloudinaryClient.js';
import { ensureCloudinaryConfig } from '../services/cloudinaryConfigService.js';

// Memory storage for quick pass-through to Cloudinary
const storage = multer.memoryStorage();
export const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    if (!/^image\//.test(file.mimetype)) {
      return cb(new Error('Only image uploads allowed'));
    }
    cb(null, true);
  }
});

export const uploadProductImage = async (req, res) => {
  try {
    const configured = await ensureCloudinaryConfig();
    if (!configured) {
      return res.status(500).json({
        message: 'Cloudinary is not configured. Please add credentials in environment variables or Settings.'
      });
    }
    if (!req.file) {
      return res.status(400).json({ message: 'No file received' });
    }
    // Allow clients to specify a target folder (e.g., 'footer') via body or query; default to 'products'
    const rawFolder = (req.body && (req.body.folder || req.body.path)) || (req.query && (req.query.folder || req.query.path)) || 'products';
    const folder = typeof rawFolder === 'string' && rawFolder.trim() ? rawFolder.trim() : 'products';
    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream({
        folder,
        resource_type: 'image',
        transformation: [{ quality: 'auto', fetch_format: 'auto' }]
      }, (err, uploaded) => {
        if (err) return reject(err);
        resolve(uploaded);
      });
      stream.end(req.file.buffer);
    });
    res.status(201).json({
      url: result.secure_url,
      public_id: result.public_id,
      folder: result.folder || folder,
      format: result.format,
      bytes: result.bytes,
      width: result.width,
      height: result.height
    });
  } catch (error) {
    console.error('uploadProductImage error:', error);
    res.status(500).json({ message: 'Failed to upload', error: error.message });
  }
};

export default { uploadProductImage };