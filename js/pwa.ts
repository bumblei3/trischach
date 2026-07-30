// PWA bootstrap: service worker registration + install prompt handling.
// Kept as a separate module (not inline) so a strict CSP
// `script-src 'self'` can block all injected/inline scripts.

// Register Service Worker for PWA offline support
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("sw.js")
      .then((registration) => {
        console.log("[PWA] Service Worker registered:", registration.scope);

        // Check for updates periodically
        setInterval(
          () => {
            registration.update();
          },
          60 * 60 * 1000,
        ); // Every hour
      })
      .catch((error) => {
        console.warn("[PWA] Service Worker registration failed:", error);
      });
  });
}

// Handle install prompt
let deferredPrompt: any;
const installBtn = document.getElementById("install-btn");

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  console.log("[PWA] Install prompt available");
  if (installBtn) installBtn.style.display = "inline-block";
});

window.addEventListener("appinstalled", () => {
  console.log("[PWA] App installed");
  if (installBtn) installBtn.style.display = "none";
  deferredPrompt = null;
});

// Install button click handler
installBtn?.addEventListener("click", async () => {
  if (!deferredPrompt) {
    console.log("[PWA] No deferred prompt available");
    return;
  }
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  console.log("[PWA] Install prompt outcome:", outcome);
  if (outcome === "accepted") {
    deferredPrompt = null;
    if (installBtn) installBtn.style.display = "none";
  }
});
