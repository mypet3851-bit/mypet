import FooterSettings from '../models/FooterSettings.js';
import FooterLink from '../models/FooterLink.js';

// Get footer settings
export const getFooterSettings = async (req, res) => {
  try {
    let settings = await FooterSettings.findOne();
    if (!settings) {
      settings = await FooterSettings.create({});
    }
    res.json(settings);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Update footer settings
export const updateFooterSettings = async (req, res) => {
  try {
    let settings = await FooterSettings.findOne();
    if (!settings) {
      settings = new FooterSettings();
    }

    Object.assign(settings, req.body);
    await settings.save();
    
    // Broadcast real-time update for footer settings (non-fatal if broadcaster unavailable)
    try {
      const broadcast = req.app?.get?.('broadcastToClients');
      if (typeof broadcast === 'function') {
        broadcast({
          type: 'footer_settings_updated',
          data: settings
        });
      }
    } catch (e) {
      console.error('Failed to broadcast footer settings update:', e);
    }
    
    res.json(settings);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// Get all footer links
export const getFooterLinks = async (req, res) => {
  try {
    const links = await FooterLink.find().sort('order');
    res.json(links);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Create footer link
export const createFooterLink = async (req, res) => {
  try {
    const link = new FooterLink(req.body);
    const savedLink = await link.save();
    // Broadcast minimal update
    try {
      const broadcast = req.app?.get?.('broadcastToClients');
      if (typeof broadcast === 'function') {
        broadcast({ type: 'footer_links_updated', data: { action: 'created', link: savedLink } });
      }
    } catch {}
    res.status(201).json(savedLink);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// Update footer link
export const updateFooterLink = async (req, res) => {
  try {
    const link = await FooterLink.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );
    
    if (!link) {
      return res.status(404).json({ message: 'Footer link not found' });
    }
    // Broadcast update
    try {
      const broadcast = req.app?.get?.('broadcastToClients');
      if (typeof broadcast === 'function') {
        broadcast({ type: 'footer_links_updated', data: { action: 'updated', link } });
      }
    } catch {}
    res.json(link);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// Delete footer link
export const deleteFooterLink = async (req, res) => {
  try {
    const link = await FooterLink.findByIdAndDelete(req.params.id);
    
    if (!link) {
      return res.status(404).json({ message: 'Footer link not found' });
    }
    // Broadcast delete
    try {
      const broadcast = req.app?.get?.('broadcastToClients');
      if (typeof broadcast === 'function') {
        broadcast({ type: 'footer_links_updated', data: { action: 'deleted', id: req.params.id } });
      }
    } catch {}
    res.json({ message: 'Footer link deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Reorder footer links
export const reorderFooterLinks = async (req, res) => {
  try {
    const { links } = req.body;
    await Promise.all(
      links.map(({ id, order, section }) => 
        FooterLink.findByIdAndUpdate(id, { order, section })
      )
    );
    try {
      const broadcast = req.app?.get?.('broadcastToClients');
      if (typeof broadcast === 'function') {
        broadcast({ type: 'footer_links_updated', data: { action: 'reordered', links: links } });
      }
    } catch {}
    res.json({ message: 'Links reordered successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};