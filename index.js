// Proxy entry to ensure both "node index.js" and "node server/index.js" work
// Uses ESM import because package.json has "type": "module"
import './server/index.js';