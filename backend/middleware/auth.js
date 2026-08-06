import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'inachis-dev-secret-change-in-production';

export class AuthMiddleware {
  static verifyToken(req, res, next) {
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    try {
      req.user = jwt.verify(token, JWT_SECRET);
      next();
    } catch (error) {
      return res.status(401).json({ error: 'Invalid token' });
    }
  }

  static adminOnly(req, res, next) {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    next();
  }

  static friendOnly(req, res, next) {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (req.user.role !== 'friend') {
      return res.status(403).json({ error: 'Friend access required' });
    }
    next();
  }
}
