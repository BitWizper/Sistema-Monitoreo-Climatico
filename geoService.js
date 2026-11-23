import { getWeatherByCity, getWeatherByCoords } from "./weatherService.js";

/**
 * Solicita la posición GPS actual del usuario.
 * @param {PositionOptions} [options]
 * @returns {Promise<{lat: number, lon: number}>}
 */
export function getCurrentCoordinates(options = {}) {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("Este navegador no soporta geolocalización."));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lon = position.coords.longitude;
        if (
          !Number.isFinite(lat) ||
          lat < -90 ||
          lat > 90 ||
          !Number.isFinite(lon) ||
          lon < -180 ||
          lon > 180
        ) {
          reject(new Error("El navegador devolvió coordenadas inválidas."));
          return;
        }
        resolve({ lat, lon });
      },
      (error) => {
        const errorMap = {
          1: "Permiso de ubicación denegado.",
          2: "Ubicación no disponible en este momento.",
          3: "Tiempo de espera agotado al obtener ubicación.",
        };
        const err = new Error(errorMap[error.code] || "No se pudo obtener la ubicación.");
        err.code = error.code;
        reject(err);
      },
      {
        enableHighAccuracy: true,
        timeout: 8000,
        maximumAge: 300000,
        ...options,
      }
    );
  });
}

/**
 * Intenta obtener el clima por geolocalización; si el permiso es denegado o falla,
 * aplica fallback a una ciudad manual/por defecto.
 * @param {string} [fallbackCity="Mérida"]
 * @returns {Promise<{weather: object, source: "geolocation" | "fallback", reason?: string}>}
 */
export async function resolveInitialWeather(fallbackCity = "Mérida") {
  try {
    const { lat, lon } = await getCurrentCoordinates();
    const weather = await getWeatherByCoords(lat, lon);
    return { weather, source: "geolocation" };
  } catch (error) {
    try {
      const weather = await getWeatherByCity(fallbackCity);
      return {
        weather,
        source: "fallback",
        reason: error.message,
      };
    } catch (fallbackError) {
      throw new AggregateError(
        [error, fallbackError],
        "No se pudo consultar la ubicación actual ni la ciudad alternativa."
      );
    }
  }
}