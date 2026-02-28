// js/admin.js (module) - WITHOUT Firebase Storage (No billing)
// Admin login (Auth) + Products Add/Edit/Delete (Firestore) + Orders view/update (Firestore)

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";

import {
  getFirestore,
  collection,
  addDoc,
  getDocs,
  doc,
  runTransaction,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  query,
  orderBy,
  increment
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";

// ===== Firebase Config (same as site) =====
const firebaseConfig = {
  apiKey: "AIzaSyAa32YSDn1NIXnrEElVqMU76haD17jJM1s",
  authDomain: "richxbackend.firebaseapp.com",
  projectId: "richxbackend",
  storageBucket: "richxbackend.firebasestorage.app",
  messagingSenderId: "420980254362",
  appId: "1:420980254362:web:25b0b1a59521d584a22123",
  measurementId: "G-DRRF90JL9T"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ===== UI Refs =====
const loginBox = document.getElementById("login-box");
const dash = document.getElementById("dash");
const btnLogout = document.getElementById("btn-logout");

const loginEmail = document.getElementById("login-email");
const loginPass = document.getElementById("login-pass");
const btnLogin = document.getElementById("btn-login");
const loginMsg = document.getElementById("login-msg");

// product inputs
const pId = document.getElementById("p-id");
const editBadge = document.getElementById("edit-badge");

const pName = document.getElementById("p-name");
const pPrice = document.getElementById("p-price");
const pDiscount = document.getElementById("p-discount");
const pStock = document.getElementById("p-stock");
const pCategory = document.getElementById("p-category");
const pFinish = document.getElementById("p-finish");
const pMaterial = document.getElementById("p-material");
const pColor = document.getElementById("p-color");
const pShort = document.getElementById("p-short");
const pOccasion = document.getElementById("p-occasion");
const pCare = document.getElementById("p-care");
const pImagesUrls = document.getElementById("p-images-urls");
const pMsg = document.getElementById("p-msg");

const btnSaveProduct = document.getElementById("btn-save-product");
const btnClear = document.getElementById("btn-clear");
const productsList = document.getElementById("products-list");
const btnRefreshProducts = document.getElementById("btn-refresh-products");

// orders
const ordersList = document.getElementById("orders-list");
const btnRefreshOrders = document.getElementById("btn-refresh-orders");

// ===== Tabs =====
document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");

    const tab = btn.dataset.tab;
    document.getElementById("tab-products").classList.toggle("hidden", tab !== "products");
    document.getElementById("tab-orders").classList.toggle("hidden", tab !== "orders");
  });
});

// ===== Auth =====
btnLogin.addEventListener("click", async () => {
  loginMsg.textContent = "";
  try {
    await signInWithEmailAndPassword(auth, loginEmail.value.trim(), loginPass.value);
  } catch (e) {
    console.error(e);
    loginMsg.textContent = e?.message || "Login failed";
  }
});

btnLogout.addEventListener("click", async () => {
  await signOut(auth);
});

onAuthStateChanged(auth, (user) => {
  if (user) {
    loginBox.classList.add("hidden");
    dash.classList.remove("hidden");
    btnLogout.classList.remove("hidden");
    loadProducts();
    loadOrders();
  } else {
    loginBox.classList.remove("hidden");
    dash.classList.add("hidden");
    btnLogout.classList.add("hidden");
  }
});

// ===== Helpers =====
function valNum(el, fallback = 0) {
  const n = Number(el.value);
  return Number.isFinite(n) ? n : fallback;
}

function setMsg(el, text, ok = true) {
  el.textContent = text;
  el.className = ok ? "text-sm mt-3 text-green-600" : "text-sm mt-3 text-red-600";
}

function cleanUrl(u) {
  return (u || "").trim().replace(/^"+|"+$/g, "");
}

function parseImageUrls(text) {
  const lines = (text || "")
    .split("\n")
    .map(cleanUrl)
    .filter(Boolean);
  return lines.filter(u => /^https?:\/\/.+/i.test(u));
}

function setEditMode(on) {
  if (!editBadge) return;
  editBadge.classList.toggle("hidden", !on);
}

function clearForm() {
  pId.value = "";
  setEditMode(false);

  pName.value = "";
  pPrice.value = "";
  pDiscount.value = "";
  pStock.value = "";
  pCategory.value = "necklace";
  pFinish.value = "";
  pMaterial.value = "";
  pColor.value = "";
  pShort.value = "";
  pOccasion.value = "";
  pCare.value = "";
  pImagesUrls.value = "";
  pMsg.textContent = "";
}
btnClear.addEventListener("click", clearForm);

// Fill form for edit
function fillFormForEdit(p) {
  pId.value = p.id || "";
  setEditMode(true);

  pName.value = p.name || "";
  pPrice.value = Number(p.price || 0) || "";
  pDiscount.value = Number(p.discount || 0) || "";
  pStock.value = (p.stock ?? p.qty ?? p.quantity ?? "") !== "" ? Number(p.stock ?? p.qty ?? p.quantity ?? 0) : "";
  pCategory.value = (p.category || "necklace").toLowerCase();
  pFinish.value = p.finish || "";
  pMaterial.value = p.material || "";
  pColor.value = p.color || "";
  pShort.value = p.short || p.desc || p.description || "";
  pOccasion.value = p.occasion || "";
  pCare.value = p.care || "";

  const imgs = Array.isArray(p.images) ? p.images : (p.image ? [p.image] : []);
  pImagesUrls.value = imgs.join("\n");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ===== Save Product (Add or Edit) =====
btnSaveProduct.addEventListener("click", async () => {
  try {
    setMsg(pMsg, "Saving...", true);

    const name = pName.value.trim();
    if (!name) return setMsg(pMsg, "Name required", false);

    const images = parseImageUrls(pImagesUrls.value);

    const data = {
      name,
      price: valNum(pPrice, 0),
      discount: valNum(pDiscount, 0),
      stock: valNum(pStock, 0),
      category: (pCategory.value || "necklace").toLowerCase(),
      finish: pFinish.value.trim(),
      material: pMaterial.value.trim(),
      color: pColor.value.trim(),
      short: pShort.value.trim(),
      occasion: pOccasion.value.trim(),
      care: pCare.value.trim(),
      images,
      image: images[0] || "",
      updatedAt: serverTimestamp()
    };

    const id = (pId.value || "").trim();

    if (id) {
      // EDIT
      await updateDoc(doc(db, "products", id), data);
      setMsg(pMsg, "✅ Product updated!", true);
    } else {
      // NEW
      await addDoc(collection(db, "products"), {
        ...data,
        createdAt: serverTimestamp()
      });
      setMsg(pMsg, "✅ Product added!", true);
    }

    clearForm();
    loadProducts();

  } catch (e) {
    console.error(e);
    setMsg(pMsg, e?.message || "Save failed", false);
  }
});

// ===== Load Products =====
let productsCache = [];

async function loadProducts() {
  productsList.innerHTML = `<p class="text-sm text-gray-500">Loading...</p>`;

  const snap = await getDocs(collection(db, "products"));
  const list = [];
  snap.forEach(d => list.push({ id: d.id, ...d.data() }));
  productsCache = list;

  if (!list.length) {
    productsList.innerHTML = `<p class="text-sm text-gray-500">No products yet.</p>`;
    return;
  }

  productsList.innerHTML = list.map(p => {
    const img = p.image || (Array.isArray(p.images) ? p.images[0] : "") || "";
    const price = Number(p.price || 0);
    const disc = Number(p.discount || 0);
    const countImgs = Array.isArray(p.images) ? p.images.length : (p.image ? 1 : 0);

    return `
      <div class="border rounded-lg p-3 bg-white">
        <div class="flex gap-3">
          <div class="w-14 h-14 bg-gray-100 rounded overflow-hidden flex items-center justify-center">
            ${img ? `<img src="${img}" class="w-full h-full object-cover">` : `<span class="text-xs text-gray-400">No img</span>`}
          </div>

          <div class="flex-1">
            <div class="font-semibold">${p.name || "Unnamed"}</div>
            <div class="text-sm text-gray-600">₹${price} ${disc ? ` • ${disc}% off` : ""} • ${p.category || ""}</div>
            <div class="text-xs mt-1 ${Number(p.stock ?? 0) <= 0 ? "text-red-600" : (Number(p.stock ?? 0) <= 5 ? "text-orange-600" : "text-green-700")}">Stock: ${Number.isFinite(Number(p.stock)) ? Number(p.stock) : 0}</div>
            <div class="text-xs text-gray-500 mt-1">${countImgs} images</div>
          </div>

          <div class="flex flex-col gap-2">
            <button class="px-3 py-1 rounded border text-sm" data-edit="${p.id}">Edit</button>
            <button class="px-3 py-1 rounded border text-sm text-red-600" data-del="${p.id}">Delete</button>
          </div>
        </div>
      </div>
    `;
  }).join("");

  // Edit handlers
  productsList.querySelectorAll("[data-edit]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-edit");
      const p = productsCache.find(x => x.id === id);
      if (p) fillFormForEdit(p);
    });
  });

  // Delete handlers
  productsList.querySelectorAll("[data-del]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-del");
      const ok = confirm("Delete this product?");
      if (!ok) return;
      await deleteDoc(doc(db, "products", id));
      // if you were editing same product, clear form
      if ((pId.value || "").trim() === id) clearForm();
      loadProducts();
    });
  });
}

btnRefreshProducts.addEventListener("click", loadProducts);

// ===== Load Orders =====
async function loadOrders() {
  ordersList.innerHTML = `<p class="text-sm text-gray-500">Loading...</p>`;

  let snap;
  try {
    snap = await getDocs(query(collection(db, "orders"), orderBy("createdAt", "desc")));
  } catch {
    snap = await getDocs(collection(db, "orders"));
  }

  const list = [];
  snap.forEach(d => list.push({ id: d.id, ...d.data() }));

  if (!list.length) {
    ordersList.innerHTML = `<p class="text-sm text-gray-500">No orders yet.</p>`;
    return;
  }

  ordersList.innerHTML = list.map(o => {
    const total = Number(o.total || 0);
    const status = (o.status || "PLACED").toUpperCase();
    const items = Array.isArray(o.items) ? o.items : [];
    const lines = items.map(i => `${i.name} x${i.qty}`).join(", ");

    return `
      <div class="border rounded-lg p-3 bg-white">
        <div class="flex items-start justify-between gap-3">
          <div>
            <div class="font-semibold">Order: ${o.id}</div>
            <div class="text-sm text-gray-600">Total: ₹${total.toLocaleString("en-IN")}</div>
            <div class="text-xs text-gray-500 mt-1">Items: ${lines || "-"}</div>
          </div>

          <div class="flex items-center gap-2">
            <select class="border rounded px-2 py-1 text-sm" data-status="${o.id}">
              ${["PLACED","CONFIRMED","SHIPPED","DELIVERED","CANCELLED"].map(s =>
                `<option value="${s}" ${s===status?"selected":""}>${s}</option>`
              ).join("")}
            </select>
            <button class="px-3 py-1 rounded border text-sm" data-save="${o.id}">Save</button>
          </div>
        </div>
      </div>
    `;
  }).join("");

  ordersList.querySelectorAll("[data-save]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-save");
      const sel = ordersList.querySelector(`[data-status="${id}"]`);
      const newStatus = sel ? sel.value : "PLACED";

      const orderRef = doc(db, "orders", id);
      try {
        await runTransaction(db, async (tx) => {
          const snap = await tx.get(orderRef);
          if (!snap.exists()) throw new Error("ORDER_NOT_FOUND");

          const o = snap.data() || {};
          const prev = String(o.status || "PLACED").toUpperCase();
          const next = String(newStatus || "PLACED").toUpperCase();

          const history = Array.isArray(o.statusHistory) ? o.statusHistory.slice(0) : [];
          history.push({ status: next, at: new Date().toISOString(), by: "admin" });

          const updates = {
            status: next,
            updatedAt: serverTimestamp(),
            statusHistory: history,
          };

          // Restock on first-time cancellation using atomic increments (no extra reads)
          const alreadyRestocked = !!o.restocked;
          if (next === "CANCELLED" && prev !== "CANCELLED" && !alreadyRestocked) {
            const items = Array.isArray(o.items) ? o.items : [];
            const qtyMap = new Map();

            for (const it of items) {
              const pid = String(it.productId || it.id || "");
              const qty = Number(it.qty || 0);
              if (!pid || !Number.isFinite(qty) || qty <= 0) continue;
              qtyMap.set(pid, (qtyMap.get(pid) || 0) + qty);
            }

            for (const [pid, addQty] of qtyMap) {
              const pRef = doc(db, "products", pid);
              tx.update(pRef, { stock: increment(addQty) });
            }

            updates.restocked = true;
            updates.restockedAt = serverTimestamp();
          }

          tx.update(orderRef, updates);
        });
        alert("Saved ✅");
      } catch (e) {
        console.log("Order update failed", e);
        alert("Failed to update: " + (e?.message || e));
      }
    });
  });
}

btnRefreshOrders.addEventListener("click", loadOrders);