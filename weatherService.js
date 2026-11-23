import { deleteRecord, putRecord, readAllRecords, readRecord } from "./storageService.js";

const WEATHER_CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_CACHED_QUERIES = 100;

function normalizeCityQuery(cityName) {
  return cityName.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function getCoordinateCacheKey(lat, lon) {
  return `coords:${lat.toFixed(2)},${lon.toFixed(2)}`;
}

function stripCoordinates(weather) {
  const cachedWeather = { ...weather };
  delete cachedWeather.coordinates;
  delete cachedWeather.cacheInfo;
  return cachedWeather;
}

function assertCoordinates(lat, lon) {
  if (
    !Number.isFinite(lat) ||
    lat < -90 ||
    lat > 90 ||
    !Number.isFinite(lon) ||
    lon < -180 ||
    lon > 180
  ) {
    throw new Error("Las coordenadas no son válidas.");
  }
}

function isValidWeatherData(weather) {
  return Boolean(
    weather &&
      typeof weather.name === "string" &&
      typeof weather.country === "string" &&
      typeof weather.condition === "string" &&
      Number.isFinite(weather.temperature) &&
      Number.isFinite(weather.feels) &&
      Number.isFinite(weather.humidity) &&
      Number.isFinite(weather.wind) &&
    Array.isArray(weather.forecastDays) &&
    weather.forecastDays.every((day) =>
      day &&
      typeof day.date === "string" &&
      typeof day.condition === "string" &&
      Number.isFinite(day.maxTemp) &&
      Number.isFinite(day.minTemp) &&
      Number.isFinite(day.rainProb)
    )
  );
}

async function pruneWeatherCache() {
  const records = await readAllRecords("cacheConsultas");
  if (records.length <= MAX_CACHED_QUERIES) return;
  const oldestFirst = records
    .slice()
    .sort((first, second) => Date.parse(first.cachedAt) - Date.parse(second.cachedAt));
  const expiredCount = records.length - MAX_CACHED_QUERIES;
  for (const record of oldestFirst.slice(0, expiredCount)) {
    await deleteRecord("cacheConsultas", record.key);
  }
}

async function saveWeatherCache(key, weather, cacheInfo = {}) {
  const cachedAt = cacheInfo.cachedAt || new Date().toISOString();
  const expiresAt = cacheInfo.expiresAt || new Date(Date.parse(cachedAt) + WEATHER_CACHE_TTL_MS).toISOString();
  const record = {
    key,
    data: stripCoordinates(weather),
    cachedAt,
    expiresAt,
  };

  try {
    await putRecord("cacheConsultas", record);
    await pruneWeatherCache();
    return { source: "live", cachedAt, expiresAt, stale: false };
  } catch (error) {
    console.error("No se pudo guardar la consulta meteorológica en caché.", error);
    return {
      source: "live",
      cachedAt,
      expiresAt,
      stale: false,
      warning: "No se pudo guardar una copia local de esta consulta.",
    };
  }
}

async function loadCachedWeather(key, coordinates) {
  const cached = await readRecord("cacheConsultas", key);
  if (!cached) return null;
  if (!isValidWeatherData(cached.data)) {
    throw new Error(`La consulta guardada "${key}" tiene un formato meteorológico inválido.`);
  }

  return {
    ...cached.data,
    ...(coordinates ? { coordinates } : {}),
    cacheInfo: {
      source: "cache",
      cachedAt: cached.cachedAt,
      expiresAt: cached.expiresAt,
      stale: Date.now() >= Date.parse(cached.expiresAt),
    },
  };
}

function mergeCacheWarning(weather, cacheInfo) {
  if (!weather.cacheInfo?.warning && !cacheInfo.warning) {
    return { ...weather, cacheInfo };
  }
  return {
    ...weather,
    cacheInfo: {
      ...cacheInfo,
      warning: weather.cacheInfo?.warning || cacheInfo.warning,
    },
  };
}

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
  if (cleanQuery.length > 100) {
    throw new Error("El nombre de la ciudad no puede superar 100 caracteres.");
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
  if (typeof place.name !== "string" || !place.name.trim()) {
    throw new Error("La geocodificación devolvió un nombre de ciudad inválido.");
  }
  assertCoordinates(place.latitude, place.longitude);
  return {
    name: place.name,
    country: place.country_code || "XX",
    countryName: place.country || place.country_code || "Desconocido",
    region: place.admin1 || "",
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
  return Object.hasOwn(conditions, code) ? conditions[code] : "Condición variable";
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

function normalizeSolarTime(value, utcOffsetSeconds) {
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value || "");
  if (!parts || !Number.isFinite(utcOffsetSeconds)) return value;
  const [year, month, day, hour, minute] = parts.slice(1).map(Number);
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - utcOffsetSeconds * 1000).toISOString();
}

/**
 * Normaliza la respuesta cruda de Open-Meteo al modelo de datos de la aplicación.
 * @param {object} rawData Respuesta JSON de /v1/forecast.
 * @param {{name: string, country: string, countryName?: string, region?: string}} location
 * @returns {object}
 */
export function normalizeWeatherData(rawData, location) {
  const current = rawData?.current;
  if (!current) {
    throw new Error("Respuesta meteorológica incompleta.");
  }

  const daily = rawData.daily || {};
  const maxUv = Array.isArray(daily.uv_index_max) ? daily.uv_index_max[0] : undefined;
  const currentUv = Number.isFinite(current.uv_index) ? current.uv_index : maxUv;
  const sunrise = Array.isArray(daily.sunrise) ? daily.sunrise[0] : undefined;
  const sunset = Array.isArray(daily.sunset) ? daily.sunset[0] : undefined;

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
    region: location.region || "",
    temperature: Math.round(current.temperature_2m),
    feels: Math.round(current.apparent_temperature),
    condition: mapWeatherCode(current.weather_code),
    humidity: Math.round(current.relative_humidity_2m),
    wind: Math.round(current.wind_speed_10m),
    uv: mapUvCategory(currentUv),
    uvValue: typeof currentUv === "number" ? Math.round(currentUv * 10) / 10 : null,
    sunrise: normalizeSolarTime(sunrise, rawData.utc_offset_seconds),
    sunset: normalizeSolarTime(sunset, rawData.utc_offset_seconds),
    rawCode: current.weather_code,
    forecastDays,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Obtiene y normaliza el clima actual y pronóstico a partir de latitud y longitud.
 * @param {number} lat
 * @param {number} lon
 * @param {{name?: string, country?: string, countryName?: string, region?: string}} meta
 * @returns {Promise<object>}
 */
export async function getWeatherByCoords(lat, lon, meta = {}) {
  assertCoordinates(lat, lon);
  const cacheKey = getCoordinateCacheKey(lat, lon);
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,uv_index",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,uv_index_max,sunrise,sunset",
    timezone: "auto",
  });

  try {
    const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`);
    if (!response.ok) {
      throw new Error(`Error al obtener el pronóstico (${response.status}).`);
    }

    const rawData = await response.json();
    let location = {
      name: meta.name || "Ubicación actual",
      country: meta.country || "LOCAL",
      countryName: meta.countryName || "",
      region: meta.region || "",
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
          region: place.principalSubdivision || "",
        };
      } catch (error) {
        console.warn("No se pudo resolver el nombre de la ubicación; se usarán coordenadas aproximadas.");
        location = {
          name: "Ubicación actual",
          country: "GPS",
          countryName: `${lat.toFixed(2)}, ${lon.toFixed(2)}`,
        };
      }
    }

    const weather = {
      ...normalizeWeatherData(rawData, location),
      coordinates: { latitude: lat, longitude: lon },
    };
    if (!isValidWeatherData(weather)) {
      throw new Error("La respuesta meteorológica contiene datos inválidos.");
    }
    const cacheInfo = await saveWeatherCache(cacheKey, weather);
    return { ...weather, cacheInfo };
  } catch (networkError) {
    try {
      const cachedWeather = await loadCachedWeather(cacheKey, {
        latitude: Number(lat.toFixed(2)),
        longitude: Number(lon.toFixed(2)),
      });
      if (cachedWeather) return cachedWeather;
    } catch (cacheError) {
      throw new AggregateError(
        [networkError, cacheError],
        "No se pudo consultar el clima ni leer la caché local."
      );
    }
    throw networkError;
  }
}

/**
 * Busca una ciudad por nombre y devuelve su clima normalizado.
 * @param {string} cityName
 * @returns {Promise<object>}
 */
export async function getWeatherByCity(cityName) {
  const cleanQuery = typeof cityName === "string" ? cityName.trim() : "";
  if (!cleanQuery) throw new Error("Ingresa el nombre de una ciudad.");
  const cacheKey = `city:${normalizeCityQuery(cleanQuery)}`;

  const yucatanPlaces = {
    uman: { name: "Umán", country: "MX", countryName: "México", region: "Yucatán", lat: 20.882, lon: -89.746 },
    merida: { name: "Mérida", country: "MX", countryName: "México", region: "Yucatán", lat: 20.967, lon: -89.62318 },
    valladolid: { name: "Valladolid", country: "MX", countryName: "México", region: "Yucatán", lat: 20.68812, lon: -88.19936 },
    progreso: { name: "Progreso", country: "MX", countryName: "México", region: "Yucatán", lat: 21.2833, lon: -89.6667 },
  };
  const normalizedQuery = normalizeCityQuery(cleanQuery);
  const knownPlace = yucatanPlaces[normalizedQuery];

  try {
    const coords = knownPlace
      ? {
          name: knownPlace.name,
          country: knownPlace.country,
          countryName: knownPlace.countryName,
          region: knownPlace.region,
          lat: knownPlace.lat,
          lon: knownPlace.lon,
        }
      : await searchCityCoordinates(cleanQuery);
    const weather = await getWeatherByCoords(coords.lat, coords.lon, {
      name: coords.name,
      country: coords.country,
      countryName: coords.countryName,
      region: coords.region,
    });
    const cacheKeys = new Set([
      cacheKey,
      `city:${normalizeCityQuery(weather.name)}`,
    ]);
    let cacheInfo = weather.cacheInfo;
    for (const key of cacheKeys) {
      cacheInfo = await saveWeatherCache(key, weather, cacheInfo);
    }
    return mergeCacheWarning(weather, cacheInfo);
  } catch (networkError) {
    try {
      const cachedWeather = await loadCachedWeather(cacheKey);
      if (cachedWeather) return cachedWeather;
    } catch (cacheError) {
      throw new AggregateError(
        [networkError, cacheError],
        "No se pudo consultar la ciudad ni leer la caché local."
      );
    }
    throw networkError;
  }
}