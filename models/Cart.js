const mongoose = require('mongoose');

const cartSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    items: [
      {
        product: { type: String, required: true },
        price: { type: Number, required: true },
        qty: { type: Number, required: true, min: 1 },
        type: { type: String, enum: ['individual', 'bulk'], default: 'individual' },
        name: { type: String },
        img: { type: String },
      },
    ],
    subtotal: { type: Number, default: 0 },
    deliveryFee: { type: Number, default: 5.0 },
    total: { type: Number, default: 0 },
    lastUpdated: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// Update total whenever items change
cartSchema.pre('save', function (next) {
  this.subtotal = this.items.reduce((sum, item) => sum + item.price * item.qty, 0);
  this.total = this.subtotal + this.deliveryFee;
  this.lastUpdated = new Date();
  next();
});

module.exports = mongoose.model('Cart', cartSchema);
