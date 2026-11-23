/**
 * pwa-install.js — Rol A (PWA / Despliegue)
 * ------------------------------------------------------------
 * Gestiona la instalación de la PWA y los avisos de estado:
 *  1. Captura `beforeinstallprompt` (Chrome/Edge/Android) y muestra un botón "Instalar".
 *  2. En iOS/Safari (no existe el evento) muestra una pista: Compartir → "Añadir a pantalla de inicio".
 *  3. Detecta `appinstalled` y modo standalone para ocultar el botón.
 *  4. Avisa cuando hay una nueva versión del Service Worker lista (y permite recargar).
 *
 * Es autónomo: crea su propio DOM/estilos, no toca app.js ni index.html (solo se importa).
 * Seguro por diseño: sin innerHTML, solo textContent.
 */

let deferredPrompt = null;

const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;

const isIOS = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

function injectStyles() {
  if (document.getElementById("pwa-install-styles")) return;
  const style = document.createElement("style");
  style.id = "pwa-install-styles";
  style.textContent = `
    .pwa-banner{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:9999;
      display:flex;align-items:center;gap:12px;max-width:min(92vw,460px);padding:12px 16px;
      background:#16324a;color:#fff;border-radius:14px;box-shadow:0 8px 28px rgba(0,0,0,.25);
      font:500 14px/1.35 "DM Sans",system-ui,sans-serif}
    .pwa-banner p{margin:0;flex:1}
    .pwa-banner button{font:inherit;font-weight:700;border:0;border-radius:10px;padding:8px 14px;cursor:pointer}
    .pwa-banner .pwa-primary{background:#5abef0;color:#0b2234}
    .pwa-banner .pwa-secondary{background:transparent;color:#cfe3f2}
    .pwa-banner button:focus-visible{outline:3px solid #fff;outline-offset:2px}
    @media (max-width:619px){
      .pwa-banner{
        bottom:calc(12px + env(safe-area-inset-bottom));
        width:calc(100vw - 24px);
        max-width:none;
        display:grid;
        grid-template-columns:minmax(0,1fr) auto;
        gap:8px 10px;
        padding:12px;
        border:1px solid rgba(255,255,255,.12);
        border-radius:16px;
        box-shadow:0 10px 30px rgba(13,47,69,.28);
        backdrop-filter:blur(16px);
        font-size:12px;
      }
      .pwa-banner p{grid-column:1/-1;line-height:1.45}
      .pwa-banner button{min-height:38px}
      .pwa-banner .pwa-primary{grid-column:1;min-width:110px}
      .pwa-banner .pwa-secondary{grid-column:2;min-width:82px}
    }
  `;
  document.head.appendChild(style);
}

function showBanner(id, message, actions) {
  removeBanner(id);
  injectStyles();
  const banner = document.createElement("div");
  banner.className = "pwa-banner";
  banner.id = id;
  banner.setAttribute("role", "status");
  banner.setAttribute("aria-live", "polite");
  const text = document.createElement("p");
  text.textContent = message;
  banner.appendChild(text);
  actions.forEach(({ label, primary, onClick }) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = primary ? "pwa-primary" : "pwa-secondary";
    btn.textContent = label;
    btn.addEventListener("click", onClick);
    banner.appendChild(btn);
  });
  document.body.appendChild(banner);
}

function removeBanner(id) {
  document.getElementById(id)?.remove();
}

/* ---------- Instalación (Chrome / Edge / Android) ---------- */
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault(); // evitamos el mini-infobar para usar nuestro botón
  deferredPrompt = event;
  if (isStandalone() || sessionStorage.getItem("pwa-install-dismissed")) return;
  showBanner("pwa-install-banner", "Instala Clima en tu celular o laptop para abrirla rápido y usarla sin conexión.", [
    {
      label: "Instalar",
      primary: true,
      onClick: async () => {
        removeBanner("pwa-install-banner");
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        console.info(`[PWA] Resultado de instalación: ${outcome}`);
        deferredPrompt = null;
      },
    },
    {
      label: "Ahora no",
      onClick: () => {
        sessionStorage.setItem("pwa-install-dismissed", "1");
        removeBanner("pwa-install-banner");
      },
    },
  ]);
});

window.addEventListener("appinstalled", () => {
  deferredPrompt = null;
  removeBanner("pwa-install-banner");
  console.info("[PWA] Aplicación instalada");
});

/* ---------- iOS: instrucciones manuales ---------- */
if (isIOS() && !isStandalone() && !localStorage.getItem("pwa-ios-hint-dismissed")) {
  window.addEventListener("load", () => {
    showBanner("pwa-ios-banner", "Instálala: toca Compartir y luego “Añadir a pantalla de inicio”.", [
      {
        label: "Entendido",
        primary: true,
        onClick: () => {
          localStorage.setItem("pwa-ios-hint-dismissed", "1");
          removeBanner("pwa-ios-banner");
        },
      },
    ]);
  });
}

/* ---------- Actualización del Service Worker ---------- */
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.ready.then((registration) => {
    registration.addEventListener("updatefound", () => {
      const worker = registration.installing;
      if (!worker) return;
      worker.addEventListener("statechange", () => {
        // "installed" + controller existente = hay versión nueva esperando/activa
        if (worker.state === "installed" && navigator.serviceWorker.controller) {
          showBanner("pwa-update-banner", "Hay una nueva versión de Clima disponible.", [
            { label: "Actualizar", primary: true, onClick: () => window.location.reload() },
            { label: "Luego", onClick: () => removeBanner("pwa-update-banner") },
          ]);
        }
      });
    });
  });
}
