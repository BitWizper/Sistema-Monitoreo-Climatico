/**
 * Solicita permiso para mostrar notificaciones del navegador/sistema.
 * @returns {Promise<NotificationPermission | "unsupported">}
 */
export async function requestNotificationPermission() {
  if (!("Notification" in window)) {
    return "unsupported";
  }
  if (Notification.permission === "granted") {
    return "granted";
  }
  return await Notification.requestPermission();
}

/**
 * Muestra una notificación usando el Service Worker si está activo o Notification API directa.
 * @param {string} title
 * @param {string} body
 * @returns {Promise<boolean>}
 */
export async function showWeatherNotification(title, body) {
  if (!("Notification" in window) || Notification.permission !== "granted") {
    return false;
  }

  const options = {
    body,
    icon: "./icons/icon-192.png",
    badge: "./icons/icon-192.png",
    tag: "climate-alert",
    renotify: true,
  };

  if ("serviceWorker" in navigator) {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg?.active) {
        await reg.showNotification(title, options);
        return true;
      }
    } catch {
      // Continúa con new Notification como respaldo
    }
  }

  new Notification(title, options);
  return true;
}

/**
 * Evalúa reglas de alerta personalizadas contra el clima actual normalizado.
 * Regla esperada: { id, city, type: "temperature" | "wind" | "rain", threshold }
 * @param {object} weather
 * @param {Array<object>} rules
 * @returns {Promise<Array<object>>} Reglas disparadas
 */
export async function evaluateAlertRules(weather, rules = []) {
  const triggered = [];

  for (const rule of rules) {
    if (
      rule.city &&
      weather.name &&
      rule.city.trim().toLowerCase() !== weather.name.trim().toLowerCase()
    ) {
      continue;
    }

    let matched = false;
    let detail = "";

    if (rule.type === "temperature") {
      const limit = Number(rule.threshold);
      if (Number.isFinite(limit) && weather.temperature > limit) {
        matched = true;
        detail = `${weather.name}: ${weather.temperature}°C supera el umbral de ${limit}°C.`;
      }
    } else if (rule.type === "wind") {
      const limit = Number(rule.threshold);
      if (Number.isFinite(limit) && weather.wind > limit) {
        matched = true;
        detail = `${weather.name}: viento de ${weather.wind} km/h supera el umbral de ${limit} km/h.`;
      }
    } else if (rule.type === "rain") {
      const rainCodes = [51, 53, 55, 61, 63, 65, 80, 81, 82, 95];
      const hasRain =
        rainCodes.includes(weather.rawCode) ||
        /lluvia|llovizna|tormenta|chubasco/i.test(weather.condition);

      if (hasRain) {
        matched = true;
        detail = `${weather.name}: condición de lluvia (${weather.condition}).`;
      }
    }

    if (matched) {
      await showWeatherNotification("Alerta de Monitoreo Climático", detail);
      triggered.push({ ...rule, detail });
    }
  }

  return triggered;
}