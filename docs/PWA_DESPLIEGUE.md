# Rol A — PWA / Despliegue

Responsable: _(nombre del integrante A)_ · Requisitos de la rúbrica: **2, 3, 9, 10**

## 0. Integración con archivos existentes (ya aplicada)

Se hicieron dos ediciones mínimas: en `index.html` se añadieron `<link rel="manifest">`, favicon, `apple-touch-icon`, metas de iOS y el script `pwa-install.js`; en `service-worker.js` se subió `CACHE_NAME` a `clima-shell-v3` y se añadieron al precaché el manifest, `pwa-install.js` y los íconos. Verificar con `node scripts/verify-pwa.mjs`.

## 1. Arquitectura PWA

| Pieza | Archivo | Función |
|---|---|---|
| Web App Manifest | `manifest.webmanifest` | Nombre, íconos (any + maskable), `display: standalone`, colores, atajos |
| Service Worker | `service-worker.js` | Precaché del shell + estrategias de caché |
| Instalación | `pwa-install.js` | Botón "Instalar", pista para iOS, aviso de actualización |
| Íconos | `icons/` | 192, 512, maskable 512, apple-touch 180, favicon SVG |
| Despliegue | `.github/workflows/deploy.yml` | Publica en GitHub Pages (HTTPS) en cada push a `main` |
| Verificación | `scripts/verify-pwa.mjs`, `lighthouserc.json` | Comprobaciones automáticas y Lighthouse |

### Estrategias de caché (Service Worker)

| Petición | Estrategia | Motivo |
|---|---|---|
| Navegación (`index.html`) | Network-first con respaldo en caché | Siempre la última versión; offline abre la última copia |
| Recursos estáticos del mismo origen | Network-first con respaldo en caché | Código actualizado en línea, disponible sin red |
| APIs externas (Open-Meteo, BigDataCloud) | No se interceptan | Sus datos se guardan en IndexedDB (rol D) con vigencia de 15 min |

El Service Worker solo maneja `GET` del mismo origen, por lo que no almacena datos personales.

## 2. Instalación

- **Chrome / Edge / Android:** aparece el banner "Instalar" (evento `beforeinstallprompt`) o el ícono de instalar en la barra de direcciones.
- **iOS (Safari):** Compartir → *Añadir a pantalla de inicio* (iOS no emite el evento; el módulo muestra la instrucción).
- **Escritorio:** ícono ⊕ en la barra de direcciones de Chrome/Edge.

## 3. Despliegue HTTPS (GitHub Pages)

1. Subir el repositorio a GitHub (rama `main`).
2. `Settings → Pages → Build and deployment → Source: GitHub Actions`.
3. Hacer *push*: el workflow verifica los archivos PWA y publica.
4. URL pública: `https://<usuario>.github.io/Sistema-Monitoreo-Climatico/`
   (GitHub Pages sirve HTTPS y rutas relativas; el `scope` y `start_url` del manifest son relativos para funcionar en subcarpeta).

URL final: **_(pegar aquí)_**

## 4. Lighthouse en 2 dispositivos

Ejecutar sobre la **URL HTTPS publicada**, en ventana de incógnito y sin extensiones.

**Opción A (DevTools):** F12 → *Lighthouse* → categorías: Performance, Accessibility, Best Practices, SEO → modo *Mobile* (y luego *Desktop*) → *Analyze* → ⋮ → *Save as HTML* en `docs/lighthouse/`.
**Opción B (CLI):**

```bash
npx lighthouse https://<usuario>.github.io/Sistema-Monitoreo-Climatico/ --preset=desktop --output=html --output-path=docs/lighthouse/desktop.html
npx lighthouse https://<usuario>.github.io/Sistema-Monitoreo-Climatico/ --form-factor=mobile --screenEmulationMode=mobile --output=html --output-path=docs/lighthouse/mobile.html
```

> Nota: Lighthouse ≥ 12 ya no incluye la categoría "PWA". La instalabilidad se valida en
> DevTools → *Application → Manifest* ("Installability") y con las pruebas de la sección 5.

### Registro de resultados

| Dispositivo / plataforma | Navegador | Perf. | Accesib. | Buenas prác. | SEO | Instalable | Archivo de reporte |
|---|---|---|---|---|---|---|---|
| Móvil: _(modelo, SO)_ | | | | | | ☐ | `docs/lighthouse/mobile.html` |
| Escritorio: _(SO)_ | | | | | | ☐ | `docs/lighthouse/desktop.html` |

## 5. Lista de verificación (evidencias para el documento técnico)

| # | Prueba | Cómo | Evidencia | ✔ |
|---|---|---|---|---|
| 1 | Manifest válido | DevTools → Application → Manifest (sin advertencias) | Captura | ☐ |
| 2 | Service Worker activo | Application → Service Workers (*activated and running*) | Captura | ☐ |
| 3 | Instalable | Banner/ícono de instalar → instalar | Captura de la app instalada | ☐ |
| 4 | Offline | Cargar en línea → Network: *Offline* → recargar | Captura/video | ☐ |
| 5 | HTTPS | Candado en la barra de direcciones | Captura con URL | ☐ |
| 6 | Actualización | Subir `CACHE_NAME` (v4) → desplegar → aviso "nueva versión" | Captura | ☐ |
| 7 | Lighthouse ×2 | Sección 4 | 2 reportes HTML | ☐ |

## 6. Mapeo con la rúbrica

| Criterio (puntos) | Cubierto por |
|---|---|
| Manifest, Service Worker e instalación (15) | `manifest.webmanifest`, `service-worker.js`, `pwa-install.js`, íconos |
| Seguridad, pruebas y despliegue (15) | Workflow HTTPS, `verify-pwa.mjs`, reportes Lighthouse, tabla de pruebas |
