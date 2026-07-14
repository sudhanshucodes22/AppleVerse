/**
 * AppleVerse — Shared Frontend Module
 * Consolidates: mobile menu, nav scroll, scroll-reveal, cart toast
 * Replaces all inline <script> blocks across pages
 */
import { initAuth, isAuthenticated, apiFetch } from './auth.js';

/* ─────────────────────────────────────────────
   1. TOAST NOTIFICATION SYSTEM
   (replaces alert() — non-blocking, styleable)
───────────────────────────────────────────── */
function createToastContainer() {
  if (document.getElementById('toast-container')) return;
  const container = document.createElement('div');
  container.id = 'toast-container';
  container.setAttribute('aria-live', 'polite');
  container.setAttribute('aria-atomic', 'true');
  container.style.cssText = `
    position: fixed;
    bottom: 24px;
    right: 24px;
    z-index: 9999;
    display: flex;
    flex-direction: column;
    gap: 12px;
    pointer-events: none;
  `;
  document.body.appendChild(container);
}

export function showToast(message, type = 'info', duration = 3500) {
  createToastContainer();
  const container = document.getElementById('toast-container');

  const icons = { info: 'shopping_bag', success: 'check_circle', error: 'error' };
  const colors = {
    info:    { bg: 'rgba(255,255,255,0.92)', border: '#D2D2D7', icon: '#0066CC' },
    success: { bg: 'rgba(232,250,243,0.95)', border: '#34C759', icon: '#34C759' },
    error:   { bg: 'rgba(255,237,237,0.95)', border: '#FF3B30', icon: '#FF3B30' },
  };
  const c = colors[type] || colors.info;

  const toast = document.createElement('div');
  toast.setAttribute('role', 'status');
  toast.style.cssText = `
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 20px;
    background: ${c.bg};
    border: 1px solid ${c.border}40;
    border-radius: 16px;
    backdrop-filter: saturate(180%) blur(20px);
    -webkit-backdrop-filter: saturate(180%) blur(20px);
    box-shadow: 0 8px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.06);
    font-family: 'Inter', sans-serif;
    font-size: 14px;
    font-weight: 500;
    color: #1D1D1F;
    pointer-events: auto;
    transform: translateX(120%);
    transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.3s ease;
    opacity: 0;
    min-width: 240px;
    max-width: 340px;
    cursor: pointer;
  `;
  toast.innerHTML = `
    <span class="material-symbols-outlined" style="color:${c.icon};font-size:20px;flex-shrink:0">${icons[type] || 'info'}</span>
    <span>${message}</span>
    <span class="material-symbols-outlined" style="font-size:16px;color:#999;margin-left:auto;flex-shrink:0">close</span>
  `;

  container.appendChild(toast);

  // Animate in
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      toast.style.transform = 'translateX(0)';
      toast.style.opacity = '1';
    });
  });

  const dismiss = () => {
    toast.style.transform = 'translateX(120%)';
    toast.style.opacity = '0';
    toast.addEventListener('transitionend', () => toast.remove(), { once: true });
  };

  toast.addEventListener('click', dismiss);
  const timer = setTimeout(dismiss, duration);
  toast.addEventListener('click', () => clearTimeout(timer));
}

/* ─────────────────────────────────────────────
   2. SHOPPING CART SYSTEM & CHECKOUT FLOW
───────────────────────────────────────────── */

const USD_TO_INR = 83;

// Product Price Database (returns USD, converted to INR dynamically)
function getProductPrice(name) {
  const cleanName = name.toLowerCase();
  if (cleanName.includes('macbook pro 16')) return 2499;
  if (cleanName.includes('macbook pro 14')) return 1999;
  if (cleanName.includes('macbook pro 13')) return 1299;
  if (cleanName.includes('macbook air 13')) return 1099;
  if (cleanName.includes('macbook air 15')) return 1299;
  if (cleanName.includes('imac')) return 1299;
  if (cleanName.includes('mac studio')) return 1999;
  if (cleanName.includes('mac pro')) return 6999;
  if (cleanName.includes('mac mini')) return 599;
  
  if (cleanName.includes('iphone 17 pro max')) return 1199;
  if (cleanName.includes('iphone 17')) return 799;
  if (cleanName.includes('iphone 16 plus')) return 899;
  if (cleanName.includes('iphone 16 pro')) return 999;
  if (cleanName.includes('iphone 15 plus')) return 799;
  if (cleanName.includes('iphone 15 pro')) return 899;
  if (cleanName.includes('iphone 14 plus')) return 699;
  if (cleanName.includes('iphone 14 pro')) return 799;
  if (cleanName.includes('iphone 13 pro')) return 699;
  if (cleanName.includes('iphone 13')) return 599;
  if (cleanName.includes('iphone 12 pro')) return 599;
  if (cleanName.includes('iphone 12')) return 499;
  if (cleanName.includes('iphone 11 pro')) return 499;
  if (cleanName.includes('iphone 11')) return 399;
  
  if (cleanName.includes('ultra 2') || cleanName.includes('ultra')) return 799;
  if (cleanName.includes('series 10')) return 399;
  if (cleanName.includes('se')) return 249;
  
  if (cleanName.includes('vision pro')) return 3499;
  if (cleanName.includes('airpods pro')) return 249;
  if (cleanName.includes('airpods max')) return 549;
  if (cleanName.includes('airpods 4') || cleanName.includes('airpods (4th')) return 129;
  if (cleanName.includes('earpods')) return 19;
  if (cleanName.includes('homepod (2nd') || cleanName.includes('homepod 2')) return 299;
  if (cleanName.includes('homepod mini')) return 99;
  
  if (cleanName.includes('iphone air magsafe battery')) return 143.37;
  if (cleanName.includes('magsafe charger (1m)')) return 54.21;
  if (cleanName.includes('magsafe charger (2m)')) return 66.26;
  
  if (cleanName.includes('clear case for iphone 15')) return 59.03;
  if (cleanName.includes('national geographic case for iphone 15 pro max')) return 71.08;
  if (cleanName.includes('clear case for iphone 16')) return 59.03;
  if (cleanName.includes('clear case for iphone 16 pro max')) return 59.03;
  if (cleanName.includes('silicon case for iphone 17 pro max')) return 71.08;
  
  if (cleanName.includes('wave case for iphone xs max')) return 46.99;
  if (cleanName.includes('glitter case for iphone 11')) return 46.99;
  if (cleanName.includes('vintage collage case for iphone 12 mini')) return 46.99;
  if (cleanName.includes('titanium case for iphone 13 pro max')) return 59.03;
  if (cleanName.includes('marble case for iphone 14')) return 59.03;
  
  if (cleanName.includes('silicone case with magsafe')) return 59.03;
  if (cleanName.includes('clear case with magsafe')) return 59.03;
  if (cleanName.includes('finewoven case with magsafe')) return 71.08;
  
  return 99; // default fallback
}

function getCart() {
  try {
    return JSON.parse(localStorage.getItem('appleverse_cart')) || [];
  } catch (e) {
    return [];
  }
}

function saveCart(cart) {
  localStorage.setItem('appleverse_cart', JSON.stringify(cart));
  updateCartBadge();
}

function addToCart(item) {
  const cart = getCart();
  const existing = cart.find(x => x.name === item.name);
  if (existing) {
    existing.quantity += 1;
  } else {
    cart.push({
      name: item.name,
      price: item.price,
      image: item.image,
      quantity: 1
    });
  }
  saveCart(cart);
  showToast(`Added ${item.name} to bag!`, 'success');
  openCartDrawer();
}
window.addToCart = addToCart;

function updateQuantity(name, change) {
  let cart = getCart();
  const existing = cart.find(x => x.name === name);
  if (existing) {
    existing.quantity += change;
    if (existing.quantity <= 0) {
      cart = cart.filter(x => x.name !== name);
    }
  }
  saveCart(cart);
  renderCartItems();
}

function removeFromCart(name) {
  let cart = getCart();
  cart = cart.filter(x => x.name !== name);
  saveCart(cart);
  renderCartItems();
}

function updateCartBadge() {
  const cart = getCart();
  const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);
  
  document.querySelectorAll('[data-cart-btn], #cart-btn, .cart-btn').forEach(btn => {
    btn.style.position = 'relative';
    let badge = btn.querySelector('.cart-badge');
    if (totalItems > 0) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'cart-badge absolute -top-1.5 -right-1.5 bg-[#0066CC] text-white text-[10px] font-bold w-5 h-5 flex items-center justify-center rounded-full border border-white';
        btn.appendChild(badge);
      }
      badge.textContent = totalItems;
    } else {
      if (badge) badge.remove();
    }
  });
}

function openCartDrawer() {
  const drawer = document.getElementById('cart-drawer');
  const overlay = document.getElementById('cart-drawer-overlay');
  if (drawer && overlay) {
    overlay.classList.remove('pointer-events-none', 'opacity-0');
    overlay.classList.add('opacity-100');
    drawer.classList.remove('translate-x-full');
    drawer.classList.add('translate-x-0');
    document.body.style.overflow = 'hidden';
    renderCartItems();
  }
}

function closeCartDrawer() {
  const drawer = document.getElementById('cart-drawer');
  const overlay = document.getElementById('cart-drawer-overlay');
  if (drawer && overlay) {
    overlay.classList.remove('opacity-100');
    overlay.classList.add('opacity-0', 'pointer-events-none');
    drawer.classList.remove('translate-x-0');
    drawer.classList.add('translate-x-full');
    document.body.style.overflow = '';
  }
}

function renderCartItems() {
  const container = document.getElementById('cart-drawer-items');
  const subtotalEl = document.getElementById('cart-drawer-subtotal');
  if (!container || !subtotalEl) return;
  
  const cart = getCart();
  if (cart.length === 0) {
    container.innerHTML = `
      <div class="h-full flex flex-col items-center justify-center text-center text-zinc-400 space-y-4 py-20">
        <span class="material-symbols-outlined text-[64px]">shopping_bag</span>
        <p class="font-semibold text-lg text-zinc-500">Your bag is empty.</p>
        <p class="text-sm text-zinc-400 max-w-[200px]">Add premium Apple devices to start shopping!</p>
      </div>
    `;
    subtotalEl.textContent = '₹0.00';
    return;
  }
  
  let html = '';
  let subtotal = 0;
  
  cart.forEach(item => {
    const itemTotal = item.price * item.quantity;
    subtotal += itemTotal;
    
    html += `
      <div class="flex items-center gap-4 bg-zinc-50 dark:bg-zinc-900/30 p-4 rounded-2xl border border-zinc-100 dark:border-zinc-800">
        <div class="w-16 h-16 flex-shrink-0 flex items-center justify-center overflow-hidden bg-white rounded-xl border border-zinc-100 p-1">
          <img src="${item.image}" alt="${item.name}" class="w-full h-full object-contain">
        </div>
        <div class="flex-grow min-w-0">
          <h4 class="font-bold text-[#1D1D1F] dark:text-white text-sm truncate">${item.name}</h4>
          <p class="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">₹${(item.price * USD_TO_INR).toLocaleString('en-IN')}</p>
          <div class="flex items-center gap-2 mt-2">
            <button class="cart-qty-dec w-6 h-6 flex items-center justify-center bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-700 active:scale-95 transition-all text-xs font-bold text-zinc-800 dark:text-zinc-200" data-name="${item.name}">-</button>
            <span class="text-sm font-semibold w-5 text-center text-zinc-800 dark:text-zinc-200">${item.quantity}</span>
            <button class="cart-qty-inc w-6 h-6 flex items-center justify-center bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-700 active:scale-95 transition-all text-xs font-bold text-zinc-800 dark:text-zinc-200" data-name="${item.name}">+</button>
          </div>
        </div>
        <div class="text-right flex flex-col justify-between items-end h-16">
          <button class="cart-remove-btn text-zinc-400 hover:text-red-500 transition-colors" data-name="${item.name}">
            <span class="material-symbols-outlined text-[18px]">delete</span>
          </button>
          <span class="text-sm font-bold text-zinc-900 dark:text-white">₹${(itemTotal * USD_TO_INR).toLocaleString('en-IN')}</span>
        </div>
      </div>
    `;
  });
  
  container.innerHTML = html;
  subtotalEl.textContent = `₹${(subtotal * USD_TO_INR).toLocaleString('en-IN')}`;
  
  // Bind events
  container.querySelectorAll('.cart-qty-dec').forEach(btn => {
    btn.addEventListener('click', () => updateQuantity(btn.getAttribute('data-name'), -1));
  });
  container.querySelectorAll('.cart-qty-inc').forEach(btn => {
    btn.addEventListener('click', () => updateQuantity(btn.getAttribute('data-name'), 1));
  });
  container.querySelectorAll('.cart-remove-btn').forEach(btn => {
    btn.addEventListener('click', () => removeFromCart(btn.getAttribute('data-name')));
  });
}

function openCheckoutModal() {
  closeCartDrawer();
  
  let modal = document.getElementById('checkout-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'checkout-modal';
    modal.className = 'fixed inset-0 z-[9995] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md opacity-0 pointer-events-none transition-opacity duration-300';
    document.body.appendChild(modal);
  }
  
  const cart = getCart();
  const total = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  const totalInr = total * USD_TO_INR;
  
  modal.innerHTML = `
    <div class="bg-white dark:bg-zinc-900 w-full max-w-2xl rounded-3xl overflow-hidden shadow-2xl transform scale-95 transition-transform duration-300 flex flex-col max-h-[90vh]">
      <div class="p-6 border-b border-zinc-200 dark:border-zinc-800 flex justify-between items-center bg-[#F5F5F7] dark:bg-zinc-800/50">
        <div class="flex items-center gap-2">
          <span class="material-symbols-outlined text-[#0066CC]">shopping_cart_checkout</span>
          <h3 class="text-xl font-bold text-zinc-900 dark:text-white">Secure Checkout</h3>
        </div>
        <button id="close-checkout-modal" class="material-symbols-outlined p-2 hover:bg-black/5 dark:hover:bg-white/5 rounded-full transition-colors text-zinc-500">close</button>
      </div>
      
      <div class="flex-grow overflow-y-auto p-6 space-y-6">
        <div class="bg-[#F5F5F7] dark:bg-zinc-800/30 rounded-2xl p-4 flex justify-between items-center">
          <div>
            <p class="text-sm text-zinc-500">Total amount to pay</p>
            <p class="text-2xl font-bold text-zinc-900 dark:text-white">₹${totalInr.toLocaleString('en-IN')}</p>
          </div>
          <div class="text-right text-sm text-zinc-500">
            ${cart.reduce((sum, item) => sum + item.quantity, 0)} items
          </div>
        </div>
        
        <form id="checkout-form" class="space-y-4">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label class="block text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">First Name</label>
              <input type="text" required class="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-4 py-3 text-zinc-900 dark:text-white focus:outline-none focus:border-[#0066CC]" placeholder="John">
            </div>
            <div>
              <label class="block text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">Last Name</label>
              <input type="text" required class="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-4 py-3 text-zinc-900 dark:text-white focus:outline-none focus:border-[#0066CC]" placeholder="Doe">
            </div>
          </div>
          
          <div>
            <label class="block text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">Email Address</label>
            <input type="email" required class="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-4 py-3 text-zinc-900 dark:text-white focus:outline-none focus:border-[#0066CC]" placeholder="john.doe@example.com">
          </div>
          
          <div>
            <label class="block text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">Shipping Address</label>
            <input type="text" required class="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-4 py-3 text-zinc-900 dark:text-white focus:outline-none focus:border-[#0066CC]" placeholder="1 Infinite Loop">
          </div>
          
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">City</label>
              <input type="text" required class="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-4 py-3 text-zinc-900 dark:text-white focus:outline-none focus:border-[#0066CC]" placeholder="Cupertino">
            </div>
            <div>
              <label class="block text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">Postal Code</label>
              <input type="text" required class="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-4 py-3 text-zinc-900 dark:text-white focus:outline-none focus:border-[#0066CC]" placeholder="95014">
            </div>
          </div>
          
          <div class="pt-4 border-t border-zinc-100 dark:border-zinc-800 space-y-4">
            <h4 class="font-semibold text-zinc-900 dark:text-white flex items-center gap-2">
              <span class="material-symbols-outlined text-zinc-500">credit_card</span>
              <span>Payment Details</span>
            </h4>
            
            <div>
              <label class="block text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">Card Number</label>
              <input type="text" required class="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-4 py-3 text-zinc-900 dark:text-white focus:outline-none focus:border-[#0066CC]" placeholder="4111 2222 3333 4444">
            </div>
            
            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="block text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">Expiration Date</label>
                <input type="text" required class="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-4 py-3 text-zinc-900 dark:text-white focus:outline-none focus:border-[#0066CC]" placeholder="MM/YY">
              </div>
              <div>
                <label class="block text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">Security Code (CVV)</label>
                <input type="password" required maxlength="4" class="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-4 py-3 text-zinc-900 dark:text-white focus:outline-none focus:border-[#0066CC]" placeholder="123">
              </div>
            </div>
          </div>
        </form>
      </div>
      
      <div class="p-6 border-t border-zinc-200 dark:border-zinc-800 bg-[#F5F5F7] dark:bg-zinc-800/50 flex gap-4">
        <button id="cancel-checkout" class="flex-1 border border-zinc-300 dark:border-zinc-700 hover:bg-black/5 dark:hover:bg-white/5 py-4 rounded-xl font-semibold transition-all">Cancel</button>
        <button type="submit" form="checkout-form" class="flex-1 bg-[#0066CC] hover:bg-[#0077ED] text-white py-4 rounded-xl font-semibold shadow-lg hover:shadow-xl hover:scale-[1.02] active:scale-98 transition-all">Place Order</button>
      </div>
    </div>
  `;
  
  modal.classList.remove('pointer-events-none', 'opacity-0');
  modal.classList.add('opacity-100');
  setTimeout(() => {
    const card = modal.querySelector('.scale-95');
    if (card) card.classList.remove('scale-95');
  }, 10);
  
  document.getElementById('close-checkout-modal').addEventListener('click', closeCheckoutModal);
  document.getElementById('cancel-checkout').addEventListener('click', closeCheckoutModal);
  
  const form = document.getElementById('checkout-form');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    handleOrderSuccess();
  });
}

function closeCheckoutModal() {
  const modal = document.getElementById('checkout-modal');
  if (modal) {
    const card = modal.querySelector('.bg-white, .dark\\:bg-zinc-900');
    if (card) card.classList.add('scale-95');
    modal.classList.remove('opacity-100');
    modal.classList.add('opacity-0', 'pointer-events-none');
  }
}

async function handleOrderSuccess() {
  const modal = document.getElementById('checkout-modal');
  const orderNum = 'AV-' + Math.floor(100000 + Math.random() * 900000);
  const cart = getCart();

  // Persist order to backend (only if user is logged in)
  if (isAuthenticated()) {
    try {
      await apiFetch('/user/orders', {
        method: 'POST',
        body: JSON.stringify({
          orderRef: orderNum,
          items: cart.map(item => ({
            id: item.id,
            name: item.name,
            price: item.price,
            qty: item.qty,
            image: item.image || null,
          })),
          total: cart.reduce((sum, i) => sum + (i.price * (i.qty || 1)), 0),
          currency: 'INR',
          status: 'Confirmed',
        }),
      });
    } catch (err) {
      console.warn('[order] Failed to persist order:', err);
    }
  }

  const card = modal.querySelector('.bg-white, .dark\\:bg-zinc-900');
  if (card) {
    card.innerHTML = `
      <div class="p-12 text-center flex flex-col items-center justify-center space-y-6 bg-white dark:bg-zinc-900 w-full rounded-3xl">
        <div class="w-20 h-20 bg-[#E8FAF3] dark:bg-emerald-950/30 text-[#34C759] rounded-full flex items-center justify-center mb-4">
          <span class="material-symbols-outlined text-[48px] animate-bounce">check_circle</span>
        </div>
        <h3 class="text-3xl font-bold text-zinc-900 dark:text-white">Order Placed Successfully!</h3>
        <p class="text-zinc-500 dark:text-zinc-400 max-w-md">Your order has been placed. A confirmation summary is linked to your billing email.</p>
        <div class="bg-[#F5F5F7] dark:bg-zinc-800/30 px-6 py-4 rounded-2xl">
          <span class="text-sm text-zinc-500">Order Reference:</span>
          <span class="font-mono font-bold text-[#0066CC] ml-2">${orderNum}</span>
        </div>
        <button id="close-success-modal" class="bg-[#0066CC] hover:bg-[#0077ED] text-white px-8 py-3 rounded-full font-semibold shadow-lg hover:shadow-xl hover:scale-105 active:scale-95 transition-all">
          Continue Shopping
        </button>
      </div>
    `;
  }
  
  localStorage.setItem('appleverse_cart', JSON.stringify([]));
  updateCartBadge();
  
  document.getElementById('close-success-modal').addEventListener('click', () => {
    closeCheckoutModal();
  });
}

function initCartButton() {
  if (!document.getElementById('cart-drawer')) {
    const drawerOverlay = document.createElement('div');
    drawerOverlay.id = 'cart-drawer-overlay';
    drawerOverlay.className = 'fixed inset-0 bg-black/40 backdrop-blur-sm z-[9990] opacity-0 pointer-events-none transition-opacity duration-300';
    
    const drawer = document.createElement('div');
    drawer.id = 'cart-drawer';
    drawer.className = 'fixed top-0 right-0 h-full w-[400px] max-w-full bg-white dark:bg-zinc-950 shadow-2xl z-[9991] translate-x-full transition-transform duration-500 ease-out flex flex-col border-l border-zinc-200 dark:border-zinc-800';
    drawer.innerHTML = `
      <div class="p-6 border-b border-zinc-100 dark:border-zinc-800 flex justify-between items-center bg-[#F5F5F7] dark:bg-zinc-900/50">
        <div class="flex items-center gap-2">
          <span class="material-symbols-outlined text-[#0066CC]">shopping_bag</span>
          <h2 class="text-xl font-bold text-[#1D1D1F] dark:text-white">Your Bag</h2>
        </div>
        <button id="close-cart-drawer" class="material-symbols-outlined p-2 hover:bg-black/5 dark:hover:bg-white/5 rounded-full transition-colors text-zinc-500">close</button>
      </div>
      <div id="cart-drawer-items" class="flex-grow overflow-y-auto p-6 space-y-6"></div>
      <div class="p-6 border-t border-zinc-100 dark:border-zinc-800 bg-[#F5F5F7] dark:bg-zinc-900/30 space-y-4">
        <div class="flex justify-between items-center text-lg font-semibold text-zinc-900 dark:text-white">
          <span>Subtotal</span>
          <span id="cart-drawer-subtotal">₹0.00</span>
        </div>
        <p class="text-xs text-zinc-500">Shipping and taxes calculated at checkout.</p>
        <button id="cart-checkout-btn" class="w-full bg-[#0066CC] hover:bg-[#0077ED] text-white py-4 rounded-xl font-semibold shadow-lg hover:shadow-xl hover:scale-[1.02] active:scale-98 transition-all flex justify-center items-center gap-2">
          <span>Proceed to Checkout</span>
          <span class="material-symbols-outlined">arrow_forward</span>
        </button>
      </div>
    `;
    document.body.appendChild(drawerOverlay);
    document.body.appendChild(drawer);
    
    drawerOverlay.addEventListener('click', closeCartDrawer);
    document.getElementById('close-cart-drawer').addEventListener('click', closeCartDrawer);
    
    document.getElementById('cart-checkout-btn').addEventListener('click', () => {
      const cart = getCart();
      if (cart.length === 0) {
        showToast('Your bag is empty!', 'error');
      } else if (!isAuthenticated()) {
        // Redirect to login, then come back to checkout
        showToast('Please sign in to continue to checkout.', 'info', 2500);
        setTimeout(() => {
          window.location.href = '/login.html?msg=Please+sign+in+to+continue+to+checkout.';
        }, 1200);
      } else {
        openCheckoutModal();
      }
    });
  }

  document.querySelectorAll('[data-cart-btn], #cart-btn, .cart-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      openCartDrawer();
    });
  });

  document.querySelectorAll('.glass-card, .card, div[class*="rounded-"], div[class*="glass-"]').forEach(card => {
    if (card.hasAttribute('data-no-price')) return;
    const hasBuyBtn = Array.from(card.querySelectorAll('button, a')).some(el => {
      const txt = el.textContent.trim().toLowerCase();
      return txt === 'buy' || txt === 'pre-order' || txt === 'buy now' || txt === 'add to bag' || el.hasAttribute('data-buy-btn');
    });
    if (!hasBuyBtn) return;
    
    const nameEl = card.querySelector('h3, h2, .font-headline-lg, .text-headline-md, h4');
    if (!nameEl) return;
    
    const name = nameEl.textContent.trim();
    const price = getProductPrice(name);
    
    const btnContainer = card.querySelector('.mt-12, .flex.gap-4, div[class*="mt-"], div.flex.gap-3');
    if (btnContainer && !card.querySelector('.product-price-tag')) {
      const priceTag = document.createElement('div');
      priceTag.className = 'product-price-tag font-headline-md text-[#1D1D1F] dark:text-white font-bold mb-3 mt-4';
      priceTag.innerHTML = `₹${(price * USD_TO_INR).toLocaleString('en-IN')}`;
      btnContainer.parentNode.insertBefore(priceTag, btnContainer);
    }
  });

  const buyButtons = Array.from(document.querySelectorAll('button, a')).filter(el => {
    const txt = el.textContent.trim().toLowerCase();
    const isBuyText = txt === 'buy' || txt === 'pre-order' || txt === 'buy now' || txt === 'add to bag' || el.hasAttribute('data-buy-btn');
    if (!isBuyText) return false;

    // If it's a link, only treat it as a cart action if it doesn't navigate to another page
    if (el.tagName.toLowerCase() === 'a') {
      const href = el.getAttribute('href');
      if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
        return false; // Let it navigate naturally
      }
    }
    return true;
  });

  buyButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      const card = btn.closest('.glass-card, .card, div[class*="rounded-"], div[class*="glass-"], td');
      let name = '';
      let image = '';
      
      if (card) {
        const nameEl = card.querySelector('h3, h2, .font-headline-lg, .text-headline-md, h4');
        if (nameEl) name = nameEl.textContent.trim();
        
        const imgEl = card.querySelector('img');
        if (imgEl) image = imgEl.getAttribute('src');
      }
      
      if (!name) name = document.querySelector('h1')?.textContent.trim() || 'Apple Product';
      if (!image) image = '/images/apple_vision_pro.jpg';
      
      const price = getProductPrice(name);
      addToCart({ name, price, image });
    });
  });

  updateCartBadge();
}

/* ─────────────────────────────────────────────
   3. MOBILE MENU
───────────────────────────────────────────── */
function initMobileMenu() {
  const menuBtn  = document.getElementById('mobile-menu-btn');
  const closeBtn = document.getElementById('mobile-menu-close');
  const menu     = document.getElementById('mobile-menu');
  if (!menuBtn || !closeBtn || !menu) return;

  const open = () => {
    menu.classList.remove('hidden');
    menu.classList.add('flex');
    menuBtn.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden'; // prevent scroll behind overlay
    // Focus trap — first link
    const firstLink = menu.querySelector('a');
    if (firstLink) firstLink.focus();
  };

  const close = () => {
    menu.classList.add('hidden');
    menu.classList.remove('flex');
    menuBtn.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
    menuBtn.focus();
  };

  menuBtn.addEventListener('click', open);
  closeBtn.addEventListener('click', close);

  // Close on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !menu.classList.contains('hidden')) close();
  });

  // Close when clicking outside the menu panel itself
  menu.addEventListener('click', (e) => {
    if (e.target === menu) close();
  });
}

/* ─────────────────────────────────────────────
   4. NAV SCROLL SHRINK EFFECT
───────────────────────────────────────────── */
function initNavScroll() {
  const nav = document.getElementById('main-nav');
  if (!nav) return;

  // Use IntersectionObserver instead of a scroll listener for better performance
  let ticking = false;
  const onScroll = () => {
    if (!ticking) {
      requestAnimationFrame(() => {
        if (window.scrollY > 50) {
          nav.classList.remove('top-4');
          nav.classList.add('top-2', 'shadow-xl');
        } else {
          nav.classList.add('top-4');
          nav.classList.remove('top-2', 'shadow-xl');
        }
        ticking = false;
      });
      ticking = true;
    }
  };

  window.addEventListener('scroll', onScroll, { passive: true });
}

/* ─────────────────────────────────────────────
   5. SCROLL REVEAL (IntersectionObserver)
   — unified, replaces both .reveal and .reveal-on-scroll
───────────────────────────────────────────── */
function initScrollReveal() {
  const options = {
    threshold: 0.08,
    rootMargin: '0px 0px -40px 0px',
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('reveal-active', 'active');
        observer.unobserve(entry.target); // fire once
      }
    });
  }, options);

  document.querySelectorAll('.reveal, .reveal-on-scroll').forEach(el => {
    observer.observe(el);
  });
}

/* ─────────────────────────────────────────────
   6. ACCESSIBLE COLOR SWATCH SWAPPER
   (AirPods Max / Watch color pickers)
───────────────────────────────────────────── */
function initColorSwatches() {
  document.querySelectorAll('[data-swatch-target]').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-swatch-target');
      const src      = btn.getAttribute('data-swatch-src');
      const img      = document.getElementById(targetId);
      if (!img || !src) return;
      img.src = src;
      // Update aria-pressed on siblings
      const parent = btn.closest('[data-swatch-group]');
      if (parent) {
        parent.querySelectorAll('[data-swatch-target]').forEach(s => {
          s.setAttribute('aria-pressed', s === btn ? 'true' : 'false');
        });
      }
    });
  });
}

/* ─────────────────────────────────────────────
   7. PARALLAX HERO (lightweight, rAF-throttled)
───────────────────────────────────────────── */
function initParallax() {
  const target = document.querySelector('.parallax-target');
  if (!target) return;

  let ticking = false;
  window.addEventListener('scroll', () => {
    if (!ticking) {
      requestAnimationFrame(() => {
        const y = window.scrollY * 0.2;
        target.style.transform = `translateY(${y}px)`;
        ticking = false;
      });
      ticking = true;
    }
  }, { passive: true });
}

/* ─────────────────────────────────────────────
   8. DYNAMIC WISHLIST HEARTS SYSTEM
───────────────────────────────────────────── */
async function initWishlistHearts(authenticated) {
  const cards = document.querySelectorAll('.glass-card, .card, div[class*="rounded-"], div[class*="glass-"]');
  if (!cards.length) return;

  const savedIds = new Set();
  if (authenticated) {
    try {
      const res = await apiFetch('/wishlist');
      if (res && res.ok) {
        const data = await res.json();
        (data.items || []).forEach(item => savedIds.add(item.productId));
      }
    } catch (e) {
      console.warn('[wishlist] Could not pre-fetch items:', e);
    }
  }

  cards.forEach(card => {
    if (card.hasAttribute('data-no-price')) return;

    const hasBuyBtn = Array.from(card.querySelectorAll('button, a')).some(el => {
      const txt = el.textContent.trim().toLowerCase();
      return txt === 'buy' || txt === 'pre-order' || txt === 'buy now' || txt === 'add to bag' || el.hasAttribute('data-buy-btn');
    });
    if (!hasBuyBtn) return;

    const nameEl = card.querySelector('h3, h2, .font-headline-lg, .text-headline-md, h4');
    if (!nameEl) return;
    const name = nameEl.textContent.trim();
    const productId = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

    if (window.getComputedStyle(card).position === 'static') {
      card.style.position = 'relative';
    }

    if (card.querySelector('.wishlist-heart-btn')) return;

    const isSaved = savedIds.has(productId);

    const heartBtn = document.createElement('button');
    heartBtn.type = 'button';
    heartBtn.className = 'wishlist-heart-btn absolute top-4 left-4 z-10 w-9 h-9 rounded-full bg-white/80 dark:bg-zinc-800/80 backdrop-blur-md shadow-md border border-[#D2D2D7]/20 flex items-center justify-center transition-all duration-300 hover:scale-110 active:scale-95';
    heartBtn.setAttribute('aria-label', isSaved ? 'Remove from wishlist' : 'Add to wishlist');
    heartBtn.setAttribute('data-product-id', productId);
    heartBtn.innerHTML = `<span class="material-symbols-outlined text-[20px] transition-colors" style="font-variation-settings: 'FILL' ${isSaved ? 1 : 0}; color: ${isSaved ? '#FF3B30' : '#8E8E93'}">favorite</span>`;

    heartBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (!authenticated) {
        showToast('Please sign in to save items to your wishlist.', 'error');
        return;
      }

      const iconEl = heartBtn.querySelector('.material-symbols-outlined');
      const alreadySaved = iconEl.style.fontVariationSettings.includes("'FILL' 1");

      if (alreadySaved) {
        try {
          const res = await apiFetch(`/wishlist/${encodeURIComponent(productId)}`, { method: 'DELETE' });
          if (res && res.ok) {
            iconEl.style.fontVariationSettings = "'FILL' 0";
            iconEl.style.color = '#8E8E93';
            heartBtn.setAttribute('aria-label', 'Add to wishlist');
            showToast(`Removed ${name} from Wishlist.`, 'success');
          } else {
            showToast('Failed to update wishlist.', 'error');
          }
        } catch {
          showToast('Connection error.', 'error');
        }
      } else {
        try {
          const res = await apiFetch('/wishlist', {
            method: 'POST',
            body: JSON.stringify({ productId }),
          });
          if (res && res.ok) {
            iconEl.style.fontVariationSettings = "'FILL' 1";
            iconEl.style.color = '#FF3B30';
            heartBtn.setAttribute('aria-label', 'Remove from wishlist');
            showToast(`Saved ${name} to Wishlist! ❤️`, 'success');
          } else {
            showToast('Failed to save item.', 'error');
          }
        } catch {
          showToast('Connection error.', 'error');
        }
      }
    });

    card.insertBefore(heartBtn, card.firstChild);
  });
}

/* ─────────────────────────────────────────────
   INIT — runs when DOM is ready
───────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', async () => {
  // Restore session silently
  const authenticated = await initAuth();

  // Guard store pages: redirect to signup.html if not logged in
  const path = window.location.pathname;
  const isAuthPage = path.includes('/login.html') || path.includes('/signup.html');

  if (!authenticated && !isAuthPage) {
    window.location.href = '/signup.html';
    return;
  }

  initCartButton();
  initMobileMenu();
  initNavScroll();
  initScrollReveal();
  initColorSwatches();
  initParallax();
  initWishlistHearts(authenticated);
});
