/* ---------------------------
   API CONFIG & AUTH
--------------------------- */
const API_BASE = 'http://localhost:5000/api';

// Check if user is logged in
function isLoggedIn() {
  return !!localStorage.getItem('token');
}

// Get current user from localStorage
function getCurrentUser() {
  const userStr = localStorage.getItem('user');
  return userStr ? JSON.parse(userStr) : null;
}

// Allow public access to most pages - only checkout requires login
function checkoutRequiresLogin() {
  const currentPage = window.location.pathname.split('/').pop() || 'index.html';
  const isCheckoutPage = currentPage === 'checkout.html';
  
  // Only redirect from checkout page if not logged in
  // All other pages are publicly accessible
  // We'll handle this in the checkout page directly
}

// Run an immediate check - no longer blocking public pages
try {
  checkoutRequiresLogin();
} catch (err) {
  // ignore errors during initial load
}

// Log user activity to backend (buffers when not logged in)
async function logActivity(action, details = {}) {
  const token = localStorage.getItem('token');
  const payload = { action, details, timestamp: new Date() };

  if (!token) {
    // buffer locally until user logs in
    const pending = JSON.parse(localStorage.getItem('pendingActivityLogs') || '[]');
    pending.push(payload);
    localStorage.setItem('pendingActivityLogs', JSON.stringify(pending));
    return;
  }

  try {
    await fetch(`${API_BASE}/auth/log-activity`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ action, details }),
    });
  } catch (error) {
    console.error('Activity logging error:', error);
  }
}

// Flush buffered activity logs after login/signup
// (kept single implementation later in file)

// Flush any buffered activity logs after login/signup
async function flushPendingActivities() {
  const pending = JSON.parse(localStorage.getItem('pendingActivityLogs') || '[]');
  if (!pending.length) return;

  const token = localStorage.getItem('token');
  if (!token) return;

  for (const p of pending) {
    try {
      await fetch(`${API_BASE}/auth/log-activity`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ action: p.action, details: p.details }),
      });
    } catch (err) {
      console.warn('Failed to flush activity', err);
    }
  }

  localStorage.removeItem('pendingActivityLogs');
}

// Call on page load to initialize authentication and UI
document.addEventListener('DOMContentLoaded', () => {
  // No longer blocking pages, just initialize session if available
  // If user already logged in, flush any buffered activities automatically
  if (isLoggedIn()) {
    flushPendingActivities().catch(err => console.warn('Failed to flush pending activities on load', err));
  }
  
  // Initialize UI based on login status
  updateUIForLoginStatus();
});

/* ---------------------------
   CART STATE MANAGEMENT
--------------------------- */

// Always reload cart from localStorage to ensure sync across page navigation
function loadCart() {
  try {
    return JSON.parse(localStorage.getItem('cart')) || [];
  } catch (err) {
    console.warn('Failed to parse cart from localStorage, resetting cart', err);
    localStorage.removeItem('cart');
    return [];
  }
}

let cart = loadCart();

// Normalize cart shape in case an object with `items` was stored previously
if (!Array.isArray(cart) && cart && Array.isArray(cart.items)) {
  cart = cart.items;
  try { localStorage.setItem('cart', JSON.stringify(cart)); } catch (e) { /* ignore */ }
}

// Ensure UI reflects the stored cart on every page load
document.addEventListener('DOMContentLoaded', () => {
  try {
    cart = loadCart();
    if (!Array.isArray(cart) && cart && Array.isArray(cart.items)) cart = cart.items;
  } catch (e) { cart = []; }

  // If we're on the cart page, render the items and show the table
  const hasCartBody = !!document.getElementById('cartBody');
  if (hasCartBody) {
    if (Array.isArray(cart) && cart.length > 0) {
      try { renderCart(); } catch (err) { console.warn('renderCart error on load', err); }
      const cartDisplay = document.getElementById('cartDisplay');
      const cartTable = document.getElementById('cartTable');
      if (cartDisplay) cartDisplay.style.display = 'none';
      if (cartTable) cartTable.style.display = 'block';
    } else {
      // ensure empty state visible
      const cartDisplay = document.getElementById('cartDisplay');
      const cartTable = document.getElementById('cartTable');
      if (cartDisplay) cartDisplay.style.display = 'block';
      if (cartTable) cartTable.style.display = 'none';
    }
  }

  // Update badge/count
  try { updateCartCount(); } catch (err) { console.warn('updateCartCount failed', err); }
});

function updateCartCount() {
  // Reload cart from localStorage to ensure we have the latest state
  cart = loadCart();
  let count = 0;
  if (Array.isArray(cart)) {
    count = cart.reduce((sum, item) => sum + (Number(item.qty) || 0), 0);
  } else if (cart && Array.isArray(cart.items)) {
    count = cart.items.reduce((sum, item) => sum + (Number(item.qty) || 0), 0);
  }
  const cartBadge = document.getElementById('cartBadge');
  if (cartBadge) {
    if (count > 0) {
      cartBadge.textContent = count;
      cartBadge.style.display = 'inline-block';
    } else {
      cartBadge.style.display = 'none';
    }
  }
}

function saveCart() {
  localStorage.setItem('cart', JSON.stringify(cart));
  updateCartCount();
}

async function syncCartToServer() {
  const token = localStorage.getItem('token');
  if (!token) return; // only sync for authenticated users

  try {
    const resp = await fetch(`${API_BASE}/cart`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ items: cart }),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(()=>null);
      console.error('syncCartToServer failed', resp.status, text);
      return { ok: false, status: resp.status, body: text };
    }
    return { ok: true };
  } catch (err) {
    console.warn('Failed to sync cart to server:', err);
    return { ok: false, error: err };
  }
}

function addToCart(product, price, type = 'individual', img = null, name = null) {
  const existing = cart.find(item => item.product === product && item.type === type);
  if (existing) {
    existing.qty += 1;
  } else {
    cart.push({ product, price: parseFloat(price), qty: 1, type, img: img || `${product}.svg`, name: name || product });
  }
  saveCart();

  // Log cart activity with type and qty
  const qty = existing ? existing.qty : 1;
  try {
    logActivity('add_to_cart', { product, price: parseFloat(price), type, qty });
  } catch (err) {
    console.error('logActivity error (addToCart):', err);
  }

  // Attempt to sync to server if user is logged in
  const token = localStorage.getItem('token');
  if (token) {
    syncCartToServer();
  } else {
    // store pending cart to flush after login
    localStorage.setItem('pendingCart', JSON.stringify(cart));
  }
}

function showToast(message){
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = message;
  document.body.appendChild(t);
  // force reflow then show
  requestAnimationFrame(()=> t.classList.add('show'));
  setTimeout(()=>{ t.classList.remove('show'); setTimeout(()=> t.remove(),220); },1200);
}

/* ---------------------------
   LOGIN MODAL FOR CHECKOUT
--------------------------- */
// modalPostLoginRedirect: stores where to go after successful modal login
let modalPostLoginRedirect = null;
function showCheckoutLoginModal(redirect = 'checkout.html', title = 'Proceed to Checkout', message = 'You need to log in first to complete your order.') {
  modalPostLoginRedirect = redirect;
  const existingModal = document.getElementById('checkoutLoginModal');
  if (existingModal) {
    // update title/message if provided
    existingModal.querySelector('.modal-title').textContent = title;
    existingModal.querySelector('.modal-message').textContent = message;
    existingModal.style.display = 'flex';
    return;
  }

  const modal = document.createElement('div');
  modal.id = 'checkoutLoginModal';
  modal.className = 'checkout-login-modal';
  modal.innerHTML = `
    <div class="modal-content">
      <button class="modal-close" onclick="closeCheckoutLoginModal()">&times;</button>
      <div class="modal-inner">
        <h2 class="modal-title">${title}</h2>
        <p class="modal-message">${message}</p>
        
        <form id="checkoutLoginForm" class="modal-form">
          <div class="form-group">
            <label for="checkoutLoginEmail">Email</label>
            <input type="email" id="checkoutLoginEmail" placeholder="you@example.com" required>
          </div>
          <div class="form-group">
            <label for="checkoutLoginPassword">Password</label>
            <input type="password" id="checkoutLoginPassword" placeholder="Password" required>
          </div>
          <div id="checkoutLoginError" class="error-message"></div>
          <button type="submit" class="btn primary" style="width:100%;margin-top:12px;">Login</button>
        </form>
        
        <div class="modal-divider">OR</div>
        
        <button id="checkoutSignupBtn" class="btn outline" style="width:100%;margin-bottom:12px;">
          Create an Account
        </button>
        
        <p class="modal-footer">Don't worry, your cart items will be saved!</p>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Add event listeners
  document.getElementById('checkoutLoginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    await performCheckoutLogin();
  });
  
  document.getElementById('checkoutSignupBtn').addEventListener('click', () => {
    closeCheckoutLoginModal();
    window.location.href = 'signup.html';
  });
}

function closeCheckoutLoginModal() {
  const modal = document.getElementById('checkoutLoginModal');
  if (modal) {
    modal.style.display = 'none';
  }
}

async function performCheckoutLogin() {
  const email = document.getElementById('checkoutLoginEmail').value.trim();
  const password = document.getElementById('checkoutLoginPassword').value.trim();
  const errorEl = document.getElementById('checkoutLoginError');
  
  if (!email || !password) {
    errorEl.textContent = 'Please fill out all fields.';
    return;
  }
  
  try {
    const response = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    let data = null;
    try { data = await response.json(); } catch (e) { data = null; }

    const backendSuccess = (data && (data.success === true || data.token)) || response.ok;
    if (!backendSuccess) {
      const msg = (data && (data.error || data.message)) || 'Wrong username or password.';
      errorEl.textContent = msg;
      return;
    }

    // Save token and user if available
    if (data && data.token) localStorage.setItem('token', data.token);
    if (data && data.user) localStorage.setItem('user', JSON.stringify(data.user));
    
    // Flush any buffered activities
    await flushPendingActivities();
    
    // Handle pending cart merge
    try {
      const pending = JSON.parse(localStorage.getItem('pendingCart') || 'null');
      if (pending && Array.isArray(pending) && pending.length) {
        const r = await fetch(`${API_BASE}/cart`, {
          headers: { 'Authorization': `Bearer ${data.token}` },
        });
        let serverCart = [];
        if (r.ok) {
          const serverJson = await r.json();
          serverCart = Array.isArray(serverJson.items) ? serverJson.items : [];
        }
        
        const map = new Map();
        const keyFor = it => `${it.product}||${it.type}`;
        [...serverCart, ...pending].forEach(it => {
          const k = keyFor(it);
          const existing = map.get(k) || { ...it, qty: 0 };
          existing.qty = (existing.qty || 0) + (Number(it.qty) || 0);
          existing.price = Number(it.price) || existing.price || 0;
          existing.type = it.type || existing.type;
          existing.name = it.name || existing.name;
          existing.img = it.img || existing.img;
          map.set(k, existing);
        });
        
        const merged = Array.from(map.values());
        
        const resp = await fetch(`${API_BASE}/cart`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${data.token}`,
          },
          body: JSON.stringify({ items: merged }),
        });
        
        if (resp.ok) {
          localStorage.removeItem('pendingCart');
          cart = merged;
          saveCart();
        }
      }
    } catch (err) {
      console.warn('Failed to flush pending cart on checkout login:', err);
    }
    
    // Close modal and redirect to desired page (modalPostLoginRedirect)
    closeCheckoutLoginModal();
    updateUIForLoginStatus();
    const dest = modalPostLoginRedirect || 'checkout.html';
    // clear redirect so next modal defaults still work
    modalPostLoginRedirect = null;
    window.location.href = dest;
  } catch (error) {
    console.error('Checkout login error:', error);
    errorEl.textContent = 'Network error. Please try again.';
  }
}

/* ---------------------------
   UI UPDATE FOR LOGIN STATUS
--------------------------- */
function updateUIForLoginStatus() {
  // Update logout button visibility
  const logoutBtns = document.querySelectorAll('#logoutBtn');
  logoutBtns.forEach(btn => {
    btn.style.display = isLoggedIn() ? 'block' : 'none';
  });
}

function handleCheckoutClick() {
  if (isLoggedIn()) {
    window.location.href = 'checkout.html';
  } else {
    showCheckoutLoginModal('checkout.html', 'Proceed to Checkout', 'You need to log in first to complete your order.');
  }
}

function filterProducts(){
  const q = (document.getElementById('searchInput')?.value || '').toLowerCase().trim();
  const activeCatEl = document.querySelector('.cat-item.active');
  const activeTypeEl = document.querySelector('.type-item.active');
  const cat = activeCatEl ? activeCatEl.dataset.cat : 'All';
  const type = activeTypeEl ? activeTypeEl.dataset.type : 'individual';
  const cards = document.querySelectorAll('#productsArea .card');
  cards.forEach(card => {
    const title = (card.querySelector('.card-title')?.textContent || '').toLowerCase();
    const cardCat = card.dataset.category || (card.closest('.category-section')?.dataset.cat) || 'All';
    const cardType = card.dataset.type || 'individual';
    const matchesQuery = !q || title.includes(q);
    const matchesCat = cat === 'All' || cardCat === cat || cardCat === 'All';
    const matchesType = !type || cardType === type;
    if (matchesQuery && matchesCat && matchesType) card.style.display = '';
    else card.style.display = 'none';
  });
}


// Attach listeners to all "Add to Cart" buttons
document.addEventListener('DOMContentLoaded', async () => {
  // If logged in, try to load authoritative cart from server first
  if (isLoggedIn()) {
    try {
      const resp = await fetch(`${API_BASE}/cart`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` },
      });
      if (resp.ok) {
        const serverCart = await resp.json();
        if (serverCart && Array.isArray(serverCart.items) && serverCart.items.length) {
          cart = serverCart.items;
          saveCart();
        }
      }
    } catch (err) {
      console.warn('Failed to load server cart on load:', err);
    }
  }

  updateCartCount();
  const addBtns = document.querySelectorAll('.add-to-cart');
  addBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      const card = e.target.closest('.card');
      const product = card.dataset.product;
      const price = card.dataset.price;
      const type = card.dataset.type || 'individual';
      // prefer the actual <img> src from the card so filenames/paths match
      const cardImgEl = card.querySelector('img.card-img');
      const img = cardImgEl ? cardImgEl.getAttribute('src') : (card.dataset.img || `${product}.svg`);
      const name = card.dataset.name || product;
      addToCart(product, price, type, img, name);
      // Show toast notification
      showToast('✓ Added to cart!');
    });
  });

  // Wire up search input if present
  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    searchInput.addEventListener('input', () => filterProducts());
  }

  // Wire up product-type segmented control
  const typeItems = document.querySelectorAll('.type-item');
  if (typeItems.length) {
    typeItems.forEach(item => {
      item.addEventListener('click', (e) => {
        typeItems.forEach(i => i.classList.remove('active'));
        e.currentTarget.classList.add('active');
        filterProducts();
      });
    });
  }

  // Wire up category toggle buttons (Fruits / Vegetables)
  const catItems = document.querySelectorAll('.cat-item');
  if (catItems.length) {
    catItems.forEach(item => {
      item.addEventListener('click', (e) => {
        catItems.forEach(i => i.classList.remove('active'));
        e.currentTarget.classList.add('active');
        filterProducts();
      });
    });
  }

  // Run an initial filter pass so grid respects controls on load
  filterProducts();

  // Render cart page if on cart.html
  if (document.getElementById('cartBody')) {
    renderCart();
  }
});

function renderCart() {
  // Reload cart from localStorage to ensure we have the latest state
  cart = loadCart();
  
  const cartBody = document.getElementById('cartBody');
  const cartDisplay = document.getElementById('cartDisplay');
  const cartTable = document.getElementById('cartTable');
  const cartSummary = document.getElementById('cartSummary');
  const subtotalEl = document.getElementById('subtotal');
  const deliveryEl = document.getElementById('delivery');
  const totalEl = document.getElementById('cartTotal');

  if (cart.length === 0) {
    cartDisplay.style.display = 'block';
    cartTable.style.display = 'none';
    if (cartSummary) cartSummary.textContent = '0 items';
    return;
  }

  cartDisplay.style.display = 'none';
  cartTable.style.display = 'block';
  cartBody.innerHTML = '';
  let subtotal = 0;
  const deliveryFee = 5.00;

  cart.forEach((item, idx) => {
    const itemTotal = item.price * item.qty;
    subtotal += itemTotal;
    const row = document.createElement('div');
    row.className = 'cart-row';
    row.style.cssText = 'display:flex;align-items:center;gap:12px;padding:14px;border-bottom:1px solid #eee;background:#fff;border-radius:8px;margin-bottom:8px';
    // item.img stores the actual src attribute (e.g. 'Images/Fruits/juicy-orange.png')
    const imgSrc = item.img ? item.img : `Images/${item.product}.svg`;
    row.innerHTML = `
      <img src="${imgSrc}" alt="${item.product}" style="width:60px;height:60px;object-fit:contain;background:#f5f5f5;border-radius:6px;padding:4px;">
      <div style="flex:1;">
        <p style="font-weight:600;margin:0 0 4px 0;">${(item.name || (item.product.charAt(0).toUpperCase() + item.product.slice(1)))}</p>
        <p style="font-size:12px;color:#666;margin:0;">${(item.type || 'individual').charAt(0).toUpperCase() + (item.type || 'individual').slice(1)}</p>
      </div>
      <div style="display:flex;align-items:center;gap:8px;background:#f5f5f5;border-radius:6px;padding:4px 8px;">
        <button class="qty-btn-minus" data-idx="${idx}" style="background:none;border:none;cursor:pointer;font-size:16px;padding:0 4px;">−</button>
        <span style="min-width:30px;text-align:center;font-weight:600;">${item.qty}</span>
        <button class="qty-btn-plus" data-idx="${idx}" style="background:none;border:none;cursor:pointer;font-size:16px;padding:0 4px;">+</button>
      </div>
      <p style="min-width:70px;text-align:right;font-weight:600;margin:0;">$${itemTotal.toFixed(2)}</p>
      <button class="remove-item" data-idx="${idx}" style="background:#e74c3c;color:#fff;border:none;padding:6px 8px;border-radius:4px;cursor:pointer;font-size:16px;">×</button>
    `;
    cartBody.appendChild(row);
  });

  if (cartSummary) cartSummary.textContent = `${cart.length} item${cart.length > 1 ? 's' : ''}`;
  const total = subtotal + deliveryFee;
  if (subtotalEl) subtotalEl.textContent = subtotal.toFixed(2);
  if (deliveryEl) deliveryEl.textContent = deliveryFee.toFixed(2);
  if (totalEl) totalEl.textContent = total.toFixed(2);

  // Attach qty and remove listeners
  document.querySelectorAll('.qty-btn-plus').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(e.target.dataset.idx);
      cart[idx].qty += 1;
      saveCart();
      // keep server copy in sync when user is authenticated
      try { if (localStorage.getItem('token')) syncCartToServer(); } catch (err) { /* ignore */ }
      // Log update_cart event
      try {
        logActivity('update_cart', {
          product: cart[idx].product,
          price: cart[idx].price,
          qty: cart[idx].qty
        });
      } catch (err) {
        console.error('logActivity error (plus):', err);
      }
      renderCart();
    });
  });

  document.querySelectorAll('.qty-btn-minus').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(e.target.dataset.idx);
      if (cart[idx].qty > 1) {
        cart[idx].qty -= 1;
        // Log update_cart event for quantity decrease
        try {
          logActivity('update_cart', {
            product: cart[idx].product,
            price: cart[idx].price,
            qty: cart[idx].qty
          });
        } catch (err) {
          console.error('logActivity error (minus):', err);
        }
      } else {
        // Log remove_from_cart event when deleting the last qty
        try {
          logActivity('remove_from_cart', {
            product: cart[idx].product,
            price: cart[idx].price
          });
        } catch (err) {
          console.error('logActivity error (remove on minus):', err);
        }
        cart.splice(idx, 1);
      }
      saveCart();
      try { if (localStorage.getItem('token')) syncCartToServer(); } catch (err) { /* ignore */ }
      renderCart();
    });
  });

  document.querySelectorAll('.remove-item').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(e.target.dataset.idx);
      // Log remove_from_cart event
      try {
        logActivity('remove_from_cart', {
          product: cart[idx].product,
          price: cart[idx].price,
          qty: cart[idx].qty
        });
      } catch (err) {
        console.error('logActivity error (remove button):', err);
      }
      cart.splice(idx, 1);
      saveCart();
      try { if (localStorage.getItem('token')) syncCartToServer(); } catch (err) { /* ignore */ }
      renderCart();
    });
  });
}

/* ---------------------------
   PROFILE PAGE
--------------------------- */

let user = JSON.parse(localStorage.getItem('user')) || null;

function saveUser() {
  if (!user) return;
  localStorage.setItem('user', JSON.stringify(user));
  try {
    // keep checkoutUser in sync so checkout autofill doesn't show stale values
    localStorage.setItem('checkoutUser', JSON.stringify(user));
  } catch (err) {
    console.warn('Failed to update checkoutUser during saveUser:', err);
  }
}

function renderProfile() {
  const isLoggedIn_Profile = isLoggedIn();
  const profileNameEl = document.getElementById('profileName');
  const profileEmailEl = document.getElementById('profileEmail');
  const profilePhoneEl = document.getElementById('profilePhone');
  const profileAddressEl = document.getElementById('profileAddress');
  const profileJoinedEl = document.getElementById('profileJoined');
  const editBtn = document.getElementById('editProfileBtn');
  const loginPromptContainer = document.getElementById('loginPromptContainer');
  const editProfileForm = document.getElementById('editProfileForm');
  const accountInfoPlaceholder = document.getElementById('accountInfoPlaceholder');
  const accountInfoGrid = document.getElementById('accountInfoGrid');
  const settingsSection = document.getElementById('settingsSection');
  const orderHistorySection = document.getElementById('orderHistory');
  const deleteModal = document.getElementById('deleteModal');

  if (!isLoggedIn_Profile) {
    // Show placeholder UI for not logged in
    if (profileNameEl) profileNameEl.textContent = 'Guest User';
    if (profileEmailEl) profileEmailEl.textContent = 'Log in to see your email';
    if (profilePhoneEl) profilePhoneEl.textContent = 'Not provided';
    if (profileAddressEl) profileAddressEl.textContent = 'Not provided';
    if (profileJoinedEl) profileJoinedEl.textContent = 'Not available';
    if (editBtn) editBtn.style.display = 'none';
    if (loginPromptContainer) loginPromptContainer.style.display = 'block';
    if (editProfileForm) editProfileForm.style.display = 'none';
    if (accountInfoPlaceholder) accountInfoPlaceholder.style.display = 'block';
    if (accountInfoGrid) accountInfoGrid.style.display = 'none';
    if (settingsSection) settingsSection.style.display = 'none';
    if (deleteModal) deleteModal.style.display = 'none';
  } else {
    // Show real user data when logged in
    if (user) {
      if (profileNameEl) profileNameEl.textContent = user.name || 'User';
      if (profileEmailEl) profileEmailEl.textContent = user.email || '';
      if (profilePhoneEl) profilePhoneEl.textContent = user.phone || 'Not provided';
      if (profileAddressEl) profileAddressEl.textContent = user.address || 'Not provided';
      if (profileJoinedEl) profileJoinedEl.textContent = user.joined || new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
    }
    if (editBtn) editBtn.style.display = 'block';
    if (loginPromptContainer) loginPromptContainer.style.display = 'none';
    if (accountInfoPlaceholder) accountInfoPlaceholder.style.display = 'none';
    if (accountInfoGrid) accountInfoGrid.style.display = 'grid';
    if (settingsSection) settingsSection.style.display = 'block';
  }
}

/* Preferences management */
function loadPreferences() {
  const prefs = JSON.parse(localStorage.getItem('userPreferences')) || { notif: true, newsletter: false };
  const notifToggle = document.getElementById('notifToggle');
  const newsletterToggle = document.getElementById('newsletterToggle');
  if (notifToggle) notifToggle.checked = prefs.notif;
  if (newsletterToggle) newsletterToggle.checked = prefs.newsletter;
}

function savePreferences() {
  const notifToggle = document.getElementById('notifToggle');
  const newsletterToggle = document.getElementById('newsletterToggle');
  const prefs = {
    notif: notifToggle ? notifToggle.checked : true,
    newsletter: newsletterToggle ? newsletterToggle.checked : false
  };
  localStorage.setItem('userPreferences', JSON.stringify(prefs));
}

document.addEventListener('DOMContentLoaded', () => {
  renderProfile();
  loadPreferences();

  // Attach checkbox listeners for persistence
  const notifToggle = document.getElementById('notifToggle');
  const newsletterToggle = document.getElementById('newsletterToggle');
  if (notifToggle) notifToggle.addEventListener('change', savePreferences);
  if (newsletterToggle) newsletterToggle.addEventListener('change', savePreferences);

  // Edit profile button
  const editBtn = document.getElementById('editProfileBtn');
  const editForm = document.getElementById('editProfileForm');
  const saveBtn = document.getElementById('saveProfileBtn');
  const cancelBtn = document.getElementById('cancelEditBtn');

  if (editBtn && isLoggedIn() && user) {
    editBtn.addEventListener('click', () => {
      document.getElementById('editName').value = user.name || '';
      document.getElementById('editEmail').value = user.email || '';
      document.getElementById('editPhone').value = user.phone || '';
      document.getElementById('editAddress').value = user.address || '';
      editForm.style.display = 'block';
      editBtn.style.display = 'none';
    });
  }

  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      editForm.style.display = 'none';
      editBtn.style.display = 'block';
    });
  }

  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      (async () => {
        const newName = document.getElementById('editName').value;
        const newEmail = document.getElementById('editEmail').value;
        const newPhone = document.getElementById('editPhone').value;
        const newAddress = document.getElementById('editAddress').value;

        // Update local 'user' object first (optimistic)
        user.name = newName;
        user.email = newEmail;
        user.phone = newPhone;
        user.address = newAddress;
        saveUser();
        renderProfile();

        // If logged in, persist to server as well so orders use authoritative data
        const token = localStorage.getItem('token');
        if (token) {
          try {
            const resp = await fetch(`${API_BASE}/auth/profile`, {
              method: 'PUT',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
              },
              body: JSON.stringify({ name: newName, email: newEmail, phone: newPhone, address: newAddress }),
            });

            const respJson = await resp.json().catch(() => null);
            if (resp.ok && respJson && respJson.user) {
              // Use server-returned user as canonical
              user = respJson.user;
              saveUser();
              renderProfile();
            } else {
              console.warn('Failed to update profile on server', resp.status, respJson);
              // leave local changes in place
            }
          } catch (err) {
            console.warn('Network error updating profile on server', err);
          }
        }

        // Update checkout fields if on checkout page
        try { populateCheckoutFields(); } catch (err) { /* ignore if not loaded */ }
        editForm.style.display = 'none';
        editBtn.style.display = 'block';
        alert('Profile updated!');
      })();
    });
  }

  // Delete account button - show modal
  const deleteBtn = document.getElementById('deleteAccountBtn');
  const deleteModal = document.getElementById('deleteModal');
  const cancelDeleteBtn = document.getElementById('cancelDeleteBtn');
  const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
  const deactivateOption = document.getElementById('deactivateOption');
  const deleteOption = document.getElementById('deleteOption');
  const deactivateRadio = document.getElementById('deactivateRadio');
  const deleteRadio = document.getElementById('deleteRadio');
  const deactivateAccountBtn = document.getElementById('deactivateAccountBtn');

  if (deleteBtn) {
    deleteBtn.addEventListener('click', () => {
      deleteModal.style.display = 'flex';
      deactivateRadio.checked = true; // Default to deactivate
      updateOptionVisuals();
    });
  }

  // Deactivate button in settings - open modal with deactivate selected
  if (deactivateAccountBtn) {
    deactivateAccountBtn.addEventListener('click', () => {
      if (deleteModal) deleteModal.style.display = 'flex';
      if (deactivateRadio) deactivateRadio.checked = true;
      updateOptionVisuals();
    });
  }

  // Also allow the new deactivate row to open the modal
  const deactivateRow = document.getElementById('deactivateRow');
  if (deactivateRow) {
    deactivateRow.addEventListener('click', () => {
      if (deleteModal) deleteModal.style.display = 'flex';
      if (deactivateRadio) deactivateRadio.checked = true;
      updateOptionVisuals();
    });
    deactivateRow.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (deleteModal) deleteModal.style.display = 'flex';
        if (deactivateRadio) deactivateRadio.checked = true;
        updateOptionVisuals();
      }
    });
  }

  if (cancelDeleteBtn) {
    cancelDeleteBtn.addEventListener('click', () => {
      deleteModal.style.display = 'none';
    });
  }

  // Toggle radio options when clicking on option boxes
  if (deactivateOption) {
    deactivateOption.addEventListener('click', () => {
      deactivateRadio.checked = true;
      updateOptionVisuals();
    });
  }

  if (deleteOption) {
    deleteOption.addEventListener('click', () => {
      deleteRadio.checked = true;
      updateOptionVisuals();
    });
  }

  if (confirmDeleteBtn) {
    confirmDeleteBtn.addEventListener('click', () => {
      if (deactivateRadio.checked) {
        // Deactivate account
        localStorage.setItem('user', JSON.stringify({...user, deactivated: true}));
        alert('Your account has been deactivated.');
        window.location.href = 'login.html';
      } else if (deleteRadio.checked) {
        // Permanently delete account
        localStorage.removeItem('user');
        localStorage.removeItem('cart');
        localStorage.removeItem('userPreferences');
        localStorage.removeItem('showAccountCreatedNotif');
        alert('Your account has been permanently deleted.');
        window.location.href = 'login.html';
      }
    });
  }

  // Visual update helper: highlight selected option and style confirm button
  function updateOptionVisuals() {
    if (!deactivateOption || !deleteOption || !confirmDeleteBtn || !deactivateRadio || !deleteRadio) return;
    if (deactivateRadio.checked) {
      deactivateOption.classList.add('selected');
      deleteOption.classList.remove('selected');
      confirmDeleteBtn.classList.remove('danger');
      confirmDeleteBtn.classList.add('btn-modal-primary');
      confirmDeleteBtn.textContent = 'Continue';
    } else if (deleteRadio.checked) {
      deleteOption.classList.add('selected');
      deactivateOption.classList.remove('selected');
      confirmDeleteBtn.classList.add('btn-modal-primary');
      confirmDeleteBtn.classList.add('danger');
      confirmDeleteBtn.textContent = 'Continue';
    }
  }

  // Initialize visuals on load in case modal is shown later
  updateOptionVisuals();

  // Close modal when clicking outside of it
  if (deleteModal) {
    deleteModal.addEventListener('click', (e) => {
      if (e.target === deleteModal) {
        deleteModal.style.display = 'none';
      }
    });
  }

  // Close via top-left X button if present
  const modalClose = document.getElementById('modalClose');
  if (modalClose) {
    modalClose.addEventListener('click', () => {
      if (deleteModal) deleteModal.style.display = 'none';
    });
  }

  // Close modal with Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.key === 'Esc') {
      if (deleteModal && deleteModal.style.display === 'flex') {
        deleteModal.style.display = 'none';
      }
    }
  });
});


/* ---------------------------
   LOGIN PAGE
--------------------------- */

document.addEventListener("click", (e) => {
  // prevent errors on pages that do not have these buttons
  if (document.getElementById("goSignup") && e.target.id === "goSignup") {
    window.location.href = "signup.html";
  }
  if (document.getElementById("goForgot") && e.target.id === "goForgot") {
    window.location.href = "forgotpassword.html";
  }
  if (document.getElementById("backLogin") && e.target.id === "backLogin") {
    window.location.href = "login.html";
  }
  if (document.getElementById("backLogin2") && e.target.id === "backLogin2") {
    window.location.href = "login.html";
  }
});

/* LOGIN BUTTON */
if (document.getElementById("loginBtn")) {
  document.getElementById("loginBtn").addEventListener("click", async () => {
    const email = document.getElementById("loginEmail").value.trim();
    const pass = document.getElementById("loginPassword").value.trim();
    const box = document.getElementById("loginNotification");

    if (!email || !pass) {
      box.innerHTML = `<p style="color:red;">Please fill out all fields.</p>`;
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: pass }),
      });

      // parse body safely
      let data = null;
      try { data = await response.json(); } catch (e) { data = null; }

      // Backend might return success flag or rely on HTTP status
      const backendSuccess = (data && (data.success === true || data.token)) || response.ok;

      if (!backendSuccess) {
        const msg = (data && (data.error || data.message)) || 'Wrong username or password.';
        box.innerHTML = `<p style="color:red;">${msg}</p>`;
        return;
      }

      // Save token and user
      if (data && data.token) localStorage.setItem('token', data.token);
      if (data && data.user) localStorage.setItem('user', JSON.stringify(data.user));

      // Flush any buffered activities from before login
      await flushPendingActivities();

      // If there was a pending cart saved while anonymous, merge it with server cart now
      try {
        const pending = JSON.parse(localStorage.getItem('pendingCart') || 'null');
        if (pending && Array.isArray(pending) && pending.length) {
          // Get current server cart
          const r = await fetch(`${API_BASE}/cart`, {
            headers: { 'Authorization': `Bearer ${data.token}` },
          });
          let serverCart = [];
          if (r.ok) {
            const serverJson = await r.json();
            serverCart = Array.isArray(serverJson.items) ? serverJson.items : [];
          }

          // Merge pending into serverCart by product+type (sum qty)
          const map = new Map();
          const keyFor = it => `${it.product}||${it.type}`;
          [...serverCart, ...pending].forEach(it => {
            const k = keyFor(it);
            const existing = map.get(k) || { ...it, qty: 0 };
            existing.qty = (existing.qty || 0) + (Number(it.qty) || 0);
            existing.price = Number(it.price) || existing.price || 0;
            existing.type = it.type || existing.type;
            existing.name = it.name || existing.name;
            existing.img = it.img || existing.img;
            map.set(k, existing);
          });

          const merged = Array.from(map.values());

          // Post merged cart to server
          const resp = await fetch(`${API_BASE}/cart`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${data.token}`,
            },
            body: JSON.stringify({ items: merged }),
          });

          if (resp.ok) {
            localStorage.removeItem('pendingCart');
            cart = merged;
            saveCart();
          } else {
            console.warn('Failed to merge pending cart on login', resp.status);
          }
        }
      } catch (err) {
        console.warn('Failed to flush pending cart on login:', err);
      }

      // Sync current cart as well (in case user had items)
      try { await syncCartToServer(); } catch (err) { /* ignore */ }

      box.innerHTML = `<p style="color:green;">Login successful!</p>`;
      setTimeout(() => {
        window.location.href = "dashboard.html";
      }, 800);
    } catch (error) {
      console.error('Login error:', error);
      box.innerHTML = `<p style="color:red;">Network error. Please try again.</p>`;
    }
  });
}

/* ---------------------------
   SIGNUP PAGE
--------------------------- */

if (document.getElementById("signupBtn")) {
  document.getElementById("signupBtn").addEventListener("click", async () => {

    let name = document.getElementById("fullName").value.trim();
    let email = document.getElementById("signEmail").value.trim();
    let phone = document.getElementById("phone").value.trim();
    let address = document.getElementById("address").value.trim();
    let pass = document.getElementById("signPassword").value.trim();
    let confirm = document.getElementById("confirmPassword").value.trim();
    let box = document.getElementById("signupNotification");

    if (!name || !email || !phone || !address || !pass || !confirm) {
      box.innerHTML = `<p style="color:red;">Please complete all fields.</p>`;
      return;
    }

    if (pass !== confirm) {
      box.innerHTML = `<p style="color:red;">Passwords do not match.</p>`;
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          email,
          phone,
          address,
          password: pass,
          confirmPassword: confirm,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        box.innerHTML = `<p style="color:red;">${data.error || 'Signup failed'}</p>`;
        return;
      }

      // Save token and user
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      
      // For checkout autofill
      localStorage.setItem("checkoutUser", JSON.stringify({
        name,
        email,
        phone,
        address,
      }));

      // Flush any buffered activities from before signup
      await flushPendingActivities();

      box.innerHTML = `<p style="color:green;">Account created successfully!</p>`;
      localStorage.setItem('showAccountCreatedNotif', 'true');

      setTimeout(() => {
        window.location.href = "dashboard.html";
      }, 800);
    } catch (error) {
      console.error('Signup error:', error);
      box.innerHTML = `<p style="color:red;">Network error. Please try again.</p>`;
    }
  });
}

/* ---------------------------
   FORGOT PASSWORD PAGE
--------------------------- */

if (document.getElementById("resetPasswordBtn")) {
  document.getElementById("resetPasswordBtn").addEventListener("click", () => {
    let email = document.getElementById("forgotEmail").value.trim();
    let box = document.getElementById("forgotNotification");

    if (!email) {
      box.innerHTML = `<p style="color:red;">Enter your email first.</p>`;
      return;
    }

    box.innerHTML = `<p style="color:green;">Reset link sent!</p>`;
  });
}

/* ---------------------------
   DASHBOARD - NOTIFICATIONS
   --------------------------- */

const bell = document.getElementById("bellWrap");
const dropdown = document.getElementById("notifDropdown");
const notif1 = document.getElementById("notif1");
const notifDot1 = document.getElementById("notifDot1");
const notifCount = document.getElementById("notifCount");
const notifTitle = document.querySelector('.notif-title');
const notifTime = document.getElementById("notifTime1");

// Check if user just created account
if (localStorage.getItem('showAccountCreatedNotif') === 'true') {
  // Update notification with account created message and current date/time
  if (notifTitle) notifTitle.textContent = 'Account Created Successfully!';
  if (notifTime) {
    const now = new Date();
    notifTime.textContent = now.toLocaleDateString() + " • " + now.toLocaleTimeString();
  }
  // Show the notification badge
  if (notifDot1) notifDot1.style.display = 'block';
  if (notifCount) notifCount.style.display = 'block';
  // Clear the flag so it only shows once
  localStorage.removeItem('showAccountCreatedNotif');
}

/* Toggle dropdown */
if (bell) {
  bell.addEventListener("click", (e) => {
    e.stopPropagation();
    dropdown.style.display =
      dropdown.style.display === "block" ? "none" : "block";
  });
}

/* Mark notification as read */
if (notif1) {
  notif1.addEventListener("click", () => {
    // hide dot and decrement count
    if (notifDot1) notifDot1.style.display = 'none';
    if (notifCount) notifCount.style.display = 'none';
    // persist read state so it doesn't reappear on navigation
    try { localStorage.setItem('notif1_read', 'true'); } catch (e) { /* ignore */ }
  });
}

// On load, respect persisted notification read state
try {
  if (localStorage.getItem('notif1_read') === 'true') {
    if (notifDot1) notifDot1.style.display = 'none';
    if (notifCount) notifCount.style.display = 'none';
  }
} catch (e) { /* ignore */ }

/* Logout button in header notification dropdown */
const headerLogoutBtn = document.getElementById('logoutBtn');
if (headerLogoutBtn && bell) { // Only wire on dashboard where bell exists
  headerLogoutBtn.addEventListener("click", async () => {
    try {
      const token = localStorage.getItem('token');
      if (token) {
        await fetch(`${API_BASE}/auth/logout`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        });
      }
    } catch (error) {
      console.error('Logout error:', error);
    }
    
    localStorage.removeItem('user');
    localStorage.removeItem('token');
    localStorage.removeItem('cart');
    localStorage.removeItem('userPreferences');
    // After logout, send users to the public dashboard (home)
    window.location.href = 'dashboard.html';
  });
}

/* Close dropdown when clicking outside */
document.addEventListener("click", () => {
  if (dropdown) dropdown.style.display = "none";
});/* ---------------------------
   HEADER NAVIGATION
--------------------------- */

const navHome = document.getElementById("navHome");
const navCart = document.getElementById("navCart");
const navProfile = document.getElementById("navProfile");
const navAboutUs = document.getElementById("navAboutUs");

if (navAboutUs) {
  navAboutUs.addEventListener("click", () => {
    // Reload cart from localStorage before navigating
    cart = loadCart();
    saveCart();
    window.location.href = "AboutUs.html";
  });
}

if (navHome) {
  navHome.addEventListener("click", () => {
    // Reload cart from localStorage before navigating
    cart = loadCart();
    saveCart();
    window.location.href = "dashboard.html";
  });
}

if (navCart) {
  navCart.addEventListener("click", () => {
    // Reload cart from localStorage before navigating
    cart = loadCart();
    saveCart();
    window.location.href = "cart.html";
  });
}

if (navProfile) {
  navProfile.addEventListener("click", (e) => {
    e.preventDefault();
    // Show the login modal instead of navigating when not logged in
    cart = loadCart();
    saveCart();
    if (!isLoggedIn()) {
      showCheckoutLoginModal('profile.html', 'Log in to view Profile', 'Please log in to view your profile.');
    } else {
      window.location.href = "profile.html";
    }
  });
}
/* ==========================
   CHECKOUT PAGE LOGIC
========================== */

document.addEventListener("DOMContentLoaded", () => {
    // If on checkout page, render the summary
    if (document.getElementById("checkoutForm")) {
        renderCheckoutSummary();
    }
});

// Place order handler: sends order to server and clears cart
async function placeOrderHandler(e) {
  e.preventDefault();
  const token = localStorage.getItem('token');
  if (!token) {
    alert('Please login before placing an order.');
    window.location.href = 'login.html';
    return;
  }

  const items = loadCart();
  if (!items || items.length === 0) {
    alert('Your cart is empty.');
    return;
  }

  const subtotal = items.reduce((s, it) => s + it.price * it.qty, 0);
  const deliveryFee = 5.0;
  const total = subtotal + deliveryFee;

  // shipping info - prefer checkoutUser (autofill), fallback to stored user
  const saved = JSON.parse(localStorage.getItem('checkoutUser')) || getCurrentUser() || {};
  const shippingAddress = {
    name: saved.name || saved.fullName || '',
    email: saved.email || '',
    phone: saved.phone || saved.number || '',
    address: saved.address || '',
  };

  const paymentMethod = document.querySelector('input[name="payment"]:checked')?.value || 'cod';

  try {
    console.debug('[placeOrder] preparing payload');
    console.debug('items', items);
    console.debug('shippingAddress', shippingAddress);
    console.debug('total', total, 'paymentMethod', paymentMethod);
    // Disable the place order button to prevent duplicate submissions
    const placeBtnEl = document.getElementById('placeOrderBtn');
    if (placeBtnEl) {
      placeBtnEl.disabled = true;
      placeBtnEl.dataset.origText = placeBtnEl.textContent;
      placeBtnEl.textContent = 'Placing order…';
    }

    showToast('Placing order...');

    const resp = await fetch(`${API_BASE}/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ items, total, shippingAddress, paymentMethod }),
    });

    let data;
    try { data = await resp.json(); } catch (err) { data = null; }

    console.debug('[placeOrder] POST /orders response', resp.status, data);

    if (!resp.ok) {
      const serverMsg = data?.error || data || await resp.text().catch(()=>null) || `Status ${resp.status}`;
      console.error('Order creation failed', resp.status, serverMsg);
      // Re-enable button and show descriptive error
      if (placeBtnEl) { placeBtnEl.disabled = false; placeBtnEl.textContent = placeBtnEl.dataset.origText || 'Place Order'; }
      showToast('Order failed: ' + (typeof serverMsg === 'string' ? serverMsg : 'Please try again'));
      // also show an alert for immediate visibility
      alert('Order failed: ' + (typeof serverMsg === 'string' ? serverMsg : 'Please try again'));
      return;
    }

    // Clear local cart and server cart
    localStorage.removeItem('cart');
    cart = [];
    updateCartCount();
    try { await fetch(`${API_BASE}/cart`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } }); } catch (err) { console.warn('Failed to clear server cart after order', err); }

    // Prefer authoritative order from server (fetch the latest order for this user)
    let authoritativeOrder = null;
    try {
      const ordersResp = await fetch(`${API_BASE}/orders`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (ordersResp.ok) {
        const orders = await ordersResp.json();
        console.debug('[placeOrder] GET /orders returned', Array.isArray(orders) ? orders.length : orders);
        if (Array.isArray(orders) && orders.length) {
          // Server returns orders sorted by createdAt desc; take first as newest
          authoritativeOrder = orders[0];
          console.debug('[placeOrder] authoritativeOrder chosen', authoritativeOrder.orderNumber);
        }
      }
    } catch (err) {
      console.warn('Failed to fetch latest order from server, falling back to response body', err);
    }

    // Fallback to the response body if fetching orders failed
    const savedOrder = authoritativeOrder || (data && (data.order || data));

    // If still missing an object, generate a minimal savedOrder object
    const finalSaved = savedOrder || { items, total, shippingAddress, paymentMethod };

    // Ensure orderNumber exists (prefer server-provided). Only generate if absolutely missing.
    if (!finalSaved.orderNumber) {
      try { finalSaved.orderNumber = generateOrderNumber(); } catch (err) { /* ignore */ }
    }

    localStorage.setItem('lastOrder', JSON.stringify(finalSaved));
    console.debug('[placeOrder] finalSaved stored as lastOrder', finalSaved.orderNumber || '(none)', finalSaved);

    window.location.href = 'orderconfirm.html';
  } catch (err) {
    console.error('Place order error:', err);
    if (placeBtnEl) { placeBtnEl.disabled = false; placeBtnEl.textContent = placeBtnEl.dataset.origText || 'Place Order'; }
    showToast('Failed to place order. Please try again.');
    alert('Failed to place order. Please try again.');
  }
}

// Attach place order handler if button exists
document.addEventListener('DOMContentLoaded', () => {
  const placeBtn = document.getElementById('placeOrderBtn');
  if (placeBtn) {
    placeBtn.addEventListener('click', placeOrderHandler);
  }
});

function renderCheckoutSummary() {
    const subtotalEl = document.getElementById("subtotal");
    const deliveryEl = document.getElementById("delivery");
    const totalEl = document.getElementById("cartTotal");
    const cartSummary = document.getElementById("cartSummary");

    if (!subtotalEl || !deliveryEl || !totalEl) return;

    let subtotal = 0;
    const deliveryFee = 5.00;

    cart.forEach(item => {
        subtotal += item.price * item.qty;
    });

    const total = subtotal + deliveryFee;

    subtotalEl.textContent = subtotal.toFixed(2);
    deliveryEl.textContent = deliveryFee.toFixed(2);
    totalEl.textContent = total.toFixed(2);

    if (cartSummary) {
        cartSummary.innerHTML = cart
            .map(item => `${item.product.charAt(0).toUpperCase() + item.product.slice(1)} × ${item.qty}`)
            .join("<br>");
    }
}


// Populate checkout delivery fields from localStorage user or explicit checkoutUser
function populateCheckoutFields() {
  try {
    // Prefer the authoritative `user` key first (updated on profile save),
    // but fall back to `checkoutUser` for legacy or explicit checkout data.
    const saved = JSON.parse(localStorage.getItem('user')) || JSON.parse(localStorage.getItem('checkoutUser')) || getCurrentUser() || {};
    const nameEl = document.getElementById('name');
    const emailEl = document.getElementById('email');
    const numberEl = document.getElementById('number');
    const addressEl = document.getElementById('address');

    if (nameEl) nameEl.textContent = saved.name || saved.fullName || '';
    if (emailEl) emailEl.textContent = saved.email || '';
    if (numberEl) numberEl.textContent = saved.phone || saved.number || '';
    if (addressEl) addressEl.textContent = saved.address || '';
  } catch (err) {
    console.warn('Failed to populate checkout fields:', err);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  populateCheckoutFields();
});

// Also refresh checkout fields when localStorage changes (other tab) or when page regains focus
window.addEventListener('storage', (e) => {
  if (e.key === 'user' || e.key === 'checkoutUser') populateCheckoutFields();
});
window.addEventListener('focus', () => populateCheckoutFields());

    // Function to generate unique order number
    function generateOrderNumber() {
        const timestamp = Date.now();  // Time-based unique number
        const randomDigits = Math.floor(Math.random() * 900 + 100); // 3 random digits
        const orderNum = "o" + timestamp + randomDigits;
        
        // Log checkout activity
        logActivity('checkout', {
          orderNumber: orderNum,
          cart: cart,
          total: document.getElementById("cartTotal")?.textContent,
        });
        
        return orderNum;
    }

    // Display the order number on the page (only on checkout page)
    if (document.getElementById("orderNumber")) {
        document.getElementById("orderNumber").textContent = generateOrderNumber();
    }

// Render last order on orderconfirm.html
function renderLastOrder() {
  try {
    const raw = localStorage.getItem('lastOrder');
    if (!raw) return;
    const order = JSON.parse(raw);
    const orderNumberEl = document.getElementById('orderNumber');
    const itemsEl = document.getElementById('orderItemsContainer') || document.getElementById('orderItems');
    const totalsEl = document.getElementById('orderTotalsContainer') || document.getElementById('orderTotals');
    const shippingEl = document.getElementById('orderShippingContainer') || document.getElementById('orderShipping');

    if (orderNumberEl && order.orderNumber) orderNumberEl.textContent = order.orderNumber;

    if (itemsEl && Array.isArray(order.items)) {
      itemsEl.innerHTML = order.items.map(it => {
        const img = it.img ? `<img src="${it.img}" style="width:48px;height:48px;object-fit:contain;margin-right:8px;border-radius:6px;">` : '';
        const name = it.name || it.product || '';
        const qty = it.qty || it.quantity || 1;
        const price = (Number(it.price) || 0) * qty;
        return `<div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid #eee;"><div style="flex:1;"><div style="font-weight:600;">${name}</div><div style="font-size:13px;color:#666;">Qty: ${qty}</div></div><div style="font-weight:600;">$${price.toFixed(2)}</div></div>`;
      }).join('');
    }

    if (totalsEl) {
      const total = Number(order.total || order.totals || 0) || (Array.isArray(order.items) ? order.items.reduce((s,it)=>s + ((Number(it.price)||0) * (it.qty||1)),0) : 0);
      totalsEl.textContent = `Total: $${total.toFixed(2)}`;
    }

    // Display customer shipping details (original behavior)
    if (shippingEl && order.shippingAddress) {
      const s = order.shippingAddress;
      shippingEl.innerHTML = `${s.name || ''}<br>${s.email ? ('Email: ' + s.email) : ''}${s.phone ? (' • ' + s.phone) : ''}<br>${s.address || ''}`;
    }
  } catch (err) {
    console.warn('Failed to render last order:', err);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  // If on order confirmation page, render the saved order
  if (document.getElementById('orderDetails')) {
    renderLastOrder();
  }
});

