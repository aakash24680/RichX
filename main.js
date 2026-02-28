// js/main.js

let products = [];
let currentCategory = "all";

const CART_KEY = "richx_cart_v1";

function readCart() {
  try {
    const raw = localStorage.getItem(CART_KEY);
    const arr = JSON.parse(raw || "[]");
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}
function isInCart(id) {
  const cid = String(id);
  return readCart().some(i => String(i.id) === cid);
}
function openCartSidebar() {
  const sidebar = document.getElementById("cart-sidebar");
  if (!sidebar) return;
  // ensure OPEN (toggleCart() would close if already open)
  if (sidebar.classList.contains("translate-x-full")) {
    if (typeof window.toggleCart === "function") window.toggleCart();
    else sidebar.classList.remove("translate-x-full");
  }
}
function updateModalAddBtnState(p) {
  const btn = document.getElementById("modal-add-btn");
  if (!btn) return;

  const s = getStock(p);
  if (s <= 0) {
    btn.disabled = true;
    btn.classList.add("opacity-50","cursor-not-allowed");
    btn.textContent = "Out of Stock";
    btn.onclick = null;
    return;
  }

  btn.disabled = false;
  btn.classList.remove("opacity-50","cursor-not-allowed");

  if (isInCart(p.id)) {
    btn.textContent = "Go to Cart";
    btn.onclick = () => {
      openCartSidebar();
      closeProductModal();
    };
  } else {
    btn.textContent = "Add to Cart";
    btn.onclick = () => {
      addToCart(p);
      // update UI -> Go to Cart
      renderProducts();
      updateModalAddBtnState(p);
    };
  }
}


// ===== Firebase readiness (prevents "products load" error on back navigation) =====
function waitForFirebaseDB(timeoutMs = 8000, intervalMs = 50) {
  // Works even if you DIDN'T add firebase-ready event in HTML (uses polling + optional event).
  if (window.db) return Promise.resolve();

  return new Promise((resolve, reject) => {
    let done = false;

    const finishOk = () => {
      if (done) return;
      done = true;
      cleanup();
      resolve();
    };
    const finishErr = () => {
      if (done) return;
      done = true;
      cleanup();
      reject(new Error("FIREBASE_DB_TIMEOUT"));
    };

    const startedAt = Date.now();

    const tick = () => {
      if (window.db) return finishOk();
      if (Date.now() - startedAt >= timeoutMs) return finishErr();
    };

    const timer = setInterval(tick, intervalMs);

    function onReady() {
      if (window.db) finishOk();
    }
    window.addEventListener("firebase-ready", onReady);

    const cleanup = () => {
      clearInterval(timer);
      window.removeEventListener("firebase-ready", onReady);
    };

    // first tick immediately
    tick();
  });
}

// ====== Firestore: Load Products ======
async function loadProductsFromFirestore() {
  const { collection, getDocs } = await import(
    "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js"
  );

  const db = window.db;
  if (!db) throw new Error("FIREBASE_DB_NOT_READY");
  const snap = await getDocs(collection(db, "products"));

  const list = [];
  snap.forEach((doc) => {
    list.push({
      id: doc.id,
      ...doc.data()
    });
  });

  return list;
}

// ===== Helpers =====
function finalPrice(p) {
  const price = Number(p.price || 0);
  const disc = Number(p.discount || 0);
  if (!disc) return price;
  return Math.round(price * (1 - disc / 100));
}

function formatINR(n) {
  const num = Number(n || 0);
  return `₹${num.toLocaleString("en-IN")}`;
}

// ===== Stock Helpers =====
function getStock(p) {
  const s = Number(p?.stock ?? p?.qty ?? p?.quantity ?? p?.inventory ?? p?.inStock);
  return Number.isFinite(s) ? s : 0;
}
function stockBadgeHTML(p) {
  const s = getStock(p);
  if (s <= 0) return `<div class="mt-2 text-xs font-semibold text-red-600">Out of stock</div>`;
  if (s <= 5) return `<div class="mt-2 text-xs font-semibold text-orange-600">Hurry! Only ${s} left</div>`;
  if (s <= 20) return `<div class="mt-2 text-xs text-green-700">${s} left</div>`;
  return `<div class="mt-2 text-xs text-gray-500">In stock</div>`;
}


// ===== Render Products =====
function renderProducts() {
  const grid = document.getElementById("product-grid");
  if (!grid) return;

  const list = (currentCategory === "all")
    ? products
    : products.filter(p => (p.category || "").toLowerCase() === currentCategory);

  grid.innerHTML = "";

  list.forEach((p) => {
    const fp = finalPrice(p);
    const hasDisc = Number(p.discount || 0) > 0;

    // product image
    const img =
      p.image ||
      (Array.isArray(p.images) ? p.images[0] : "") ||
      "https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?w=900";

    const card = document.createElement("div");
    card.className = "bg-white rounded shadow overflow-hidden flex flex-col cursor-pointer product-card";
    card.innerHTML = `
      <div class="relative h-[320px]">
        <img src="${img}" class="w-full h-full object-cover" alt="${p.name || "Product"}">
        ${hasDisc ? `<span class="absolute top-2 left-2 bg-red-500 text-white text-xs px-2 py-1 rounded">${p.discount}% OFF</span>` : ""}
      </div>

      <div class="p-4 flex flex-col flex-1">
        <h3 class="font-semibold">${p.name || "Unnamed Product"}</h3>

        <div class="mt-2">
          <span class="gold font-bold">${formatINR(fp)}</span>
          ${hasDisc ? `<span class="line-through text-gray-400 text-sm ml-2">${formatINR(p.price)}</span>` : ""}
        </div>

        ${stockBadgeHTML(p)}

        <button class="mt-auto w-full bg-black text-white py-2 rounded btn-anim ${getStock(p) <= 0 ? "opacity-50 cursor-not-allowed" : ""}"
          data-add="${p.id}" ${getStock(p) <= 0 ? "disabled" : ""}>
          ${
            getStock(p) <= 0
              ? "Out of Stock"
              : (isInCart(p.id) ? "Go to Cart" : "Add to Cart")
          }
        </button>

        <button class="mt-2 w-full bg-gray-100 text-black py-2 rounded btn-anim"
          data-view="${p.id}">
          View Details
        </button>
      </div>
    `;

    grid.appendChild(card);
  });

  // Card click handlers (event delegation)
  grid.onclick = (e) => {
    const addBtn = e.target.closest("[data-add]");
    const viewBtn = e.target.closest("[data-view]");

    if (addBtn) {
      const id = addBtn.getAttribute("data-add");
      if (isInCart(id)) {
        openCartSidebar();
        return;
      }
      const p = products.find(x => String(x.id) === String(id));
      if (p) {
        addToCart(p);
        // re-render so button becomes "Go to Cart"
        renderProducts();
      }
      return;
    }

    if (viewBtn) {
      const id = viewBtn.getAttribute("data-view");
      const p = products.find(x => String(x.id) === String(id));
      if (p) openProductModal(p);
      return;
    }
  };
}

// ===== Category filter (HTML button passes this) =====
function filterProducts(cat, el) {
  currentCategory = cat;

  document.querySelectorAll(".category-btn").forEach(b => b.classList.remove("active"));
  if (el) el.classList.add("active");

  renderProducts();
}
window.filterProducts = filterProducts;

// ===== Modal with multiple images =====
let modalProduct = null;
let slideIndex = 0;

function openProductModal(p) {
  modalProduct = p;
  slideIndex = 0;

  const modal = document.getElementById("product-modal");
  const title = document.getElementById("modal-title");
  const mainImg = document.getElementById("modal-main-image");
  const thumbs = document.getElementById("modal-thumbs");

  const fp = finalPrice(p);
  const hasDisc = Number(p.discount || 0) > 0;

  document.getElementById("modal-final-price").textContent = formatINR(fp);
  document.getElementById("modal-mrp").textContent = hasDisc ? formatINR(p.price) : "";
  document.getElementById("modal-discount").textContent = hasDisc ? `${p.discount}% OFF` : "";
  document.getElementById("modal-short").textContent = p.short || p.desc || p.description || "";

  // Stock UI
  const stockEl = document.getElementById("modal-stock");
  const s = getStock(p);
  if (stockEl) stockEl.innerHTML = stockBadgeHTML(p).replace('mt-2',''); // reuse same labels
  const modalAddBtn = document.getElementById("modal-add-btn");
  if (modalAddBtn) {
    // state handled below (Add to Cart / Go to Cart / Out of Stock)
  }

  document.getElementById("modal-material").textContent = p.material || "Premium";
  document.getElementById("modal-finish").textContent = p.finish || "Glossy";
  document.getElementById("modal-color").textContent = p.color || "Gold";
  document.getElementById("modal-occasion").textContent = p.occasion || "Party / Daily";
  document.getElementById("modal-care").textContent = p.care || "Keep away from water/perfume";

  title.textContent = p.name || "Product";

  const imgs = Array.isArray(p.images) && p.images.length ? p.images : [p.image].filter(Boolean);
  const safeImgs = imgs.length ? imgs : ["https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?w=900"];

  const shimmer = document.getElementById("modal-shimmer");

  // show shimmer while loading
  if (shimmer) shimmer.style.display = "block";
  mainImg.style.opacity = "0";

  // when image loads, hide shimmer
  mainImg.onload = () => {
    if (shimmer) shimmer.style.display = "none";
    mainImg.style.opacity = "1";
  };

  // set image
  mainImg.src = safeImgs[0];

  // thumbs
  thumbs.innerHTML = "";
  safeImgs.forEach((src, idx) => {
    const t = document.createElement("button");
    t.className = "thumb btn-anim";
    t.innerHTML = `<img src="${src}" alt="thumb" />`;
    t.onclick = () => {
      slideIndex = idx;
      if (shimmer) shimmer.style.display = "block";
      mainImg.style.opacity = "0";
      mainImg.src = safeImgs[slideIndex];
    };
    thumbs.appendChild(t);
  });

  // Add to cart / Go to cart button in modal
  updateModalAddBtnState(p);

  modal.classList.remove("hidden");
}
window.openProductModal = openProductModal;

function closeProductModal() {
  document.getElementById("product-modal").classList.add("hidden");
  modalProduct = null;
}
window.closeProductModal = closeProductModal;

function prevSlide() {
  if (!modalProduct) return;
  const mainImg = document.getElementById("modal-main-image");
  const imgs = Array.isArray(modalProduct.images) && modalProduct.images.length ? modalProduct.images : [modalProduct.image].filter(Boolean);
  const safeImgs = imgs.length ? imgs : ["https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?w=900"];

  slideIndex = (slideIndex - 1 + safeImgs.length) % safeImgs.length;
  const shimmer = document.getElementById("modal-shimmer");
  if (shimmer) shimmer.style.display = "block";
  mainImg.style.opacity = "0";

  mainImg.onload = () => {
    if (shimmer) shimmer.style.display = "none";
    mainImg.style.opacity = "1";
  };

  mainImg.src = safeImgs[slideIndex];
}
window.prevSlide = prevSlide;

function nextSlide() {
  if (!modalProduct) return;
  const mainImg = document.getElementById("modal-main-image");
  const imgs = Array.isArray(modalProduct.images) && modalProduct.images.length ? modalProduct.images : [modalProduct.image].filter(Boolean);
  const safeImgs = imgs.length ? imgs : ["https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?w=900"];

  slideIndex = (slideIndex + 1) % safeImgs.length;
  const shimmer = document.getElementById("modal-shimmer");
  if (shimmer) shimmer.style.display = "block";
  mainImg.style.opacity = "0";

  mainImg.onload = () => {
    if (shimmer) shimmer.style.display = "none";
    mainImg.style.opacity = "1";
  };

  mainImg.src = safeImgs[slideIndex];
}
window.nextSlide = nextSlide;

function enquireOnWhatsApp() {
  if (!modalProduct) return;
  const phone = "919518832695";
  const msg = `Hi RichX! I want to enquire about: ${modalProduct.name || "Product"}`;
  window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, "_blank");
}
window.enquireOnWhatsApp = enquireOnWhatsApp;

// ===== Small UI animations =====
function setupScrollReveal() {
  const els = document.querySelectorAll(".animate-on-scroll");
  if (!els.length) return;

  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (en.isIntersecting) en.target.classList.add("in-view");
    });
  }, { threshold: 0.12 });

  els.forEach(el => io.observe(el));
}

function setupHeroLoaded() {
  window.addEventListener("load", () => document.body.classList.add("page-loaded"));
}


// Keep product buttons in sync when cart changes
window.addEventListener("richx-cart-changed", () => {
  try {
    renderProducts();
    if (modalProduct) updateModalAddBtnState(modalProduct);
  } catch (e) {}
});

// ===== Init =====
async function init() {
  setupHeroLoaded();
  setupScrollReveal();

  try {
    await waitForFirebaseDB();
    products = await loadProductsFromFirestore();
    renderProducts();
  } catch (e) {
    console.error("Firestore load error:", e);
    const grid = document.getElementById("product-grid");
    if (grid) {
      grid.innerHTML = `<p class="text-center text-red-600 col-span-full">
        Please Refresh.
      </p>`;
    }
  }

  // cart init
  updateCart();
}

init();


// ✅ Checkout: open address page
function checkout() {
  try {
    if (!Array.isArray(cart) || cart.length === 0) {
      alert('Cart is empty');
      return;
    }
  } catch (e) {
    // cart not accessible
  }
  try {
    sessionStorage.setItem(CHECKOUT_KEY, JSON.stringify({ mode: "all" }));
  } catch (e) {}
  window.location.href = 'address.html';
}
