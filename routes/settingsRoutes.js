import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { adminAuth, auth } from '../middleware/auth.js';
import Settings from '../models/Settings.js';
import { ensureCloudinaryConfig, hasCloudinaryCredentials } from '../services/cloudinaryConfigService.js';
import cloudinary from '../services/cloudinaryClient.js';

const router = express.Router();

// Helper: convert relative asset path (e.g. /uploads/xxx.png) to absolute URL for client consumption
function toAbsolute(req, url) {
  if (!url) return url;
  // Already absolute (http/https) OR inline / blob data – leave untouched
  if (/^(https?:|data:|blob:)/i.test(url)) return url;
  try {
    const protoHeader = (req.headers['x-forwarded-proto'] || '').toString();
    const proto = protoHeader.split(',')[0] || req.protocol || 'http';
    const host = (req.headers['x-forwarded-host'] || req.get('host') || '').toString().split(',')[0];
    if (!host) return url; // fallback – return as-is
    return `${proto}://${host}${url.startsWith('/') ? '' : '/'}${url}`;
  } catch {
    return url;
  }
}

// Configure multer for uploads (project-level /uploads)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadDir = path.resolve(__dirname, '../../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext).replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
    cb(null, `${base}-${Date.now()}${ext}`);
  }
});
const upload = multer({ storage });

// Optional: allow non-admins to edit general settings when ALLOW_NON_ADMIN_SETTINGS=1
// This is intended for development only. Sensitive endpoints remain admin-only.
const settingsWriteGuard = process.env.ALLOW_NON_ADMIN_SETTINGS === '1' ? auth : adminAuth;

// Get store settings
router.get('/', async (req, res) => {
  try {
    console.log('[GET /api/settings] incoming', {
      time: new Date().toISOString(),
      ip: req.ip,
      ua: req.headers['user-agent'],
      auth: req.header('Authorization') ? 'present' : 'none',
      origin: req.headers.origin || '',
      referer: req.headers.referer || ''
    });
  } catch {}
  try {
    let settings = await Settings.findOne();
    if (!settings) {
      settings = await Settings.create({});
    }
    // Do not leak secrets when returning settings publicly
    const obj = settings.toObject();
    if (obj.cloudinary && obj.cloudinary.apiSecret) {
      obj.cloudinary = {
        cloudName: obj.cloudinary.cloudName || '',
        apiKey: obj.cloudinary.apiKey ? '***' : '',
        apiSecret: obj.cloudinary.apiSecret ? '***' : ''
      };
    }
    if (obj.payments) {
      if (obj.payments.paypal) {
        obj.payments.paypal = {
          enabled: !!obj.payments.paypal.enabled,
          mode: obj.payments.paypal.mode || 'sandbox',
          clientId: obj.payments.paypal.clientId ? obj.payments.paypal.clientId : '',
          secret: obj.payments.paypal.secret ? '***' : ''
        };
      }
      if (obj.payments.visibility) {
        obj.payments.visibility = {
          card: !!obj.payments.visibility.card,
          cod: !!obj.payments.visibility.cod,
          paypal: !!obj.payments.visibility.paypal
        };
      }
    }
    if (obj.googleAuth) {
      obj.googleAuth = {
        enabled: !!obj.googleAuth.enabled,
        clientId: obj.googleAuth.clientId || '',
        secretSet: !!(obj.googleAuth.clientSecret && obj.googleAuth.clientSecret.length > 0)
      };
      delete obj.googleAuth.clientSecret;
    }
    // Normalize favicon (and optionally logo) to absolute so other-origins (Netlify) can load it
    try {
  if (obj.favicon) obj.favicon = toAbsolute(req, obj.favicon);
      if (obj.logo && obj.logo.startsWith('/uploads/')) obj.logo = toAbsolute(req, obj.logo);
      if (obj.authBackgroundImage && obj.authBackgroundImage.startsWith('/uploads/')) obj.authBackgroundImage = toAbsolute(req, obj.authBackgroundImage);
    } catch {}
    res.json(obj);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get analytics config (subset of settings)
router.get('/analytics', async (req, res) => {
  try {
    let settings = await Settings.findOne();
    if (!settings) {
      settings = await Settings.create({});
    }

    const analytics = {
      facebookPixel: settings.facebookPixel || { pixelId: '', enabled: false },
      googleAnalytics: settings.googleAnalytics || { trackingId: '', enabled: false }
    };

    res.json(analytics);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Lightweight version endpoint for polling (no secrets, minimal payload)
router.get('/version', async (req, res) => {
  try {
    let settings = await Settings.findOne().select('_id updatedAt logo logoWidthMobile logoMaxHeightMobile logoWidthDesktop');
    if (!settings) {
      settings = await Settings.create({});
    }
    const updatedAt = settings.updatedAt instanceof Date ? settings.updatedAt : new Date();
    // Version can be milliseconds timestamp; easy to compare client-side
    const version = updatedAt.getTime();
    res.json({ version, updatedAt: updatedAt.toISOString() });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get Facebook Pixel config
router.get('/analytics/facebook-pixel', async (req, res) => {
  try {
    let settings = await Settings.findOne();
    if (!settings) {
      settings = await Settings.create({});
    }

    const fb = settings.facebookPixel || { pixelId: '', enabled: false };
    res.json(fb);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Update Facebook Pixel config (guarded; can be relaxed via env)
router.put('/analytics/facebook-pixel', settingsWriteGuard, async (req, res) => {
  try {
    const { pixelId = '', enabled = false } = req.body || {};

    // Basic validation: when enabled, require 15-16 digit numeric Pixel ID
    if (enabled && !/^\d{15,16}$/.test(String(pixelId))) {
      return res.status(400).json({ message: 'Invalid Facebook Pixel ID format' });
    }

    let settings = await Settings.findOne();
    if (!settings) {
      settings = new Settings();
    }

    settings.facebookPixel = { pixelId: String(pixelId), enabled: Boolean(enabled) };
    await settings.save();

    res.json(settings.facebookPixel);
  } catch (error) {
    if (error.name === 'ValidationError') {
      res.status(400).json({ 
        message: 'Validation error',
        errors: Object.values(error.errors).map(err => err.message)
      });
    } else {
      res.status(500).json({ message: error.message });
    }
  }
});

// Update store settings (guarded; can be relaxed via env)
router.put('/', settingsWriteGuard, async (req, res) => {
  try {
    console.log('[Settings PUT] Incoming payload:', req.body);
    // Always operate on the most recently updated Settings document to avoid splitting state
    let settings = await Settings.findOne().sort({ updatedAt: -1 });
    if (!settings) {
      settings = new Settings();
      console.log('[Settings PUT] Created new Settings document');
    }

    // Update settings
    // Preserve existing secrets when UI sends masked values like '***'
    const prevCloudinarySecret = settings?.cloudinary?.apiSecret;
    const prevPaypalSecret = settings?.payments?.paypal?.secret;

    // Shallow assign for top-level scalars and simple objects
    Object.assign(settings, req.body);

    // Deep handling for known nested structures and secret preservation
    if (req.body && typeof req.body === 'object') {
      // Cloudinary
      if (req.body.cloudinary && typeof req.body.cloudinary === 'object') {
        settings.cloudinary = settings.cloudinary || {};
        if (typeof req.body.cloudinary.cloudName === 'string') settings.cloudinary.cloudName = req.body.cloudinary.cloudName;
        if (typeof req.body.cloudinary.apiKey === 'string') settings.cloudinary.apiKey = req.body.cloudinary.apiKey;
        if (typeof req.body.cloudinary.apiSecret === 'string') {
          settings.cloudinary.apiSecret = req.body.cloudinary.apiSecret === '***' ? prevCloudinarySecret : req.body.cloudinary.apiSecret;
        }
        try { settings.markModified('cloudinary'); } catch {}
      }

      // Payments: PayPal
      if (req.body.payments && typeof req.body.payments === 'object') {
        settings.payments = settings.payments || {};
        // Handle paypal sub-object
        if (req.body.payments.paypal) {
          const incoming = req.body.payments.paypal || {};
          settings.payments.paypal = settings.payments.paypal || { enabled: false, mode: 'sandbox', clientId: '', secret: '' };
          if (typeof incoming.enabled !== 'undefined') settings.payments.paypal.enabled = !!incoming.enabled;
          if (typeof incoming.mode === 'string') settings.payments.paypal.mode = incoming.mode;
          if (typeof incoming.clientId === 'string') settings.payments.paypal.clientId = incoming.clientId;
          if (typeof incoming.secret === 'string') settings.payments.paypal.secret = incoming.secret === '***' ? prevPaypalSecret : incoming.secret;
        }
        // Handle visibility sub-object
        if (req.body.payments.visibility && typeof req.body.payments.visibility === 'object') {
          settings.payments.visibility = settings.payments.visibility || { card: true, cod: true, paypal: true };
          const vis = req.body.payments.visibility;
          // Basic validation: require booleans only
          ['card','cod','paypal'].forEach(k => {
            if (typeof vis[k] !== 'undefined') {
              if (typeof vis[k] !== 'boolean') {
                return res.status(400).json({ message: `payments.visibility.${k} must be a boolean` });
              }
              settings.payments.visibility[k] = vis[k];
            }
          });
        }
        try { settings.markModified('payments'); } catch {}
      }

      // Google Auth (includes optional clientSecret write-only)
      if (req.body.googleAuth && typeof req.body.googleAuth === 'object') {
        settings.googleAuth = settings.googleAuth || { enabled: false, clientId: '', clientSecret: '' };
        const incomingGA = req.body.googleAuth;
        if (typeof incomingGA.enabled !== 'undefined') settings.googleAuth.enabled = !!incomingGA.enabled;
        if (typeof incomingGA.clientId === 'string') settings.googleAuth.clientId = incomingGA.clientId.trim();
        if (typeof incomingGA.clientSecret === 'string') {
          // Mask preservation pattern: if UI sends '***' keep previous secret
          if (incomingGA.clientSecret === '***') {
            // preserve existing
          } else if (incomingGA.clientSecret === '') {
            settings.googleAuth.clientSecret = '';
          } else {
            settings.googleAuth.clientSecret = incomingGA.clientSecret.trim();
          }
        }
        try { settings.markModified('googleAuth'); } catch {}
      }

      // Facebook Pixel
      if (req.body.facebookPixel && typeof req.body.facebookPixel === 'object') {
        settings.facebookPixel = {
          ...(settings.facebookPixel || { pixelId: '', enabled: false }),
          ...req.body.facebookPixel
        };
        try { settings.markModified('facebookPixel'); } catch {}
      }

      // Google Analytics
      if (req.body.googleAnalytics && typeof req.body.googleAnalytics === 'object') {
        settings.googleAnalytics = {
          ...(settings.googleAnalytics || { trackingId: '', enabled: false }),
          ...req.body.googleAnalytics
        };
        try { settings.markModified('googleAnalytics'); } catch {}
      }

      // Social links
      if (req.body.socialLinks && typeof req.body.socialLinks === 'object') {
        settings.socialLinks = { ...(settings.socialLinks || {}), ...req.body.socialLinks };
        try { settings.markModified('socialLinks'); } catch {}
      }

      // Checkout form
      if (req.body.checkoutForm && typeof req.body.checkoutForm === 'object') {
        settings.checkoutForm = { ...(settings.checkoutForm || {}), ...req.body.checkoutForm };
        try { settings.markModified('checkoutForm'); } catch {}
      }

      // Header icon configurations
      if (Object.prototype.hasOwnProperty.call(req.body, 'headerIcons')) {
        try { settings.markModified('headerIcons'); } catch {}
      }
      if (Object.prototype.hasOwnProperty.call(req.body, 'headerIconVariants')) {
        try { settings.markModified('headerIconVariants'); } catch {}
      }
      if (Object.prototype.hasOwnProperty.call(req.body, 'headerIconAssets')) {
        try { settings.markModified('headerIconAssets'); } catch {}
      }
      // Simple boolean toggles
      if (Object.prototype.hasOwnProperty.call(req.body, 'showColorFilter')) {
        settings.showColorFilter = !!req.body.showColorFilter;
      }
    }

    await settings.save();

    // Optional singleton enforcement / pruning of duplicates
    try {
      const all = await Settings.find({}, '_id updatedAt').sort({ updatedAt: -1 });
      if (all.length > 1) {
        if (process.env.PRUNE_EXTRA_SETTINGS === '1') {
          const toDelete = all.slice(1).map(d => d._id);
            if (toDelete.length) {
              await Settings.deleteMany({ _id: { $in: toDelete } });
              console.warn(`[Settings] Pruned ${toDelete.length} older Settings documents to enforce singleton.`);
            }
        } else {
          console.warn(`[Settings] Detected ${all.length} Settings documents (expected 1). Set PRUNE_EXTRA_SETTINGS=1 to auto-prune older ones.`);
        }
      }
    } catch (e) {
      console.warn('[Settings] Duplicate detection/pruning skipped:', e.message);
    }

    // Emit real-time event to notify clients of settings change
    try {
      const broadcast = req.app.get('broadcastToClients');
      if (typeof broadcast === 'function') {
        broadcast({
          type: 'settings_updated',
          data: {
            // Currency default
            currency: settings.currency,
            // Send only fields that impact design/theme to avoid oversharing
            primaryColor: settings.primaryColor,
            secondaryColor: settings.secondaryColor,
            accentColor: settings.accentColor,
            searchBorderColor: settings.searchBorderColor,
            // Navigation styles
            navCategoryFontColor: settings.navCategoryFontColor,
            navCategoryFontSize: settings.navCategoryFontSize,
            navPanelFontColor: settings.navPanelFontColor,
            navPanelColumnActiveBgColor: settings.navPanelColumnActiveBgColor,
            navPanelAccentColor: settings.navPanelAccentColor,
            navPanelHeaderColor: settings.navPanelHeaderColor,
            fontFamily: settings.fontFamily,
            borderRadius: settings.borderRadius,
            buttonStyle: settings.buttonStyle,
            headerLayout: settings.headerLayout,
            headerBackgroundColor: settings.headerBackgroundColor,
            headerTextColor: settings.headerTextColor,
            headerIcons: settings.headerIcons,
            headerIconVariants: settings.headerIconVariants,
            footerStyle: settings.footerStyle,
            productCardStyle: settings.productCardStyle,
            productGridStyle: settings.productGridStyle,
            showColorFilter: settings.showColorFilter,
            // Component behavior
            heroAutoplayMs: settings.heroAutoplayMs,
            // Scroll-to-top
            scrollTopBgColor: settings.scrollTopBgColor,
            scrollTopTextColor: settings.scrollTopTextColor,
            scrollTopHoverBgColor: settings.scrollTopHoverBgColor,
            scrollTopPingColor: settings.scrollTopPingColor,
            // SEO fields
            siteTitle: settings.siteTitle,
            siteDescription: settings.siteDescription,
            keywords: settings.keywords,
            socialLinks: settings.socialLinks,
            // Contact info fields
            phone: settings.phone,
            address: settings.address,
            addressLink: settings.addressLink,
            email: settings.email,
            name: settings.name,
            // Added logo & logo sizing so all clients update immediately when admin changes logo
            logo: settings.logo,
            logoWidthMobile: settings.logoWidthMobile,
            logoMaxHeightMobile: settings.logoMaxHeightMobile,
            logoWidthDesktop: settings.logoWidthDesktop,
            // Favicon
            favicon: settings.favicon ? toAbsolute(req, settings.favicon) : settings.favicon,
            // ATC theme colors (newly persisted)
            atcBgColor: settings.atcBgColor,
            atcTextColor: settings.atcTextColor,
            atcHoverBgColor: settings.atcHoverBgColor,
            // New Arrivals mobile theme
            newArrivalsMobileHeadingColor: settings.newArrivalsMobileHeadingColor,
            newArrivalsMobileTextColor: settings.newArrivalsMobileTextColor,
            newArrivalsMobileOverlayBg: settings.newArrivalsMobileOverlayBg,
            newArrivalsMobileProductNameColor: settings.newArrivalsMobileProductNameColor,
            newArrivalsMobileProductPriceColor: settings.newArrivalsMobileProductPriceColor,
            // New Arrivals banner
            newArrivalsBannerEnabled: settings.newArrivalsBannerEnabled,
            newArrivalsBannerImage: settings.newArrivalsBannerImage ? toAbsolute(req, settings.newArrivalsBannerImage) : settings.newArrivalsBannerImage,
            newArrivalsBannerHeading: settings.newArrivalsBannerHeading,
            newArrivalsBannerSubheading: settings.newArrivalsBannerSubheading,
            // Auth pages background image
            authBackgroundImage: settings.authBackgroundImage,
            // Auth provider toggles
            googleAuth: settings.googleAuth ? { enabled: !!settings.googleAuth.enabled, clientId: settings.googleAuth.clientId || '', secretSet: !!(settings.googleAuth.clientSecret && settings.googleAuth.clientSecret.length > 0) } : { enabled: false, clientId: '', secretSet: false }
          }
        });
      }
    } catch (e) {
      console.error('Failed to broadcast settings update:', e);
    }

    // Sanitize response like GET
    const savedObj = settings.toObject();
    try {
  if (savedObj.favicon) savedObj.favicon = toAbsolute(req, savedObj.favicon);
      if (savedObj.logo && savedObj.logo.startsWith('/uploads/')) savedObj.logo = toAbsolute(req, savedObj.logo);
      if (savedObj.authBackgroundImage && savedObj.authBackgroundImage.startsWith('/uploads/')) savedObj.authBackgroundImage = toAbsolute(req, savedObj.authBackgroundImage);
      if (savedObj.newArrivalsBannerImage && savedObj.newArrivalsBannerImage.startsWith('/uploads/')) savedObj.newArrivalsBannerImage = toAbsolute(req, savedObj.newArrivalsBannerImage);
    } catch {}
    if (savedObj.googleAuth) {
      savedObj.googleAuth = {
        enabled: !!savedObj.googleAuth.enabled,
        clientId: savedObj.googleAuth.clientId || '',
        secretSet: !!(savedObj.googleAuth.clientSecret && savedObj.googleAuth.clientSecret.length > 0)
      };
    }
    // Ensure addressLink always present for clients (empty string fallback)
    if (typeof savedObj.addressLink === 'undefined') {
      savedObj.addressLink = '';
    }
    res.json(savedObj);
  } catch (error) {
  console.error('[Settings PUT] Error:', error);
    if (error.name === 'ValidationError') {
      res.status(400).json({ 
        message: 'Validation error',
        errors: Object.values(error.errors).map(err => err.message)
      });
    } else {
      res.status(500).json({ message: error.message });
    }
  }
});

// Upload custom header icon asset (admin only)
router.post('/upload/header-icon/:key', adminAuth, upload.single('file'), async (req, res) => {
  try {
    const { key } = req.params; // cart|wishlist|account|search|language|currency
    const allowed = ['cart','wishlist','account','search','language','currency'];
    if (!allowed.includes(key)) {
      return res.status(400).json({ message: 'Invalid header icon key' });
    }
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    let settings = await Settings.findOne();
    if (!settings) settings = new Settings();

    const publicUrl = `/uploads/${req.file.filename}`;
    settings.headerIconAssets = settings.headerIconAssets || {};
    settings.headerIconAssets[key] = publicUrl;
    settings.markModified('headerIconAssets');
    await settings.save();

    // Broadcast minimal update
    try {
      const broadcast = req.app.get('broadcastToClients');
      if (typeof broadcast === 'function') {
        broadcast({
          type: 'settings_updated',
          data: { headerIconAssets: settings.headerIconAssets }
        });
      }
    } catch {}

    res.json({ key, url: publicUrl });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Upload authentication background image (admin only)
router.post('/upload/auth-background', adminAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    let settings = await Settings.findOne();
    if (!settings) settings = new Settings();

    // Decide whether to push to Cloudinary (more persistent) or keep local file.
  let finalUrl = `/uploads/${req.file.filename}`; // default local path (ephemeral if host has no persistent disk)
  const hasCloudinaryCreds = await hasCloudinaryCredentials();

    if (hasCloudinaryCreds) {
      try {
        await ensureCloudinaryConfig();
        const uploadResult = await cloudinary.uploader.upload(path.join(uploadDir, req.file.filename), {
          folder: 'settings/auth',
          resource_type: 'image',
          use_filename: true,
          unique_filename: false,
          overwrite: true
        });
        if (uploadResult && uploadResult.secure_url) {
          finalUrl = uploadResult.secure_url;
          // Remove local temp file to save space
          try { fs.unlinkSync(path.join(uploadDir, req.file.filename)); } catch {}
        }
      } catch (cloudErr) {
        console.warn('[auth-background] Cloudinary upload failed, keeping local file:', cloudErr.message);
      }
    }

    // If no Cloudinary credentials are configured we currently store a relative /uploads path.
    // On many hosts (Render free tier, some serverless containers) this directory is ephemeral
    // and wiped on each redeploy/restart – causing the auth background to "disappear".
    // To make the background persist, inline it as a data URI in Mongo when Cloudinary isn't used.
    if (!hasCloudinaryCreds) {
      try {
        const filePath = path.join(uploadDir, req.file.filename);
        const buf = fs.readFileSync(filePath);
        const b64 = buf.toString('base64');
        const mime = req.file.mimetype || 'image/png';
        // Store as data URI so frontend can render without hitting /uploads
        finalUrl = `data:${mime};base64,${b64}`;
        // Optionally remove temp file to save disk (it won't be referenced anymore)
        try { fs.unlinkSync(filePath); } catch {}
      } catch (inlineErr) {
        console.warn('[auth-background] Failed to inline image, falling back to relative path:', inlineErr.message);
      }
    }

    settings.authBackgroundImage = finalUrl;
    await settings.save();

    // Broadcast minimal update
    try {
      const broadcast = req.app.get('broadcastToClients');
      if (typeof broadcast === 'function') {
        broadcast({ type: 'settings_updated', data: { authBackgroundImage: settings.authBackgroundImage } });
      }
    } catch {}

  res.json({ url: finalUrl, stored: hasCloudinaryCreds ? 'cloudinary' : 'inline' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Upload New Arrivals banner image (admin only)
router.post('/upload/new-arrivals-banner', adminAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    let settings = await Settings.findOne();
    if (!settings) settings = new Settings();

    let finalUrl = `/uploads/${req.file.filename}`;
    const hasCloudinaryCreds = await hasCloudinaryCredentials();
    if (hasCloudinaryCreds) {
      try {
        await ensureCloudinaryConfig();
        const uploadResult = await cloudinary.uploader.upload(path.join(uploadDir, req.file.filename), {
          folder: 'settings/new-arrivals',
          resource_type: 'image',
          use_filename: true,
          unique_filename: false,
          overwrite: true
        });
        if (uploadResult?.secure_url) {
          finalUrl = uploadResult.secure_url;
          try { fs.unlinkSync(path.join(uploadDir, req.file.filename)); } catch {}
        }
      } catch (cloudErr) {
        console.warn('[new-arrivals-banner] Cloudinary upload failed, keeping local file:', cloudErr.message);
      }
    }

    // Inline when no Cloudinary to persist across ephemeral storage
    if (!hasCloudinaryCreds) {
      try {
        const filePath = path.join(uploadDir, req.file.filename);
        const buf = fs.readFileSync(filePath);
        const b64 = buf.toString('base64');
        const mime = req.file.mimetype || 'image/png';
        finalUrl = `data:${mime};base64,${b64}`;
        try { fs.unlinkSync(filePath); } catch {}
      } catch (inlineErr) {
        console.warn('[new-arrivals-banner] Failed to inline image, using relative path:', inlineErr.message);
      }
    }

    settings.newArrivalsBannerImage = finalUrl;
    await settings.save();

    // Broadcast minimal update
    try {
      const broadcast = req.app.get('broadcastToClients');
      if (typeof broadcast === 'function') {
        broadcast({ type: 'settings_updated', data: { newArrivalsBannerImage: toAbsolute(req, finalUrl) } });
      }
    } catch {}

    res.json({ url: toAbsolute(req, finalUrl) });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Upload favicon (admin only). Accepts image/svg+xml, image/png, image/x-icon. Stores at /uploads or Cloudinary folder settings/favicon
router.post('/upload/favicon', adminAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }
    // Basic content-type check
    const allowed = ['image/svg+xml','image/png','image/x-icon','image/vnd.microsoft.icon'];
    if (!allowed.includes(req.file.mimetype)) {
      return res.status(400).json({ message: 'Unsupported favicon file type' });
    }

    let settings = await Settings.findOne();
    if (!settings) settings = new Settings();

    let finalUrl = `/uploads/${req.file.filename}`; // default local path (may be ephemeral)
  const hasCloudinaryCreds = await hasCloudinaryCredentials();
    if (hasCloudinaryCreds) {
      try {
        await ensureCloudinaryConfig();
        const uploadResult = await cloudinary.uploader.upload(path.join(uploadDir, req.file.filename), {
          folder: 'settings/favicon',
            resource_type: 'image',
            use_filename: true,
            unique_filename: false,
            overwrite: true,
            type: 'upload'
          });
          if (uploadResult?.secure_url) {
            finalUrl = uploadResult.secure_url;
            try { fs.unlinkSync(path.join(uploadDir, req.file.filename)); } catch {}
          }
        } catch (cloudErr) {
          console.warn('[favicon] Cloudinary upload failed, keeping local file:', cloudErr.message);
        }
    }
    // Inline as data URI when Cloudinary not configured to persist across restarts
    if (!hasCloudinaryCreds) {
      try {
        const filePath = path.join(uploadDir, req.file.filename);
        const buf = fs.readFileSync(filePath);
        const b64 = buf.toString('base64');
        const mime = req.file.mimetype || 'image/png';
        finalUrl = `data:${mime};base64,${b64}`;
        try { fs.unlinkSync(filePath); } catch {}
      } catch (inlineErr) {
        console.warn('[favicon] Failed to inline favicon, leaving relative path:', inlineErr.message);
      }
    }

    settings.favicon = finalUrl;
    await settings.save();

    // Prepare absolute (or inline) URL
    const absoluteUrl = settings.favicon ? toAbsolute(req, settings.favicon) : settings.favicon;

    // Broadcast minimal update with absolute / inline URL (so clients on different origins can consume directly)
    try {
      const broadcast = req.app.get('broadcastToClients');
      if (typeof broadcast === 'function') {
        broadcast({ type: 'settings_updated', data: { favicon: absoluteUrl } });
      }
    } catch {}

    res.json({ url: absoluteUrl, stored: hasCloudinaryCreds ? 'cloudinary' : 'inline' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;

// Cloudinary admin config endpoints
// Cloudinary settings are sensitive; admin only
router.get('/cloudinary', adminAuth, async (req, res) => {
  try {
    let settings = await Settings.findOne();
    if (!settings) settings = new Settings();
    const c = settings.cloudinary || { cloudName: '', apiKey: '', apiSecret: '' };
    // Allow explicit reveal of secret for admin when query param reveal=1 provided.
    // This is intentionally permissive per user request ("keep them available").
    // WARNING: Exposing the raw apiSecret increases risk – ensure HTTPS and restrict admin access.
    const reveal = req.query.reveal === '1' || req.query.reveal === 'true';
    res.json({
      cloudName: c.cloudName || '',
      apiKey: c.apiKey || '',
      apiSecret: c.apiSecret ? (reveal ? c.apiSecret : '***') : ''
    });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

router.put('/cloudinary', adminAuth, async (req, res) => {
  try {
    const { cloudName = '', apiKey = '', apiSecret = '', clearSecret = false } = req.body || {};
    let settings = await Settings.findOne();
    if (!settings) settings = new Settings();
    settings.cloudinary = settings.cloudinary || {};
    // Only update fields when non-empty strings provided. Allow explicit clearing via clearSecret flag.
    if (typeof cloudName === 'string' && cloudName.trim().length) settings.cloudinary.cloudName = cloudName.trim();
    if (typeof apiKey === 'string' && apiKey.trim().length) settings.cloudinary.apiKey = apiKey.trim();
    if (clearSecret === true) {
      settings.cloudinary.apiSecret = '';
    } else if (typeof apiSecret === 'string' && apiSecret !== '***' && apiSecret.trim().length) {
      settings.cloudinary.apiSecret = apiSecret.trim();
    }
    await settings.save();
    const configured = await ensureCloudinaryConfig();
    const c = settings.cloudinary || {};
    res.json({ ok: true, configured, cloudinary: { cloudName: c.cloudName || '', apiKey: c.apiKey || '', apiSecret: c.apiSecret ? '***' : '' } });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

router.post('/cloudinary/test', adminAuth, async (req, res) => {
  try {
    const ok = await ensureCloudinaryConfig();
    if (!ok) return res.status(400).json({ ok: false, message: 'Missing Cloudinary credentials' });
    // Simple API ping: list 1 image; if auth fails, it will throw
    await import('../services/cloudinaryClient.js');
    const { v2: sdk } = await import('cloudinary');
    const r = await sdk.api.resources({ max_results: 1, type: 'upload', resource_type: 'image' });
    res.json({ ok: true, count: (r.resources || []).length });
  } catch (e) {
    res.status(400).json({ ok: false, message: e.message });
  }
});

// PayPal config endpoint (public: returns only non-sensitive fields)
router.get('/payments/paypal', async (req, res) => {
  try {
    let settings = await Settings.findOne();
    if (!settings) settings = new Settings();
    const p = (settings.payments && settings.payments.paypal) || { enabled: false, mode: 'sandbox', clientId: '', secret: '' };
    res.json({ enabled: !!p.enabled, mode: p.mode || 'sandbox', clientId: p.clientId || '', secret: p.secret ? '***' : '' });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// Updating PayPal credentials should be admin-only
router.put('/payments/paypal', adminAuth, async (req, res) => {
  try {
    const { enabled, mode, clientId, secret } = req.body || {};
    if (mode && !['sandbox', 'live'].includes(String(mode))) {
      return res.status(400).json({ message: 'Invalid mode. Use sandbox or live.' });
    }
    let settings = await Settings.findOne();
    if (!settings) settings = new Settings();
    settings.payments = settings.payments || {};
    settings.payments.paypal = settings.payments.paypal || { enabled: false, mode: 'sandbox', clientId: '', secret: '' };
    if (typeof enabled !== 'undefined') settings.payments.paypal.enabled = !!enabled;
    if (typeof mode === 'string') settings.payments.paypal.mode = mode;
    if (typeof clientId === 'string') settings.payments.paypal.clientId = clientId.trim();
    if (typeof secret === 'string' && secret !== '***') settings.payments.paypal.secret = secret.trim();
    settings.markModified('payments');
    await settings.save();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// Checkout form customization endpoints
router.get('/checkout', async (req, res) => {
  try {
    let settings = await Settings.findOne();
    if (!settings) settings = await Settings.create({});
    const cf = settings.checkoutForm || {};
    res.json({
      showEmail: !!cf.showEmail,
      showLastName: !!cf.showLastName,
      showSecondaryMobile: !!cf.showSecondaryMobile,
      showCountry: !!cf.showCountry,
      allowOtherCity: !!cf.allowOtherCity,
      cities: Array.isArray(cf.cities) ? cf.cities : []
    });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// Update checkout form (guarded; can be relaxed via env)
router.put('/checkout', settingsWriteGuard, async (req, res) => {
  try {
    const { showEmail, showLastName, showSecondaryMobile, showCountry, cities, allowOtherCity } = req.body || {};
    let settings = await Settings.findOne();
    if (!settings) settings = new Settings();
    settings.checkoutForm = settings.checkoutForm || {};
    if (typeof showEmail === 'boolean') settings.checkoutForm.showEmail = showEmail;
    if (typeof showLastName === 'boolean') settings.checkoutForm.showLastName = showLastName;
    if (typeof showSecondaryMobile === 'boolean') settings.checkoutForm.showSecondaryMobile = showSecondaryMobile;
    if (typeof showCountry === 'boolean') settings.checkoutForm.showCountry = showCountry;
    if (typeof allowOtherCity === 'boolean') settings.checkoutForm.allowOtherCity = allowOtherCity;
    if (Array.isArray(cities)) settings.checkoutForm.cities = cities.filter(c => typeof c === 'string' && c.trim().length).map(c => c.trim());
    settings.markModified('checkoutForm');
    await settings.save();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// PayPal config test endpoint
router.post('/payments/paypal/test', adminAuth, async (req, res) => {
  try {
    let settings = await Settings.findOne();
    if (!settings || !settings.payments || !settings.payments.paypal || !settings.payments.paypal.clientId || !settings.payments.paypal.secret) {
      return res.status(400).json({ ok: false, message: 'Missing PayPal credentials' });
    }
    // Simple auth test: get an access token via SDK by creating a minimal order and not executing
    const { getPayPalClient, paypalSdk } = await import('../services/paypalClient.js');
    try {
      const client = getPayPalClient();
      const request = new paypalSdk.orders.OrdersCreateRequest();
      request.prefer('return=representation');
      request.requestBody({ intent: 'CAPTURE', purchase_units: [{ amount: { currency_code: 'USD', value: '1.00' } }] });
      await client.execute(request);
      return res.json({ ok: true });
    } catch (e) {
      return res.status(400).json({ ok: false, message: e.message });
    }
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});