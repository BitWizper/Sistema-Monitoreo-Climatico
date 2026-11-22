const cities = {
  "ciudad de mexico": { name: "Ciudad de México", country: "MX", temperature: 24, feels: 26, condition: "Parcialmente nublado", humidity: 64, wind: 12, uv: "Moderado" },
  madrid: { name: "Madrid", country: "ES", temperature: 18, feels: 18, condition: "Despejado", humidity: 42, wind: 9, uv: "Bajo" },
  "buenos aires": { name: "Buenos Aires", country: "AR", temperature: 22, feels: 23, condition: "Algo de sol", humidity: 58, wind: 15, uv: "Moderado" },
  bogota: { name: "Bogotá", country: "CO", temperature: 14, feels: 13, condition: "Lluvia ligera", humidity: 78, wind: 8, uv: "Bajo" },
  barcelona: { name: "Barcelona", country: "ES", temperature: 21, feels: 21, condition: "Soleado", humidity: 51, wind: 11, uv: "Moderado" },
  santiago: { name: "Santiago", country: "CL", temperature: 20, feels: 21, condition: "Despejado", humidity: 47, wind: 10, uv: "Alto" },
};

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
let currentCity = cities["ciudad de mexico"];
let fahrenheit = false;
let toastTimeout;

function toDisplayTemperature(celsius) {
  const temperature = fahrenheit ? Math.round((celsius * 9) / 5 + 32) : celsius;
  return `${temperature}°`;
}

function updateWeather(city) {
  currentCity = city;
  document.querySelector("#current-city").innerHTML = `${city.name} <span class="country-tag">${city.country}</span>`;
  document.querySelector("#current-temperature").innerHTML = `${toDisplayTemperature(city.temperature).slice(0, -1)}<span>°</span>`;
  document.querySelector("#current-condition").textContent = city.condition;
  document.querySelector("#feels-like").textContent = toDisplayTemperature(city.feels);
  document.querySelector("#humidity").textContent = `${city.humidity}%`;
  document.querySelector("#wind").textContent = `${fahrenheit ? Math.round(city.wind * 0.621) : city.wind} ${fahrenheit ? "mph" : "km/h"}`;
  document.querySelector("#uv-index").textContent = city.uv;
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
  toastTimeout = window.setTimeout(() => toast.classList.remove("visible"), 2800);
}

function findCity(query) {
  const normalized = query.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return cities[normalized];
}

searchForm.addEventListener("submit", (event) => {
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
  window.setTimeout(() => {
    const city = findCity(query);
    if (!city) {
      searchStatus.textContent = `No encontramos “${query}”. Prueba Madrid, Bogotá o Santiago.`;
      searchStatus.className = "search-status visible error";
      return;
    }
    searchStatus.className = "search-status";
    updateWeather(city);
    showToast(`Pronóstico de ${city.name} actualizado (datos de demostración).`);
  }, 450);
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

alertForm.addEventListener("submit", (event) => {
  event.preventDefault();
  alertFeedback.textContent = "";
  thresholdError.textContent = "";
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

  const city = document.querySelector("#alert-city").value;
  const typeLabel = alertType.value === "rain" ? "Lluvia pronosticada" : alertType.value === "wind" ? `Viento > ${threshold} km/h` : `Temperatura > ${threshold}°C`;
  const alert = document.createElement("div");
  alert.className = "active-alert";
  alert.innerHTML = `<span class="alert-status-dot"></span><span><strong>${typeLabel}</strong><small>${city}</small></span><button type="button" class="remove-alert" aria-label="Eliminar alerta ${typeLabel}">×</button>`;
  document.querySelector(".active-alerts").append(alert);
  updateAlertCount();
  alertFeedback.textContent = "Alerta creada correctamente.";
  alertForm.reset();
  syncThresholdField();
});

document.querySelector(".active-alerts").addEventListener("click", (event) => {
  const button = event.target.closest(".remove-alert");
  if (!button) return;
  button.closest(".active-alert").remove();
  updateAlertCount();
});

function updateAlertCount() {
  document.querySelector("#active-alert-count").textContent = document.querySelectorAll(".active-alert").length;
  document.querySelector(".nav-count").textContent = document.querySelectorAll(".active-alert").length;
}

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

document.querySelectorAll(".nav-link").forEach((link) => {
  link.addEventListener("click", () => {
    document.querySelectorAll(".nav-link").forEach((item) => item.classList.remove("active"));
    link.classList.add("active");
  });
});
