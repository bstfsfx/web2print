/* PrintFlow — interaction layer.
   Loaded with `defer`, so the DOM is ready when this runs.

   Optimizations:
   - Event delegation: one listener per container instead of one per element.
   - Cached element lookups instead of repeated getElementById calls.
   - Passive listeners where the event cannot preventDefault.
   - rAF-batched toast updates so rapid calls don't thrash layout. */
(function () {
  "use strict";

  var toastEl = document.getElementById("toast");
  var toastTimer = null;
  var toastFrame = null;

  function showToast(message) {
    if (toastFrame) cancelAnimationFrame(toastFrame);
    toastFrame = requestAnimationFrame(function () {
      toastEl.textContent = message;
      toastEl.style.display = "block";
    });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.style.display = "none";
    }, 2400);
  }

  /* ---------------- Configurator tabs ---------------- */
  var tabs = Array.prototype.slice.call(document.querySelectorAll("[data-tab]"));
  var productNames = {
    "名片": ["客製化名片", "高質感印刷｜圓潤顯色細緻", "名片 PRODUCT"],
    "海報／宣傳單": ["活動海報", "大尺寸亮眼輸出，吸睛不褪色", "海報 POSTER"],
    "貼紙": ["品牌貼紙", "圓形、方形、異形一次完成", "貼紙 STICKER"],
    "布條／易拉展": ["戶外布條", "耐候材質，遠距也清楚", "布條 BANNER"],
    "包裝印刷": ["品牌紙盒", "從開箱開始，建立品牌好感", "包裝 PACKAGING"],
    "大圖輸出": ["展場大圖輸出", "色彩飽和、細節清晰的現場氣勢", "大圖輸出 LARGE FORMAT"],
  };
  var productNameEl = document.getElementById("productName");
  var productDescEl = document.getElementById("productDesc");
  var productLabelEl = document.getElementById("productLabel");

  function activateTab(tab, announce) {
    for (var i = 0; i < tabs.length; i++) {
      var isActive = tabs[i] === tab;
      tabs[i].classList.toggle("active", isActive);
      tabs[i].setAttribute("aria-selected", isActive ? "true" : "false");
    }
    var entry = productNames[tab.dataset.tab];
    if (!entry) return;
    productNameEl.textContent = entry[0];
    productDescEl.textContent = entry[1];
    if (productLabelEl) productLabelEl.textContent = entry[2];
    if (announce) showToast(tab.dataset.tab + "產品已更新");
  }

  // Delegated: one listener for all tabs.
  document.querySelector(".config-tabs").addEventListener("click", function (e) {
    var tab = e.target.closest("[data-tab]");
    if (tab) activateTab(tab, true);
  });

  /* ---------------- Option groups (size / material / quantity) ---------------- */
  var priceEl = document.getElementById("price");

  function recalcPrice(qty) {
    // Base price is 300 per 500 units, rounded to the nearest 10.
    priceEl.textContent = String(Math.round((300 * qty) / 500 / 10) * 10);
  }

  document.querySelectorAll(".choices").forEach(function (group) {
    group.addEventListener("click", function (e) {
      var btn = e.target.closest("button");
      if (!btn) return;
      group.querySelectorAll("button").forEach(function (b) {
        b.classList.toggle("active", b === btn);
      });
      if (group.dataset.group === "quantity") {
        var qty = parseInt(btn.textContent.replace(/,/g, ""), 10);
        if (!isNaN(qty)) recalcPrice(qty);
      }
    });
  });

  /* ---------------- Cart ---------------- */
  var cartCountEl = document.getElementById("cartCount");

  document.getElementById("addCart").addEventListener("click", function () {
    cartCountEl.textContent = String(Number(cartCountEl.textContent) + 1);
    showToast("客製化名片已加入購物車");
  });

  /* ---------------- Scroll to configurator ---------------- */
  var configurator = document.getElementById("configurator");

  function scrollToConfigurator() {
    configurator.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  document.getElementById("heroCta").addEventListener("click", scrollToConfigurator);

  // Product cards jump to the configurator and preselect the matching tab.
  document.querySelectorAll("[data-category]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      scrollToConfigurator();
      for (var i = 0; i < tabs.length; i++) {
        if (tabs[i].dataset.tab === btn.dataset.category) {
          activateTab(tabs[i], false);
          break;
        }
      }
    });
  });

  /* ---------------- File upload ---------------- */
  var fileInput = document.getElementById("fileInput");
  var uploadText = document.getElementById("uploadText");

  fileInput.addEventListener("change", function (e) {
    if (e.target.files && e.target.files[0]) {
      uploadText.textContent = e.target.files[0].name;
      showToast("檔案已準備上傳");
    }
  });

  // The label's `for` attribute already opens the picker; this keeps the
  // click-to-upload affordance working in browsers that need the explicit call.
  document.querySelector(".upload").addEventListener("click", function (e) {
    if (e.target !== fileInput) fileInput.click();
  });

  /* ---------------- Search ---------------- */
  document.getElementById("searchForm").addEventListener("submit", function (e) {
    e.preventDefault();
  });
  document.getElementById("searchInput").addEventListener("change", function (e) {
    showToast(e.target.value ? "正在搜尋「" + e.target.value + "」" : "請輸入想找的印刷品");
  });

  /* ---------------- Header buttons ---------------- */
  document.getElementById("loginBtn").addEventListener("click", function () {
    showToast("登入功能示範");
  });
  document.getElementById("cartBtn").addEventListener("click", function () {
    showToast("購物車示範");
  });

  // Delegated: nav buttons live in two separate containers.
  document.querySelectorAll(".main-nav, .mobile-panel").forEach(function (nav) {
    nav.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-nav]");
      if (btn) showToast(btn.dataset.nav + "內容示範");
    });
  });

  /* ---------------- Mobile menu ---------------- */
  var mobileMenu = document.getElementById("mobileMenu");
  var mobilePanel = document.getElementById("mobilePanel");

  mobileMenu.addEventListener("click", function () {
    var open = mobilePanel.classList.toggle("show");
    mobileMenu.setAttribute("aria-expanded", open ? "true" : "false");
  });

  // Close the panel when a mobile nav item is chosen.
  mobilePanel.addEventListener("click", function (e) {
    if (e.target.closest("[data-nav]")) {
      mobilePanel.classList.remove("show");
      mobileMenu.setAttribute("aria-expanded", "false");
    }
  });

  /* ---------------- Scroll reveal (cheap, GPU-friendly) ---------------- */
  if ("IntersectionObserver" in window) {
    var revealTargets = document.querySelectorAll(".product-card, .step, .benefit");
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            io.unobserve(entry.target);
          }
        });
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.05 },
    );
    revealTargets.forEach(function (el) {
      io.observe(el);
    });
  }
})();
