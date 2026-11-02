# Liftnote

Plugin de entrenamientos para [Obsidian](https://obsidian.md). Interfaz moderna (oscuro + violeta), optimizado para **iPhone** y escritorio.

Registra rutinas, series, descansos, historial y calendario. Todo se guarda como notas Markdown en tu bóveda.

## Características

- **Rutinas** — crea y edita plantillas de entrenamiento
- **Sesión en vivo** — peso, reps, check por serie y temporizador de descanso
- **Historial** — sesiones agrupadas por mes (`Entrenamiento/Historial/Octubre/`, etc.)
- **Calendario** — planifica días, marca descanso/enfermo y migra entrenamientos pasados
- **Progresión** — peso máximo y mejores series por ejercicio
- **Días especiales** — descanso (`😴`) y enfermo se guardan en el historial y se distinguen en el calendario

## Instalación

### Desde la comunidad (cuando esté aprobado)

1. Ajustes → Plugins de comunidad → Activar plugins de comunidad  
2. Explorar → busca **Liftnote** → Instalar → Activar  

### Instalación manual

1. Descarga el último release (ZIP)  
2. Extrae en: `<tu-bóveda>/.obsidian/plugins/liftnote/`  
3. Debe quedar así:
   ```
   .obsidian/plugins/liftnote/
   ├── manifest.json
   ├── main.js
   └── styles.css
   ```
4. Ajustes → Plugins de comunidad → activa **Liftnote**

## Uso rápido

1. Toca el icono de la **mancuerna** en la barra lateral  
2. Pestaña **Ejercicio** → elige o crea una rutina  
3. Durante el entreno: escribe peso y reps, marca el check, espera el descanso  
4. **Calendario** → toca días pasados para agregar historial o marcar descanso/enfermo  

Las notas se guardan en:

- `Entrenamiento/Rutinas/` — plantillas  
- `Entrenamiento/Historial/` — sesiones por mes  
- `Entrenamiento/Plantillas/` — plantillas opcionales  

## Requisitos

- Obsidian 1.5.0 o superior  
- Funciona en escritorio y móvil (iOS / Android)

## Autor

[Yohandys](https://github.com/yohandysbanguela-jpg)

## Licencia

MIT
