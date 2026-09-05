// Login gate — PREVIEW-ONLY, NOT REAL SECURITY.
//
// This is a static site with no backend, so there is nowhere to safely check
// a password. Anyone who views this file's source (or opens devtools) can
// read the credentials below and bypass this screen entirely — it exists
// only to keep casual/accidental visitors out of an internal preview link,
// not to protect real production data.
//
// Change these before sharing the preview link, and see README.md for what
// real authentication would need (a backend + a proper auth provider).
const AUTH_CONFIG = {
  username: "admin",
  password: "bee4stitch2026",
};

const SESSION_KEY = "bee4stitch_authed";

function isAuthed() {
  try {
    return sessionStorage.getItem(SESSION_KEY) === "1";
  } catch (e) {
    return false;
  }
}

function setAuthed(value) {
  try {
    if (value) sessionStorage.setItem(SESSION_KEY, "1");
    else sessionStorage.removeItem(SESSION_KEY);
  } catch (e) {
    /* sessionStorage unavailable — session just won't persist across reloads */
  }
}

function showApp() {
  document.getElementById("login-overlay").classList.add("hidden");
  document.getElementById("app-root").classList.remove("hidden");
  // Charts drawn while the app was hidden behind the login gate sized
  // themselves against a zero-width canvas. Trigger the existing resize
  // handler (see app.js) now that the layout has real dimensions.
  window.dispatchEvent(new Event("resize"));
}

function showLogin() {
  document.getElementById("login-overlay").classList.remove("hidden");
  document.getElementById("app-root").classList.add("hidden");
}

document.addEventListener("DOMContentLoaded", () => {
  if (isAuthed()) {
    showApp();
  } else {
    showLogin();
  }

  document.getElementById("login-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const u = document.getElementById("login-username").value.trim();
    const p = document.getElementById("login-password").value;
    const errorEl = document.getElementById("login-error");

    if (u === AUTH_CONFIG.username && p === AUTH_CONFIG.password) {
      errorEl.classList.add("hidden");
      setAuthed(true);
      showApp();
    } else {
      errorEl.classList.remove("hidden");
    }
  });

  document.getElementById("logout-btn").addEventListener("click", () => {
    setAuthed(false);
    document.getElementById("login-password").value = "";
    showLogin();
  });
});
