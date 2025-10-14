import express from 'express';

// Minimal translation endpoint placeholder.
// Accepts { text, to, from } and echoes back text. This avoids 404s from mobile app
// and can be upgraded later to call a translation service.
const router = express.Router();

router.post('/', async (req, res) => {
  try {
    const text = typeof req.body?.text === 'string' ? req.body.text : '';
    // Optional: simple identity mapping; in future integrate translation provider here.
    return res.json({ text });
  } catch (e) {
    return res.status(500).json({ message: 'translate_failed' });
  }
});

export default router;
