const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const ActivityLog = require('../models/ActivityLog');

const router = express.Router();

// Signup
router.post('/signup', async (req, res) => {
  try {
    const { name, email, phone, address, password, confirmPassword } = req.body;

    // Validation
    if (!name || !email || !phone || !address || !password || !confirmPassword) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ error: 'Passwords do not match' });
    }

    // Check if user exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Create user
    const newUser = new User({
      name,
      email,
      phone,
      address,
      password: hashedPassword,
    });

    await newUser.save();

    // Log signup activity server-side so activity logs reflect new accounts
    try {
      await ActivityLog.create({
        userId: newUser._id,
        userName: newUser.name,
        userEmail: newUser.email,
        action: 'signup',
        timestamp: new Date(),
        ipAddress: req.headers['x-forwarded-for'] || req.ip || req.connection.remoteAddress,
      });
    } catch (logErr) {
      console.warn('Failed to create signup activity log:', logErr);
    }

    // Create JWT token
    const token = jwt.sign(
      { userId: newUser._id, email: newUser.email },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({
      message: 'Account created successfully',
      token,
      user: {
        id: newUser._id,
        name: newUser.name,
        email: newUser.email,
        phone: newUser.phone,
        address: newUser.address,
        joined: newUser.createdAt,
      },
    });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ error: 'Server error during signup' });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = jwt.sign(
      { userId: user._id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Log login activity (include IP address when available)
    await ActivityLog.create({
      userId: user._id,
      userName: user.name,
      userEmail: user.email,
      action: 'login',
      timestamp: new Date(),
      ipAddress: req.headers['x-forwarded-for'] || req.ip || req.connection.remoteAddress,
    });

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        address: user.address,
        joined: user.createdAt,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Server error during login' });
  }
});

// Get profile (requires token)
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('-password');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ user });
  } catch (error) {
    console.error('Profile error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update profile (requires token)
router.put('/profile', authenticateToken, async (req, res) => {
  try {
    const { name, email, phone, address } = req.body;
    const user = await User.findByIdAndUpdate(
      req.userId,
      { name, email, phone, address },
      { new: true }
    ).select('-password');
    res.json({ message: 'Profile updated', user });
  } catch (error) {
    console.error('Update error:', error);
    res.status(500).json({ error: 'Server error during update' });
  }
});

// Logout - log activity
router.post('/logout', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (user) {
      await ActivityLog.create({
        userId: user._id,
        userName: user.name,
        userEmail: user.email,
        action: 'logout',
        timestamp: new Date(),
        ipAddress: req.headers['x-forwarded-for'] || req.ip || req.connection.remoteAddress,
      });
    }
    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Logout error' });
  }
});

// Log cart activity
router.post('/log-activity', authenticateToken, async (req, res) => {
  try {
    const { action, details } = req.body;
    const user = await User.findById(req.userId);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Valid actions: add_to_cart, checkout, view_profile, etc.
    await ActivityLog.create({
      userId: user._id,
      userName: user.name,
      userEmail: user.email,
      action,
      details,
      timestamp: new Date(),
      ipAddress: req.headers['x-forwarded-for'] || req.ip || req.connection.remoteAddress,
    });

    res.json({ message: 'Activity logged' });
  } catch (error) {
    console.error('Activity log error:', error);
    res.status(500).json({ error: 'Activity logging error' });
  }
});

// Get activity logs (admin/user viewing their logs)
router.get('/activity-logs', authenticateToken, async (req, res) => {
  try {
    const logs = await ActivityLog.find({ userId: req.userId }).sort({ timestamp: -1 }).limit(50);
    res.json({ logs });
  } catch (error) {
    console.error('Get logs error:', error);
    res.status(500).json({ error: 'Could not retrieve logs' });
  }
});

// Get all activity logs (admin only)
router.get('/all-activity-logs', authenticateToken, async (req, res) => {
  try {
    const logs = await ActivityLog.find().sort({ timestamp: -1 }).limit(100);
    res.json({ logs });
  } catch (error) {
    console.error('Get all logs error:', error);
    res.status(500).json({ error: 'Could not retrieve logs' });
  }
});

// Middleware to verify JWT token
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid token' });
    }
    req.userId = decoded.userId;
    next();
  });
}

module.exports = router;
