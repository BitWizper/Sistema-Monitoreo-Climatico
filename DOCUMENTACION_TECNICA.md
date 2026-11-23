# Documentación técnica

## Arquitectura

La aplicación es una interfaz web estática en módulos ES:

- `index.html` define la estructura, formularios y puntos de montaje de la interfaz.
- `styles.css` presenta el diseño adaptable y los estados de carga, error, caché y desconexión.
- `app.js` coordina eventos, renderizado seguro y persistencia de favoritos, alertas y preferencias.
- `weatherService.js` consulta Open-Meteo y mantiene la caché meteorológica en IndexedDB.
- `geoService.js` obtiene la ubicación del navegador y resuelve la ubicación inicial con una ciudad alternativa.
- `notificationService.js` valida y evalúa reglas; las notificaciones requieren permiso del navegador.
- `storageService.js` administra IndexedDB, validación, migración de alertas antiguas y borrado de datos.
- `service-worker.js` cachea el shell estático de la aplicación para permitir abrirlo offline.

No hay backend ni credenciales de API en el cliente. La interfaz usa Open-Meteo y, para geocodificación inversa, BigDataCloud. El Service Worker solo intercepta solicitudes GET del mismo origen; las respuestas de las APIs meteorológicas se guardan desde `weatherService.js` en IndexedDB.

## Esquema de `ClimaDB`

La base se abre como `ClimaDB`, versión `1`. Durante `onupgradeneeded` se crean los almacenes que falten. No hay índices secundarios en esta versión; cada almacén consulta por su `keyPath`. Al cambiar el esquema de almacenes o índices se debe incrementar `DATABASE_VERSION` y añadir la migración correspondiente.

| Object store | `keyPath` | Índices | Registro |
|---|---|---|---|
| `favoritos` | `id` | Ninguno | `{ id, name, country?, countryName?, region?, alias? }` |
| `alertas` | `id` | Ninguno | `{ id, city, type, threshold, country?, countryName?, region?, coordinates?, lastTriggeredAt? }` |
| `preferencias` | `key` | Ninguno | `{ key, value }` |
| `cacheConsultas` | `key` | Ninguno | `{ key, data, cachedAt, expiresAt }` |

`data` en `cacheConsultas` es el clima normalizado: `{ name, country, countryName, region, temperature, feels, condition, humidity, wind, uv, rawCode, forecastDays, updatedAt }`. Cada elemento de `forecastDays` tiene `{ date, code, condition, maxTemp, minTemp, rainProb }`. No contiene `coordinates` ni `cacheInfo`. `cachedAt` y `expiresAt` son fechas parseables en formato ISO; los cuerpos cacheados se validan antes de guardar y leer.

Reglas de validación principales:

- Los IDs, nombres y claves no pueden estar vacíos; los nombres de ciudad tienen un máximo de 100 caracteres y los alias de favorito, 60.
- `type` en alertas es `temperature`, `wind` o `rain`. Los umbrales de temperatura admiten `-50..60`; los de viento, `0..300`. Las alertas de lluvia guardan `threshold: null`.
- Las coordenadas de alertas se validan en los rangos geográficos y se redondean a dos decimales (aproximadamente 1 km). Las coordenadas de favoritos se descartan.
- Los datos de caché deben tener campos meteorológicos normalizados y fechas parseables. Se excluyen `coordinates` y metadatos de interfaz del cuerpo meteorológico cacheado.
- Los valores de preferencias y registros deben poder clonarse con `structuredClone`, como requiere IndexedDB.

## CRUD y migración

`storageService.js` expone las operaciones asíncronas `createRecord`, `readRecord`, `readAllRecords`, `updateRecord`, `deleteRecord` y `putRecord` (crear o reemplazar). Todas validan el almacén y el registro; `updateRecord` falla si no existe el registro, y `deleteRecord` devuelve `false` cuando no existía. Los errores se exponen mediante `StorageError` y `StorageValidationError`.

La interfaz permite:

- Crear favoritos con ciudad y alias opcional, leerlos al iniciar, editar ciudad/alias y eliminarlos. La estrella del clima actual también agrega o quita el favorito.
- Crear, editar y eliminar alertas. La edición permite cambiar ubicación, tipo y umbral.
- Cambiar entre °C y °F. La selección se guarda en `preferencias` bajo la clave `temperatureUnit`, con valor `C` o `F`.

`initializeStorage()` se ejecuta al iniciar `app.js`. Si existe `localStorage["clima.active-alerts"]`, valida y copia las alertas a IndexedDB en una transacción. Omite IDs ya migrados para que el proceso sea idempotente y elimina la copia de `localStorage` solo después de confirmar la transacción. Si hay un error o datos inválidos, conserva la copia anterior y comunica el error. También normaliza a dos decimales las coordenadas de alertas ya almacenadas.

`clearLocalData()` vacía los cuatro almacenes y elimina la clave antigua de alertas. Si la transacción falla, intenta restaurar esa clave antigua. No borra la caché del shell del Service Worker, que contiene recursos estáticos, no datos personales.

## Caché meteorológica

- `weatherService.js` cachea el cuerpo meteorológico normalizado con `cachedAt` y `expiresAt`; la vigencia es de 15 minutos.
- Las claves de ciudad son `city:<consulta normalizada>`. Se guarda también una clave con el nombre canónico devuelto por geocodificación para que los favoritos puedan recuperarse sin red.
- Las claves de ubicación son `coords:<latitud>,<longitud>`, con latitud/longitud redondeadas a dos decimales. El cuerpo cacheado no contiene coordenadas.
- Se conservan como máximo 100 consultas; al superar el límite se eliminan primero las más antiguas según `cachedAt`.
- Al fallar la red, una consulta guardada se puede usar incluso vencida. La interfaz indica si es dato guardado y si puede estar desactualizado; muestra la fecha original y no evalúa alertas con datos cacheados.

## Flujo online y offline

1. En línea, la aplicación obtiene ubicación o ciudad, consulta el pronóstico y guarda el resultado en `cacheConsultas`.
2. Sin red, el Service Worker sirve `index.html`, `styles.css` y los módulos que ya se descargaron. Las APIs externas no se simulan ni se cachean en el Service Worker.
3. La aplicación intenta recuperar el pronóstico desde IndexedDB. Si lo encuentra, presenta el último dato disponible con la advertencia de antigüedad.
4. Cuando vuelve la conexión, las siguientes consultas vuelven a intentar Open-Meteo. Las alertas se revisan cada 15 minutos únicamente mientras la aplicación está abierta; el Service Worker no programa alertas en segundo plano.

El Service Worker requiere HTTPS o un origen local seguro como `localhost`. Para disponer del shell offline, el sitio debe haberse abierto en línea al menos una vez para instalar el Service Worker y precargar los recursos.

## Seguridad y privacidad

- Los datos de APIs y usuarios se insertan con `textContent` y nodos DOM; no se usa `innerHTML`.
- Se codifican los nombres en parámetros de geocodificación y se limitan a 100 caracteres. Se validan coordenadas, reglas y registros antes de guardar o usar.
- No se guardan coordenadas en favoritos ni en el cuerpo de la caché meteorológica. La caché por ubicación usa una clave aproximada; las alertas retienen coordenadas redondeadas porque las necesitan para sus consultas.
- El Service Worker limita su caché a solicitudes GET del mismo origen. Las respuestas de servicios externos no se almacenan allí.
- IndexedDB y Cache Storage son almacenamiento local del navegador, no cifrado ni protegido frente a otros scripts del mismo origen. Esta aplicación estática no ofrece autenticación, CSP ni controles de servidor.

## Registro de pruebas manuales en dos dispositivos

Registrar navegador y versión, fecha, resultado y notas. Ejecutar las pruebas online y offline después de una primera visita online.

| Dispositivo | Navegador / versión | Prueba | Resultado | Fecha y notas |
|---|---|---|---|---|
| Dispositivo 1 |  | CRUD favoritos, alertas y unidad |  |  |
| Dispositivo 1 |  | Abrir shell offline y mostrar caché vencida |  |  |
| Dispositivo 2 |  | CRUD favoritos, alertas y unidad |  |  |
| Dispositivo 2 |  | Abrir shell offline y mostrar caché vencida |  |  |

No hay un runner de pruebas automatizadas configurado en el proyecto; la tabla es una base para registrar validación manual en los navegadores objetivo.
