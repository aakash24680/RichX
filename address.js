// ===== RichX Address Page (WhatsApp + Firestore Order) =====

// ✅ Business WhatsApp number (no +, no spaces)
const ADMIN_WHATSAPP_NUMBER = "919518832695";

// ✅ Must match cart storage key used on your site
const CART_KEY = "richx_cart_v1";
const CHECKOUT_KEY = "richx_checkout_v1";

// Shipping rules
const FREE_SHIP_MIN = 499;
const SHIPPING_FEE = 59;

// ---------- Helpers ----------
function safeParseJSON(v) {
  try { return JSON.parse(v); } catch (e) { return null; }
}

// ---------- Checkout Selection (single item / all items) ----------
function getCheckoutSelection() {
  try {
    const raw = sessionStorage.getItem(CHECKOUT_KEY);
    const sel = safeParseJSON(raw);
    if (sel && typeof sel === "object" && (sel.mode === "single" || sel.mode === "all")) return sel;
  } catch (e) {}
  return { mode: "all" };
}

function getCheckoutCart(fullCart) {
  const sel = getCheckoutSelection();
  if (sel.mode !== "single") return { cart: fullCart, sel };
  const ids = Array.isArray(sel.ids) ? sel.ids.map(String) : [];
  const filtered = fullCart.filter(i => ids.includes(String(i.id)));
  return { cart: filtered, sel };
}

function saveFullCartAfterSync(sel, syncedSubset) {
  // When ordering a single item, sync results should be applied back to the full cart.
  try {
    if (!sel || sel.mode !== "single") {
      localStorage.setItem(CART_KEY, JSON.stringify(syncedSubset));
      return;
    }
    const full = safeParseJSON(localStorage.getItem(CART_KEY)) || [];
    const ids = (Array.isArray(sel.ids) ? sel.ids : []).map(String);
    const map = new Map(syncedSubset.map(i => [String(i.id), i]));
    const updated = [];
    for (const item of full) {
      const id = String(item.id);
      if (!ids.includes(id)) { updated.push(item); continue; }
      const synced = map.get(id);
      if (!synced) continue; // removed (out of stock)
      updated.push({ ...item, qty: synced.qty, stock: synced.stock });
    }
    localStorage.setItem(CART_KEY, JSON.stringify(updated));
  } catch (e) {}
}

function removeOrderedFromCart(orderedItems, sel) {
  try {
    if (!Array.isArray(orderedItems) || orderedItems.length === 0) return;
    if (sel && sel.mode !== "single") {
      // all items ordered
      localStorage.removeItem(CART_KEY);
      return;
    }
    const full = safeParseJSON(localStorage.getItem(CART_KEY)) || [];
    const byId = new Map(full.map(i => [String(i.id), { ...i }]));
    for (const o of orderedItems) {
      const id = String(o.id);
      const cur = byId.get(id);
      if (!cur) continue;
      const newQty = Number(cur.qty || 0) - Number(o.qty || 0);
      if (newQty <= 0) byId.delete(id);
      else { cur.qty = newQty; byId.set(id, cur); }
    }
    localStorage.setItem(CART_KEY, JSON.stringify(Array.from(byId.values())));
  } catch (e) {}
}

function clearCheckoutSelection() {
  try { sessionStorage.removeItem(CHECKOUT_KEY); } catch (e) {}
}


function getCart() {
  const data = safeParseJSON(localStorage.getItem(CART_KEY));
  return Array.isArray(data) ? data : [];
}

function pickImage(obj) {
  const img =
    (obj && (obj.img || obj.image || obj.imageUrl || obj.thumbnail)) ||
    (obj && Array.isArray(obj.images) ? obj.images[0] : "") ||
    "";
  return String(img || "").trim();
}

function normalizeCart(cart) {
  return cart.map((item) => {
    const qty = Number(item.qty ?? item.quantity ?? 1) || 1;

    const mrp = Number(item.mrp ?? item.originalPrice ?? item.price ?? 0) || 0;
    const discount = Number(item.discount ?? 0) || 0;
    const finalPrice = discount
      ? Math.round(mrp - (mrp * discount) / 100)
      : (Number(item.price) || mrp);

    return {
      id: item.id ?? item.productId ?? item._id ?? "",
      name: item.name ?? item.title ?? "Product",
      qty,
      mrp,
      discount,
      price: Number(finalPrice) || 0,
      img: pickImage(item),
    };
  });
}

function getStockFromProductDoc(data) {
  const s = Number(data?.stock ?? data?.qtyAvailable ?? data?.quantity ?? data?.inventory ?? data?.inStock);
  return Number.isFinite(s) ? s : 0;
}

// Live stock sync: remove OOS items + clamp qty to available stock
async function syncCartWithLiveStock(cart) {
  try {
    if (!window.db || !window.fs) return { cart, notes: [] };
    const { doc } = window.fs;
    const { getDoc } = await import(
      "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js"
    );

    const notes = [];
    const fixed = [];

    for (const item of cart) {
      const id = String(item.id);
      if (!id) continue;
      const snap = await getDoc(doc(window.db, "products", id));
      if (!snap.exists()) {
        fixed.push(item);
        continue;
      }
      const liveStock = getStockFromProductDoc(snap.data() || {});
      const qty = Number(item.qty || 0);

      if (liveStock <= 0) {
        notes.push(`${item.name || "Item"} is out of stock now and was removed.`);
        continue;
      }
      if (qty > liveStock) {
        notes.push(`${item.name || "Item"} qty updated to ${liveStock} (only few left).`);
        fixed.push({ ...item, qty: liveStock });
      } else {
        fixed.push(item);
      }
    }

    return { cart: fixed, notes };
  } catch (e) {
    console.log("syncCartWithLiveStock failed", e);
    return { cart, notes: [] };
  }
}

function calcTotals(cart) {
  const subtotal = cart.reduce((s, i) => s + (Number(i.price) * Number(i.qty)), 0);
  const shipping = subtotal > 0 && subtotal < FREE_SHIP_MIN ? SHIPPING_FEE : 0;
  const total = subtotal + shipping;
  return { subtotal, shipping, total };
}

function formatINR(n) {
  return "₹" + Number(n || 0).toLocaleString("en-IN");
}

function generateOrderId(len = 16) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function readCustomer() {
  return {
    name: document.getElementById("cust-name")?.value?.trim() || "",
    phone: document.getElementById("cust-phone")?.value?.trim() || "",
    email: document.getElementById("cust-email")?.value?.trim() || "",
    address: document.getElementById("cust-address")?.value?.trim() || "",
    city: document.getElementById("cust-city")?.value?.trim() || "",
    state: document.getElementById("cust-state")?.value?.trim() || "",
    pincode: document.getElementById("cust-pincode")?.value?.trim() || "",
    landmark: document.getElementById("cust-landmark")?.value?.trim() || "",
  };
}

function validateCustomer(c) {
  if (!c.name || !c.phone || !c.address || !c.city || !c.state || !c.pincode) return "Please fill all required fields.";
  if (!/^\d{10}$/.test(c.phone)) return "Mobile number must be 10 digits.";
  if (!/^\d{6}$/.test(c.pincode)) return "Pincode must be 6 digits.";
  return "";
}

// ---------- WhatsApp Message (same format you want) ----------
function buildWhatsAppMessage(orderId, c, cart, totals) {
  let msg = "Hello RichX, I would like to place an order for the following items:\n";
  msg += `Order ID: ${orderId}\n\n`;

  msg += "Customer Details\n";
  msg += `Name: ${c.name}\n`;
  msg += `Phone: ${c.phone}\n`;
  if (c.email) msg += `Email: ${c.email}\n`;
  msg += `Address: ${c.address}\n`;
  msg += `City/State: ${c.city}, ${c.state}\n`;
  msg += `Pincode: ${c.pincode}\n`;
  if (c.landmark) msg += `Landmark: ${c.landmark}\n`;
  msg += "\n----------------\n";

  cart.forEach((item) => {
    msg += `${item.name} x${item.qty} = ${formatINR(item.price * item.qty)}\n`;
  });

  msg += "----------------\n";
  msg += totals.shipping > 0 ? `Shipping: ${formatINR(totals.shipping)}\n` : `Shipping: FREE\n`;
  msg += `Total: ${formatINR(totals.total)}`;

  return msg;
}

// ---------- Firestore save with SAME document id as orderId ----------

// ---------- Merge same products (safety for bulk orders) ----------
function mergeSameProducts(items) {
  const map = new Map();
  for (const it of Array.isArray(items) ? items : []) {
    const pid = String(it.productId || it.id || "");
    const qty = Number(it.qty || 0);
    if (!pid || !Number.isFinite(qty) || qty <= 0) continue;
    const prev = map.get(pid) || { ...it, id: pid, productId: pid, qty: 0 };
    prev.qty = Number(prev.qty || 0) + qty;
    // keep latest name/price/img if present
    prev.name = it.name || prev.name;
    prev.price = Number(it.price ?? prev.price ?? 0);
    prev.img = it.img || prev.img || "";
    prev.mrp = Number(it.mrp ?? prev.mrp ?? 0);
    prev.discount = Number(it.discount ?? prev.discount ?? 0);
    map.set(pid, prev);
  }
  return Array.from(map.values());
}


async function saveOrderToFirestore(orderId, c, cart, totals) {
  // address.html exposes window.db and window.fs = { doc, setDoc, serverTimestamp }
  if (!window.db || !window.fs) return;

  const { doc, serverTimestamp, runTransaction } = window.fs;

  const mergedCart = mergeSameProducts(cart);

  const payload = {
    orderId,
    status: "PLACED",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    restocked: false,
    // Simple history (admin panel will append further)
    statusHistory: [
      { status: "PLACED", at: new Date().toISOString(), by: "customer" }
    ],
    customer: c,
    items: mergedCart.map((i) => ({
      productId: String(i.productId || i.id || ""),
      id: String(i.productId || i.id || ""),
      name: i.name,
      qty: i.qty,
      price: i.price,
      lineTotal: i.price * i.qty,
      img: i.img || "",
      mrp: i.mrp || 0,
      discount: i.discount || 0,
    })),
    subtotal: totals.subtotal,
    shipping: totals.shipping,
    total: totals.total,
    channel: "whatsapp",
  };

  // ✅ Atomic: validate stock + decrement + write order (single transaction)
  const orderRef = doc(window.db, "orders", orderId);
  const productRefs = mergedCart.map(i => doc(window.db, "products", String(i.id)));

  await runTransaction(window.db, async (tx) => {
    const snaps = [];
    for (const ref of productRefs) snaps.push(await tx.get(ref));

    // validate
    for (let idx = 0; idx < mergedCart.length; idx++) {
      const item = mergedCart[idx];
      const snap = snaps[idx];
      if (!snap.exists()) throw new Error("Product not found");
      const cur = getStockFromProductDoc(snap.data() || {});
      const qty = Number(item.qty || 0);
      if (qty <= 0) throw new Error("Invalid qty");
      if (cur < qty) throw new Error(`OUT_OF_STOCK:${item.id}:${cur}`);
    }

    // decrement
    for (let idx = 0; idx < mergedCart.length; idx++) {
      const item = mergedCart[idx];
      const snap = snaps[idx];
      const cur = getStockFromProductDoc(snap.data() || {});
      const qty = Number(item.qty || 0);
      tx.update(productRefs[idx], { stock: cur - qty });
    }

    tx.set(orderRef, payload);
  });
}

// ---------- UI render ----------
function renderSummary(cart) {
  const box = document.getElementById("order-items");
  const totalEl = document.getElementById("order-total");
  if (!box || !totalEl) return;

  box.innerHTML = "";

  if (!cart.length) {
    box.innerHTML = `<div class="text-sm text-gray-600">Cart is empty. Please go back and add products.</div>`;
    totalEl.textContent = "₹0";
    return;
  }

  cart.forEach((item) => {
    const lineTotal = item.price * item.qty;
    const imgSrc = item.img || "https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?w=900";
    box.innerHTML += `
      <div class="flex items-center gap-3 border rounded p-3">
        <img src="${imgSrc}" alt="${item.name}"
          style="width:56px;height:56px;object-fit:cover;border-radius:8px;border:1px solid #eee;">
        <div class="flex-1">
          <div class="font-semibold">${item.name}</div>
          <div class="text-sm text-gray-600">${formatINR(item.price)} × ${item.qty} = ${formatINR(lineTotal)}</div>
        </div>
      </div>
    `;
  });

  const totals = calcTotals(cart);
  totalEl.textContent = formatINR(totals.total);
}

function openWhatsApp(message) {
  const url = `https://wa.me/${ADMIN_WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
  window.location.href = url;
}

// ---------- Main ----------
async function placeOrderNow() {
  const msgEl = document.getElementById("form-msg");

  const customer = readCustomer();
  const err = validateCustomer(customer);
  if (err) {
    if (msgEl) msgEl.textContent = err;
    return;
  }
  if (msgEl) msgEl.textContent = "";

  const fullCart = normalizeCart(getCart());
  const { cart: initialCart, sel } = getCheckoutCart(fullCart);
  const synced = await syncCartWithLiveStock(initialCart);
  const cart = synced.cart;
  if (synced.notes.length) {
    saveFullCartAfterSync(sel, cart);
    alert(synced.notes.join("\n"));
    renderSummary(cart);
  }
  if (!cart.length) {
    alert("Cart empty hai. Back to Shop jaake product add karo.");
    return;
  }

  const totals = calcTotals(cart);
  const orderId = generateOrderId(16); // ✅ generate ONCE

  // ✅ Save + stock update atomically
  try {
    await saveOrderToFirestore(orderId, customer, cart, totals);
  } catch (e) {
    const msg = String(e?.message || e || "");
    if (msg.startsWith("OUT_OF_STOCK:")) {
      alert("Sorry! Stock change ho gaya. Cart refresh karke dubara try karo.");
      return;
    }
    console.log("Firestore save failed:", e);
    // Still allow WhatsApp even if Firestore fails
  }

  // ✅ WhatsApp message with SAME orderId
  // ✅ Remove only ordered items from cart (Flipkart-style)
  removeOrderedFromCart(cart, sel);
  clearCheckoutSelection();

  const message = buildWhatsAppMessage(orderId, customer, cart, totals);
  openWhatsApp(message);
}

// ---------- Init ----------
document.addEventListener("DOMContentLoaded", () => {
  // Render summary (with live stock sync)
  (async () => {
    const cart0 = normalizeCart(getCart());
    const synced = await syncCartWithLiveStock(cart0);
    if (synced.notes.length) {
      localStorage.setItem(CART_KEY, JSON.stringify(synced.cart));
      alert(synced.notes.join("\n"));
    }
    renderSummary(synced.cart);
  })();

  // Buttons
  document.getElementById("btn-edit-cart")?.addEventListener("click", () => {
    window.location.href = "index.html";
  });

  document.getElementById("btn-place")?.addEventListener("click", (e) => {
    e.preventDefault();
    placeOrderNow();
  });

  // safety: prevent form submit reload
  document.getElementById("address-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    placeOrderNow();
  });
});
