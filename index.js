import recipientRoutes from './routes/recipientRoutes.js';
// Runtime sanity check: ensure this file is loaded from the expected project/server directory structure.
// Misconfiguration (e.g., running `node index.js` at repo root without adjusting rootDir) previously caused
// attempts to resolve './userRoutes.js' from the wrong working directory, leading to ERR_MODULE_NOT_FOUND.
// This guard logs a clear diagnostic if cwd does not contain the package.json for the project root.
import fs from 'fs';
import url from 'url';
try {
  const cwd = process.cwd();
  const expectedPkg = new URL('../package.json', import.meta.url);
  if (!fs.existsSync(expectedPkg)) {
    console.warn('[startup][diagnostic] Expected package.json not found relative to server entry.');
    console.warn('[startup][diagnostic] CWD=', cwd, ' ENTRY=', import.meta.url);
    console.warn('[startup][diagnostic] If deploying on Render, set rootDir: project and startCommand: node server/index.js');
  }
} catch (e) {
  // Non-fatal; purely diagnostic
}
import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { errorHandler } from './middleware/errorHandler.js';
import cookieParser from 'cookie-parser';
import cspMiddleware from './middleware/csp.js';

// Route Imports
import userRoutes from './routes/userRoutes.js';
import productRoutes from './routes/productRoutes.js';
import orderRoutes from './routes/orderRoutes.js';
import authRoutes from './routes/authRoutes.js';
import heroRoutes from './routes/heroRoutes.js';
import settingsRoutes from './routes/settingsRoutes.js';
import categoryRoutes from './routes/categoryRoutes.js';
import navigationCategoryRoutes from './routes/navigationCategoryRoutes.js';
import deliveryRoutes from './routes/deliveryRoutes.js';
import currencyRoutes from './routes/currencyRoutes.js';
import footerRoutes from './routes/footerRoutes.js';
import announcementRoutes from './routes/announcementRoutes.js';
import backgroundRoutes from './routes/backgroundRoutes.js';
import bannerRoutes from './routes/bannerRoutes.js';
import inventoryRoutes from './routes/inventoryRoutes.js';
import warehouseRoutes from './routes/warehouseRoutes.js';
import giftCardRoutes from './routes/giftCardRoutes.js';
import couponRoutes from './routes/couponRoutes.js';
import shippingRoutes from './routes/shippingRoutes.js'; // Added Shipping Routes
import revenueRoutes from './routes/revenueRoutes.js'; // Added Revenue Routes
import pushRoutes from './routes/pushRoutes.js';
import whatsappRoutes from './routes/whatsappRoutes.js';
import layoutRoutes from './routes/layoutRoutes.js';
import dbRoutes from './routes/dbRoutes.js';
import dbManager from './services/dbManager.js';
import brandRoutes from './routes/brandRoutes.js';
import cloudinaryRoutes from './routes/cloudinaryRoutes.js';
import paypalRoutes from './routes/paypalRoutes.js';
import legalRoutes from './routes/legalRoutes.js';
import uploadRoutes from './routes/uploadRoutes.js';

// Path Setup
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Environment Variables
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const app = express();

// Middleware
// Lightweight request logging & version header
let APP_VERSION = process.env.APP_VERSION || '';
try {
  if (!APP_VERSION) {
    // Attempt to read version from package.json one directory up
    const pkg = await import(path.resolve(__dirname, '../package.json'), { assert: { type: 'json' } }).catch(() => null);
    APP_VERSION = pkg?.default?.version || '0.0.0-dev';
  }
} catch {}

app.use((req, res, next) => {
  const start = Date.now();
  const authHeader = req.header('Authorization');
  // Defer logging until response finished
  res.setHeader('X-App-Version', APP_VERSION);
  res.on('finish', () => {
    const duration = Date.now() - start;
    const user = req.user ? `${req.user._id}:${req.user.role}` : 'anon';
    console.log(`REQ ${req.method} ${req.originalUrl} -> ${res.statusCode} ${duration}ms auth=${authHeader? 'y':'n'} user=${user}`);
  });
  next();
});
// Hardened CORS configuration: explicitly allow known storefront/admin origins and handle preflight
const defaultAllowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:3000',
  'https://relaxed-cucurucho-360448.netlify.app',
  // Self origin (Render) – harmless for health checks and internal tools
  'https://leohol.onrender.com'
];

// Allow override via env (comma-separated list)
const envOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const allowedOrigins = envOrigins.length ? envOrigins : defaultAllowedOrigins;

const corsOptions = {
  origin: function(origin, callback) {
    // Allow non-browser requests (no origin) like curl/health checks
    if (!origin) return callback(null, true);
    // Allow any Netlify preview/production subdomain if desired
    const isNetlify = /\.netlify\.app$/i.test(origin) || /\.netlify\.live$/i.test(origin);
    // Allow any localhost/127.0.0.1 origin regardless of port for development
    try {
      const u = new URL(origin);
      if (['localhost', '127.0.0.1', '::1'].includes(u.hostname)) {
        return callback(null, true);
      }
    } catch {}
    if (allowedOrigins.includes(origin) || isNetlify) {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
  // We now rely on httpOnly refresh token cookie (rt) for /api/auth/refresh. Enable credentials.
  credentials: true,
  optionsSuccessStatus: 204
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// Reinforce credentials & dynamic origin echo after cors() in case upstream config omits header
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    // Re-run origin allow logic similar to corsOptions.origin
    let allow = false;
    try {
      const u = new URL(origin);
      if (['localhost','127.0.0.1','::1'].includes(u.hostname)) allow = true;
    } catch {}
    const isNetlify = /\.netlify\.(app|live)$/i.test(origin);
    if (!allow && (isNetlify || allowedOrigins.includes(origin))) allow = true;
    if (allow) {
      // Only set ACAO if not already set by cors (avoid header duplication)
      if (!res.getHeader('Access-Control-Allow-Origin')) {
        res.setHeader('Access-Control-Allow-Origin', origin);
      }
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      const vary = res.getHeader('Vary');
      if (!vary) res.setHeader('Vary', 'Origin');
      else if (!String(vary).includes('Origin')) res.setHeader('Vary', vary + ', Origin');
    }
  }
  next();
});

// Apply Content Security Policy middleware
app.use(cspMiddleware);

app.use(express.json());
app.use(cookieParser());
// Serve static for service worker if behind express (especially in production)
app.use(express.static(path.resolve(__dirname, '../public')));

// Serve uploaded files with CORS headers to prevent CORB issues
app.use('/uploads', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
}, express.static(path.resolve(__dirname, '../uploads')));

// MongoDB connection handled by dbManager service

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/hero', heroRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/navigation', navigationCategoryRoutes);
app.use('/api/delivery', deliveryRoutes);
app.use('/api/currency', currencyRoutes);
app.use('/api/footer', footerRoutes);
app.use('/api/announcements', announcementRoutes);
app.use('/api/backgrounds', backgroundRoutes);
app.use('/api/banners', bannerRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/gift-cards', giftCardRoutes);
app.use('/api/recipients', recipientRoutes);
app.use('/api/coupons', couponRoutes);
app.use('/api/warehouses', warehouseRoutes);
app.use('/api/shipping', shippingRoutes); // Added Shipping Routes
app.use('/api/revenue', revenueRoutes); // Added Revenue Routes
app.use('/api/push', pushRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/layout', layoutRoutes);
app.use('/api/brands', brandRoutes);
app.use('/api/cloudinary', cloudinaryRoutes);
app.use('/api/paypal', paypalRoutes);
app.use('/api/legal', legalRoutes);
app.use('/api/db', dbRoutes);
// File upload endpoints (must come before static /uploads to avoid intercepting multipart requests)
app.use('/api/uploads', uploadRoutes);

// Health Check Route
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handling middleware
app.use(errorHandler);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

const PORT = process.env.PORT || 5000;

// Create HTTP server
const server = createServer(app);

// WebSocket setup (expanded)
// Accept all upgrade paths so platform/proxy rewrites (e.g. /api/ws) still succeed.
// Disable perMessageDeflate to reduce chances of proxy interference closing connection early.
const wss = new WebSocketServer({ server, perMessageDeflate: false });

// Extra upgrade diagnostics
server.on('upgrade', (req, socket, head) => {
  try {
    console.log('[WS][upgrade] incoming', {
      url: req.url,
      host: req.headers.host,
      origin: req.headers.origin,
      ua: req.headers['user-agent'],
      secVersion: req.headers['sec-websocket-version'],
      secProtocol: req.headers['sec-websocket-protocol']
    });
  } catch {}
});

// Track clients (WebSocket) and Server-Sent Events (SSE)
const clients = new Set();
const sseClients = new Set(); // each item: { id, res }

function initSocket(ws, request) {
  const pathInfo = request?.url || 'unknown';
  console.log(`[WS] Connection established path=${pathInfo} total=${clients.size + 1}`);
  clients.add(ws);
  try {
    ws.send(JSON.stringify({
      type: 'connection_established',
      data: { message: 'Connected to real-time updates', path: pathInfo },
      timestamp: new Date().toISOString()
    }));
  } catch {}

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());
      if (data.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
      } else {
        console.log('[WS] Unknown message type:', data.type);
      }
    } catch (err) {
      console.error('[WS] Error parsing message', err?.message || err);
    }
  });

  ws.on('close', (code, reason) => {
    clients.delete(ws);
    console.log(`[WS] Closed code=${code} reason=${reason?.toString() || ''} remaining=${clients.size}`);
  });

  ws.on('error', (err) => {
    console.error('[WS] Socket error', err?.message || err);
    clients.delete(ws);
  });
}

wss.on('connection', (ws, req) => initSocket(ws, req));

// Function to broadcast to all connected clients (WS + SSE)
export function broadcastToClients(data) {
  const message = JSON.stringify({
    ...data,
    timestamp: new Date().toISOString()
  });
  
  clients.forEach(client => {
    if (client.readyState === client.OPEN) {
      try {
        client.send(message);
      } catch (error) {
        console.error('Error sending message to client:', error);
        clients.delete(client);
      }
    }
  });

  // SSE broadcast (send as event stream line)
  const ssePayload = `data: ${message}\n\n`;
  sseClients.forEach(client => {
    try {
      client.res.write(ssePayload);
    } catch (err) {
      console.error('[SSE] Failed write, removing client', err?.message || err);
      sseClients.delete(client);
    }
  });
}

// Make broadcaster accessible to routes/controllers without creating import cycles
// Routes can access it via req.app.get('broadcastToClients')
app.set('broadcastToClients', broadcastToClients);

// SSE endpoint for settings / real-time updates fallback
app.get('/api/settings/stream', (req, res) => {
  // Setup headers for SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders && res.flushHeaders();

  const id = Date.now() + ':' + Math.random().toString(36).slice(2);
  const clientRef = { id, res };
  sseClients.add(clientRef);
  console.log(`[SSE] Client connected id=${id} total=${sseClients.size}`);

  // Heartbeat every 25s (avoid some proxies timing out)
  const heartbeat = setInterval(() => {
    try { res.write(`: ping ${Date.now()}\n`); } catch {}
  }, 25000);

  // Initial hello
  try {
    res.write(`event: connection\n`);
    res.write(`data: ${JSON.stringify({ type: 'sse_connected', id, ts: new Date().toISOString() })}\n\n`);
  } catch {}

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(clientRef);
    console.log(`[SSE] Client disconnected id=${id} remaining=${sseClients.size}`);
  });
});

// Realtime status endpoint (diagnostics)
app.get('/api/realtime/status', (req, res) => {
  try {
    const mem = process.memoryUsage();
    res.json({
      wsClients: clients.size,
      sseClients: sseClients.size,
      uptimeSec: Math.round(process.uptime()),
      version: APP_VERSION,
      rssMB: +(mem.rss / 1024 / 1024).toFixed(1),
      heapUsedMB: +(mem.heapUsed / 1024 / 1024).toFixed(1)
    });
  } catch (e) {
    res.status(500).json({ message: 'status_error', error: (e?.message || 'unknown') });
  }
});

// Test broadcast route (development aid) - can be disabled behind env guard if needed
app.post('/api/realtime/test-broadcast', (req, res) => {
  try {
    broadcastToClients({
      type: 'settings_updated',
      data: {
        test: true,
        primaryColor: '#'+Math.random().toString(16).slice(2,8).padEnd(6,'0'),
        timestamp: Date.now()
      }
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || 'broadcast_failed' });
  }
});

// Initialize server
const startServer = async () => {
  if (process.env.SKIP_DB === '1') {
    console.warn('Starting server with SKIP_DB=1 (database connection skipped).');
    server.listen(PORT, () => {
      console.log(`Server running (no DB) on port ${PORT}`);
      console.log(`WebSocket server running on ws://localhost:${PORT}/ws`);
    });
    return;
  }

  // Use dbManager for connection with retry
  let conn = null;
  try {
    conn = await dbManager.connectWithRetry();
  } catch (e) {
    console.error('Database connection failed after retries:', e.message);
  }
  if (!conn) {
    console.error('Database connection failed; server not started. Set SKIP_DB=1 to bypass during development.');
    return;
  }

  // Initialize default data after database connection is established
  try {
    // Import and run data initialization
    const User = (await import('./models/User.js')).default;
    const Settings = (await import('./models/Settings.js')).default;
    const FooterSettings = (await import('./models/FooterSettings.js')).default;
    const Background = (await import('./models/Background.js')).default;

    // Create default admin user
    await User.createDefaultAdmin();

    // Create default settings
    await Settings.createDefaultSettings();

    // Create default footer settings
    await FooterSettings.createDefaultSettings();

    // Create default background
    await Background.createDefaultBackground();

    // Ensure a test delivery company exists
    try {
      const { createTestDeliveryCompany } = await import('./utils/createTestData.js');
      await createTestDeliveryCompany();
    } catch (e) {
      console.warn('Delivery company seeding skipped:', e.message);
    }
    
    

    console.log('✅ Default data initialization completed');
  } catch (error) {
    console.error('❌ Error during data initialization:', error.message);
  }

  // Start real-time services after everything is initialized
  import('./services/realTimeEventService.js');

  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`WebSocket server running on ws://localhost:${PORT}/ws`);
  });
};

// Start server
startServer();

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  console.error('Unhandled Promise Rejection:', err);
  if (process.env.NODE_ENV === 'production') {
    process.exit(1);
  }
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  if (process.env.NODE_ENV === 'production') {
    process.exit(1);
  }
});
