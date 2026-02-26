const express = require('express');
const jwt = require('jsonwebtoken');
const Order = require('../models/Order');
const Cart = require('../models/Cart');
const User = require('../models/User');

const router = express.Router();

// Middleware to verify token and get userId
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (error) {
    res.status(403).json({ error: 'Invalid token' });
  }
};

// GET user's cart
router.get('/cart', authenticateToken, async (req, res) => {
  try {
    console.log('[GET /cart] userId=', req.userId);
    const userCart = await Cart.findOne({ userId: req.userId });
    
    if (!userCart) {
      return res.json({ items: [], subtotal: 0, deliveryFee: 5.0, total: 5.0 });
    }

    res.json(userCart);
  } catch (error) {
    console.error('Get cart error:', error);
    res.status(500).json({ error: 'Failed to retrieve cart' });
  }
});

// POST/UPDATE user's cart
router.post('/cart', authenticateToken, async (req, res) => {
  try {
    console.log('[POST /cart] userId=', req.userId, 'body=', JSON.stringify(req.body).slice(0,1000));
    const { items } = req.body;

    if (!Array.isArray(items)) {
      return res.status(400).json({ error: 'Items must be an array' });
    }

    // Calculate subtotal
    const subtotal = items.reduce((sum, item) => sum + item.price * item.qty, 0);
    const deliveryFee = 5.0;
    const total = subtotal + deliveryFee;

    const updatedCart = await Cart.findOneAndUpdate(
      { userId: req.userId },
      {
        userId: req.userId,
        items,
        subtotal,
        deliveryFee,
        total,
        lastUpdated: new Date(),
      },
      { upsert: true, new: true }
    );

    res.json(updatedCart);
  } catch (error) {
    console.error('Save cart error:', error);
    res.status(500).json({ error: 'Failed to save cart' });
  }
});

// DELETE/Clear user's cart
router.delete('/cart', authenticateToken, async (req, res) => {
  try {
    await Cart.findOneAndDelete({ userId: req.userId });
    res.json({ message: 'Cart cleared' });
  } catch (error) {
    console.error('Clear cart error:', error);
    res.status(500).json({ error: 'Failed to clear cart' });
  }
});

// POST create an order (checkout)
router.post('/orders', authenticateToken, async (req, res) => {
  try {
    console.log('[POST /orders] userId=', req.userId, 'body=', JSON.stringify(req.body).slice(0,1000));
    const { items, total, shippingAddress, paymentMethod } = req.body;

    if (!items || !total) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Get user info
    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Generate unique order number
    const timestamp = Date.now();
    const randomDigits = Math.floor(Math.random() * 900 + 100);
    const orderNumber = `o${timestamp}${randomDigits}`;

    // Ensure each item has a subtotal field and valid qty
    const itemsWithSubtotal = items.map(it => {
      const qty = Number(it.qty) > 0 ? Number(it.qty) : 1;
      const price = Number(it.price) || 0;
      return {
        product: it.product,
        price,
        qty,
        type: it.type || 'individual',
        subtotal: parseFloat((price * qty).toFixed(2)),
      };
    });

    // Calculate subtotal
    const subtotal = itemsWithSubtotal.reduce((sum, item) => sum + item.subtotal, 0);

    // Sanitize shippingAddress. Prefer server-side user profile values (authoritative),
    // but allow client-provided fields to override when explicitly present.
    const sa = shippingAddress || {};
    console.log('[POST /orders] incoming shippingAddress:', sa);
    const sanitizedShipping = {
      name: (user.name || sa.name || '').toString().trim(),
      email: (user.email || sa.email || '').toString().trim(),
      phone: (user.phone || sa.phone || '').toString().trim(),
      address: (user.address || sa.address || '').toString().trim(),
    };
    console.log('[POST /orders] sanitizedShipping (after preferring DB user):', sanitizedShipping);

    if (!sanitizedShipping.name || !sanitizedShipping.email || !sanitizedShipping.phone || !sanitizedShipping.address) {
      return res.status(400).json({ error: 'Incomplete shipping information' });
    }

    // Create order
    const newOrder = new Order({
      userId: req.userId,
      orderNumber,
      items: itemsWithSubtotal,
      subtotal,
      deliveryFee: 5.0,
      total,
      status: 'pending',
      shippingAddress: sanitizedShipping,
      paymentStatus: 'unpaid',
      paymentMethod: paymentMethod || 'cash_on_delivery',
    });

    await newOrder.save();

    // Clear user's cart after successful order
    await Cart.findOneAndDelete({ userId: req.userId });

    res.status(201).json({
      message: 'Order created successfully',
      order: newOrder,
    });
  } catch (error) {
    console.error('Create order error:', error);
    res.status(500).json({ error: 'Failed to create order' });
  }
});

// GET user's orders
router.get('/orders', authenticateToken, async (req, res) => {
  try {
    const orders = await Order.find({ userId: req.userId }).sort({ createdAt: -1 });
    res.json(orders);
  } catch (error) {
    console.error('Get orders error:', error);
    res.status(500).json({ error: 'Failed to retrieve orders' });
  }
});

// GET single order by ID
router.get('/orders/:orderId', authenticateToken, async (req, res) => {
  try {
    const order = await Order.findOne({ _id: req.params.orderId, userId: req.userId });
    
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    res.json(order);
  } catch (error) {
    console.error('Get order error:', error);
    res.status(500).json({ error: 'Failed to retrieve order' });
  }
});

// PUT update order status (admin or user)
router.put('/orders/:orderId', authenticateToken, async (req, res) => {
  try {
    const { status, paymentStatus, trackingNumber } = req.body;

    const order = await Order.findOne({ _id: req.params.orderId, userId: req.userId });
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (status) order.status = status;
    if (paymentStatus) order.paymentStatus = paymentStatus;
    if (trackingNumber) order.trackingNumber = trackingNumber;

    await order.save();
    res.json(order);
  } catch (error) {
    console.error('Update order error:', error);
    res.status(500).json({ error: 'Failed to update order' });
  }
});

module.exports = router;
