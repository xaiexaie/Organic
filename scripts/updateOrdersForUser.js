// Usage:
// node scripts/updateOrdersForUser.js --userId=692f1c7938d55cef3d595846 [--name="kenneth" --email="kenneth@example.com" --phone="0909090909" --address="123 main st blk 10"] [--apply]
// If no explicit name/email/phone/address are provided, the script will use the server User record.
// Without --apply the script will do a dry-run and print affected orders.

require('dotenv').config();
const mongoose = require('mongoose');
const path = require('path');

// Ensure models can be required relative to this file
const Order = require(path.join(__dirname, '..', 'models', 'Order'));
const User = require(path.join(__dirname, '..', 'models', 'User'));

function parseArgs() {
  const args = {};
  process.argv.slice(2).forEach(arg => {
    if (arg.startsWith('--')) {
      const [key, ...rest] = arg.slice(2).split('=');
      const value = rest.length ? rest.join('=') : true;
      args[key] = value === 'true' ? true : value === 'false' ? false : value;
    }
  });
  return args;
}

(async function main(){
  const args = parseArgs();
  const userId = args.userId;
  const apply = !!args.apply;
  const explicit = {
    name: args.name,
    email: args.email,
    phone: args.phone,
    address: args.address,
  };

  if (!userId) {
    console.error('ERROR: --userId is required.');
    process.exit(1);
  }

  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/fruit-market';
  console.log('Connecting to', uri);
  await mongoose.connect(uri, { useNewUrlParser: true, useUnifiedTopology: true });

  try {
    // Find affected orders
    const orders = await Order.find({ userId }).select('_id shippingAddress orderNumber').lean();
    console.log(`Found ${orders.length} order(s) for userId=${userId}`);
    if (orders.length === 0) {
      console.log('No orders to update. Exiting.');
      process.exit(0);
    }

    // Show sample current shippingAddresses
    orders.slice(0, 10).forEach(o => {
      console.log(`- order ${o._id} (${o.orderNumber || ''}) current shipping:`, o.shippingAddress || null);
    });

    // Determine new shipping values
    let newShipping = {};
    const haveExplicit = explicit.name || explicit.email || explicit.phone || explicit.address;
    if (haveExplicit) {
      newShipping = {
        name: explicit.name || '',
        email: explicit.email || '',
        phone: explicit.phone || '',
        address: explicit.address || '',
      };
      console.log('Using explicit values provided on command line for shippingAddress.');
    } else {
      // Fetch server User doc
      const user = await User.findById(userId).lean();
      if (!user) {
        console.error('User not found in users collection and no explicit shipping provided. Aborting.');
        process.exit(1);
      }
      newShipping = {
        name: user.name || '',
        email: user.email || '',
        phone: user.phone || '',
        address: user.address || '',
      };
      console.log('Using server User document values for shippingAddress:', newShipping);
    }

    if (!apply) {
      console.log('\nDRY RUN: to apply these changes re-run with --apply');
      console.log('Will set shippingAddress for all above orders to:');
      console.log(newShipping);
      await mongoose.disconnect();
      process.exit(0);
    }

    // Perform update
    const res = await Order.updateMany({ userId }, { $set: { shippingAddress: newShipping } });
    console.log(`updateMany matched ${res.matchedCount || res.n || 0}, modified ${res.modifiedCount || res.nModified || 0}`);

    // Show post-update sample
    const updated = await Order.find({ userId }).select('_id shippingAddress orderNumber').lean();
    updated.slice(0, 10).forEach(o => {
      console.log(`- order ${o._id} (${o.orderNumber || ''}) new shipping:`, o.shippingAddress || null);
    });

    console.log('Done.');
    await mongoose.disconnect();
  } catch (err) {
    console.error('Error during migration:', err);
    await mongoose.disconnect();
    process.exit(1);
  }
})();
