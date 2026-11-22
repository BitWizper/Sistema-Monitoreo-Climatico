import { getWeatherByCity, getWeatherByCoords } from "./weatherService.js";
import { resolveInitialWeather } from "./geoService.js";
import { requestNotificationPermission, evaluateAlertRules } from "./notificationService.js";

const cities = {
  "ciudad de mexico": { name: "Ciudad de México", country: "MX", temperature: 24, feels: 26, condition: "Parcialmente nublado", humidity: 64, wind: 12, uv: "Moderado", rawCode: 2 },
  madrid: { name: "Madrid", country: "ES", temperature: 18, feels: 18, condition: "Despejado", humidity: 42, wind: 9, uv: "Bajo", rawCode: 0 },
  "buenos aires": { name: "Buenos Aires", country: "AR", temperature: 22, feels: 23, condition: "Algo de sol", humidity: 58, wind: 15, uv: "Moderado", rawCode: 1 },
  bogota: { name: "Bogotá", country: "CO", temperature: 14, feels: 13, condition: "Lluvia ligera", humidity: 78, wind: 8, uv: "Bajo", rawCode: 61 },
  barcelona: { name: "Barcelona", country: "ES", temperature: 21, feels: 21, condition: "Soleado", humidity: 51, wind: 11, uv: "Moderado", rawCode: 0 },
  santiago: { name: "Santiago", country: "CL", temperature: 20, feels: 21, condition: "Despejado", humidity: 47, wind: 10, uv: "Alto", rawCode: 0 },
};

const nearbyPeninsulaCities = [
  { name: "Mérida", country: "MX", countryName: "México", region: "Yucatán", latitude: 20.967, longitude: -89.62318 },
  { name: "Valladolid", country: "MX", countryName: "México", region: "Yucatán", latitude: 20.68812, longitude: -88.19936 },
  { name: "Progreso", country: "MX", countryName: "México", region: "Yucatán", latitude: 21.2833, longitude: -89.6667 },
  { name: "Campeche", country: "MX", countryName: "México", region: "Campeche", latitude: 19.84073, longitude: -90.51676 },
  { name: "Cancún", country: "MX", countryName: "México", region: "Quintana Roo", latitude: 21.17429, longitude: -86.84656 },
  { name: "Playa del Carmen", country: "MX", countryName: "México", region: "Quintana Roo", latitude: 20.6274, longitude: -87.07987 },
  { name: "Tulum", country: "MX", countryName: "México", region: "Quintana Roo", latitude: 20.21173, longitude: -87.46325 },
  { name: "Chetumal", country: "MX", countryName: "México", region: "Quintana Roo", latitude: 18.51957, longitude: -88.30397 },
];

const ALERT_STORAGE_KEY = "clima.active-alerts";

function loadAlertRules() {
  try {
    const savedRules = localStorage.getItem(ALERT_STORAGE_KEY);
    if (!savedRules) return [];
    const parsedRules = JSON.parse(savedRules);
    if (!Array.isArray(parsedRules)) throw new Error("El formato de alertas guardadas no es válido.");
    return parsedRules.filter((rule) =>
      rule &&
      typeof rule.id === "string" &&
      typeof rule.city === "string" &&
      ["temperature", "wind", "rain"].includes(rule.type)
    );
  } catch (error) {
    console.error("No se pudieron cargar las alertas guardadas.", error);
    return [];
  }
}

const activeAlertRules = loadAlertRules();

const searchForm = document.querySelector("#search-form");
const searchInput = document.querySelector("#city-search");
const searchStatus = document.querySelector("#search-status");
const toast = document.querySelector("#toast");
const favoriteCities = document.querySelector("#favorite-cities");
const currentFavoriteButton = document.querySelector("#favorite-current");
const alertForm = document.querySelector("#alert-form");
const alertType = document.querySelector("#alert-type");
const thresholdInput = document.querySelector("#alert-threshold");
const alertFeedback = document.querySelector("#alert-feedback");
const thresholdError = document.querySelector("#threshold-error");
const notificationButton = document.querySelector(".notification-button");

let currentCity = cities["ciudad de mexico"];
let currentAlertLocation = null;
let availableAlertLocations = [];
let fahrenheit = false;
let toastTimeout;

function normalizeKey(text) {
  return text.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function cacheCity(weatherObj) {
  if (!weatherObj?.name) return;
  cities[normalizeKey(weatherObj.name)] = weatherObj;
}

function toDisplayTemperature(celsius) {
  const temperature = fahrenheit ? Math.round((celsius * 9) / 5 + 32) : celsius;
  return `${temperature}°`;
}

function updateDateLabels() {
  const now = new Date();
  const date = new Intl.DateTimeFormat("es-MX", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(now);
  const time = new Intl.DateTimeFormat("es-MX", {
    hour: "numeric",
    minute: "2-digit",
  }).format(now);
  document.querySelector("#header-date").textContent = date.toLocaleUpperCase("es-MX");
  document.querySelector("#weather-date").textContent = `${date} · Actualizado a las ${time}`;
}

function getForecastIcon(code) {
  if ([0].includes(code)) return { className: "sunny", symbol: "☀" };
  if ([1, 2].includes(code)) return { className: "partly", symbol: "◐" };
  if ([45, 48, 3].includes(code)) return { className: "cloudy", symbol: "☁" };
  if ([95, 96, 99].includes(code)) return { className: "stormy", symbol: "ϟ" };
  return { className: "rainy", symbol: "☂" };
}

function renderForecast(days = []) {
  const forecastList = document.querySelector("#forecast-list");
  forecastList.replaceChildren();

  if (!days.length) {
    const message = document.createElement("p");
    message.className = "forecast-message";
    message.textContent = "El pronóstico no está disponible en este momento.";
    forecastList.append(message);
    return;
  }

  days.forEach((day, index) => {
    const date = new Date(`${day.date}T12:00:00`);
    const weekday = index === 0
      ? "Hoy"
      : new Intl.DateTimeFormat("es-MX", { weekday: "short" })
          .format(date)
          .replace(".", "");
    const shortDate = new Intl.DateTimeFormat("es-MX", {
      day: "numeric",
      month: "short",
    }).format(date).replace(".", "");
    const icon = getForecastIcon(day.code);
    const article = document.createElement("article");
    article.className = `forecast-day${index === 0 ? " today" : ""}`;

    const dayName = document.createElement("div");
    dayName.className = "forecast-day-name";
    const weekdayLabel = document.createElement("strong");
    weekdayLabel.textContent = weekday.charAt(0).toUpperCase() + weekday.slice(1);
    const dateLabel = document.createElement("span");
    dateLabel.textContent = shortDate;
    dayName.append(weekdayLabel, dateLabel);

    const iconElement = document.createElement("span");
    iconElement.className = `forecast-icon ${icon.className}`;
    iconElement.setAttribute("aria-hidden", "true");
    iconElement.textContent = icon.symbol;

    const condition = document.createElement("div");
    condition.className = "forecast-condition";
    condition.textContent = day.condition;

    const range = document.createElement("div");
    range.className = "forecast-range";
    const high = document.createElement("strong");
    high.dataset.celsius = String(day.maxTemp);
    high.textContent = toDisplayTemperature(day.maxTemp);
    const low = document.createElement("span");
    low.dataset.celsius = String(day.minTemp);
    low.textContent = toDisplayTemperature(day.minTemp);
    range.append(high, low);

    const rain = document.createElement("div");
    rain.className = `rain-chance${day.rainProb >= 50 ? " rain-high" : ""}`;
    const rainIcon = document.createElement("span");
    rainIcon.setAttribute("aria-hidden", "true");
    rainIcon.textContent = "◉";
    rain.append(rainIcon, document.createTextNode(` ${day.rainProb}%`));
    article.append(dayName, iconElement, condition, range, rain);
    forecastList.append(article);
  });
}

function updateWeather(city, source = "api") {
  currentCity = city;
  cacheCity(city);
  updateDateLabels();
  document.querySelector("#current-city").innerHTML = `${city.name} <span class="country-tag">${city.country}</span>`;
  document.querySelector("#current-temperature").innerHTML = `${toDisplayTemperature(city.temperature).slice(0, -1)}<span>°</span>`;
  document.querySelector("#current-condition").textContent = city.condition;
  document.querySelector("#feels-like").textContent = toDisplayTemperature(city.feels);
  document.querySelector("#humidity").textContent = `${city.humidity}%`;
  document.querySelector("#wind").textContent = `${fahrenheit ? Math.round(city.wind * 0.621) : city.wind} ${fahrenheit ? "mph" : "km/h"}`;
  document.querySelector("#uv-index").textContent = city.uv;
  const weatherStatus = document.querySelector("#weather-status");
  weatherStatus.classList.toggle("offline", source === "cache");
  weatherStatus.lastChild.textContent = source === "cache"
    ? " Sin conexión · última consulta guardada"
    : " Datos en tiempo real · Open-Meteo";
  renderForecast(city.forecastDays);
  currentFavoriteButton.setAttribute("aria-label", `Agregar ${city.name} a favoritos`);
  const saved = Array.from(favoriteCities.querySelectorAll(".city-card")).some((card) => card.dataset.city === city.name);
  currentFavoriteButton.setAttribute("aria-pressed", String(saved));
  currentFavoriteButton.setAttribute("aria-label", `${saved ? "Quitar" : "Agregar"} ${city.name} ${saved ? "de" : "a"} favoritos`);
  searchForm.classList.remove("expanded");
  searchInput.value = "";
  searchInput.blur();
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("visible");
  window.clearTimeout(toastTimeout);
  toastTimeout = window.setTimeout(() => toast.classList.remove("visible"), 3200);
}

function saveAlertRules() {
  try {
    localStorage.setItem(ALERT_STORAGE_KEY, JSON.stringify(activeAlertRules));
    return true;
  } catch (error) {
    console.error("No se pudieron guardar las alertas.", error);
    showToast("No se pudieron guardar las alertas en este dispositivo.");
    return false;
  }
}

function getAlertLabel(rule) {
  if (rule.type === "rain") return "Lluvia pronosticada";
  if (rule.type === "wind") return `Viento > ${rule.threshold} km/h`;
  return `Temperatura > ${rule.threshold}°C`;
}

function renderActiveAlerts() {
  const alertList = document.querySelector("#active-alert-list");
  alertList.replaceChildren();

  activeAlertRules.forEach((rule) => {
    const alert = document.createElement("div");
    alert.className = "active-alert";
    alert.dataset.alertId = rule.id;
    const dot = document.createElement("span");
    dot.className = "alert-status-dot";
    const details = document.createElement("span");
    const label = document.createElement("strong");
    label.textContent = getAlertLabel(rule);
    const location = document.createElement("small");
    location.textContent = [rule.city, rule.region, rule.countryName || rule.country].filter(Boolean).join(", ");
    details.append(label, location);
    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "remove-alert";
    removeButton.setAttribute("aria-label", `Eliminar alerta ${getAlertLabel(rule)} de ${rule.city}`);
    removeButton.textContent = "×";
    alert.append(dot, details, removeButton);
    alertList.append(alert);
  });

  document.querySelector("#empty-alerts").hidden = activeAlertRules.length > 0;
  updateAlertCount();
}

function distanceBetweenCoordinates(first, second) {
  const radians = (degrees) => (degrees * Math.PI) / 180;
  const latitudeDifference = radians(second.latitude - first.latitude);
  const longitudeDifference = radians(second.longitude - first.longitude);
  const haversine =
    Math.sin(latitudeDifference / 2) ** 2 +
    Math.cos(radians(first.latitude)) *
      Math.cos(radians(second.latitude)) *
      Math.sin(longitudeDifference / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function getAlertLocationId(location) {
  return `${normalizeKey(location.name)}-${location.country}-${location.coordinates.latitude.toFixed(3)}-${location.coordinates.longitude.toFixed(3)}`;
}

function getNearbyAlertLocations(weather) {
  if (weather.country !== "MX" || !weather.coordinates) return [];
  const region = normalizeKey(weather.region || "");
  if (!["yucatan", "estado de yucatan", "campeche", "estado de campeche", "quintana roo", "estado de quintana roo"].includes(region)) {
    return [];
  }

  return nearbyPeninsulaCities
    .map((place) => {
      const coordinates = { latitude: place.latitude, longitude: place.longitude };
      return {
        ...place,
        coordinates,
        distanceKm: distanceBetweenCoordinates(weather.coordinates, coordinates),
      };
    })
    .filter((place) =>
      place.distanceKm <= 450 &&
      normalizeKey(place.name) !== normalizeKey(weather.name)
    )
    .sort((first, second) => first.distanceKm - second.distanceKm);
}

function migrateAlertLocations() {
  let changed = false;
  activeAlertRules.forEach((rule) => {
    if (rule.coordinates) return;
    const location = availableAlertLocations.find((candidate) =>
      normalizeKey(candidate.name) === normalizeKey(rule.city) &&
      (!rule.country || candidate.country === rule.country)
    );
    if (!location) return;
    rule.coordinates = location.coordinates;
    rule.countryName = location.countryName;
    rule.region = location.region;
    changed = true;
  });
  if (changed) saveAlertRules();
}

function updateAlertLocation(weather, isFallback = false) {
  const locationSelect = document.querySelector("#alert-city");
  locationSelect.replaceChildren();
  const currentLocation = {
    id: "",
    name: weather.name,
    country: weather.country,
    countryName: weather.countryName,
    region: weather.region,
    coordinates: weather.coordinates,
    distanceKm: 0,
    isCurrent: true,
  };
  availableAlertLocations = [
    currentLocation,
    ...getNearbyAlertLocations(weather),
  ];
  availableAlertLocations.forEach((location) => {
    location.id = getAlertLocationId(location);
    const option = document.createElement("option");
    option.value = location.id;
    const place = [location.name, location.region, location.countryName || location.country]
      .filter(Boolean)
      .join(", ");
    option.textContent = location.isCurrent
      ? `${place} · ubicación actual${isFallback ? " (predeterminada)" : ""}`
      : `${place} · ${Math.round(location.distanceKm)} km`;
    option.defaultSelected = location.isCurrent;
    locationSelect.append(option);
  });
  locationSelect.value = currentLocation.id;
  locationSelect.disabled = !weather.coordinates;
  document.querySelector("#alert-form .primary-button").disabled = !weather.coordinates;
  migrateAlertLocations();
  renderActiveAlerts();
}

async function checkAlertRules(weather, rules = activeAlertRules) {
  const triggered = await evaluateAlertRules(weather, rules);
  if (triggered.length) {
    if (rules === activeAlertRules) saveAlertRules();
    showToast(triggered.map((rule) => rule.detail).join(" "));
  }
  return triggered;
}

function findCity(query) {
  return cities[normalizeKey(query)];
}

// Búsqueda manual: usa API REST real y cae a caché/fallback si no hay red o no existe
searchForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const query = searchInput.value.trim();
  if (!query) {
    searchStatus.textContent = "Escribe el nombre de una ciudad para buscar.";
    searchStatus.className = "search-status visible error";
    searchInput.focus();
    return;
  }

  searchStatus.textContent = "Buscando ciudad…";
  searchStatus.className = "search-status visible loading";

  try {
    const liveWeather = await getWeatherByCity(query);
    searchStatus.className = "search-status";
    updateWeather(liveWeather);
    showToast(`Pronóstico de ${liveWeather.name} actualizado.`);
    await checkAlertRules(liveWeather);
  } catch (error) {
    const localMatch = findCity(query);
    if (localMatch) {
      searchStatus.className = "search-status";
      updateWeather(localMatch, "cache");
      showToast(`Mostrando datos guardados de ${localMatch.name}.`);
    } else {
      searchStatus.textContent = error.message || `No encontramos “${query}”.`;
      searchStatus.className = "search-status visible error";
    }
  }
});

searchInput.addEventListener("input", () => {
  if (searchStatus.classList.contains("error")) searchStatus.className = "search-status";
});

searchForm.addEventListener("click", () => {
  if (window.matchMedia("(max-width: 420px)").matches) {
    searchForm.classList.add("expanded");
    searchInput.focus();
  }
});

document.addEventListener("click", (event) => {
  if (!searchForm.contains(event.target)) {
    searchStatus.className = "search-status";
    searchForm.classList.remove("expanded");
  }
});

currentFavoriteButton.addEventListener("click", () => {
  const existing = Array.from(favoriteCities.querySelectorAll(".city-card")).find((card) => card.dataset.city === currentCity.name);
  if (existing) {
    existing.remove();
    currentFavoriteButton.setAttribute("aria-pressed", "false");
    currentFavoriteButton.setAttribute("aria-label", `Agregar ${currentCity.name} a favoritos`);
    showToast(`${currentCity.name} se quitó de tus favoritos.`);
    return;
  }
  const card = document.createElement("button");
  card.type = "button";
  card.className = "city-card";
  card.dataset.city = currentCity.name;
  card.innerHTML = `<span class="city-card-top"><span><strong>${currentCity.name}</strong><small>${currentCity.country}</small></span><span class="mini-weather partly" aria-hidden="true">☀</span></span><span class="city-card-bottom"><strong>${toDisplayTemperature(currentCity.temperature)}</strong><span>${currentCity.condition}</span><span class="city-low">Mín. ${toDisplayTemperature(currentCity.temperature - 7)}</span></span>`;
  favoriteCities.append(card);
  currentFavoriteButton.setAttribute("aria-pressed", "true");
  currentFavoriteButton.setAttribute("aria-label", `Quitar ${currentCity.name} de favoritos`);
  showToast(`${currentCity.name} se agregó a tus favoritos.`);
});

favoriteCities.addEventListener("click", (event) => {
  const card = event.target.closest(".city-card");
  if (!card) return;
  const city = findCity(card.dataset.city);
  if (city) {
    updateWeather(city);
    window.scrollTo({ top: 0, behavior: "smooth" });
    showToast(`Mostrando el clima de ${city.name}.`);
  }
});

document.querySelector("#add-favorite").addEventListener("click", () => {
  searchInput.focus();
  showToast("Busca una ciudad y usa la estrella para guardarla.");
});

function syncThresholdField() {
  const isRain = alertType.value === "rain";
  const isWind = alertType.value === "wind";
  const hasThreshold = !isRain;
  thresholdInput.disabled = !hasThreshold;
  thresholdInput.min = isWind ? "0" : "-50";
  thresholdInput.max = isWind ? "300" : "60";
  document.querySelector("#threshold-unit").textContent = isWind ? "km/h" : "°C";
  document.querySelector("#threshold-hint").textContent = isWind ? "Umbral de velocidad" : "Umbral de temperatura";
  thresholdInput.setAttribute("aria-describedby", hasThreshold ? "threshold-error" : "");
  thresholdError.textContent = "";
}
alertType.addEventListener("change", syncThresholdField);

alertForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  alertFeedback.textContent = "";
  thresholdError.textContent = "";
  const selectedLocation = availableAlertLocations.find(
    (location) => location.id === document.querySelector("#alert-city").value
  );
  if (!selectedLocation?.coordinates) {
    alertFeedback.textContent = "No se encontró el pronóstico para esa ubicación.";
    return;
  }

  const threshold = Number(thresholdInput.value);
  const isWind = alertType.value === "wind";
  const minimum = isWind ? 0 : -50;
  const maximum = isWind ? 300 : 60;
  if (alertType.value !== "rain" && (!Number.isFinite(threshold) || threshold < minimum || threshold > maximum)) {
    thresholdError.textContent = `Ingresa un valor entre ${minimum} y ${maximum} ${isWind ? "km/h" : "°C"}.`;
    thresholdInput.setAttribute("aria-invalid", "true");
    thresholdInput.focus();
    return;
  }
  thresholdInput.removeAttribute("aria-invalid");

  const newRule = {
    id: String(Date.now()),
    city: selectedLocation.name,
    country: selectedLocation.country,
    countryName: selectedLocation.countryName,
    region: selectedLocation.region,
    coordinates: selectedLocation.coordinates,
    type: alertType.value,
    threshold: alertType.value === "rain" ? null : threshold,
  };

  if (activeAlertRules.some((rule) =>
    rule.city === newRule.city &&
    rule.country === newRule.country &&
    rule.coordinates?.latitude === newRule.coordinates.latitude &&
    rule.coordinates?.longitude === newRule.coordinates.longitude &&
    rule.type === newRule.type &&
    rule.threshold === newRule.threshold
  )) {
    alertFeedback.textContent = "Ya existe esa alerta para esta ubicación.";
    return;
  }

  const submitButton = document.querySelector("#alert-form .primary-button");
  submitButton.disabled = true;
  const permissionPromise = requestNotificationPermission().catch((error) => {
    console.error("No se pudo solicitar permiso para las notificaciones.", error);
    return "default";
  });

  try {
    const liveWeather = await getWeatherByCoords(
      selectedLocation.coordinates.latitude,
      selectedLocation.coordinates.longitude,
      {
        name: selectedLocation.name,
        country: selectedLocation.country,
        countryName: selectedLocation.countryName,
        region: selectedLocation.region,
      }
    );
    const permission = await permissionPromise;
    activeAlertRules.push(newRule);
    if (!saveAlertRules()) {
      activeAlertRules.pop();
      return;
    }

    renderActiveAlerts();
    const triggered = await checkAlertRules(liveWeather, [newRule]);
    if (triggered.length) {
      alertFeedback.textContent = `Alerta creada: ${triggered[0].detail}`;
    } else if (permission === "granted") {
      alertFeedback.textContent = `Alerta creada para ${selectedLocation.name}. Se revisará cada 15 min mientras la app esté abierta.`;
    } else {
      alertFeedback.textContent = `Alerta guardada para ${selectedLocation.name}. Activa las notificaciones del navegador para recibir avisos.`;
    }
    saveAlertRules();
    alertForm.reset();
    document.querySelector("#alert-city").value = selectedLocation.id;
    syncThresholdField();
  } catch (error) {
    console.error(`No se pudo consultar el clima de ${selectedLocation.name}.`, error);
    alertFeedback.textContent = `No se pudo consultar el clima de ${selectedLocation.name}; la alerta no se creó.`;
  } finally {
    submitButton.disabled = !currentAlertLocation?.coordinates;
  }
});

document.querySelector(".active-alerts").addEventListener("click", (event) => {
  const button = event.target.closest(".remove-alert");
  if (!button) return;
  const alert = button.closest(".active-alert");
  const index = activeAlertRules.findIndex((rule) => rule.id === alert.dataset.alertId);
  if (index < 0) return;
  const [removedRule] = activeAlertRules.splice(index, 1);
  if (!saveAlertRules()) {
    activeAlertRules.splice(index, 0, removedRule);
    return;
  }
  renderActiveAlerts();
});

function updateAlertCount() {
  const count = activeAlertRules.length;
  document.querySelector("#active-alert-count").textContent = count;
  document.querySelector(".nav-count").textContent = count;
  document.querySelector(".mobile-nav-count").textContent = count;
}

renderActiveAlerts();

async function refreshCurrentLocationAlerts() {
  if (!currentAlertLocation || !activeAlertRules.length) return;
  const locations = new Map();
  activeAlertRules.forEach((rule) => {
    if (!rule.coordinates) return;
    const key = `${rule.coordinates.latitude},${rule.coordinates.longitude}`;
    if (!locations.has(key)) locations.set(key, { rule, rules: [] });
    locations.get(key).rules.push(rule);
  });

  const triggeredAlerts = [];
  const failedLocations = [];
  for (const { rule, rules } of locations.values()) {
    try {
      const weather = await getWeatherByCoords(
        rule.coordinates.latitude,
        rule.coordinates.longitude,
        {
          name: rule.city,
          country: rule.country,
          countryName: rule.countryName,
          region: rule.region,
        }
      );
      if (
        weather.coordinates.latitude === currentAlertLocation.coordinates?.latitude &&
        weather.coordinates.longitude === currentAlertLocation.coordinates?.longitude
      ) {
        currentAlertLocation = weather;
      }
      triggeredAlerts.push(...await evaluateAlertRules(weather, rules));
    } catch (error) {
      console.error(`No se pudo actualizar el clima de ${rule.city}.`, error);
      failedLocations.push(rule.city);
    }
  }

  if (triggeredAlerts.length) {
    saveAlertRules();
    showToast(triggeredAlerts.map((rule) => rule.detail).join(" "));
  }
  if (failedLocations.length) {
    alertFeedback.textContent = `No se pudo actualizar el clima de ${failedLocations.join(", ")}; volveremos a intentarlo.`;
  }
}

window.setInterval(refreshCurrentLocationAlerts, 15 * 60 * 1000);

function updateUnits() {
  document.querySelectorAll(".forecast-range").forEach((range) => {
    const [high, low] = Array.from(range.children);
    const highValue = Number(high.dataset.celsius || high.textContent.replace("°", ""));
    const lowValue = Number(low.dataset.celsius || low.textContent.replace("°", ""));
    high.dataset.celsius = String(highValue);
    low.dataset.celsius = String(lowValue);
    high.textContent = toDisplayTemperature(highValue);
    low.textContent = toDisplayTemperature(lowValue);
  });
  document.querySelectorAll(".city-card").forEach((card) => {
    const temperatures = card.querySelectorAll(".city-card-bottom > strong, .city-card-bottom .city-low");
    temperatures.forEach((element, index) => {
      const displayedValue = Number(element.dataset.celsius || element.textContent.match(/-?\d+/)?.[0]);
      if (!Number.isFinite(displayedValue)) return;
      element.dataset.celsius = String(displayedValue);
      const formatted = toDisplayTemperature(displayedValue);
      element.textContent = index === 0 ? formatted : `Mín. ${formatted}`;
    });
  });
  updateWeather(currentCity);
  document.querySelector("#unit-toggle").innerHTML = fahrenheit ? "°F <span>/</span> °C" : "°C <span>/</span> °F";
  document.querySelector("#forecast-unit").innerHTML = fahrenheit ? "Ver en °C <span aria-hidden=\"true\">→</span>" : "Ver en °F <span aria-hidden=\"true\">→</span>";
}

document.querySelector("#unit-toggle").addEventListener("click", () => {
  fahrenheit = !fahrenheit;
  updateUnits();
});
document.querySelector("#forecast-unit").addEventListener("click", () => {
  fahrenheit = !fahrenheit;
  updateUnits();
});

document.querySelectorAll(".nav-link, .mobile-nav-link").forEach((link) => {
  link.addEventListener("click", () => {
    document.querySelectorAll(".nav-link, .mobile-nav-link").forEach((item) => {
      item.classList.toggle("active", item.getAttribute("href") === link.getAttribute("href"));
    });
  });
});

if (notificationButton) {
  notificationButton.addEventListener("click", async () => {
    const status = await requestNotificationPermission();
    showToast(status === "granted" ? "Notificaciones activadas." : `Estado de notificaciones: ${status}.`);
  });
}

// Carga inicial con geolocalización y fallback automático
window.addEventListener("DOMContentLoaded", async () => {
  try {
    const result = await resolveInitialWeather("Mérida");
    currentAlertLocation = result.weather;
    updateAlertLocation(result.weather, result.source === "fallback");
    updateWeather(result.weather);
    if (result.source === "fallback") {
      showToast(`${result.reason} Mostrando ${result.weather.name}.`);
    } else {
      showToast(`Ubicación detectada: ${result.weather.name}.`);
    }
    await refreshCurrentLocationAlerts();
  } catch (error) {
    console.error("No se pudo cargar el clima de tu ubicación.", error);
    const weatherStatus = document.querySelector("#weather-status");
    weatherStatus.lastChild.textContent = " No se pudo conectar · intenta buscar una ciudad";
    weatherStatus.classList.add("offline");
    renderForecast();
    alertFeedback.textContent = "No se pudo detectar tu ubicación. Las alertas estarán disponibles cuando se conecte el clima.";
  }
});