# RoadGuard Qro — Manual de Usuario
**Guía Operativa para Operadores de Flota, Motociclistas e Ingenieros de Obras Públicas**

*Municipio de Santiago de Querétaro — Secretaría de Obras Públicas Municipales*  
*Versión:* `1.0.0-PROD` | *Fecha:* Noviembre 2026

---

## 1. Introducción y Enlaces de Acceso

**RoadGuard Qro** es una plataforma tecnológica para auditar de forma continua y pasiva el estado de las vialidades de la ciudad de Querétaro. Consta de dos componentes principales:
1. **Módulo de Captura en Campo (PWA Móvil):** Instalado en los teléfonos inteligentes de los conductores de flotas (camiones, patrullas o motocicletas de supervisión).
2. **Centro de Control y Monitoreo (Dashboard Web):** Utilizado por ingenieros y directores de obras públicas para visualizar el mapa de calor de daños, asignar cuadrillas de bacheo y calcular presupuesto asfáltico.

### Enlaces Oficiales del Sistema
- **Panel Administrativo (Dashboard):** [https://road-guard-qro.vercel.app/dashboard](https://road-guard-qro.vercel.app/dashboard)
- **Módulo de Captura en Conducción (PWA):** [https://road-guard-qro.vercel.app/capture](https://road-guard-qro.vercel.app/capture)
- **Simulador Virtual de Rutas:** [https://road-guard-qro.vercel.app/simulator](https://road-guard-qro.vercel.app/simulator)
- **Diagnóstico del Servidor de Inferencia:** [https://roadguard-qro.onrender.com/health](https://roadguard-qro.onrender.com/health)

---

## 2. Guía del Operador de Campo (PWA Móvil)

El módulo de captura corre directamente en el navegador del teléfono móvil sin necesidad de descargar aplicaciones desde la App Store o Google Play Store.

### 2.1. Requisitos y Preparación del Teléfono
- Teléfono inteligente con cámara trasera funcional y receptor GPS (iOS 15+ en Safari o Android 9+ en Chrome).
- Conexión a datos móviles (opcional, el sistema funciona de manera 100% offline y sube datos al conectarse a Wi-Fi).
- **Soporte de montaje rígido:**
  - **En Motocicleta:** Soporte de manubrio o retrovisor con amortiguador de vibración para evitar movimiento excesivo.
  - **En Patrulla o Camión:** Soporte con ventosa de alta resistencia fijado en la parte central baja del parabrisas.

### 2.2. Ángulo de Inclinación y Orientación Óptima
- **Orientación Recomendada: HORIZONTAL (Landscape):**
  - Girar el teléfono de forma horizontal para aprovechar el ancho del sensor de la cámara. Esto permite cubrir los ~3.5 metros del carril completo y optimiza la detección de baches en el borde de la banqueta.
- **Ángulo de Inclinación:**
  - Apuntar el teléfono hacia el asfalto (entre 30° y 45° con respecto al horizonte).
  - El encuadre debe captar el pavimento a una distancia de **5 a 12 metros frente al vehículo**. Debe evitarse apuntar hacia el cielo o el horizonte para proteger la privacidad de peatones y placas vehiculares.

---

### 2.3. Configuración de Permisos en el Teléfono (Paso a Paso)

#### En iPhone (iOS Safari):
Si al ingresar aparece un recuadro rojo con el texto *"Aviso de GPS en iPhone: Permiso de ubicación denegado"*, sigue estos sencillos pasos:

1. Abre la aplicación **Configuración** (Ajustes) en tu iPhone.
2. Desplázate hacia abajo y selecciona **Privacidad y Seguridad**.
3. Toca en **Localización** y asegúrate de que esté **Activada** (interruptor verde).
4. En esa misma lista, baja hasta encontrar **Sitios web de Safari**.
5. Selecciona la opción **"Al usar la app"** (o "Preguntar la próxima vez") y asegúrate de que la opción **"Ubicación precisa"** esté encendida.
6. Regresa a Safari, abre [https://road-guard-qro.vercel.app/capture](https://road-guard-qro.vercel.app/capture) y pulsa el botón **"Reintentar GPS"** o recarga la página. Cuando aparezca la ventana emergente solicitando acceso a la cámara y ubicación, selecciona **Permitir**.

#### En Android (Google Chrome):
1. Abre [https://road-guard-qro.vercel.app/capture](https://road-guard-qro.vercel.app/capture).
2. Toca el ícono de **ajustes del sitio** o candado situado a la izquierda de la barra de dirección.
3. Entra a **Permisos** y activa **Cámara** y **Ubicación**.

---

### 2.4. Uso de la Pantalla HUD en Conducción

Al ingresar a `/capture`, pulsa el botón azul **"INICIAR RUTA"**. Verás la pantalla HUD (Head-Up Display) con la cámara en vivo y telemetría en tiempo real:

```
┌─────────────────────────────────────────────────────────────┐
│  RoadGuard  Moto/Flotilla                    [🟢 IA Lista]  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│                [ STREAM DE CÁMARA EN VIVO ]                 │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│  VELOCIDAD   │ GPS PRECISIÓN │ ENVIADAS/COLA │   DAÑOS IA   │
│   42 km/h    │    Activo     │    12 / 0     │      3       │
├─────────────────────────────────────────────────────────────┤
│  Alto de Imagen (ROI):   [60%]  [75%]  [85%]  [100%]        │
│  [X] Auto-captura continua (cada 4s + cada 15m)             │
├─────────────────────────────────────────────────────────────┤
│  [ 📷 Capturar Ahora ]                 [ ⏹ FINALIZAR ]      │
└─────────────────────────────────────────────────────────────┘
```

#### Indicadores del HUD:
- **VELOCIDAD:** Muestra tu velocidad en km/h. Para evitar desperdicio de almacenamiento y datos, la cámara no captura fotos si el vehículo está detenido en un semáforo (velocidad 0 km/h).
- **GPS PRECISIÓN:** Si marca **Activo** o una precisión menor a 25 metros, la geolocalización es óptima para registrar el bache.
- **ENVIADAS / COLA:** 
  - El primer número indica los paquetes transmitidos exitosamente al servidor.
  - El segundo número indica las fotos guardadas temporalmente en la cola local del teléfono (IndexedDB).
- **DAÑOS IA:** Muestra cuántos baches o grietas han sido detectados por el modelo de inteligencia artificial durante tu recorrido actual.
- **Alto de Imagen (ROI):** Permite elegir el recorte inferior de la imagen. El valor recomendado es **75%**.
- **Auto-captura continua:** Mantén marcada esta casilla para que el teléfono capture automáticamente cada 15 metros de avance o cada 4 segundos.
- **Capturar Ahora:** Si ves un bache peligroso y quieres asegurarte de registrarlo inmediatamente, pulsa este botón para forzar una fotografía al instante.
- **FINALIZAR:** Al terminar el turno o jornada de patrullaje, pulsa este botón para cerrar la sesión de cámara.

### 2.5. Operación en Zonas sin Señal (Modo Offline)
Si transitas por pasos a desnivel, túneles o tramos carreteros sin señal celular:
- La aplicación **no se detiene**. Todas las fotografías y coordenadas se guardan de forma segura en la base de datos interna de tu teléfono (IndexedDB).
- El contador de **COLA** aumentará.
- Tan pronto recuperes señal celular o llegues a la base con conexión Wi-Fi, la aplicación enviará automáticamente todos los datos pendientes en paquetes de 10 fotos con pausas de seguridad.

---

## 3. Guía del Ingeniero de Obras Públicas (Dashboard Web)

El panel administrativo permite a los supervisores e ingenieros monitorear el estado del pavimento en toda la zona metropolitana de Querétaro.

### 3.1. Acceso a la Plataforma
Abre [https://road-guard-qro.vercel.app/dashboard](https://road-guard-qro.vercel.app/dashboard) desde cualquier computadora de escritorio o portátil.
> **Compatibilidad:** 100% compatible con Google Chrome, Mozilla Firefox, Microsoft Edge, Safari y Brave Browser.

---

### 3.2. Navegación en el Mapa de Querétaro

#### Controles del Mapa:
- **Arrastre (Pan):** Haz clic sostenido con el ratón y arrastra para moverte por las diferentes delegaciones (Centro Histórico, Epigmenio González, Felipe Carrillo Puerto, Félix Osores, Santa Rosa Jáuregui, Cayetano Rubio, Josefa Vergara).
- **Zoom:** Usa la rueda del ratón o los botones `+` y `-` en la esquina superior derecha.
- **Botón "Vista General Qro":** Ubicado en la barra superior; al hacer clic re-centra la vista en la capital queretana con un zoom panorámico.

#### Selector de Capas Cartográficas:
En la barra superior del mapa puedes alternar entre tres vistas:
1. **Modo Oscuro:** Mapa de alto contraste nocturno; resalta vívidamente los colores de los baches y reduce la fatiga visual.
2. **Calles OSM:** Mapa callejero con nombres de avenidas, cruces y manzanas (OpenStreetMap).
3. **Satelital:** Ortofoto aérea de alta resolución (ESRI World Imagery) para verificar si el bache está cerca de una alcantarilla, banqueta o puente vehicular.

---

### 3.3. Código de Colores de Severidad

Los marcadores en el mapa utilizan un código cromático internacional para priorizar la atención de cuadrillas:

| Color del Marcador | Nivel de Severidad | Código RDD | Descripción y Criterio de Atención |
|---|---|---|---|
| **🔴 Rojo** | **Crítica (> 75%)** | `D40` | **Bache profundo o asfalto destruido.** Representa riesgo inminente de ponchadura de llanta, daño a suspensión o accidente a motociclistas. **Atención prioritaria en menos de 24 horas.** |
| **🟠 Naranja** | **Alta (> 55%)** | `D20` | **Piel de cocodrilo severa.** Fatiga estructural avanzada donde el asfalto se ha fragmentado en bloques; colapsará en bache ante la primera lluvia fuerte. |
| **🟡 Amarillo** | **Media (> 35%)** | `D10` | **Grieta transversal.** Fisura perpendicular que requiere sellado asfáltico preventivo antes de que filtre agua a la subbase. |
| **🔵 Azul** | **Baja (< 35%)** | `D00` | **Grieta longitudinal leve.** Fisura paralela a la trayectoria vehicular; monitoreo rutinario. |
| **🟢 Pulso Azul Animado** | **En Vivo** | Cualquier clase | Daño registrado en los últimos 15 minutos por una unidad en ruta activa. |

---

### 3.4. Inspección de Evidencia y Gestión de Reparaciones

Al hacer clic en cualquier bache del mapa o en la lista lateral izquierda:
1. **Ficha de Detalle (Panel Inferior Izquierdo):**
   - **Fotografía de Evidencia:** Muestra la captura exacta tomada por el vehículo en la calle.
   - **Coordenadas GPS:** Latitud y longitud con 5 decimales de precisión.
   - **Confirmaciones de Flota:** Muestra cuántas veces fue detectado el daño (ej. *"Confirmado: 4 detecciones por 2 unidades"*). Esto garantiza que no se trate de una mancha de agua o sombra.
   - **Fecha y Hora:** Momento del último registro.

2. **Flujo de Estados y Botones de Acción:**
   - **Validar:** Pulsa este botón cuando hayas verificado la evidencia fotográfica. El estado cambiará a `VALIDATED`.
   - **Asignar Cuadrilla:** Pulsa este botón cuando despaches una cuadrilla de bacheo al lugar. El estado cambiará a `IN_REPAIR`.
   - **Marcar Reparado:** Pulsa este botón cuando la cuadrilla reporte el bache cubierto y compactado. El estado cambiará a `REPAIRED` y se archivará del mapa principal.
   - **Descartar:** Si la foto muestra una sombra o una junta de dilatación normal, márcalo como `DISMISSED`.
   - **Eliminar (Bote de basura):** Borra permanentemente el registro de la base de datos (útil para eliminar pruebas).

---

### 3.5. Exportación de Reportes y Presupuesto de Asfalto

En la esquina superior derecha del Dashboard, haz clic en el botón **"Exportar CSV Presupuesto"**:
- Descargará automáticamente un archivo con formato `roadguard_danos_YYYY-MM-DD.csv`.
- Contiene: ID, tipo de daño, severidad (%), estado, latitud, longitud, número de confirmaciones, fecha de registro y **estimación de mezcla asfáltica en caliente en toneladas**.
- Este archivo se puede abrir directamente en Excel o importar en sistemas GIS municipales (QGIS o ArcGIS) para licitaciones y órdenes de compra de asfalto.

---

## 4. Guía del Simulador de Pruebas Virtuales

Si deseas validar el sistema completo sin salir a la calle en un vehículo:
1. Abre [https://road-guard-qro.vercel.app/simulator](https://road-guard-qro.vercel.app/simulator).
2. Haz clic en **"Iniciar Simulación Ruta 5 de Febrero"**.
3. El simulador recorrerá virtualmente 7 puntos geográficos sobre Av. 5 de Febrero, inyectando telemetría y fotogramas de prueba con baches reales.
4. Podrás observar cómo se actualiza la cola, cómo responde la API y cómo los baches aparecen inmediatamente reflejados en el [Dashboard](https://road-guard-qro.vercel.app/dashboard).

---

## 5. Preguntas Frecuentes y Solución de Problemas (FAQ)

### P1: En mi computadora con navegador Brave, la pantalla del mapa se veía negra. ¿Por qué ocurre y cómo se soluciona?
**Respuesta:** Brave incluye escudos estrictos que bloquean ciertas funciones de WebGL. RoadGuard Qro utiliza un mapa 2D nativo optimizado. Si llegas a ver el fondo oscuro sin calles, simplemente selecciona la capa **"Satelital"** o **"Calles OSM"** en la barra superior del mapa, o haz clic en el ícono del león de Brave en la barra de direcciones y desactiva temporalmente los escudos para el sitio.

### P2: Al abrir la aplicación por primera vez en el día, tarda unos 40 segundos en cargar los datos o da un aviso de reintento. ¿Está fallando?
**Respuesta:** No. RoadGuard Qro opera bajo una arquitectura de **Costo Cero ($0)** en el nivel gratuito de Render. Cuando el servidor no recibe tráfico durante 15 minutos, entra en modo de suspensión automática. Al recibir la primera petición, el servidor "despierta" en aproximadamente 30 a 50 segundos. Una vez encendido, todas las peticiones posteriores responden de forma instantánea (~150 ms). Además, el repositorio incluye un robot automático (keep-alive) que envía una señal cada 14 minutos en horarios laborales para mantenerlo despierto.

### P3: ¿Por qué en iPhone Safari me pedía permiso de GPS repetidamente?
**Respuesta:** En iOS, Apple bloquea las solicitudes simultáneas de cámara y geolocalización. El sistema ahora solicita primero la cámara y medio segundo después la ubicación. Si tu iPhone tiene desactivada la localización en Safari, consulta la sección **2.3** de este manual para habilitar "Ubicación precisa" en los ajustes de iOS.

### P4: ¿El sistema gasta todos mis datos móviles mientras conduzco?
**Respuesta:** No. Las imágenes son optimizadas, recortadas y comprimidas a solo ~25 KB antes de enviarse, y solo se capturan fotos cada 15 metros o cuando el vehículo está en movimiento. Una jornada completa de 4 horas en motocicleta consume menos de 45 MB de datos móviles (menos que ver un video corto en YouTube). Si prefieres no gastar datos, puedes poner el teléfono en modo avión o desactivar datos móviles: la aplicación guardará todo en su memoria interna y lo enviará al llegar a tu red Wi-Fi.

### P5: ¿Qué pasa si la cámara capta peatones o autos particulares?
**Respuesta:** La aplicación recorta automáticamente la mitad superior de la imagen (horizonte y cielo), enfocándose únicamente en el asfalto. Ni los rostros de peatones ni las placas vehiculares entran en el encuadre procesado, cumpliendo al 100% con la Ley Federal de Protección de Datos Personales (LFPDPPP).
