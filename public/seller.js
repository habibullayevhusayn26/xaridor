"use strict";
const $ = (selector, root = document) => root.querySelector(selector);
const esc = value => String(value ?? "").replace(/[&<>"']/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[character]));
const fmt = value => new Intl.NumberFormat("uz-UZ").format(Math.round(value)).replace(/,/g, " ") + " so'm";
const app = $("#sellerApp");
let token = localStorage.getItem("bz_seller_token");
let categories = [];
let currentProduct = null;
let products = [];
let toastTimer;
let googleClientId = "";
let googleScriptPromise;
let googleInitialized = false;
let pendingGoogleCredential = "";

function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { element.hidden = true; }, 2500);
}

async function api(url, options = {}) {
  const response = await fetch("/api" + url, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  let data = {};
  try { data = await response.json(); } catch {}
  if (!response.ok) throw new Error(data.error || "Xatolik yuz berdi.");
  return data;
}

function showAuth(mode = "login", message = "") {
  const login = mode === "login";
  app.innerHTML = `<section class="seller-auth">
    <h1>${login ? "Sotuvchi kabinetiga kirish" : "Sotuvchi sifatida ro'yxatdan o'tish"}</h1>
    <p class="meta">Google orqali kiring. Yangi sotuvchidan do'kon ma'lumotlari so'raladi, so'ng admin arizani ko'rib chiqadi.</p>
    <div class="tabs">
      <button type="button" class="${login ? "on" : ""}" data-seller-auth="login">Kirish</button>
      <button type="button" class="${login ? "" : "on"}" data-seller-auth="register">Ro'yxatdan o'tish</button>
    </div>
    ${message ? `<p class="seller-notice">${esc(message)}</p>` : ""}
    <div id="googleButton"></div>
    <div class="err" id="sellerError" role="alert"></div>
  </section>`;
  app.querySelectorAll("[data-seller-auth]").forEach(button => {
    button.onclick = () => showAuth(button.dataset.sellerAuth);
  });
  setupGoogleButton();
}

async function loadGoogleIdentity() {
  if (window.google?.accounts?.id) return;
  if (!googleScriptPromise) {
    googleScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.onload = resolve;
      script.onerror = () => reject(new Error("Google kirish oynasini yuklab bo'lmadi."));
      document.head.appendChild(script);
    });
  }
  await googleScriptPromise;
}

async function setupGoogleButton() {
  try {
    if (!googleClientId) googleClientId = (await api("/seller/google-config")).clientId;
    await loadGoogleIdentity();
    if (!googleInitialized) {
      window.google.accounts.id.initialize({
        client_id: googleClientId,
        callback: result => completeGoogleLogin(result.credential)
      });
      googleInitialized = true;
    }
    window.google.accounts.id.renderButton($("#googleButton"), {
      type: "standard", theme: "outline", size: "large", text: "continue_with", shape: "rectangular"
    });
  } catch (error) {
    $("#sellerError").textContent = error.message;
  }
}

async function completeGoogleLogin(credential, profile = null) {
  pendingGoogleCredential = credential;
  $("#sellerError").textContent = "";
  try {
    const result = await api("/seller/google", {
      method: "POST",
      body: { credential, ...(profile ? { ...profile, profileSubmitted: true } : {}) }
    });
    if (result.needsProfile) {
      showGoogleProfile(result);
      return;
    }
    pendingGoogleCredential = "";
    token = result.token;
    localStorage.setItem("bz_seller_token", token);
    renderDashboard(result.seller);
  } catch (error) {
    const message = error.message;
    const errorElement = $("#sellerError");
    if (errorElement) errorElement.textContent = message;
    else showAuth("login", message);
  }
}

function showGoogleProfile(profile) {
  app.innerHTML = `<section class="seller-auth">
    <h1>Do'kon ma'lumotlari</h1>
    <p class="meta">Google emaili: ${esc(profile.email)}</p>
    <form class="form" id="sellerProfile">
      <label>Ism-familiya<input name="name" maxlength="80" autocomplete="name" value="${esc(profile.name)}" required></label>
      <label>Telefon<input name="phone" type="tel" placeholder="+998 90 123 45 67" autocomplete="tel" required></label>
      <label>Do'kon nomi<input name="storeName" maxlength="100" required></label>
      <label>Do'kon manzili<input name="address" maxlength="250" autocomplete="street-address" required></label>
      <div class="err" id="sellerError" role="alert"></div>
      <button class="btn sun block" type="submit">Ro'yxatdan o'tish</button>
    </form>
  </section>`;
  $("#sellerProfile").onsubmit = async event => {
    event.preventDefault();
    const form = event.target;
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = "Tekshirilmoqda...";
    try {
      await completeGoogleLogin(pendingGoogleCredential, Object.fromEntries(new FormData(form)));
    } finally {
      if (document.body.contains(button)) {
        button.disabled = false;
        button.textContent = "Ro'yxatdan o'tish";
      }
    }
  };
}

function renderDashboard(seller) {
  if (seller.status !== "approved") {
    app.innerHTML = `<section class="seller-auth">
      <h1>${seller.status === "rejected" ? "Ariza rad etildi" : "Ariza ko'rib chiqilmoqda"}</h1>
      <p class="seller-notice">${seller.status === "rejected"
        ? "Sotuvchi arizangiz administrator tomonidan rad etilgan."
        : "Google akkaunt tasdiqlandi. Administrator arizangizni tasdiqlagach, mahsulot qo'sha olasiz."}</p>
      <p><b>${esc(seller.storeName)}</b><br>${esc(seller.name)} · ${esc(seller.email)}</p>
      <button class="btn line" id="sellerLogout">Chiqish</button>
    </section>`;
    $("#sellerLogout").onclick = logout;
    return;
  }
  app.innerHTML = `<div class="seller-dashboard">
    <div class="seller-dashboard-head">
      <div><h1>${esc(seller.storeName)}</h1><p class="meta">${esc(seller.name)} · ${esc(seller.email)} · ${esc(seller.address)}</p></div>
      <button class="btn line" id="sellerLogout">Chiqish</button>
    </div>
    <section class="seller-panel">
      <h2 id="productFormTitle">Yangi mahsulot qo'shish</h2>
      <form class="form" id="sellerProductForm">
        <label>Mahsulot nomi<input name="name" maxlength="120" required></label>
        <label>Kategoriya<select name="cat" required>${categories.map(category => `<option value="${esc(category.id)}">${esc(category.name)}</option>`).join("")}</select></label>
        <div class="two">
          <label>Narxi (so'm)<input name="price" type="number" min="1" step="1" required></label>
          <label>Eski narx<input name="old" type="number" min="1" step="1"></label>
        </div>
        <label>Ombordagi soni<input name="stock" type="number" min="0" step="1" value="1" required></label>
        <label>Mahsulot rasmi (JPG, PNG yoki WebP, 5 MB gacha)<input name="imageFile" type="file" accept="image/jpeg,image/png,image/webp"></label>
        <img class="image-preview" id="sellerImagePreview" alt="Rasm ko'rinishi" hidden>
        <label>Tavsif<textarea name="desc" maxlength="1000" rows="4"></textarea></label>
        <div class="err" id="sellerProductError"></div>
        <div class="seller-form-actions"><button class="btn sun" type="submit">Mahsulotni saqlash</button><button class="btn line" id="sellerCancelEdit" type="button" hidden>Bekor qilish</button></div>
      </form>
    </section>
    <section class="seller-panel">
      <h2>Mahsulotlarim</h2><div id="sellerProducts"><p class="meta">Yuklanmoqda...</p></div>
    </section>
  </div>`;
  $("#sellerLogout").onclick = logout;
  $("#sellerCancelEdit").onclick = () => resetProductForm();
  $("#sellerProductForm").imageFile.onchange = showImagePreview;
  $("#sellerProductForm").onsubmit = saveProduct;
  loadProducts();
}

async function loadProducts() {
  try {
    products = await api("/seller/products");
    renderProducts();
  } catch (error) {
    $("#sellerProducts").innerHTML = `<p class="err">${esc(error.message)}</p>`;
  }
}

function renderProducts() {
  $("#sellerProducts").innerHTML = products.length
    ? `<div class="seller-products">${products.map(product => `<article class="seller-product">
        <div class="seller-product-image">${product.image
          ? `<img src="${esc(product.image)}" alt="${esc(product.name)}">`
          : ic("package", 36)}</div>
        <div class="seller-product-info"><b>${esc(product.name)}</b><span>${fmt(product.price)}</span>
          <small class="meta">Omborda: ${product.stock} · ${esc((categories.find(category => category.id === product.cat) || {}).name || product.cat)}</small></div>
        <div class="seller-product-actions"><button class="mini" data-product-edit="${product.id}">Tahrirlash</button>
          <button class="mini del" data-product-delete="${product.id}">O'chirish</button></div>
      </article>`).join("")}</div>`
    : `<p class="meta">Hali mahsulot qo'shilmagan.</p>`;
  $("#sellerProducts").onclick = async event => {
    const edit = event.target.closest("[data-product-edit]");
    const remove = event.target.closest("[data-product-delete]");
    if (edit) editProduct(products.find(product => product.id === Number(edit.dataset.productEdit)));
    if (remove && confirm("Mahsulotni o'chirasizmi?")) {
      remove.disabled = true;
      try {
        await api("/seller/products/" + encodeURIComponent(remove.dataset.productDelete), { method: "DELETE" });
        await loadProducts();
        toast("Mahsulot o'chirildi.");
      } catch (error) { toast(error.message); remove.disabled = false; }
    }
  };
}

function editProduct(product) {
  if (!product) return;
  currentProduct = product;
  const form = $("#sellerProductForm");
  for (const key of ["name", "cat", "price", "old", "stock", "desc"]) form.elements[key].value = product[key] ?? "";
  const preview = $("#sellerImagePreview");
  preview.src = product.image || "";
  preview.hidden = !product.image;
  $("#productFormTitle").textContent = "Mahsulotni tahrirlash";
  $("#sellerCancelEdit").hidden = false;
  form.scrollIntoView({ behavior: "smooth", block: "start" });
}

function resetProductForm() {
  currentProduct = null;
  $("#sellerProductForm").reset();
  $("#sellerProductForm").elements.stock.value = "1";
  $("#sellerImagePreview").hidden = true;
  $("#sellerImagePreview").removeAttribute("src");
  $("#productFormTitle").textContent = "Yangi mahsulot qo'shish";
  $("#sellerCancelEdit").hidden = true;
  $("#sellerProductError").textContent = "";
}

function showImagePreview(event) {
  const file = event.target.files[0];
  if (!file) return;
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024) {
    event.target.value = "";
    $("#sellerProductError").textContent = "JPG, PNG yoki WebP rasm tanlang (5 MB gacha).";
    return;
  }
  $("#sellerProductError").textContent = "";
  const preview = $("#sellerImagePreview");
  preview.src = URL.createObjectURL(file);
  preview.hidden = false;
}

async function fileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Rasmni o'qib bo'lmadi."));
    reader.readAsDataURL(file);
  });
}

async function saveProduct(event) {
  event.preventDefault();
  const form = event.target;
  if (form.dataset.submitting) return;
  const isEditing = !!currentProduct;
  form.dataset.submitting = "true";
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  button.textContent = "Saqlanmoqda...";
  const data = Object.fromEntries(new FormData(form));
  delete data.imageFile;
  try {
    const file = form.elements.imageFile.files[0];
    if (file) data.image = await fileAsDataUrl(file);
    const url = currentProduct ? `/seller/products/${currentProduct.id}` : "/seller/products";
    await api(url, { method: currentProduct ? "PUT" : "POST", body: data });
    resetProductForm();
    await loadProducts();
    toast(isEditing ? "Mahsulot yangilandi." : "Mahsulot qo'shildi.");
  } catch (error) {
    $("#sellerProductError").textContent = error.message;
  } finally {
    delete form.dataset.submitting;
    button.disabled = false;
    button.textContent = "Mahsulotni saqlash";
  }
}

function logout() {
  localStorage.removeItem("bz_seller_token");
  token = null;
  currentProduct = null;
  showAuth();
}

async function initialize() {
  try { categories = await api("/categories"); }
  catch (error) { app.innerHTML = `<p class="err">${esc(error.message)}</p>`; return; }
  if (token) {
    try {
      const seller = await api("/seller/me");
      renderDashboard(seller);
      return;
    } catch {
      localStorage.removeItem("bz_seller_token");
      token = null;
    }
  }
  showAuth();
}

initialize();
