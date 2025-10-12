import jwt from 'jsonwebtoken';
import User from '../models/User.js';

export const auth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      throw new Error('No authentication token provided');
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId);
    
    if (!user) {
      throw new Error('User not found');
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('Authentication error:', error);
    res.status(401).json({ 
      message: 'Authentication failed: ' + error.message 
    });
  }
};

export const adminAuth = async (req, res, next) => {
  console.log('adminAuth middleware called for:', req.method, req.path);
  console.log('Authorization header:', req.header('Authorization'));
  
  try {
    await auth(req, res, () => {
      console.log('User role check:', req.user?.role);
      if (req.user?.role !== 'admin') {
        console.log('User is not admin, rejecting request');
        return res.status(403).json({ 
          message: 'Admin access required' 
        });
      }
      console.log('Admin auth successful, proceeding to controller');
      next();
    });
  } catch (error) {
    console.error('Admin auth error:', error);
    res.status(403).json({ 
      message: 'Admin access required' 
    });
  }
};