/**
 * script.js – Snackcorner Shopping Cart (v3 – Bug fixes)
 * =========================================================
 *
 * WHAT WAS WRONG AND WHAT IS FIXED
 * ---------------------------------
 *
 * BUG 1 – Cart closed on every internal click (Event Bubbling)
 * ------------------------------------------------------------
 * The previous code had:
 *   cartOverlay.addEventListener('click', closeCart);
 *
 * This fired closeCart() for EVERY click event that reached the
 * overlay element. Because of a CSS z-index issue (the overlay
 * was painted on top of the panel), ALL clicks inside the cart
 * were landing on the overlay, not on the buttons underneath.
 *
 * The CSS fix (z-index: 200 on .cart-panel) is the root cause fix.
 * The JS fix below is a defensive guard that ALSO protects against
 * the same problem if the z-index is ever changed accidentally:
 *
 *   cartOverlay.addEventListener('click', function (e) {
 *     if (e.target === cartOverlay) closeCart();   ← KEY GUARD
 *   });
 *
 * "e.target" is the exact element that was clicked.
 * "e.currentTarget" would be cartOverlay regardless of where clicked.
 * By checking e.target === cartOverlay we guarantee we only close
 * when the user clicked the DIM BACKGROUND, never a panel button.
 *
 *
 * BUG 2 – Event Delegation (already correct, now verified)
 * --------------------------------------------------------
 * The cartItemsList delegation was already logically correct in v2.
 * It couldn't work because clicks never reached it (they were
 * swallowed by the overlay due to the z-index bug above).
 * With the CSS fix applied, delegation now works as intended.
 * No logic change was needed here.
 *
 *
 * HOW THE FULL CART CLICK CHAIN WORKS NOW
 * ----------------------------------------
 * 1. User clicks "+" button inside the cart panel.
 * 2. The ".cart-panel" now has z-index:200 > overlay z-index:199,
 *    so the click reaches the "+" button, NOT the overlay.
 * 3. The click bubbles up: button → li → ul#cartItems → …
 * 4. The listener on cartItemsList (Part G) catches it.
 * 5. e.target.closest('.qty-btn') finds the "+" button.
 * 6. We update cartItems[] and call renderCart().
 * 7. The overlay listener does NOT fire because e.target is the
 *    "+" button, not the overlay element.
 */

'use strict';

/* ==========================================================
   0. WAIT FOR THE PAGE TO FULLY LOAD
   ========================================================== */
document.addEventListener('DOMContentLoaded', function () {

  /* ==========================================================
     PART A – ELEMENT REFERENCES
     Grab every DOM element we need and store it in a variable.
     Doing this once is faster than calling getElementById every time.
  ========================================================== */
  const cartToggleBtn  = document.getElementById('cartToggle');
  const cartSidebar    = document.getElementById('cartSidebar');
  const cartOverlay    = document.getElementById('cartOverlay');
  const cartCloseBtn   = document.getElementById('cartClose');
  const cartPanel      = document.querySelector('.cart-panel');   // ← needed for stopPropagation
  const cartCountBadge = document.getElementById('cartCount');
  const cartItemsList  = document.getElementById('cartItems');
  const cartEmptyEl    = document.getElementById('cartEmpty');
  const cartTotalEl    = document.getElementById('cartTotal');
  const checkoutBtn    = document.getElementById('checkoutBtn');
  const clearCartBtn   = document.getElementById('clearCartBtn');
  const toastEl        = document.getElementById('toast');
  const hamburgerBtn   = document.getElementById('hamburger');
  const mobileNav      = document.getElementById('mobileNav');
  const yearSpan       = document.getElementById('year');
  const tabButtons     = document.querySelectorAll('.tab-btn');

  /* ==========================================================
     PART B – APP STATE
     One plain array is our entire "database".
     Each item looks like:
       { key: "Friet Zonder – Klein", name: "Friet Zonder – Klein",
         price: 2.60, quantity: 1 }
     "key" is unique per name+size and used for deduplication.
  ========================================================== */
  let cartItems  = [];
  let toastTimer = null;

  /* ==========================================================
     PART C – CART OPEN / CLOSE
     ─────────────────────────────────────────────────────────
     THE FIX IS HERE:
     Old code:  cartOverlay.addEventListener('click', closeCart);
     New code:  cartOverlay.addEventListener('click', function(e) {
                  if (e.target === cartOverlay) closeCart();
                });
     
     Why the guard works:
       • e.target  = the element the user ACTUALLY clicked on.
       • If they clicked the dim background, e.target IS cartOverlay → close.
       • If they clicked a button inside the panel, that button is e.target,
         which is NOT cartOverlay → do nothing, cart stays open.
     
     SECOND LAYER of protection (belt-and-suspenders):
     We also call e.stopPropagation() on the cart-panel itself so that
     any click bubbling OUT of the panel cannot reach the overlay listener.
     This makes the behaviour bulletproof regardless of z-index values.
  ========================================================== */

  /** Opens the cart sidebar (slide-in from right). */
  function openCart() {
    cartSidebar.classList.add('open');
    cartSidebar.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';  // Prevent page scroll behind cart
    cartCloseBtn.focus();                      // Accessibility: move focus in
  }

  /** Closes the cart sidebar. */
  function closeCart() {
    cartSidebar.classList.remove('open');
    cartSidebar.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';         // Restore page scroll
    cartToggleBtn.focus();                     // Accessibility: return focus
  }

  // Open cart when header basket icon is clicked
  cartToggleBtn.addEventListener('click', openCart);

  // Close cart when the ✕ button inside the panel is clicked
  cartCloseBtn.addEventListener('click', closeCart);

  // ─── THE CRITICAL FIX ────────────────────────────────────────────
  // Close cart ONLY when the user clicks the dim overlay background.
  // NOT when they click inside the panel (buttons, selects, etc.).
  cartOverlay.addEventListener('click', function (e) {
    /*
     * e.target  → the exact element that received the click.
     * cartOverlay → the dim background div.
     *
     * If e.target IS cartOverlay, the user clicked the background → close.
     * If e.target is ANYTHING ELSE (a button, a span, etc.), do nothing.
     */
    if (e.target === cartOverlay) {
      closeCart();
    }
  });

  // ─── SECOND LAYER: stop panel clicks from reaching the overlay ───
  // Even if something bubbles out of the panel, it won't trigger
  // the overlay listener because we stop the event here.
  if (cartPanel) {
    cartPanel.addEventListener('click', function (e) {
      e.stopPropagation();
    });
  }
  // ─────────────────────────────────────────────────────────────────

  // Escape key also closes the cart
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && cartSidebar.classList.contains('open')) {
      closeCart();
    }
  });

  /* ==========================================================
     PART D – ADD TO CART
     Uses document-level event delegation so ONE listener handles
     every "Add to Cart" button on the entire page. We use
     e.target.closest('.add-to-cart') to find the button even
     if the user clicked an icon nested inside it.
  ========================================================== */
  document.addEventListener('click', function (e) {

    const button = e.target.closest('.add-to-cart');
    if (!button) return; // Something else was clicked – ignore

    const baseName = button.dataset.name;

    // Does this card have a size <select>? Read its selected value.
    const card   = button.closest('.menu-card');
    const select = card ? card.querySelector('.size-select') : null;

    let itemKey, itemName, itemPrice;

    if (select) {
      // Multi-size item: read the dropdown
      const opt       = select.options[select.selectedIndex];
      itemPrice       = parseFloat(opt.value);              // e.g. 2.85
      const sizeLabel = opt.dataset.size || '';             // e.g. "Normaal"
      itemName        = baseName + ' \u2013 ' + sizeLabel; // "Friet Zonder – Normaal"
      itemKey         = itemName;
    } else {
      // Fixed-price item: read the button attribute
      itemPrice = parseFloat(button.dataset.price);
      itemName  = baseName;
      itemKey   = baseName;
    }

    if (isNaN(itemPrice)) {
      console.warn('Snackcorner: no valid price for "' + itemName + '"');
      return;
    }

    // Increment if already in cart, otherwise add new entry
    const existing = cartItems.find(function (item) { return item.key === itemKey; });
    if (existing) {
      existing.quantity += 1;
    } else {
      cartItems.push({ key: itemKey, name: itemName, price: itemPrice, quantity: 1 });
    }

    renderCart();
    showButtonFeedback(button);
    showToast('\u2713 ' + itemName + ' toegevoegd!');
  });

  /* ==========================================================
     PART E – SIZE DROPDOWN: live price label update
     When the user changes a size select, update the "€X,XX"
     price shown in the card footer to match.
  ========================================================== */
  document.addEventListener('change', function (e) {
    if (!e.target.classList.contains('size-select')) return;

    const select = e.target;
    const card   = select.closest('.menu-card');
    const label  = card ? card.querySelector('.price') : null;

    if (label) {
      label.textContent = '\u20ac' + parseFloat(select.value).toFixed(2).replace('.', ',');
    }
  });

  /* ==========================================================
     PART F – RENDER CART
     Completely rebuilds the cart list from the cartItems array.
     Called every time the array changes (add, +, -, clear).
  ========================================================== */
  function renderCart() {

    // Remove old rows (but keep the empty-state <li>)
    cartItemsList.querySelectorAll('.cart-item').forEach(function (row) { row.remove(); });

    // Tally totals
    var totalQty   = 0;
    var totalPrice = 0;
    cartItems.forEach(function (item) {
      totalQty   += item.quantity;
      totalPrice += item.price * item.quantity;
    });

    // Toggle the empty-state message
    cartEmptyEl.style.display = cartItems.length === 0 ? 'flex' : 'none';

    // Build one <li> per cart item
    cartItems.forEach(function (item, index) {
      var li = document.createElement('li');
      li.className = 'cart-item';

      var linePrice = (item.price * item.quantity).toFixed(2).replace('.', ',');

      /*
       * data-index on the +/- buttons tells the Part G listener
       * which entry in cartItems[] to modify.
       *
       * We use innerHTML with escapeHTML() for safety.
       * The Part G listener is delegated on cartItemsList,
       * so these buttons work immediately without re-attaching listeners.
       */
      li.innerHTML =
        '<span class="cart-item-name">'    + escapeHTML(item.name) + '</span>' +
        '<div class="cart-item-qty">'      +
          '<button class="qty-btn minus" data-index="' + index + '" ' +
            'aria-label="Minder van ' + escapeHTML(item.name) + '">' +
            '&#8722;' +  /* − */
          '</button>'  +
          '<span class="qty-num">' + item.quantity + '</span>' +
          '<button class="qty-btn plus" data-index="' + index + '" ' +
            'aria-label="Meer van ' + escapeHTML(item.name) + '">' +
            '&#43;' +   /* + */
          '</button>'  +
        '</div>'       +
        '<span class="cart-item-price">&#8364;' + linePrice + '</span>';

      cartItemsList.appendChild(li);
    });

    // Update total, badge, checkout button state
    cartTotalEl.textContent    = '\u20ac' + totalPrice.toFixed(2).replace('.', ',');
    cartCountBadge.textContent = totalQty;
    cartCountBadge.classList.toggle('has-items', totalQty > 0);
    checkoutBtn.disabled = cartItems.length === 0;
  }

  /* ==========================================================
     PART G – CART +/- BUTTON DELEGATION
     ─────────────────────────────────────────────────────────
     ONE listener on the stable <ul id="cartItems"> parent.
     It catches every click that bubbles up from + and - buttons.
     
     WHY THIS WORKS (and the old approach didn't):
     renderCart() deletes and recreates all <li> elements.
     Direct listeners attached to those <li> children die with them.
     By listening on the PARENT <ul> (which is never deleted), we
     catch clicks on all dynamically-created children forever.
     
     This is the "event delegation" pattern. It's the correct,
     reliable way to handle clicks on dynamic content.
  ========================================================== */
  cartItemsList.addEventListener('click', function (e) {

    var btn = e.target.closest('.qty-btn');
    if (!btn) return; // Click was not on a +/- button

    var index = parseInt(btn.dataset.index, 10);
    if (isNaN(index) || index < 0 || index >= cartItems.length) return;

    if (btn.classList.contains('plus')) {
      // ➕ Add one more
      cartItems[index].quantity += 1;

    } else if (btn.classList.contains('minus')) {
      // ➖ Remove one
      cartItems[index].quantity -= 1;

      if (cartItems[index].quantity <= 0) {
        // Quantity hit zero → remove item entirely
        var gone = cartItems[index].name;
        cartItems.splice(index, 1);
        showToast('\uD83D\uDDD1 ' + gone + ' verwijderd.');
      }
    }

    renderCart();
  });

  /* ==========================================================
     PART H – CLEAR CART & CHECKOUT
  ========================================================== */

  clearCartBtn.addEventListener('click', function () {
    if (cartItems.length === 0) return;
    cartItems = [];
    renderCart();
    showToast('Winkelwagen geleegd.');
  });

  checkoutBtn.addEventListener('click', function () {
    if (cartItems.length === 0) return;
    alert('Bedankt voor je bestelling bij Snackcorner! \uD83C\uDF5F\nWe gaan direct aan de slag!');
    cartItems = [];
    renderCart();
    closeCart();
  });

  /* ==========================================================
     PART I – MOBILE HAMBURGER MENU
  ========================================================== */

  hamburgerBtn.addEventListener('click', function () {
    var isOpen = hamburgerBtn.classList.toggle('open');
    mobileNav.classList.toggle('open', isOpen);
    hamburgerBtn.setAttribute('aria-expanded', String(isOpen));
    mobileNav.setAttribute('aria-hidden', String(!isOpen));
  });

  mobileNav.querySelectorAll('.mobile-nav-link').forEach(function (link) {
    link.addEventListener('click', function () {
      hamburgerBtn.classList.remove('open');
      mobileNav.classList.remove('open');
      hamburgerBtn.setAttribute('aria-expanded', 'false');
      mobileNav.setAttribute('aria-hidden', 'true');
    });
  });

  /* ==========================================================
     PART J – CATEGORY TABS (smooth scroll to section)
  ========================================================== */

  tabButtons.forEach(function (tab) {
    tab.addEventListener('click', function () {
      tabButtons.forEach(function (t) { t.classList.remove('active'); });
      tab.classList.add('active');

      var target = document.getElementById(tab.dataset.target);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  /* ==========================================================
     PART K – UTILITY FUNCTIONS
  ========================================================== */

  /**
   * Briefly turns the "Add to Cart" button green to confirm the action,
   * then restores its original label after 1.2 seconds.
   * @param {HTMLElement} button
   */
  function showButtonFeedback(button) {
    var original = button.innerHTML;
    button.classList.add('added');
    button.innerHTML = '<i class="fa-solid fa-check"></i> Toegevoegd!';
    button.disabled  = true;

    setTimeout(function () {
      button.classList.remove('added');
      button.innerHTML = original;
      button.disabled  = false;
    }, 1200);
  }

  /**
   * Shows a brief notification bar at the bottom of the screen.
   * Cancels any in-flight timer so messages never pile up.
   * @param {string} message
   */
  function showToast(message) {
    if (toastTimer) clearTimeout(toastTimer);
    toastEl.textContent = message;
    toastEl.classList.add('show');
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 2500);
  }

  /**
   * Escapes < > & " ' so that product names are safe to embed in innerHTML.
   * Prevents XSS if a name ever contains HTML characters.
   * @param {string} str
   * @returns {string}
   */
  function escapeHTML(str) {
    var d = document.createElement('div');
    d.textContent = String(str);
    return d.innerHTML;
  }

  /* ==========================================================
     PART L – INITIALISATION
  ========================================================== */
  if (yearSpan) yearSpan.textContent = new Date().getFullYear();
  renderCart(); // Set up the empty-state cart panel on first load

}); // end DOMContentLoaded