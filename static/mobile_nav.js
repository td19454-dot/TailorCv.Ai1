(function () {
  function closeMenu(header) {
    header.classList.remove("nav-open");
    header.querySelectorAll(".nav-dropdown.open").forEach(function (dd) {
      dd.classList.remove("open");
      const btn = dd.querySelector(".nav-dropdown-toggle");
      if (btn) btn.setAttribute("aria-expanded", "false");
    });
    const toggle = header.querySelector(".mobile-menu-toggle");
    if (toggle) {
      toggle.setAttribute("aria-expanded", "false");
      toggle.setAttribute("aria-label", "Open navigation menu");
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    const headers = document.querySelectorAll(".navbar");

    headers.forEach(function (header) {
      const toggle = header.querySelector(".mobile-menu-toggle");
      if (!toggle) return;

      toggle.addEventListener("click", function () {
        const isOpen = header.classList.toggle("nav-open");
        toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
        toggle.setAttribute("aria-label", isOpen ? "Close navigation menu" : "Open navigation menu");
      });

      header.querySelectorAll(".nav-links a, .nav-actions a, .nav-actions button").forEach(function (item) {
        item.addEventListener("click", function () {
          closeMenu(header);
        });
      });

      header.querySelectorAll(".nav-dropdown-toggle").forEach(function (toggleBtn) {
        toggleBtn.addEventListener("click", function (event) {
          event.preventDefault();
          event.stopPropagation();
          const dropdown = toggleBtn.closest(".nav-dropdown");
          if (!dropdown) return;
          const willOpen = !dropdown.classList.contains("open");
          header.querySelectorAll(".nav-dropdown.open").forEach(function (openDd) {
            if (openDd !== dropdown) openDd.classList.remove("open");
          });
          dropdown.classList.toggle("open", willOpen);
          toggleBtn.setAttribute("aria-expanded", willOpen ? "true" : "false");
        });
      });
    });

    document.addEventListener("click", function (event) {
      headers.forEach(function (header) {
        if (!header.contains(event.target)) {
          closeMenu(header);
        }
      });
    });
  });
})();
