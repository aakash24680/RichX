// cart.js (GitHub Pages compatible) - Shipping + Free Shipping Bar
const CART_KEY = "richx_cart_v1";
const CHECKOUT_KEY = "richx_checkout_v1";
const FREE_SHIP_MIN = 499;
const SHIPPING_FEE  = 59;

let cart = JSON.parse(localStorage.getItem(CART_KEY) || "[]");

// --- Lightweight alert area inside cart sidebar ---
function showCartAlert(msg, type = "warn") {
  const el = document.getElementById("cart-alert");
  if (!el) return;
  el.classList.remove("hidden");

  // simple tailwind-ish colors without needing new CSS
  const cls = {
    ok: "bg-green-50 text-green-700 border border-green-200",
    warn: "bg-yellow-50 text-yellow-800 border border-yellow-200",
    err: "bg-red-50 text-red-700 border border-red-200",
  }[type] || "bg-yellow-50 text-yellow-800 border border-yellow-200";

  el.className = `px-4 py-2 text-sm ${cls}`;
  el.textContent = msg;
}
function hideCartAlert() {
  const el = document.getElementById("cart-alert");
  if (!el) return;
  el.classList.add("hidden");
  el.textContent = "";
}

function getStock(product) {
  const s = Number(product?.stock ?? product?.qtyAvailable ?? product?.quantity ?? product?.inventory);
  return Number.isFinite(s) ? s : 0;
}


function normalizeCart() {
  let changed = false;
  cart = (Array.isArray(cart) ? cart : []).map((item) => {
    const mrp = Number(item.mrp ?? item.price ?? 0);
    const disc = Number(item.discount ?? 0);

    // If item.mrp missing and discount exists, assume stored price was MRP
    if ((item.mrp == null || item.mrp === "") && disc > 0 && Number(item.price) === mrp) {
      const final = Math.round(mrp * (1 - disc / 100));
      if (!Number.isNaN(final) && final > 0) {
        item = { ...item, mrp: mrp, price: final };
        changed = true;
      }
    }

    // If price is NaN but mrp exists, fix
    if (Number.isNaN(Number(item.price)) && mrp > 0) {
      item = { ...item, price: disc > 0 ? Math.round(mrp * (1 - disc / 100)) : mrp };
      changed = true;
    }
    return item;
  });

  if (changed) saveCart();
}

normalizeCart();

function saveCart() {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
}

function toggleCart() {
  const sidebar = document.getElementById("cart-sidebar");
  if (sidebar) {
    const willOpen = sidebar.classList.contains("translate-x-full");
    sidebar.classList.toggle("translate-x-full");
    // When opening, sync with latest stock
    if (willOpen) {
      syncCartStock().then(() => updateCart());
    }
  }
}
window.toggleCart = toggleCart;

// --- Sync cart with latest Firestore stock ---
async function syncCartStock() {
  try {
    if (!window.db) return;
    const cartNow = JSON.parse(localStorage.getItem(CART_KEY) || "[]");
    if (!Array.isArray(cartNow) || cartNow.length === 0) {
      hideCartAlert();
      return;
    }

    const { doc, getDoc } = await import(
      "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js"
    );

    let changed = false;
    const notes = [];

    for (const item of cartNow) {
      const id = String(item.id);
      if (!id) continue;
      const snap = await getDoc(doc(window.db, "products", id));
      if (!snap.exists()) continue;

      const data = snap.data() || {};
      const liveStock = getStock(data);
      const oldStock = Number(item.stock ?? 0);
      if (liveStock !== oldStock) {
        item.stock = liveStock;
        changed = true;
      }

      const qty = Number(item.qty || 0);
      if (liveStock <= 0) {
        // remove out of stock item
        item.__remove = true;
        changed = true;
        notes.push(`${item.name || "Item"} is now out of stock and was removed.`);
        continue;
      }
      if (qty > liveStock) {
        item.qty = liveStock;
        changed = true;
        notes.push(`${item.name || "Item"} qty updated to ${liveStock} (only few left).`);
      }
    }

    const filtered = cartNow.filter(i => !i.__remove);
    if (changed) {
      localStorage.setItem(CART_KEY, JSON.stringify(filtered));
    }

    if (notes.length) {
      showCartAlert(notes.join(" "), "warn");
    } else {
      hideCartAlert();
    }
  } catch (e) {
    // fail silently (static site)
    console.log("syncCartStock failed", e);
  }
}
window.syncCartStock = syncCartStock;

function addToCart(product) {
  const id = String(product.id);
  const stock = getStock(product);
  if (stock <= 0) {
    alert("Out of stock");
    return;
  }

  // ✅ Always compute latest prices (discounted)
  const mrp = Number(product.mrp ?? product.price ?? 0);
  const discount = Number(product.discount ?? 0); // percent
  const finalPrice = discount ? Math.round(mrp - (mrp * discount) / 100) : mrp;

  const existing = cart.find(i => String(i.id) === id);

  if (existing) {
    const maxStock = Number(existing.stock ?? stock);
    if (Number(existing.qty || 0) >= maxStock) {
      alert(`Only ${maxStock} left in stock`);
      return;
    }
    existing.qty += 1;

    // ✅ Update values so old saved MRP doesn't stay
    existing.name = product.name ?? existing.name;
    existing.img = product.img ?? existing.img;

    existing.mrp = mrp;                 // original price
    existing.discount = discount;       // %
    existing.price = finalPrice;        // discounted price
    existing.stock = stock;
  } else {
    cart.push({
      ...product,
      id,
      qty: 1,
      mrp: mrp,
      discount: discount,
      price: finalPrice,
      stock: stock
    });
  }

  saveCart();
  updateCart();
}
window.addToCart = addToCart;


function buyNow(id) {
  // Save selection for checkout page: single item
  try {
    const payload = { mode: "single", ids: [String(id)] };
    sessionStorage.setItem(CHECKOUT_KEY, JSON.stringify(payload));
  } catch (e) {}
  window.location.href = "address.html";
}
window.buyNow = buyNow;

function changeQty(id, delta) {
  const item = cart.find(i => String(i.id) === String(id));
  if (!item) return;
  const current = Number(item.qty || 0);
  const maxStock = Number(item.stock ?? 0);
  if (delta > 0 && maxStock > 0 && current >= maxStock) {
    alert(`Only ${maxStock} left in stock`);
    return;
  }
  item.qty = current + delta;
  if (item.qty <= 0) {
    cart = cart.filter(i => String(i.id) !== String(id));
  }
  saveCart();
  updateCart();
}
window.changeQty = changeQty;

function setQty(id, value) {
  const item = cart.find(i => String(i.id) === String(id));
  if (!item) return;

  let qty = parseInt(value, 10);
  if (Number.isNaN(qty)) {
    // If input cleared, revert to previous qty on next render
    updateCart();
    return;
  }

  const maxStock = Number(item.stock ?? 0);
  if (qty < 1) qty = 1;
  if (maxStock > 0 && qty > maxStock) {
    qty = maxStock;
    alert(`Only ${maxStock} left in stock`);
  }

  item.qty = qty;
  saveCart();
  updateCart();
}
window.setQty = setQty;

function removeItem(id) {
  cart = cart.filter(i => String(i.id) !== String(id));
  saveCart();
  updateCart();
}
window.removeItem = removeItem;

function calcTotals() {
  const subtotal = cart.reduce((s, i) => s + (Number(i.price || 0) * Number(i.qty || 0)), 0);
  const shipping = (subtotal > 0 && subtotal < FREE_SHIP_MIN) ? SHIPPING_FEE : 0;
  const grandTotal = subtotal + shipping;
  return { subtotal, shipping, grandTotal };
}

function updateFreeShipUI(subtotal) {
  const freeText = document.getElementById("free-ship-text");
  const freeBar = document.getElementById("free-ship-bar");
  const freeStatus = document.getElementById("free-ship-status");
  const freeBox = document.getElementById("free-ship-box");

  if (!freeBox) return;

  if (subtotal <= 0) {
    if (freeText) freeText.textContent = "Add items to unlock FREE shipping";
    if (freeStatus) freeStatus.textContent = "";
    if (freeBar) freeBar.style.width = "0%";
    return;
  }

  if (subtotal >= FREE_SHIP_MIN) {
    if (freeText) freeText.textContent = "🎉 You unlocked FREE shipping";
    if (freeStatus) freeStatus.textContent = "FREE";
    if (freeBar) freeBar.style.width = "100%";
    return;
  }

  const remaining = FREE_SHIP_MIN - subtotal;
  const pct = Math.max(0, Math.min(100, Math.round((subtotal / FREE_SHIP_MIN) * 100)));
  if (freeText) freeText.textContent = `Add ₹${remaining.toLocaleString("en-IN")} more for FREE shipping`;
  if (freeStatus) freeStatus.textContent = "";
  if (freeBar) freeBar.style.width = `${pct}%`;
}

function updateCart() {
  // Refresh cart from storage in case other scripts updated it
  cart = JSON.parse(localStorage.getItem(CART_KEY) || "[]");
  normalizeCart();

  const count = cart.reduce((s, i) => s + (Number(i.qty || 0)), 0);
  const { subtotal, shipping, grandTotal } = calcTotals();

  const cartCount = document.getElementById("cart-count");
  const cartTotal = document.getElementById("cart-total");
  const cartSubtotalEl = document.getElementById("cart-subtotal");
  const cartShippingEl = document.getElementById("cart-shipping");
  const cartItemsEl = document.getElementById("cart-items");

  if (cartCount) cartCount.textContent = (count > 99 ? "99+" : String(count));
  if (cartTotal) cartTotal.textContent = `₹${grandTotal.toLocaleString("en-IN")}`;
  if (cartSubtotalEl) cartSubtotalEl.textContent = `₹${subtotal.toLocaleString("en-IN")}`;
  if (cartShippingEl) cartShippingEl.textContent = `₹${shipping.toLocaleString("en-IN")}`;

  updateFreeShipUI(subtotal);

  if (!cartItemsEl) return;

  if (cart.length === 0) {
    cartItemsEl.innerHTML = `<p class="text-center text-gray-500 mt-10">Cart is empty</p>`;
    return;
  }

  cartItemsEl.innerHTML = cart.map(item => `
    <div class="flex flex-wrap gap-3 items-center border p-3 rounded mb-3 w-full overflow-hidden">
      <img src="${item.image || ''}" class="w-16 h-16 object-cover rounded" />
      <div class="flex-1 min-w-0">
        <h4 class="font-semibold break-words">${item.name || ''}</h4>
        <p class="text-sm text-gray-600">₹${Number(item.price||0).toLocaleString("en-IN")} × ${item.qty || 0}</p>
        <div class="flex flex-wrap items-center gap-2 mt-2">
          <button class="px-2 py-1 border rounded" onclick="changeQty('${item.id}', -1)">-</button>
          <input
            type="number"
            class="w-20 px-2 py-1 border rounded text-center"
            min="1"
            max="${Number(item.stock ?? 0) > 0 ? Number(item.stock) : 999999}"
            value="${Number(item.qty || 0)}"
            onblur="setQty('${item.id}', this.value)"
            onchange="setQty('${item.id}', this.value)"
          />
          <button class="px-2 py-1 border rounded" onclick="changeQty('${item.id}', 1)">+</button>
          <span class="text-xs text-gray-500">${Number(item.stock ?? 0) > 0 ? `/${Number(item.stock)} available` : ''}</span>
        </div>
      </div>
      <div class="flex flex-col gap-2 items-end shrink-0">
        <button class="px-3 py-1 border rounded bg-black text-white text-sm" onclick="buyNow('${item.id}')">Buy</button>
        <button class="text-red-500 text-sm" onclick="removeItem('${item.id}')">Remove</button>
      </div>
    </div>
  `).join('');
}
window.updateCart = updateCart;

// Make sure UI is correct on load
document.addEventListener("DOMContentLoaded", async () => {
  await syncCartStock();
  updateCart();
});
