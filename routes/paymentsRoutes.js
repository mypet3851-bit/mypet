import express from 'express';

const router = express.Router();

// iCredit IPN webhook (public)
router.post('/icredit/ipn', async (req, res) => {
  try {
    const payload = req.body || {};
    console.log('[payments][icredit][ipn]', JSON.stringify(payload).slice(0, 2000));
    // TODO: verify authenticity and update order status accordingly
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, message: e?.message || 'ipn_error' });
  }
});

export default router;
