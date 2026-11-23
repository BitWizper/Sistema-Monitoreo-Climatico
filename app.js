import { getWeatherByCity, getWeatherByCoords } from "./weatherService.js";
import { resolveInitialWeather } from "./geoService.js";
import { requestNotificationPermission, evaluateAlertRules } from "./notificationService.js";
import {
  createRecord,
  deleteRecord,
  initializeStorage,
  putRecord,
  readAllRecords,
  readRecord,
  updateRecord,
} from "./storageService.js";

const cities = {
  "ciudad de mexico": { name: "Ciudad de México", country: "MX", temperature: 24, feels: 26, condition: "Parcialmente nublado", humidity: 64, wind: 12, uv: "Moderado", rawCode: 2 },
  madrid: { name: "Madrid", country: "ES", temperature: 18, feels: 18, condition: "Despejado", humidity: 42, wind: 9, uv: "Bajo", rawCode: 0 },
  "buenos aires": { name: "Buenos Aires", country: "AR", temperature: 22, feels: 23, condition: "Algo de sol", humidity: 58, wind: 15, uv: "Moderado", rawCode: 1 },
  bogota: { name: "Bogotá", country: "CO", temperature: 14, feels: 13, condition: "Lluvia ligera", humidity: 78, wind: 8, uv: "Bajo", rawCode: 61 },
  barcelona: { name: "Barcelona", country: "ES", temperature: 21, feels: 21, condition: "Soleado", humidity: 51, wind: 11, uv: "Moderado", rawCode: 0 },
  santiago: { name: "Santiago", country: "CL", temperature: 20, feels: 21, condition: "Despejado", humidity: 47, wind: 10, uv: "Alto", rawCode: 0 },
};
const recentWeather = new Map();

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

let activeAlertRules = [];

const searchForm = document.querySelector("#search-form");
const searchInput = document.querySelector("#city-search");
const searchStatus = document.querySelector("#search-status");
const toast = document.querySelector("#toast");
const favoriteCities = document.querySelector("#favorite-cities");
const currentFavoriteButton = document.querySelector("#favorite-current");
const favoriteForm = document.querySelector("#favorite-form");
const favoriteCityInput = document.querySelector("#favorite-city");
const favoriteAliasInput = document.querySelector("#favorite-alias");
const favoriteFeedback = document.querySelector("#favorite-feedback");
const alertForm = document.querySelector("#alert-form");
const alertType = document.querySelector("#alert-type");
const thresholdInput = document.querySelector("#alert-threshold");
const alertFeedback = document.querySelector("#alert-feedback");
const thresholdError = document.querySelector("#threshold-error");
const notificationButton = document.querySelector(".notification-button");

let currentCity = cities["ciudad de mexico"];
let currentAlertLocation = null;
let availableAlertLocations = [];
let favoriteRecords = [];
let editingFavoriteId = null;
let editingAlertId = null;
let fahrenheit = false;
let toastTimeout;

function normalizeKey(text) {
  return text.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function reduceCoordinatePrecision(coordinates) {
  return {
    latitude: Number(coordinates.latitude.toFixed(2)),
    longitude: Number(coordinates.longitude.toFixed(2)),
  };
}

function cacheCity(weatherObj) {
  if (!weatherObj?.name) return;
  recentWeather.set(normalizeKey(weatherObj.name), weatherObj);
}

function toDisplayTemperature(celsius) {
  const temperature = fahrenheit ? Math.round((celsius * 9) / 5 + 32) : celsius;
  return `${temperature}°`;
}

function updateDateLabels(weather) {
  const now = new Date();
  const currentDate = new Intl.DateTimeFormat("es-MX", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(now);
  const headerTime = new Intl.DateTimeFormat("es-MX", {
    hour: "numeric",
    minute: "2-digit",
  }).format(now);
  document.querySelector("#header-date").textContent = currentDate.toLocaleUpperCase("es-MX");
  const savedAt = new Date(weather.updatedAt || now);
  const weatherTime = Number.isFinite(savedAt.getTime())
    ? new Intl.DateTimeFormat("es-MX", {
        weekday: "long",
        day: "numeric",
        month: "long",
        hour: "numeric",
        minute: "2-digit",
      }).format(savedAt)
    : headerTime;
  document.querySelector("#weather-date").textContent = weather.cacheInfo?.source === "cache"
    ? `Consulta guardada · ${weatherTime}`
    : `${currentDate} · Actualizado a las ${headerTime}`;
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
  updateDateLabels(city);
  const cityHeading = document.querySelector("#current-city");
  cityHeading.replaceChildren(document.createTextNode(city.name));
  const countryTag = document.createElement("span");
  countryTag.className = "country-tag";
  countryTag.textContent = city.country;
  cityHeading.append(" ", countryTag);
  const temperature = document.querySelector("#current-temperature");
  temperature.replaceChildren(document.createTextNode(String(fahrenheit
    ? Math.round((city.temperature * 9) / 5 + 32)
    : city.temperature)));
  const degree = document.createElement("span");
  degree.textContent = "°";
  temperature.append(degree);
  document.querySelector("#current-condition").textContent = city.condition;
  document.querySelector("#feels-like").textContent = toDisplayTemperature(city.feels);
  document.querySelector("#humidity").textContent = `${city.humidity}%`;
  document.querySelector("#wind").textContent = `${fahrenheit ? Math.round(city.wind * 0.621) : city.wind} ${fahrenheit ? "mph" : "km/h"}`;
  document.querySelector("#uv-index").textContent = city.uv;
  const weatherStatus = document.querySelector("#weather-status");
  const cacheInfo = city.cacheInfo;
  const isCached = cacheInfo?.source === "cache" || source === "cache";
  const isStale = cacheInfo?.stale ?? isCached;
  weatherStatus.classList.toggle("offline", isCached || !navigator.onLine);
  weatherStatus.classList.toggle("cached", isCached);
  weatherStatus.classList.toggle("stale", isStale);
  weatherStatus.classList.remove("error", "loading");
  let statusText = isCached
    ? `${navigator.onLine ? " No se pudo actualizar" : " Sin conexión"} · dato guardado${isStale ? " que puede estar desactualizado" : " recientemente"}`
    : " Datos en tiempo real · Open-Meteo";
  if (cacheInfo?.warning) statusText += ` · ${cacheInfo.warning}`;
  if (!isCached && !navigator.onLine) statusText = " Sin conexión · esperando datos guardados";
  weatherStatus.lastChild.textContent = statusText;
  renderForecast(city.forecastDays);
  const saved = favoriteRecords.some((favorite) =>
    normalizeKey(favorite.name) === normalizeKey(city.name) &&
    (!favorite.country || favorite.country === city.country)
  );
  currentFavoriteButton.setAttribute("aria-pressed", String(saved));
  currentFavoriteButton.setAttribute("aria-label", `${saved ? "Quitar" : "Agregar"} ${city.name} ${saved ? "de" : "a"} favoritos`);
  searchForm.classList.remove("expanded");
  searchInput.value = "";
  searchInput.blur();
}

function createId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function renderFavorites() {
  favoriteCities.replaceChildren();
  favoriteRecords.forEach((favorite) => {
    const card = document.createElement("article");
    card.className = "city-card";
    card.dataset.favoriteId = favorite.id;

    const top = document.createElement("div");
    top.className = "city-card-top";
    const cityInfo = document.createElement("span");
    cityInfo.className = "favorite-city-info";
    const openButton = document.createElement("button");
    openButton.className = "favorite-open";
    openButton.type = "button";
    openButton.textContent = favorite.alias || favorite.name;
    const country = document.createElement("small");
    country.textContent = favorite.alias
      ? [favorite.name, favorite.countryName || favorite.country].filter(Boolean).join(", ")
      : favorite.countryName || favorite.country || "Ciudad guardada";
    cityInfo.append(openButton, country);

    const actions = document.createElement("span");
    actions.className = "favorite-actions";
    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.className = "favorite-edit";
    editButton.textContent = "Editar";
    editButton.setAttribute("aria-label", `Editar favorito ${favorite.name}`);
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "favorite-delete";
    deleteButton.textContent = "Eliminar";
    deleteButton.setAttribute("aria-label", `Eliminar favorito ${favorite.name}`);
    actions.append(editButton, deleteButton);
    top.append(cityInfo, actions);

    const bottom = document.createElement("div");
    bottom.className = "city-card-bottom";
    const description = document.createElement("span");
    description.textContent = "Consultar pronóstico";
    bottom.append(description);
    card.append(top, bottom);
    favoriteCities.append(card);
  });
  document.querySelector("#empty-favorites").hidden = favoriteRecords.length > 0;
  const saved = favoriteRecords.some((favorite) =>
    normalizeKey(favorite.name) === normalizeKey(currentCity.name) &&
    (!favorite.country || favorite.country === currentCity.country)
  );
  currentFavoriteButton.setAttribute("aria-pressed", String(saved));
  currentFavoriteButton.setAttribute("aria-label", `${saved ? "Quitar" : "Agregar"} ${currentCity.name} ${saved ? "de" : "a"} favoritos`);
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("visible");
  window.clearTimeout(toastTimeout);
  toastTimeout = window.setTimeout(() => toast.classList.remove("visible"), 3200);
}

function showFavoriteForm(favorite = null) {
  editingFavoriteId = favorite?.id || null;
  favoriteCityInput.value = favorite?.name || "";
  favoriteAliasInput.value = favorite?.alias || "";
  favoriteFeedback.textContent = "";
  favoriteForm.hidden = false;
  favoriteForm.querySelector('button[type="submit"]').textContent = favorite
    ? "Guardar cambios"
    : "Guardar favorito";
  favoriteCityInput.focus();
}

function hideFavoriteForm() {
  editingFavoriteId = null;
  favoriteForm.reset();
  favoriteFeedback.textContent = "";
  favoriteForm.hidden = true;
}

async function loadFavorites() {
  favoriteRecords = await readAllRecords("favoritos");
  renderFavorites();
}

async function saveFavorite(event) {
  event.preventDefault();
  favoriteFeedback.textContent = "";
  const cityQuery = favoriteCityInput.value.trim();
  const alias = favoriteAliasInput.value.trim();
  const existing = editingFavoriteId
    ? favoriteRecords.find((favorite) => favorite.id === editingFavoriteId)
    : null;

  if (editingFavoriteId && !existing) {
    favoriteFeedback.textContent = "No se encontró el favorito que intentas editar.";
    return;
  }

  try {
    const weather = await getWeatherByCity(cityQuery);
    const duplicate = favoriteRecords.find((favorite) =>
      favorite.id !== existing?.id &&
      normalizeKey(favorite.name) === normalizeKey(weather.name) &&
      favorite.country === weather.country
    );
    if (duplicate) {
      favoriteFeedback.textContent = `${weather.name} ya está en tus favoritos.`;
      return;
    }

    const record = {
      id: existing?.id || createId(),
      name: weather.name,
      country: weather.country,
      countryName: weather.countryName,
      region: weather.region,
      ...(alias ? { alias } : {}),
    };
    const savedRecord = existing
      ? await updateRecord("favoritos", record)
      : await createRecord("favoritos", record);
    favoriteRecords = existing
      ? favoriteRecords.map((favorite) => favorite.id === savedRecord.id ? savedRecord : favorite)
      : [...favoriteRecords, savedRecord];
    renderFavorites();
    hideFavoriteForm();
    showToast(`${savedRecord.alias || savedRecord.name} se guardó en favoritos.`);
  } catch (error) {
    console.error("No se pudo guardar el favorito.", error);
    favoriteFeedback.textContent = error.message || "No se pudo guardar el favorito.";
  }
}

async function saveAlertRules() {
  try {
    for (const rule of activeAlertRules) {
      await updateRecord("alertas", rule);
    }
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
  const threshold = fahrenheit
    ? Math.round((rule.threshold * 9) / 5 + 32)
    : rule.threshold;
  return `Temperatura > ${threshold}°${fahrenheit ? "F" : "C"}`;
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
    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.className = "edit-alert";
    editButton.setAttribute("aria-label", `Editar alerta ${getAlertLabel(rule)} de ${rule.city}`);
    editButton.textContent = "Editar";
    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "remove-alert";
    removeButton.setAttribute("aria-label", `Eliminar alerta ${getAlertLabel(rule)} de ${rule.city}`);
    removeButton.textContent = "×";
    alert.append(dot, details, editButton, removeButton);
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
  return `${normalizeKey(location.name)}-${location.country}-${location.coordinates.latitude.toFixed(2)}-${location.coordinates.longitude.toFixed(2)}`;
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

async function migrateAlertLocations() {
  let changed = false;
  activeAlertRules.forEach((rule) => {
    if (rule.coordinates) return;
    const location = availableAlertLocations.find((candidate) =>
      normalizeKey(candidate.name) === normalizeKey(rule.city) &&
      (!rule.country || candidate.country === rule.country)
    );
    if (!location) return;
    rule.coordinates = reduceCoordinatePrecision(location.coordinates);
    rule.countryName = location.countryName;
    rule.region = location.region;
    changed = true;
  });
  if (changed && !(await saveAlertRules())) {
    showToast("No se pudieron actualizar las ubicaciones de las alertas.");
  }
}

async function updateAlertLocation(weather, isFallback = false) {
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
  await migrateAlertLocations();
  renderActiveAlerts();
  renderFavorites();
}

async function checkAlertRules(weather, rules = activeAlertRules) {
  if (weather.cacheInfo?.source === "cache") {
    alertFeedback.textContent = `Alerta guardada para ${weather.name}; se evaluará cuando haya datos actualizados.`;
    return [];
  }
  const triggered = await evaluateAlertRules(weather, rules);
  if (triggered.length) {
    if (rules === activeAlertRules) await saveAlertRules();
    showToast(triggered.map((rule) => rule.detail).join(" "));
  }
  return triggered;
}

function findCity(query) {
  return recentWeather.get(normalizeKey(query));
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
  const weatherStatus = document.querySelector("#weather-status");
  weatherStatus.classList.add("loading");
  weatherStatus.classList.remove("error");
  weatherStatus.lastChild.textContent = " Consultando Open-Meteo y caché local";

  try {
    const liveWeather = await getWeatherByCity(query);
    searchStatus.className = "search-status";
    updateWeather(liveWeather);
    showToast(liveWeather.cacheInfo?.source === "cache"
      ? `${liveWeather.name}: se muestra la última consulta guardada.`
      : `Pronóstico de ${liveWeather.name} actualizado.`);
    await checkAlertRules(liveWeather);
  } catch (error) {
    const localMatch = findCity(query);
    if (localMatch) {
      searchStatus.className = "search-status";
      updateWeather({
        ...localMatch,
        cacheInfo: {
          ...localMatch.cacheInfo,
          source: "cache",
          stale: true,
        },
      }, "cache");
      showToast(`Mostrando datos guardados de ${localMatch.name}.`);
    } else {
      searchStatus.textContent = error.message || `No encontramos “${query}”.`;
      searchStatus.className = "search-status visible error";
      const weatherStatus = document.querySelector("#weather-status");
      weatherStatus.classList.add("error");
      weatherStatus.lastChild.textContent = " No se pudo actualizar el clima";
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

favoriteForm.addEventListener("submit", saveFavorite);
document.querySelector("#cancel-favorite").addEventListener("click", hideFavoriteForm);
document.querySelector("#add-favorite").addEventListener("click", () => showFavoriteForm());

currentFavoriteButton.addEventListener("click", async () => {
  const existing = favoriteRecords.find((favorite) =>
    normalizeKey(favorite.name) === normalizeKey(currentCity.name) &&
    favorite.country === currentCity.country
  );
  try {
    if (existing) {
      const deleted = await deleteRecord("favoritos", existing.id);
      if (!deleted) throw new Error("El favorito no existe en el almacenamiento local.");
      favoriteRecords = favoriteRecords.filter((favorite) => favorite.id !== existing.id);
      showToast(`${existing.alias || existing.name} se quitó de tus favoritos.`);
    } else {
      const saved = await createRecord("favoritos", {
        id: createId(),
        name: currentCity.name,
        country: currentCity.country,
        countryName: currentCity.countryName || currentCity.country,
        region: currentCity.region || "",
      });
      favoriteRecords = [...favoriteRecords, saved];
      showToast(`${saved.name} se agregó a tus favoritos.`);
    }
    renderFavorites();
  } catch (error) {
    console.error("No se pudo actualizar el favorito actual.", error);
    showToast("No se pudo actualizar el favorito en este dispositivo.");
  }
});

favoriteCities.addEventListener("click", async (event) => {
  const card = event.target.closest(".city-card");
  if (!card) return;
  const favorite = favoriteRecords.find((record) => record.id === card.dataset.favoriteId);
  if (!favorite) return;

  if (event.target.closest(".favorite-edit")) {
    showFavoriteForm(favorite);
    return;
  }
  if (event.target.closest(".favorite-delete")) {
    try {
      const deleted = await deleteRecord("favoritos", favorite.id);
      if (!deleted) throw new Error("El favorito no existe en el almacenamiento local.");
      favoriteRecords = favoriteRecords.filter((record) => record.id !== favorite.id);
      renderFavorites();
      showToast(`${favorite.alias || favorite.name} se eliminó de tus favoritos.`);
    } catch (error) {
      console.error("No se pudo eliminar el favorito.", error);
      showToast("No se pudo eliminar el favorito de este dispositivo.");
    }
    return;
  }
  if (!event.target.closest(".favorite-open")) return;

  try {
    const weather = await getWeatherByCity(favorite.name);
    updateWeather(weather);
    await checkAlertRules(weather);
    window.scrollTo({ top: 0, behavior: "smooth" });
    showToast(weather.cacheInfo?.source === "cache"
      ? `${weather.name}: se muestra la última consulta guardada.`
      : `Mostrando el clima de ${weather.name}.`);
  } catch (error) {
    console.error(`No se pudo consultar el clima de ${favorite.name}.`, error);
    showToast(error.message || `No se pudo consultar ${favorite.name}.`);
  }
});

function syncThresholdField() {
  const isRain = alertType.value === "rain";
  const isWind = alertType.value === "wind";
  const hasThreshold = !isRain;
  thresholdInput.disabled = !hasThreshold;
  thresholdInput.min = isWind ? "0" : fahrenheit ? "-58" : "-50";
  thresholdInput.max = isWind ? "300" : fahrenheit ? "140" : "60";
  document.querySelector("#threshold-unit").textContent = isWind ? "km/h" : fahrenheit ? "°F" : "°C";
  document.querySelector("#threshold-hint").textContent = isWind ? "Umbral de velocidad" : "Umbral de temperatura";
  thresholdInput.setAttribute("aria-describedby", hasThreshold ? "threshold-error" : "");
  thresholdError.textContent = "";
}

function resetAlertForm() {
  editingAlertId = null;
  alertForm.reset();
  document.querySelector("#cancel-alert-edit").hidden = true;
  const submitButton = document.querySelector("#alert-form .primary-button");
  submitButton.textContent = "Crear alerta";
  const locationSelect = document.querySelector("#alert-city");
  locationSelect.disabled = !currentAlertLocation?.coordinates;
  if (currentAlertLocation?.coordinates) {
    const currentLocation = availableAlertLocations.find((location) => location.isCurrent);
    if (currentLocation) locationSelect.value = currentLocation.id;
  }
  submitButton.disabled = !currentAlertLocation?.coordinates;
  syncThresholdField();
}

function beginAlertEdit(rule) {
  let coordinates = rule.coordinates;
  if (!coordinates) {
    const matchingLocation = availableAlertLocations.find((location) =>
      normalizeKey(location.name) === normalizeKey(rule.city) &&
      (!rule.country || location.country === rule.country)
    );
    coordinates = matchingLocation?.coordinates ||
      (normalizeKey(currentCity.name) === normalizeKey(rule.city) ? currentCity.coordinates : null);
  }
  if (!coordinates) {
    showToast("Esta alerta no tiene una ubicación válida. Crea una alerta nueva o selecciona la ubicación actual.");
    return;
  }
  editingAlertId = rule.id;
  const location = {
    id: getAlertLocationId({
      name: rule.city,
      country: rule.country,
      coordinates,
    }),
    name: rule.city,
    country: rule.country,
    countryName: rule.countryName,
    region: rule.region,
    coordinates,
    distanceKm: 0,
    isCurrent: false,
  };
  if (!availableAlertLocations.some((candidate) => candidate.id === location.id)) {
    availableAlertLocations.push(location);
    const option = document.createElement("option");
    option.value = location.id;
    option.textContent = [location.name, location.region, location.countryName || location.country]
      .filter(Boolean)
      .join(", ");
    document.querySelector("#alert-city").append(option);
  }

  const locationSelect = document.querySelector("#alert-city");
  locationSelect.disabled = false;
  locationSelect.value = location.id;
  alertType.value = rule.type;
  thresholdInput.value = rule.type === "temperature" && fahrenheit
    ? String(Math.round((rule.threshold * 9) / 5 + 32))
    : (rule.threshold ?? "30");
  document.querySelector("#cancel-alert-edit").hidden = false;
  document.querySelector("#alert-form .primary-button").textContent = "Guardar cambios";
  syncThresholdField();
  document.querySelector("#alertas").scrollIntoView({ behavior: "smooth", block: "center" });
}

alertType.addEventListener("change", syncThresholdField);
document.querySelector("#cancel-alert-edit").addEventListener("click", resetAlertForm);

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
  const minimum = isWind ? 0 : fahrenheit ? -58 : -50;
  const maximum = isWind ? 300 : fahrenheit ? 140 : 60;
  if (alertType.value !== "rain" && (!Number.isFinite(threshold) || threshold < minimum || threshold > maximum)) {
    thresholdError.textContent = `Ingresa un valor entre ${minimum} y ${maximum} ${isWind ? "km/h" : fahrenheit ? "°F" : "°C"}.`;
    thresholdInput.setAttribute("aria-invalid", "true");
    thresholdInput.focus();
    return;
  }
  thresholdInput.removeAttribute("aria-invalid");

  const existingRule = editingAlertId
    ? activeAlertRules.find((rule) => rule.id === editingAlertId)
    : null;
  const newRule = {
    id: existingRule?.id || createId(),
    city: selectedLocation.name,
    country: selectedLocation.country,
    countryName: selectedLocation.countryName,
    region: selectedLocation.region,
    coordinates: reduceCoordinatePrecision(selectedLocation.coordinates),
    type: alertType.value,
    threshold: alertType.value === "rain"
      ? null
      : alertType.value === "temperature" && fahrenheit
        ? Math.round((threshold - 32) * 5 / 9)
        : threshold,
  };

  if (activeAlertRules.some((rule) =>
    rule.id !== existingRule?.id &&
    rule.city === newRule.city &&
    rule.country === newRule.country &&
    rule.coordinates?.latitude.toFixed(2) === newRule.coordinates.latitude.toFixed(2) &&
    rule.coordinates?.longitude.toFixed(2) === newRule.coordinates.longitude.toFixed(2) &&
    rule.type === newRule.type &&
    rule.threshold === newRule.threshold
  )) {
    alertFeedback.textContent = "Ya existe esa alerta para esta ubicación.";
    return;
  }

  const submitButton = document.querySelector("#alert-form .primary-button");
  submitButton.disabled = true;

  try {
    if (existingRule) {
      const updatedRule = await updateRecord("alertas", newRule);
      activeAlertRules = activeAlertRules.map((rule) =>
        rule.id === updatedRule.id ? updatedRule : rule
      );
      renderActiveAlerts();

      try {
        const liveWeather = await getWeatherByCoords(
          updatedRule.coordinates.latitude,
          updatedRule.coordinates.longitude,
          {
            name: updatedRule.city,
            country: updatedRule.country,
            countryName: updatedRule.countryName,
            region: updatedRule.region,
          }
        );
        const triggered = await checkAlertRules(liveWeather, [updatedRule]);
        await saveAlertRules();
        alertFeedback.textContent = triggered.length
          ? `Alerta actualizada: ${triggered[0].detail}`
          : `Alerta actualizada para ${updatedRule.city}.`;
      } catch (weatherError) {
        console.warn(`La alerta se actualizó, pero no se pudo comprobar su clima.`, weatherError);
        alertFeedback.textContent = `Alerta actualizada para ${updatedRule.city}. Se comprobará al actualizar el pronóstico.`;
      }
      resetAlertForm();
      return;
    }

    const permissionPromise = requestNotificationPermission().catch((error) => {
      console.error("No se pudo solicitar permiso para las notificaciones.", error);
      return "default";
    });
    let liveWeather = null;
    const savedRule = await createRecord("alertas", newRule);
    activeAlertRules.push(savedRule);
    renderActiveAlerts();
    const permission = await permissionPromise;

    let triggered = [];
    try {
      liveWeather = await getWeatherByCoords(
        selectedLocation.coordinates.latitude,
        selectedLocation.coordinates.longitude,
        {
          name: selectedLocation.name,
          country: selectedLocation.country,
          countryName: selectedLocation.countryName,
          region: selectedLocation.region,
        }
      );
      triggered = await checkAlertRules(liveWeather, [savedRule]);
      await saveAlertRules();
    } catch (weatherError) {
      console.warn(`La alerta quedó guardada, pero no se pudo consultar el clima de ${selectedLocation.name}.`, weatherError);
    }

    if (triggered.length) {
      alertFeedback.textContent = `Alerta creada: ${triggered[0].detail}`;
    } else if (permission === "granted") {
      alertFeedback.textContent = `Alerta creada para ${selectedLocation.name}. Se revisará cada 15 min mientras la app esté abierta.`;
    } else {
      alertFeedback.textContent = `Alerta guardada para ${selectedLocation.name}. Activa las notificaciones del navegador para recibir avisos.`;
    }
    resetAlertForm();
  } catch (error) {
    console.error(`No se pudo guardar la alerta para ${selectedLocation.name}.`, error);
    alertFeedback.textContent = existingRule
      ? `No se pudo actualizar la alerta de ${selectedLocation.name}.`
      : `No se pudo consultar el clima o guardar la alerta de ${selectedLocation.name}.`;
  } finally {
    if (!editingAlertId) submitButton.disabled = !currentAlertLocation?.coordinates;
  }
});

document.querySelector(".active-alerts").addEventListener("click", async (event) => {
  const editButton = event.target.closest(".edit-alert");
  if (editButton) {
    const alert = editButton.closest(".active-alert");
    const rule = activeAlertRules.find((candidate) => candidate.id === alert.dataset.alertId);
    if (rule) beginAlertEdit(rule);
    return;
  }
  const button = event.target.closest(".remove-alert");
  if (!button) return;
  const alert = button.closest(".active-alert");
  const index = activeAlertRules.findIndex((rule) => rule.id === alert.dataset.alertId);
  if (index < 0) return;
  try {
    const deleted = await deleteRecord("alertas", alert.dataset.alertId);
    if (!deleted) throw new Error("La alerta no existe en el almacenamiento local.");
  } catch (error) {
    console.error("No se pudo eliminar la alerta.", error);
    showToast("No se pudo eliminar la alerta de este dispositivo.");
    return;
  }
  activeAlertRules.splice(index, 1);
  if (editingAlertId === alert.dataset.alertId) resetAlertForm();
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
      if (weather.cacheInfo?.source === "cache") {
        failedLocations.push(rule.city);
        continue;
      }
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
    await saveAlertRules();
    showToast(triggeredAlerts.map((rule) => rule.detail).join(" "));
  }
  if (failedLocations.length) {
    alertFeedback.textContent = `No se obtuvieron datos actuales para ${failedLocations.join(", ")}; se reintentará cuando haya conexión.`;
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
  updateWeather(currentCity);
  syncUnitLabels();
}

function syncUnitLabels() {
  document.querySelector("#unit-toggle").textContent = fahrenheit ? "°F / °C" : "°C / °F";
  document.querySelector("#forecast-unit").textContent = fahrenheit ? "Ver en °C →" : "Ver en °F →";
}

async function toggleUnits() {
  const nextUnit = fahrenheit ? "C" : "F";
  try {
    await putRecord("preferencias", { key: "temperatureUnit", value: nextUnit });
    fahrenheit = nextUnit === "F";
    updateUnits();
  } catch (error) {
    console.error("No se pudo guardar la preferencia de unidades.", error);
    showToast("No se pudo guardar la unidad en este dispositivo.");
  }
}

document.querySelector("#unit-toggle").addEventListener("click", toggleUnits);
document.querySelector("#forecast-unit").addEventListener("click", toggleUnits);

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

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    console.warn("Este navegador no permite registrar un Service Worker.");
    return;
  }
  if (!window.isSecureContext) {
    console.warn("El modo offline requiere HTTPS o un origen local seguro.");
    return;
  }
  try {
    await navigator.serviceWorker.register("./service-worker.js");
  } catch (error) {
    console.error("No se pudo registrar el Service Worker.", error);
    showToast("No se pudo activar la interfaz sin conexión.");
  }
}

function updateConnectionStatus(isOnline) {
  const weatherStatus = document.querySelector("#weather-status");
  const isCached = weatherStatus.classList.contains("cached");
  weatherStatus.classList.toggle("offline", !isOnline);
  if (!isOnline && !isCached) {
    weatherStatus.lastChild.textContent = " Sin conexión · se intentará usar la última consulta guardada";
  } else if (isOnline && !isCached) {
    weatherStatus.lastChild.textContent = " Conexión disponible · Open-Meteo";
  } else if (isOnline && isCached) {
    const freshness = weatherStatus.classList.contains("stale")
      ? " que puede estar desactualizada"
      : " reciente";
    weatherStatus.lastChild.textContent = ` Conexión disponible · se muestra una consulta guardada${freshness}`;
  }
}

window.addEventListener("offline", () => updateConnectionStatus(false));
window.addEventListener("online", () => updateConnectionStatus(true));

// Carga inicial con geolocalización y fallback automático
window.addEventListener("DOMContentLoaded", async () => {
  await registerServiceWorker();
  try {
    await initializeStorage();
  } catch (error) {
    console.error("No se pudieron inicializar las alertas guardadas.", error);
    showToast("No se pudieron cargar las alertas guardadas en este dispositivo.");
  }
  try {
    activeAlertRules = await readAllRecords("alertas");
    renderActiveAlerts();
  } catch (error) {
    console.error("No se pudieron leer las alertas guardadas.", error);
    showToast("No se pudieron leer las alertas de este dispositivo.");
  }
  try {
    await loadFavorites();
  } catch (error) {
    console.error("No se pudieron leer los favoritos.", error);
    showToast("No se pudieron cargar los favoritos de este dispositivo.");
  }
  try {
    const preference = await readRecord("preferencias", "temperatureUnit");
    if (preference?.value === "F" || preference?.value === "C") {
      fahrenheit = preference.value === "F";
    }
    syncUnitLabels();
  } catch (error) {
    console.error("No se pudo cargar la preferencia de unidades.", error);
    showToast("No se pudo cargar la unidad guardada.");
  }

  try {
    const result = await resolveInitialWeather("Mérida");
    currentAlertLocation = result.weather;
    await updateAlertLocation(result.weather, result.source === "fallback");
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