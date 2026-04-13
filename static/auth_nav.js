(function () {
  function getStoredUser() {
    try {
      return JSON.parse(localStorage.getItem("tailorcv_user") || "null");
    } catch (error) {
      return null;
    }
  }

  function clearStoredUser() {
    localStorage.removeItem("tailorcv_user");
  }

  function createAuthWidget(user) {
    if (!user) {
      return `
        <a class="login" href="/login">Login</a>
      `;
    }

    const initial = (user.name || user.email || "U").trim().charAt(0).toUpperCase();
    const safeName = user.name || user.email || "User";

    return `
      <div class="profile-menu" id="profileMenu">
        <button type="button" class="profile-trigger" id="profileTrigger" aria-haspopup="true" aria-expanded="false" title="${safeName}">
          <span class="profile-avatar">${initial}</span>
          <span class="profile-display-name">${safeName}</span>
        </button>
        <div class="profile-dropdown" id="profileDropdown">
          <div class="profile-name">${safeName}</div>
          <button type="button" class="profile-logout" id="logoutBtn">Logout</button>
        </div>
      </div>
    `;
  }

  function initAuthNav() {
    const slot = document.getElementById("auth-nav-slot");
    if (!slot) return;

    const user = getStoredUser();
    slot.innerHTML = createAuthWidget(user);

    if (!user) return;

    const trigger = document.getElementById("profileTrigger");
    const menu = document.getElementById("profileMenu");
    const logoutBtn = document.getElementById("logoutBtn");

    if (trigger && menu) {
      trigger.addEventListener("click", function () {
        const isOpen = menu.classList.toggle("open");
        trigger.setAttribute("aria-expanded", isOpen ? "true" : "false");
      });

      document.addEventListener("click", function (event) {
        if (!menu.contains(event.target)) {
          menu.classList.remove("open");
          trigger.setAttribute("aria-expanded", "false");
        }
      });
    }

    if (logoutBtn) {
      logoutBtn.addEventListener("click", function () {
        fetch('/logout', {method: 'POST'})
        .then(() => {
          clearStoredUser();
          window.location.href = "/";
        })
        .catch(() => {
          clearStoredUser();
          window.location.href = "/";
        });
      });
    }
  }

  window.TailorCVAuth = {
    saveUser(user) {
      localStorage.setItem("tailorcv_user", JSON.stringify(user));
    },
    clearUser: clearStoredUser,
    getUser: getStoredUser,
  };

  document.addEventListener("DOMContentLoaded", initAuthNav);
})();
