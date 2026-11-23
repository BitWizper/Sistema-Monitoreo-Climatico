const DATABASE_NAME = "ClimaDB";
const DATABASE_VERSION = 1;
const LEGACY_ALERTS_KEY = "clima.active-alerts";

export const STORAGE_STORES = Object.freeze([
  "favoritos",
  "alertas",
  "preferencias",
  "cacheConsultas",
]);

export class StorageError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = "StorageError";
    if (cause !== undefined) this.cause = cause;
  }
}

export class StorageValidationError extends StorageError {
  constructor(message, cause) {
    super(message, cause);
    this.name = "StorageValidationError";
  }
}

let databasePromise;

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new StorageValidationError(`${label} debe ser un objeto.`);
  }
}

function assertString(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new StorageValidationError(`${label} debe ser un texto no vacío.`);
  }
}

function assertMaxLength(value, maximum, label) {
  if (value.length > maximum) {
    throw new StorageValidationError(`${label} no puede superar ${maximum} caracteres.`);
  }
}

function assertStoreName(storeName) {
  if (!STORAGE_STORES.includes(storeName)) {
    throw new StorageValidationError(`Almacén desconocido: ${storeName}.`);
  }
}

function assertOptionalString(value, label) {
  if (value !== undefined && value !== null && typeof value !== "string") {
    throw new StorageValidationError(`${label} debe ser texto.`);
  }
}

function validateCoordinates(coordinates, label) {
  if (coordinates === undefined || coordinates === null) return;
  assertObject(coordinates, label);
  const { latitude, longitude } = coordinates;
  if (
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180
  ) {
    throw new StorageValidationError(`${label} debe contener latitud y longitud válidas.`);
  }
}

function roundCoordinates(coordinates) {
  if (!coordinates) return coordinates;
  return {
    latitude: Number(coordinates.latitude.toFixed(2)),
    longitude: Number(coordinates.longitude.toFixed(2)),
  };
}

function isValidDate(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function ensureCloneable(record, label) {
  try {
    structuredClone(record);
  } catch (error) {
    throw new StorageValidationError(`${label} contiene datos que IndexedDB no puede almacenar.`, error);
  }
  return record;
}

function validateRecord(storeName, record) {
  assertStoreName(storeName);
  assertObject(record, `El registro de ${storeName}`);

  switch (storeName) {
    case "favoritos": {
      assertString(record.id, "El id del favorito");
      assertString(record.name, "El nombre del favorito");
      assertMaxLength(record.name, 100, "El nombre del favorito");
      assertOptionalString(record.country, "El país del favorito");
      assertOptionalString(record.countryName, "El nombre del país del favorito");
      assertOptionalString(record.region, "La región del favorito");
      assertOptionalString(record.alias, "El alias del favorito");
      if (record.alias) assertMaxLength(record.alias, 60, "El alias del favorito");
      const favorite = { id: record.id, name: record.name };
      for (const field of ["country", "countryName", "region", "alias"]) {
        if (typeof record[field] === "string") favorite[field] = record[field];
      }
      return ensureCloneable(favorite, "El favorito");
    }
    case "alertas": {
      assertString(record.id, "El id de la alerta");
      assertString(record.city, "La ciudad de la alerta");
      assertMaxLength(record.city, 100, "La ciudad de la alerta");
      if (!["temperature", "wind", "rain"].includes(record.type)) {
        throw new StorageValidationError("El tipo de alerta debe ser temperature, wind o rain.");
      }
      if (record.type === "rain") {
        if (record.threshold !== null && record.threshold !== undefined) {
          throw new StorageValidationError("Las alertas de lluvia no deben tener umbral.");
        }
      } else {
        const minimum = record.type === "wind" ? 0 : -50;
        const maximum = record.type === "wind" ? 300 : 60;
        if (
          !Number.isFinite(record.threshold) ||
          record.threshold < minimum ||
          record.threshold > maximum
        ) {
          throw new StorageValidationError(
            `El umbral de ${record.type} debe estar entre ${minimum} y ${maximum}.`
          );
        }
      }
      assertOptionalString(record.country, "El país de la alerta");
      assertOptionalString(record.countryName, "El nombre del país de la alerta");
      assertOptionalString(record.region, "La región de la alerta");
      assertOptionalString(record.lastTriggeredAt, "La fecha de la última alerta");
      if (record.lastTriggeredAt && !Number.isFinite(Date.parse(record.lastTriggeredAt))) {
        throw new StorageValidationError("La fecha de la última alerta no es válida.");
      }
      validateCoordinates(record.coordinates, "Las coordenadas de la alerta");
      const validatedAlert = {
        id: record.id,
        city: record.city,
        type: record.type,
        threshold: record.type === "rain" ? null : record.threshold,
      };
      for (const field of ["country", "countryName", "region", "lastTriggeredAt"]) {
        if (typeof record[field] === "string") validatedAlert[field] = record[field];
      }
      if (record.coordinates) {
        validatedAlert.coordinates = roundCoordinates(record.coordinates);
      }
      return ensureCloneable(validatedAlert, "La alerta");
    }
    case "preferencias": {
      assertString(record.key, "La clave de preferencia");
      if (!Object.hasOwn(record, "value")) {
        throw new StorageValidationError("La preferencia debe incluir un valor.");
      }
      try {
        structuredClone(record.value);
      } catch (error) {
        throw new StorageValidationError("El valor de la preferencia no se puede almacenar.", error);
      }
      return ensureCloneable({ key: record.key, value: record.value }, "La preferencia");
    }
    case "cacheConsultas": {
      assertString(record.key, "La clave de caché");
      assertMaxLength(record.key, 150, "La clave de caché");
      assertObject(record.data, "Los datos meteorológicos de caché");
      if (
        typeof record.data.name !== "string" ||
        typeof record.data.country !== "string" ||
        typeof record.data.condition !== "string" ||
        !Number.isFinite(record.data.temperature) ||
        !Number.isFinite(record.data.feels) ||
        !Number.isFinite(record.data.humidity) ||
        !Number.isFinite(record.data.wind) ||
        !Array.isArray(record.data.forecastDays) ||
        !record.data.forecastDays.every((day) =>
          day &&
          typeof day.date === "string" &&
          typeof day.condition === "string" &&
          Number.isFinite(day.maxTemp) &&
          Number.isFinite(day.minTemp) &&
          Number.isFinite(day.rainProb)
        )
      ) {
        throw new StorageValidationError("Los datos meteorológicos de caché no son válidos.");
      }
      if (!isValidDate(record.cachedAt)) {
        throw new StorageValidationError("La fecha de caché debe ser una fecha válida.");
      }
      if (!isValidDate(record.expiresAt)) {
        throw new StorageValidationError("La vigencia de caché debe ser una fecha válida.");
      }
      const cachedWeather = { ...record.data };
      delete cachedWeather.coordinates;
      delete cachedWeather.cacheInfo;
      return ensureCloneable({
        key: record.key,
        data: cachedWeather,
        cachedAt: record.cachedAt,
        expiresAt: record.expiresAt,
      }, "La consulta en caché");
    }
    default:
      throw new StorageValidationError(`Almacén desconocido: ${storeName}.`);
  }
}

function getLocalStorage() {
  try {
    return window.localStorage;
  } catch (error) {
    throw new StorageError("No se pudo acceder al almacenamiento local del navegador.", error);
  }
}

function openDatabase() {
  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) {
        reject(new StorageError("Este navegador no permite usar IndexedDB."));
        return;
      }

      let settled = false;
      const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        for (const storeName of STORAGE_STORES) {
          if (!database.objectStoreNames.contains(storeName)) {
            const keyPath = storeName === "preferencias" || storeName === "cacheConsultas"
              ? "key"
              : "id";
            database.createObjectStore(storeName, { keyPath });
          }
        }
      };
      request.onsuccess = () => {
        const database = request.result;
        if (settled) {
          database.close();
          return;
        }
        settled = true;
        database.onversionchange = () => {
          database.close();
          databasePromise = undefined;
        };
        resolve(database);
      };
      request.onerror = () => {
        if (!settled) {
          settled = true;
          reject(new StorageError("No se pudo abrir la base de datos ClimaDB.", request.error));
        }
      };
      request.onblocked = () => {
        if (!settled) {
          settled = true;
          reject(new StorageError("ClimaDB está bloqueada por otra pestaña abierta."));
        }
      };
    }).catch((error) => {
      databasePromise = undefined;
      throw error;
    });
  }
  return databasePromise;
}

function runTransaction(database, storeNames, mode, setup) {
  return new Promise((resolve, reject) => {
    let transaction;
    let result;
    let setupError;
    try {
      transaction = database.transaction(storeNames, mode);
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => {};
      transaction.onabort = () => {
        reject(
          setupError ||
            new StorageError("La transacción de IndexedDB fue cancelada.", transaction.error)
        );
      };
      setup(
        transaction,
        (value) => {
          result = value;
        },
        (error) => {
          setupError = error instanceof StorageError
            ? error
            : new StorageError("No se pudo completar la operación de almacenamiento.", error);
          transaction.abort();
        }
      );
    } catch (error) {
      setupError = error instanceof StorageError
        ? error
        : new StorageError("No se pudo completar la operación de almacenamiento.", error);
      if (transaction) {
        try {
          transaction.abort();
        } catch {
          reject(setupError);
        }
      } else {
        reject(setupError);
      }
    }
  });
}

async function migrateLegacyAlerts(database) {
  await runTransaction(database, "alertas", "readwrite", (transaction, setResult, fail) => {
    const store = transaction.objectStore("alertas");
    const request = store.getAll();
    request.onsuccess = () => {
      try {
        request.result.forEach((rule) => {
          const validatedRule = validateRecord("alertas", rule);
          if (
            rule.coordinates &&
            (rule.coordinates.latitude !== validatedRule.coordinates.latitude ||
              rule.coordinates.longitude !== validatedRule.coordinates.longitude)
          ) {
            store.put(validatedRule);
          }
        });
        setResult(true);
      } catch (error) {
        fail(error);
      }
    };
  });

  const localStorage = getLocalStorage();
  let savedRules;
  try {
    savedRules = localStorage.getItem(LEGACY_ALERTS_KEY);
  } catch (error) {
    throw new StorageError("No se pudieron leer las alertas anteriores; se conservaron.", error);
  }
  if (savedRules === null) return;

  let parsedRules;
  try {
    parsedRules = JSON.parse(savedRules);
  } catch (error) {
    throw new StorageError("Las alertas anteriores no contienen JSON válido; se conservaron.", error);
  }
  if (!Array.isArray(parsedRules)) {
    throw new StorageValidationError("Las alertas anteriores tienen un formato inválido; se conservaron.");
  }
  const legacyRules = parsedRules.map((rule) => validateRecord("alertas", rule));

  await runTransaction(database, "alertas", "readwrite", (transaction) => {
    const store = transaction.objectStore("alertas");
    const request = store.getAll();
    request.onsuccess = () => {
      const existingIds = new Set(request.result.map((rule) => rule.id));
      for (const rule of legacyRules) {
        if (!existingIds.has(rule.id)) {
          store.add(rule);
          existingIds.add(rule.id);
        }
      }
    };
  });

  try {
    localStorage.removeItem(LEGACY_ALERTS_KEY);
  } catch (error) {
    throw new StorageError("Las alertas se copiaron, pero no se pudo retirar la copia anterior.", error);
  }
}

export async function initializeStorage() {
  const database = await openDatabase();
  await migrateLegacyAlerts(database);
}

export async function createRecord(storeName, record) {
  const validatedRecord = validateRecord(storeName, record);
  const database = await openDatabase();
  return runTransaction(database, storeName, "readwrite", (transaction, setResult) => {
    const request = transaction.objectStore(storeName).add(validatedRecord);
    request.onsuccess = () => setResult(validatedRecord);
  });
}

export async function putRecord(storeName, record) {
  const validatedRecord = validateRecord(storeName, record);
  const database = await openDatabase();
  return runTransaction(database, storeName, "readwrite", (transaction, setResult) => {
    const request = transaction.objectStore(storeName).put(validatedRecord);
    request.onsuccess = () => setResult(validatedRecord);
  });
}

export async function readRecord(storeName, key) {
  assertStoreName(storeName);
  assertString(key, "La clave del registro");
  const database = await openDatabase();
  return runTransaction(database, storeName, "readonly", (transaction, setResult, fail) => {
    const request = transaction.objectStore(storeName).get(key);
    request.onsuccess = () => {
      try {
        setResult(request.result === undefined ? null : validateRecord(storeName, request.result));
      } catch (error) {
        fail(error);
      }
    };
  });
}

export async function readAllRecords(storeName) {
  assertStoreName(storeName);
  const database = await openDatabase();
  return runTransaction(database, storeName, "readonly", (transaction, setResult, fail) => {
    const request = transaction.objectStore(storeName).getAll();
    request.onsuccess = () => {
      try {
        setResult(request.result.map((record) => validateRecord(storeName, record)));
      } catch (error) {
        fail(error);
      }
    };
  });
}

export async function updateRecord(storeName, record) {
  const validatedRecord = validateRecord(storeName, record);
  const key = validatedRecord.id ?? validatedRecord.key;
  const database = await openDatabase();
  return runTransaction(database, storeName, "readwrite", (transaction, setResult, fail) => {
    const store = transaction.objectStore(storeName);
    const lookup = store.get(key);
    lookup.onsuccess = () => {
      if (lookup.result === undefined) {
        fail(new StorageError(`No existe el registro "${key}" en ${storeName}.`));
        return;
      }
      const request = store.put(validatedRecord);
      request.onsuccess = () => setResult(validatedRecord);
    };
  });
}

export async function deleteRecord(storeName, key) {
  assertStoreName(storeName);
  assertString(key, "La clave del registro");
  const database = await openDatabase();
  return runTransaction(database, storeName, "readwrite", (transaction, setResult) => {
    const store = transaction.objectStore(storeName);
    const lookup = store.get(key);
    lookup.onsuccess = () => {
      if (lookup.result === undefined) {
        setResult(false);
        return;
      }
      const request = store.delete(key);
      request.onsuccess = () => setResult(true);
    };
  });
}

export async function clearLocalData() {
  const database = await openDatabase();
  const localStorage = getLocalStorage();
  let legacyAlerts;
  try {
    legacyAlerts = localStorage.getItem(LEGACY_ALERTS_KEY);
    localStorage.removeItem(LEGACY_ALERTS_KEY);
  } catch (error) {
    throw new StorageError("No se pudieron preparar los datos locales para limpiarlos.", error);
  }

  try {
    await runTransaction(database, STORAGE_STORES, "readwrite", (transaction, setResult) => {
      for (const storeName of STORAGE_STORES) {
        transaction.objectStore(storeName).clear();
      }
      setResult(true);
    });
  } catch (error) {
    if (legacyAlerts !== null) {
      try {
        localStorage.setItem(LEGACY_ALERTS_KEY, legacyAlerts);
      } catch (restoreError) {
        throw new StorageError(
          "No se pudieron limpiar los datos ni restaurar las alertas anteriores.",
          new AggregateError([error, restoreError])
        );
      }
    }
    throw error;
  }
  return true;
}
