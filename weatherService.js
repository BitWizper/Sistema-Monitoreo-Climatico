/**
 * Busca coordenadas geográficas de una ciudad mediante Open-Meteo Geocoding API.
 * @param {string} cityName Nombre de la ciudad a buscar.
 * @returns {Promise<{name: string, country: string, lat: number, lon: number}>}
 */
export async function searchCityCoordinates(cityName) {
  const cleanQuery = typeof cityName === "string" ? cityName.trim() : "";
  if (!cleanQuery) {
    throw new Error("Ingresa el nombre de una ciudad.");
  }

  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cleanQuery)}&count=1&language=es&format=json`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Error al consultar geocodificación (${response.status}).`);
  }

  const data = await response.json();
  if (!data.results || data.results.length === 0) {
    throw new Error(`No encontramos la ciudad “${cleanQuery}”.`);
  }

  const place = data.results[0];
  return {
    name: place.name,
    country: place.country_code || "XX",
    countryName: place.country || place.country_code || "Desconocido",
    lat: place.latitude,
    lon: place.longitude,
  };
}

/**
 * Convierte códigos WMO de Open-Meteo a una condición legible en español.
 * @param {number} code
 * @returns {string}
 */
function mapWeatherCode(code) {
  const conditions = {
    0: "Despejado",
    1: "Mayormente despejado",
    2: "Parcialmente nublado",
    3: "Nublado",
    45: "Niebla",
    48: "Niebla con escarcha",
    51: "Llovizna ligera",
    53: "Llovizna moderada",
    55: "Llovizna intensa",
    61: "Lluvia ligera",
    63: "Lluvia moderada",
    65: "Lluvia fuerte",
    80: "Chubascos ligeros",
    81: "Chubascos moderados",
    82: "Chubascos fuertes",
    95: "Tormenta eléctrica",
  };
  return conditions[code] ?? "Condición variable";
}

/**
 * Clasifica el índice UV máximo diario en categoría textual.
 * @param {number | undefined} uvMax
 * @returns {string}
 */
function mapUvCategory(uvMax) {
  if (typeof uvMax !== "number" || Number.isNaN(uvMax)) return "Moderado";
  if (uvMax < 3) return "Bajo";
  if (uvMax < 6) return "Moderado";
  if (uvMax < 8) return "Alto";
  return "Muy alto";
}

/**
 * Normaliza la respuesta cruda de Open-Meteo al modelo de datos de la aplicación.
 * @param {object} rawData Respuesta JSON de /v1/forecast.
 * @param {{name: string, country: string, countryName?: string}} location
 * @returns {object}
 */
export function normalizeWeatherData(rawData, location) {
  const current = rawData?.current;
  if (!current) {
    throw new Error("Respuesta meteorológica incompleta.");
  }

  const daily = rawData.daily || {};
  const maxUv = Array.isArray(daily.uv_index_max) ? daily.uv_index_max[0] : undefined;

  const forecastDays = Array.isArray(daily.time)
    ? daily.time.slice(0, 5).map((dateStr, index) => ({
        date: dateStr,
        code: daily.weather_code?.[index] ?? 0,
        condition: mapWeatherCode(daily.weather_code?.[index] ?? 0),
        maxTemp: Math.round(daily.temperature_2m_max?.[index] ?? current.temperature_2m),
        minTemp: Math.round(daily.temperature_2m_min?.[index] ?? current.temperature_2m - 5),
        rainProb: Math.round(daily.precipitation_probability_max?.[index] ?? 0),
      }))
    : [];

  return {
    name: location.name,
    country: location.country,
    countryName: location.countryName || location.country,
    temperature: Math.round(current.temperature_2m),
    feels: Math.round(current.apparent_temperature),
    condition: mapWeatherCode(current.weather_code),
    humidity: Math.round(current.relative_humidity_2m),
    wind: Math.round(current.wind_speed_10m),
    uv: mapUvCategory(maxUv),
    rawCode: current.weather_code,
    forecastDays,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Obtiene y normaliza el clima actual y pronóstico a partir de latitud y longitud.
 * @param {number} lat
 * @param {number} lon
 * @param {{name?: string, country?: string, countryName?: string}} meta
 * @returns {Promise<object>}
 */
export async function getWeatherByCoords(lat, lon, meta = {}) {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,uv_index_max",
    timezone: "auto",
  });

  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`Error al obtener el pronóstico (${response.status}).`);
  }

  const rawData = await response.json();
  let location = {
    name: meta.name || "Ubicación actual",
    country: meta.country || "LOCAL",
    countryName: meta.countryName || "",
  };

  if (!meta.name) {
    try {
      const revUrl = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}&localityLanguage=es`;
      const revResponse = await fetch(revUrl);
      if (!revResponse.ok) {
        throw new Error(`Error al resolver la ubicación (${revResponse.status}).`);
      }
      const place = await revResponse.json();
      const administrativeLocality = place.localityInfo?.administrative
        ?.slice()
        .reverse()
        .find((area) => area.adminLevel >= 8)?.name;
      const placeName = administrativeLocality || place.city || place.locality || place.principalSubdivision;
      if (!placeName) {
        throw new Error("La geocodificación no devolvió una localidad.");
      }
      location = {
        name: placeName,
        country: place.countryCode || "XX",
        countryName: place.countryName || place.countryCode || "Desconocido",
      };
    } catch {
      location = {
        name: "Ubicación actual",
        country: "GPS",
        countryName: `${lat.toFixed(3)}, ${lon.toFixed(3)}`,
      };
    }
  }

  return {
    ...normalizeWeatherData(rawData, location),
    coordinates: { latitude: lat, longitude: lon },
  };
}

/**
 * Busca una ciudad por nombre y devuelve su clima normalizado.
 * @param {string} cityName
 * @returns {Promise<object>}
 */
export async function getWeatherByCity(cityName) {
  const coords = await searchCityCoordinates(cityName);
  return getWeatherByCoords(coords.lat, coords.lon, {
    name: coords.name,
    country: coords.country,
    countryName: coords.countryName,
  });
}