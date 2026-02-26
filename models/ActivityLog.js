const mongoose = require('mongoose');

const activityLogSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    userName: { type: String, required: true },
    userEmail: { type: String, required: true },
    action: { type: String, required: true }, // 'login', 'logout', 'add_to_cart', 'checkout', 'view_profile'
    details: { type: Object }, // cart items, order details, etc.
    timestamp: { type: Date, default: Date.now },
    ipAddress: { type: String },
  },
  { timestamps: true }
);

module.exports = mongoose.model('ActivityLog', activityLogSchema);
