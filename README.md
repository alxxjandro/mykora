# Mykora — Visualizador del filtro 3D

Prototipo interactivo del filtro **Mykora** (Borregolitos · Mars Challenge 2026).
Muestra el modelo 3D del filtro multicapa; al hacer click en cada cápsula, esta
se desliza hacia afuera y se muestra la información de la capa. El agua se
simula con un modelo hidráulico: el caudal, el balance de masa y el tiempo en cada
capa se calculan y se muestran en pantalla.

Es un sitio **100% estático** (HTML + Three.js por CDN). No requiere build.

## Estructura

```
.
├── index.html        # App completa (escena Three.js + lógica + datos)
├── physics.js        # Modelo hidráulico del filtro (Darcy, Kozeny–Carman, balance de masa)
├── models/           # Modelos 3D (.obj / .mtl)
├── textures/         # Texturas de cada material (1.png … 6.png)
├── netlify.toml      # Configuración de despliegue
└── .gitignore
```

## Ver en local

El sitio carga modelos y texturas con `fetch`, así que **no** funciona abriendo
el `index.html` directo (protocolo `file://`). Hay que servirlo por HTTP:

```bash
# Opción A: Python (viene en macOS)
python3 -m http.server 8000
# luego abre http://localhost:8000

# Opción B: Live Server (extensión de VS Code) — lo que ya usabas
```

## Desplegar en Netlify

### Opción 1 — Arrastrar y soltar (lo más rápido)
1. Entra a https://app.netlify.com/drop
2. Arrastra **toda la carpeta** `filtro/` a la ventana.
3. Listo: Netlify te da una URL pública.

### Opción 2 — Conectar un repositorio Git (recomendado para actualizar)
1. Sube esta carpeta a un repo de GitHub/GitLab.
2. En Netlify: **Add new site → Import an existing project** y elige el repo.
3. Build command: *(vacío)* · Publish directory: `.`
   (ya queda definido en `netlify.toml`).
4. Cada `git push` redepliega automáticamente.

### Opción 3 — Netlify CLI
```bash
npm install -g netlify-cli
netlify deploy           # previsualización
netlify deploy --prod    # producción
```

## Notas técnicas
- Three.js se carga desde CDN (unpkg) vía import map; requiere conexión a internet.
- Los `.obj` no traían UVs ni normales: las normales se calculan en runtime y la
  textura de cada material se aplica sobre un cilindro interno generado por código.
- Las coordenadas y rotaciones de las cápsulas están fijas a propósito; no cambiar.
- Porosidad, grano y retención de cada capa (`MATERIALS` en `physics.js`) son valores
  típicos estimados, y la escala asume 1 unidad = 1 mm; conviene sustituirlos por los
  medidos en el prototipo.
