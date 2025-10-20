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
    await ensureCloudinaryConfig();
    if (!req.file) {
      return res.status(400).json({ message: 'No file received' });
    }
    const folder = 'products';
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