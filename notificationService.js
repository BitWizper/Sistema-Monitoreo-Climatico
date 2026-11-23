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
    } catch (error) {
      console.error("No se pudo usar el Service Worker para notificar; se probará Notification API.", error);
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
  if (!weather || typeof weather !== "object" || !Array.isArray(rules)) {
    throw new TypeError("El clima y las reglas de alerta deben tener un formato válido.");
  }
  const triggered = [];

  for (const rule of rules) {
    if (
      !rule ||
      typeof rule !== "object" ||
      typeof rule.id !== "string" ||
      typeof rule.city !== "string" ||
      !["temperature", "wind", "rain"].includes(rule.type)
    ) {
      throw new TypeError("Se encontró una regla de alerta inválida.");
    }
    if (
      (rule.type === "temperature" || rule.type === "wind") &&
      !Number.isFinite(rule.threshold)
    ) {
      throw new TypeError(`El umbral de la alerta "${rule.id}" no es válido.`);
    }
    if (rule.type === "rain" && rule.threshold !== null && rule.threshold !== undefined) {
      throw new TypeError(`La alerta de lluvia "${rule.id}" no debe tener umbral.`);
    }

    const sameCity =
      !rule.city ||
      !weather.name ||
      rule.city.trim().toLocaleLowerCase() === weather.name.trim().toLocaleLowerCase();
    const sameCountry =
      !rule.country ||
      !weather.country ||
      rule.country.trim().toLocaleLowerCase() === weather.country.trim().toLocaleLowerCase();
    if (
      !sameCity ||
      !sameCountry
    ) {
      continue;
    }

    let matched = false;
    let detail = "";

    if (rule.type === "temperature") {
      const limit = rule.threshold;
      if (Number.isFinite(weather.temperature) && weather.temperature > limit) {
        matched = true;
        detail = `${weather.name}: ${weather.temperature}°C supera el umbral de ${limit}°C.`;
      }
    } else if (rule.type === "wind") {
      const limit = rule.threshold;
      if (Number.isFinite(weather.wind) && weather.wind > limit) {
        matched = true;
        detail = `${weather.name}: viento de ${weather.wind} km/h supera el umbral de ${limit} km/h.`;
      }
    } else if (rule.type === "rain") {
      const rainCodes = [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99];
      const hasRain =
        rainCodes.includes(weather.rawCode) ||
        /lluvia|llovizna|tormenta|chubasco/i.test(weather.condition) ||
        weather.forecastDays?.some((day) =>
          rainCodes.includes(day.code) || day.rainProb >= 50
        );

      if (hasRain) {
        matched = true;
        detail = `${weather.name}: condición de lluvia (${weather.condition}).`;
      }
    }

    if (matched) {
      const lastTriggeredAt = Date.parse(rule.lastTriggeredAt || "");
      if (Number.isFinite(lastTriggeredAt) && Date.now() - lastTriggeredAt < 6 * 60 * 60 * 1000) {
        continue;
      }
      await showWeatherNotification("Alerta de Monitoreo Climático", detail);
      rule.lastTriggeredAt = new Date().toISOString();
      triggered.push({ ...rule, detail });
    }
  }

  return triggered;
}