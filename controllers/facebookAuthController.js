// Minimal Facebook auth placeholder.
// Mobile app may call /api/auth/facebook with { accessToken }.
// This stub returns a clear message indicating Facebook auth is not configured.
// Later, integrate Facebook Graph API token verification and user provisioning.
export const facebookAuth = async (req, res) => {
  try {
    const accessToken = req.body?.accessToken;
    if (!accessToken) {
      return res.status(400).json({ message: 'Missing accessToken' });
    }
    return res.status(501).json({ message: 'Facebook auth not configured' });
  } catch (e) {
    return res.status(500).json({ message: 'Facebook auth failed' });
  }
};
