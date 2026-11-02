/*
  Liftnote — plugin original para Obsidian
  UI inspirada en trackers modernos de gimnasio (oscuro + violeta)
  Optimizado para iPhone / Obsidian móvil
  + Calendario con asignación manual de rutina por día
*/

const { Plugin, ItemView, Notice, Modal, Setting, MarkdownRenderer } = require("obsidian");

const VIEW_TYPE = "liftnote-view";
const PLUGIN_ID = "liftnote";

// ── Utilidades ──────────────────────────────────────────────────────────────
function hoyISO() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}
function horaAhora() {
  const d = new Date();
  return d.toTimeString().slice(0, 5);
}
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
function parseFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return { data: {}, body: text };
  const data = {};
  m[1].split("\n").forEach((line) => {
    const i = line.indexOf(":");
    if (i > 0) {
      const k = line.slice(0, i).trim();
      let v = line.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
        v = v.slice(1, -1);
      data[k] = v;
    }
  });
  return { data, body: text.slice(m[0].length).trim() };
}
function parseRutinaMD(text) {
  const { data, body } = parseFrontmatter(text);
  const ejercicios = [];
  let actual = null;
  body.split("\n").forEach((line) => {
    const h = line.match(/^##\s+(.+)/);
    if (h) {
      actual = { nombre: h[1].trim(), series: 3, reps: "8-12", peso: "", descanso: 90, notas: "" };
      ejercicios.push(actual);
      return;
    }
    if (!actual) return;
    const s = line.match(/series:\s*(\d+)/i);
    if (s) actual.series = parseInt(s[1], 10);
    const r = line.match(/reps:\s*(.+)/i);
    if (r) actual.reps = r[1].trim();
    const p = line.match(/peso:\s*(.+)/i);
    if (p) actual.peso = p[1].trim();
    const d = line.match(/descanso:\s*(\d+)/i);
    if (d) actual.descanso = parseInt(d[1], 10);
    const n = line.match(/notas:\s*(.+)/i);
    if (n) actual.notas = n[1].trim();
  });
  return {
    nombre: data.nombre || "Rutina",
    tipo: data.tipo || "planificada",
    ejercicios,
  };
}
function rutinaToMD(rutina) {
  let md = `---\nnombre: "${rutina.nombre}"\ntipo: ${rutina.tipo || "planificada"}\n---\n\n`;
  rutina.ejercicios.forEach((ej) => {
    md += `## ${ej.nombre}\n`;
    md += `- series: ${ej.series || 3}\n`;
    md += `- reps: ${ej.reps || "8-12"}\n`;
    if (ej.peso) md += `- peso: ${ej.peso}\n`;
    md += `- descanso: ${ej.descanso || 90}\n`;
    if (ej.notas) md += `- notas: ${ej.notas}\n`;
    md += `\n`;
  });
  return md;
}
function sesionToMD(sesion) {
  const u = lnNormUnidad(sesion.unidad || "kg");
  const uTxt = u === "lbs" ? "lbs" : "kg";
  let md = `---\nrutina: "${sesion.rutina}"\nfecha: ${sesion.fecha}\ninicio: ${sesion.inicio}\nfin: ${sesion.fin || ""}\nduracion_min: ${sesion.duracionMin || 0}\nunidad: ${uTxt}\n---\n\n`;
  sesion.ejercicios.forEach((ej) => {
    md += `## ${ej.nombre}\n`;
    ej.sets.forEach((s, i) => {
      if (s.hecho) {
        md += `- Serie ${i + 1}: ${s.peso || 0} ${uTxt} × ${s.reps || 0} reps\n`;
      } else if (s.saltada) {
        md += `- Serie ${i + 1}: saltada\n`;
      }
    });
    md += `\n`;
  });
  if (sesion.notas) md += `### Notas\n${sesion.notas}\n`;
  return md;
}

function formatVolumen(n, unidad = "kg") {
  if (!n || n === 0) return "—";
  if (n >= 1000) return (n / 1000).toFixed(1) + "k " + unidad;
  return Math.round(n) + " " + unidad;
}

/** Nombre del mes en español a partir de fecha YYYY-MM-DD */
function nombreMesES(fechaISO) {
  const MESES = [
    "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
  ];
  if (!fechaISO || fechaISO.length < 7) return "Sin fecha";
  const m = parseInt(fechaISO.slice(5, 7), 10);
  if (isNaN(m) || m < 1 || m > 12) return "Sin fecha";
  return MESES[m - 1];
}

/**
 * Detecta si un nombre de asignación es día especial.
 * @returns {"descanso"|"enfermo"|null}
 */
function tipoDiaEspecial(nombre) {
  const n = String(nombre || "").trim().toLowerCase();
  if (!n) return null;
  // Descanso: emoji, palabras clave
  if (
    n === "😴" || n === "💤" || n === "🛏" || n === "bed" ||
    /^(descanso|rest|off|día\s*libre|dia\s*libre|recovery|recuperación|recuperacion)$/i.test(n) ||
    /\bdescanso\b/.test(n)
  ) return "descanso";
  // Enfermo / lesión
  if (
    /enfermo|enfermedad|sick|ill|lesión|lesion|injured|injury|dolor|rehab/.test(n)
  ) return "enfermo";
  return null;
}

/** Normaliza etiqueta de unidad */
function lnNormUnidad(u) {
  const s = String(u || "kg").toLowerCase();
  if (s === "lb" || s === "lbs" || s === "libra" || s === "libras") return "lbs";
  return "kg";
}
function lnUnidadLabel(u) {
  return lnNormUnidad(u) === "lbs" ? "LB" : "KG";
}
/** Convierte un peso numérico entre kg y lbs. Devuelve string limpio. */
function lnConvertPeso(val, fromU, toU) {
  const from = lnNormUnidad(fromU);
  const to = lnNormUnidad(toU);
  if (from === to) return val;
  const n = parseFloat(String(val).replace(",", "."));
  if (isNaN(n) || n === 0) return val === 0 || val === "0" ? "0" : (val || "");
  let out;
  if (from === "kg" && to === "lbs") out = n * 2.2046226218;
  else out = n / 2.2046226218;
  // kg: 1 decimal; lbs: entero si >= 20, si no 1 decimal
  if (to === "kg") {
    out = Math.round(out * 10) / 10;
    return (Math.abs(out - Math.round(out)) < 1e-9) ? String(Math.round(out)) : out.toFixed(1);
  }
  out = Math.round(out * 10) / 10;
  if (out >= 20) return String(Math.round(out));
  return (Math.abs(out - Math.round(out)) < 1e-9) ? String(Math.round(out)) : out.toFixed(1);
}

// Beeps del temporizador (Web Audio — sin archivos externos)
let _lnAudioCtx = null;
function lnGetAudio() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!_lnAudioCtx) _lnAudioCtx = new AC();
    if (_lnAudioCtx.state === "suspended") _lnAudioCtx.resume();
    return _lnAudioCtx;
  } catch (_) {
    return null;
  }
}
function lnBeep({ freq = 880, dur = 0.12, type = "sine", vol = 0.25, when = 0 }) {
  const ctx = lnGetAudio();
  if (!ctx) return;
  const t0 = ctx.currentTime + when;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}
/** Click corto de UI (pestañas y botones de navegación) */
function lnClick() {
  try {
    // Click nítido y corto (estilo botón físico)
    lnBeep({ freq: 1400, dur: 0.035, type: "sine", vol: 0.18 });
    lnBeep({ freq: 900, dur: 0.025, type: "triangle", vol: 0.10, when: 0.012 });
  } catch (_) {}
}
/** Voz hablada del temporizador (Web Speech API) */
function lnSpeak(text) {
  try {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "es-ES";
    u.rate = 1.05;
    u.pitch = 1.0;
    u.volume = 1.0;
    // Preferir voz en español si existe
    const voices = window.speechSynthesis.getVoices() || [];
    const es = voices.find((v) => /es(-|_)?(ES|MX|US|AR)?/i.test(v.lang));
    if (es) u.voice = es;
    window.speechSynthesis.speak(u);
  } catch (_) {}
}
function lnSpeakCountdown(secLeft) {
  if (secLeft === 10) {
    lnSpeak("Quedan diez segundos");
    return;
  }
  const map = {
    5: "cinco",
    4: "cuatro",
    3: "tres",
    2: "dos",
    1: "uno",
  };
  if (map[secLeft]) lnSpeak(map[secLeft]);
}
function lnSpeakFinish() {
  // Voz del DESCANSO entre series (sesión de entrenamiento)
  lnSpeak("Descanso terminado");
  try {
    lnBeep({ freq: 880, dur: 0.15, type: "square", vol: 0.22, when: 0 });
    lnBeep({ freq: 1320, dur: 0.25, type: "square", vol: 0.25, when: 0.18 });
  } catch (_) {}
}
function lnSpeakTimeFinish() {
  // Voz del temporizador de EJERCICIOS POR TIEMPO (pestaña Tiempo)
  lnSpeak("Tiempo finalizado");
  try {
    lnBeep({ freq: 880, dur: 0.15, type: "square", vol: 0.22, when: 0 });
    lnBeep({ freq: 1320, dur: 0.25, type: "square", vol: 0.25, when: 0.18 });
  } catch (_) {}
}

// ── Iconos SVG premium (estilo line / SF Symbols) ───────────────────────────
const LN_ICONS = {
  inicio: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5L12 3l9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5"/></svg>`,
  ejercicio: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 8.5v7M17.5 8.5v7M4 10.5v3M20 10.5v3M6.5 12h11"/><rect x="2" y="9" width="2.5" height="6" rx="0.8"/><rect x="19.5" y="9" width="2.5" height="6" rx="0.8"/></svg>`,
  calendario: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M3 10h18M8 3v4M16 3v4"/><circle cx="8.5" cy="14.5" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="14.5" r="1" fill="currentColor" stroke="none"/><circle cx="15.5" cy="14.5" r="1" fill="currentColor" stroke="none"/></svg>`,
  progresion: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19V5M4 19h16"/><path d="M8 15v-3M12 15V9M16 15V6"/><path d="M8 12l4-3 4 2"/></svg>`,
  timer: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 1.5"/><path d="M9 3h6M12 3v2"/></svg>`,
};
function lnIcon(name) {
  return LN_ICONS[name] || "";
}

// ── Vista principal ─────────────────────────────────────────────────────────
class LiftnoteView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.tab = "inicio"; // "inicio" | "ejercicio" | "calendario" | "progresion" | "timer"
    this.calMonth = new Date(); // mes visible del calendario
    // Estado del temporizador (persiste al cambiar de pestaña)
    this.timerTotal = 90; // segundos por defecto (descanso)
    this.timerLeft = 90;
    this.timerRunning = false;
    this._timerInterval = null;
  }
  getViewType() {
    return VIEW_TYPE;
  }
  getDisplayText() {
    return "Liftnote";
  }
  getIcon() {
    return "dumbbell";
  }
  async onOpen() {
    await this.render();
  }
  async onClose() {}
  async render() {
    const root = this.containerEl.children[1];
    root.empty();
    root.addClass("ln-vista");

    // Tabs con iconos premium SVG: Inicio · Ejercicio · Calendario · Progresión · Tiempo
    const tabs = root.createDiv({ cls: "ln-tabs ln-tabs-icons" });
    const tabDefs = [
      { id: "inicio", label: "Inicio", iconKey: "inicio" },
      { id: "ejercicio", label: "Ejercicio", iconKey: "ejercicio" },
      { id: "calendario", label: "Calendario", iconKey: "calendario" },
      { id: "progresion", label: "Progresión", iconKey: "progresion" },
      { id: "timer", label: "Tiempo", iconKey: "timer" },
    ];
    tabDefs.forEach((t) => {
      const btn = tabs.createEl("button", {
        cls: "ln-tab ln-tab-icon" + (this.tab === t.id ? " active" : ""),
        attr: { "aria-label": t.label },
      });
      const ico = btn.createEl("span", { cls: "ln-tab-ico" });
      ico.innerHTML = lnIcon(t.iconKey);
      btn.createEl("span", { text: t.label, cls: "ln-tab-lbl" });
      btn.onclick = () => {
        lnClick();
        this.tab = t.id;
        this.render();
      };
    });

    if (this.tab === "inicio") {
      await this.renderHome(root);
      return;
    }
    if (this.tab === "ejercicio") {
      await this.renderEjercicio(root);
      return;
    }
    if (this.tab === "calendario") {
      await this.renderCalendario(root);
      return;
    }
    if (this.tab === "progresion") {
      await this.renderProgresion(root);
      return;
    }
    if (this.tab === "timer") {
      this.renderTemporizador(root);
      return;
    }
  }

  // ── Inicio: presentación premium ──────────────────────────────────────────
  async renderHome(root) {
    const hoy = new Date();
    const dias = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
    const meses = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
    const fechaTxt = `${hoy.getDate()} ${meses[hoy.getMonth()].toUpperCase()} · ${dias[hoy.getDay()].toUpperCase()}`;

    const rutinas = await this.plugin.listarRutinas();
    const hist = await this.plugin.listarHistorial(20);
    const sesionesMes = hist.filter((h) => (h.fecha || "").startsWith(hoyISO().slice(0, 7))).length;

    // Hero visual
    const hero = root.createDiv({ cls: "ln-hero" });
    const heroBg = hero.createDiv({ cls: "ln-hero-bg" });
    // Ilustración SVG abstracta (sin archivo externo)
    heroBg.innerHTML = `
      <svg class="ln-hero-art" viewBox="0 0 400 220" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <defs>
          <linearGradient id="lnG1" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#7c3aed"/>
            <stop offset="100%" stop-color="#22d3ee"/>
          </linearGradient>
          <linearGradient id="lnG2" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stop-color="#a78bfa" stop-opacity="0.2"/>
            <stop offset="100%" stop-color="#22d3ee" stop-opacity="0.05"/>
          </linearGradient>
        </defs>
        <rect width="400" height="220" fill="url(#lnG2)"/>
        <circle cx="320" cy="40" r="70" fill="#7c3aed" opacity="0.25"/>
        <circle cx="60" cy="180" r="50" fill="#22d3ee" opacity="0.15"/>
        <!-- mancuerna estilizada -->
        <g transform="translate(140,70)" fill="none" stroke="url(#lnG1)" stroke-width="8" stroke-linecap="round">
          <line x1="20" y1="40" x2="100" y2="40"/>
          <rect x="0" y="18" width="22" height="44" rx="6" fill="#a78bfa" stroke="none"/>
          <rect x="98" y="18" width="22" height="44" rx="6" fill="#22d3ee" stroke="none"/>
          <rect x="10" y="10" width="12" height="60" rx="4" fill="#c4b5fd" stroke="none" opacity="0.9"/>
          <rect x="108" y="10" width="12" height="60" rx="4" fill="#67e8f9" stroke="none" opacity="0.9"/>
        </g>
      </svg>
    `;

    const heroContent = hero.createDiv({ cls: "ln-hero-content" });
    heroContent.createEl("div", { text: "LIFTNOTE", cls: "ln-hero-brand" });
    heroContent.createEl("div", { text: fechaTxt, cls: "ln-hero-date" });
    heroContent.createEl("h1", { text: "Entrena con intención", cls: "ln-hero-title" });
    heroContent.createEl("p", {
      text: "Tu fuerza, tu ritmo. Elige una rutina y cierra el día más fuerte que ayer.",
      cls: "ln-hero-desc",
    });

    const cta = heroContent.createEl("button", {
      text: "ENTRENAR HOY  →",
      cls: "ln-btn ln-hero-cta",
    });
    cta.onclick = () => {
      lnClick();
      this.tab = "ejercicio";
      this.render();
    };

    // Stats rápidos
    const stats = root.createDiv({ cls: "ln-home-stats" });
    const s1 = stats.createDiv({ cls: "ln-stat" });
    s1.createEl("div", { text: String(rutinas.length), cls: "ln-stat-num" });
    s1.createEl("div", { text: "Rutinas", cls: "ln-stat-lbl" });
    const s2 = stats.createDiv({ cls: "ln-stat" });
    s2.createEl("div", { text: String(sesionesMes), cls: "ln-stat-num" });
    s2.createEl("div", { text: "Sesiones mes", cls: "ln-stat-lbl" });
    const s3 = stats.createDiv({ cls: "ln-stat" });
    s3.createEl("div", { text: String(hist.length), cls: "ln-stat-num" });
    s3.createEl("div", { text: "Historial", cls: "ln-stat-lbl" });

    // Accesos rápidos
    const quick = root.createDiv({ cls: "ln-home-quick" });
    quick.createEl("div", { text: "ACCESOS RÁPIDOS", cls: "ln-home-label" });
    const grid = quick.createDiv({ cls: "ln-home-grid" });
    const items = [
      { tab: "ejercicio", iconKey: "ejercicio", title: "Ejercicio", sub: "Tus rutinas" },
      { tab: "calendario", iconKey: "calendario", title: "Calendario", sub: "Planifica días" },
      { tab: "progresion", iconKey: "progresion", title: "Progresión", sub: "Pesos por mes" },
      { tab: "timer", iconKey: "timer", title: "Tiempo", sub: "Por tiempo" },
    ];
    items.forEach((it) => {
      const card = grid.createDiv({ cls: "ln-home-card" });
      const ico = card.createEl("div", { cls: "ln-home-card-ico" });
      ico.innerHTML = lnIcon(it.iconKey);
      card.createEl("div", { text: it.title, cls: "ln-home-card-title" });
      card.createEl("div", { text: it.sub, cls: "ln-home-card-sub" });
      card.onclick = () => {
        lnClick();
        this.tab = it.tab;
        this.render();
      };
    });
  }

  // ── Ejercicio: lista de rutinas ───────────────────────────────────────────
  async renderEjercicio(root) {
    const header = root.createDiv({ cls: "ln-page-head" });
    header.createEl("h1", { text: "Ejercicio", cls: "ln-page-title" });
    header.createEl("p", { text: "Tus rutinas de entrenamiento", cls: "ln-page-sub" });

    const actions = root.createDiv({ cls: "ln-actions ln-actions-premium" });
    const btnStart = actions.createEl("button", {
      text: "▶  Empezar entrenamiento",
      cls: "ln-btn ln-btn-primary ln-btn-lg ln-btn-glow",
    });
    btnStart.onclick = () => this.plugin.abrirSelectorRutina();

    const btnSearch = actions.createEl("button", {
      text: "🔍  Buscar ejercicio",
      cls: "ln-btn ln-btn-ghost ln-btn-outline",
    });
    btnSearch.onclick = () => this.plugin.abrirBuscadorEjercicios();

    const btnNew = actions.createEl("button", {
      text: "+  Nueva rutina",
      cls: "ln-btn ln-btn-ghost ln-btn-outline",
    });
    btnNew.onclick = () => this.plugin.crearRutina();

    const section = root.createDiv({ cls: "ln-section" });
    const secHead = section.createDiv({ cls: "ln-section-head" });
    secHead.createEl("h2", { text: "Tus rutinas", cls: "ln-section-title" });
    const list = section.createDiv({ cls: "ln-lista ln-lista-premium" });

    const rutinas = await this.plugin.listarRutinas();
    if (!rutinas.length) {
      const vacio = list.createDiv({ cls: "ln-vacio" });
      vacio.createEl("p", { text: "Aún no tienes rutinas." });
      const b = vacio.createEl("button", { text: "Crear la primera", cls: "ln-btn ln-btn-primary" });
      b.onclick = () => this.plugin.crearRutina();
    } else {
      secHead.createEl("span", { text: `${rutinas.length}`, cls: "ln-badge" });
      rutinas.forEach((r) => {
        const card = list.createDiv({ cls: "ln-card ln-card-premium" });
        const main = card.createDiv({ cls: "ln-card-main" });
        main.createEl("div", { text: r.nombre, cls: "ln-card-title" });
        main.createEl("div", { text: `${r.ejercicios.length} ejercicios`, cls: "ln-card-meta" });
        main.onclick = () => this.plugin.iniciarSesion(r);

        const row = card.createDiv({ cls: "ln-card-actions" });
        const play = row.createEl("button", { cls: "ln-icon-btn ln-icon-play", attr: { "aria-label": "Empezar" } });
        play.innerHTML = "▶";
        play.onclick = (e) => {
          e.stopPropagation();
          this.plugin.iniciarSesion(r);
        };
        const edit = row.createEl("button", { cls: "ln-icon-btn ln-icon-muted", attr: { "aria-label": "Editar" } });
        edit.innerHTML = "✎";
        edit.onclick = (e) => {
          e.stopPropagation();
          this.plugin.editarRutina(r);
        };
        const del = row.createEl("button", { cls: "ln-icon-btn ln-icon-danger", attr: { "aria-label": "Borrar" } });
        del.innerHTML = "🗑";
        del.onclick = (e) => {
          e.stopPropagation();
          this.plugin.borrarRutina(r);
        };
      });
    }
  }

  // ── Calendario ────────────────────────────────────────────────────────────
  async renderCalendario(root) {
    const asignaciones = this.plugin.settings.asignaciones || {};

    // Navegación de mes
    const nav = root.createDiv({ cls: "ln-cal-nav" });
    const prev = nav.createEl("button", { text: "‹", cls: "ln-icon-btn" });
    const title = nav.createEl("div", { cls: "ln-cal-title" });
    const next = nav.createEl("button", { text: "›", cls: "ln-icon-btn" });

    const meses = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
    title.setText(`${meses[this.calMonth.getMonth()]} ${this.calMonth.getFullYear()}`);

    prev.onclick = () => {
      this.calMonth = new Date(this.calMonth.getFullYear(), this.calMonth.getMonth() - 1, 1);
      this.render();
    };
    next.onclick = () => {
      this.calMonth = new Date(this.calMonth.getFullYear(), this.calMonth.getMonth() + 1, 1);
      this.render();
    };

    // Grid de días
    const grid = root.createDiv({ cls: "ln-cal-grid" });

    // Cabecera días de la semana
    const diasSemana = ["L", "M", "X", "J", "V", "S", "D"];
    diasSemana.forEach((d) => {
      grid.createDiv({ cls: "ln-cal-dow", text: d });
    });

    const year = this.calMonth.getFullYear();
    const month = this.calMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    // Lunes = 0
    let startOffset = firstDay.getDay() - 1;
    if (startOffset < 0) startOffset = 6;

    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const hoy = hoyISO();

    // Celdas vacías al inicio
    for (let i = 0; i < startOffset; i++) {
      grid.createDiv({ cls: "ln-cal-day empty" });
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const fecha = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const asignado = asignaciones[fecha] || "";
      const tipoEsp = tipoDiaEspecial(asignado);

      let cls = "ln-cal-day";
      if (fecha === hoy) cls += " today";
      if (asignado) cls += " has-data";
      if (tipoEsp === "descanso") cls += " rest-day";
      if (tipoEsp === "enfermo") cls += " sick-day";

      const cell = grid.createDiv({ cls });
      
      cell.createDiv({ cls: "ln-cal-num", text: String(day) });

      if (asignado) {
        const label = cell.createDiv({ cls: "ln-cal-routine" + (tipoEsp ? " ln-cal-special" : "") });
        label.setText(asignado);
      }

      // Toque → comportamiento según si es pasado / hoy / futuro
      cell.onclick = async () => {
        const sesiones = await this.plugin.obtenerSesionesPorFecha(fecha);
        const esPasado = fecha < hoy;
        const esEspecial = !!tipoDiaEspecial(asignado);

        if (sesiones.length > 0) {
          // Ya hay registro → verlo (y poder agregar otro si es pasado)
          new VerHistorialDiaModal(this.app, this.plugin, fecha, sesiones, esPasado).open();
        } else if (esPasado && !esEspecial) {
          // Día pasado sin registro de entrenamiento → menú para migrar datos
          // (si es descanso/enfermo solo se asigna, no se abre el form de series)
          new AgregarHistorialModal(this.app, this.plugin, fecha, () => this.render()).open();
        } else {
          // Hoy, futuro, o especial sin archivo → asignar / editar nombre
          new AsignarRutinaModal(this.app, this.plugin, fecha, asignado, () => this.render()).open();
        }
      };
    }

    // Ayuda
    const help = root.createDiv({ cls: "ln-cal-help" });
    help.createEl("p", {
      text: "Días pasados: toca para agregar o ver entrenamientos. Hoy y futuros: toca para planificar la rutina.",
      cls: "ln-muted",
    });
  }

  // ── Progresión ────────────────────────────────────────────────────────────
  async renderProgresion(root) {
    const section = root.createDiv({ cls: "ln-section" });
    section.createEl("h2", { text: "Progresión", cls: "ln-section-title" });
    section.createEl("p", {
      text: "Peso máximo por ejercicio y mes (se actualiza con tus sesiones).",
      cls: "ln-muted",
    });

    const data = await this.plugin.calcularProgresionEjercicios();
    const { ejercicios, meses, unidad } = data;

    if (!ejercicios.length || !meses.length) {
      const vacio = section.createDiv({ cls: "ln-vacio" });
      vacio.createEl("p", { text: "Aún no hay datos de progresión." });
      vacio.createEl("p", {
        text: "Completa entrenamientos y registra peso × reps. Aquí verás una tabla por mes.",
        cls: "ln-muted",
      });
      return;
    }

    // Tabla horizontal scrollable (estilo móvil)
    const wrap = section.createDiv({ cls: "ln-prog-wrap" });
    const table = wrap.createEl("table", { cls: "ln-prog-table" });

    const thead = table.createEl("thead");
    const hr = thead.createEl("tr");
    hr.createEl("th", { text: "Ejercicio", cls: "ln-prog-sticky" });
    meses.forEach((m) => {
      hr.createEl("th", { text: m.label });
    });

    const tbody = table.createEl("tbody");
    ejercicios.forEach((ej, idx) => {
      const tr = tbody.createEl("tr", { cls: idx % 2 === 0 ? "even" : "odd" });
      tr.createEl("td", { text: ej.nombre, cls: "ln-prog-sticky ln-prog-name" });
      meses.forEach((m) => {
        const cell = ej.porMes[m.key];
        let txt = "—";
        if (cell) {
          if (cell.min !== cell.max) {
            txt = `${cell.min} → ${cell.max}`;
          } else {
            txt = `${cell.max}`;
          }
          if (unidad) txt += ` ${unidad}`;
        }
        const td = tr.createEl("td", { text: txt });
        if (cell && cell.min !== cell.max) td.addClass("ln-prog-up");
      });
    });
  }

  // ── Temporizador premium ──────────────────────────────────────────────────
  renderTemporizador(root) {
    const box = root.createDiv({ cls: "ln-timer" });

    // Cabecera
    const head = box.createDiv({ cls: "ln-timer-head" });
    head.createEl("div", { text: "Temporizador", cls: "ln-timer-title" });
    head.createEl("div", { text: "Ejercicios por tiempo", cls: "ln-timer-sub" });

    // Barra de progreso que se reduce hacia el centro (ambos lados) + números grandes en los últimos 5s
    const ringWrap = box.createDiv({ cls: "ln-timer-ring-wrap" });

    // Barra horizontal superior (se encoge al centro desde ambos lados)
    const barWrap = ringWrap.createDiv({ cls: "ln-timer-bar-wrap" });
    const barTrack = barWrap.createDiv({ cls: "ln-timer-bar-track" });
    const barProgress = barTrack.createDiv({ cls: "ln-timer-bar-progress" });

    // Área central para el tiempo / números grandes del conteo final
    const timeEl = ringWrap.createDiv({ cls: "ln-timer-time" });
    const statusEl = box.createDiv({ cls: "ln-timer-status" });

    const format = (sec) => {
      const s = Math.max(0, Math.floor(sec));
      const m = Math.floor(s / 60);
      const r = s % 60;
      return `${m}:${String(r).padStart(2, "0")}`;
    };

    const updateUI = () => {
      const left = Math.max(0, Math.floor(this.timerLeft));
      const total = Math.max(1, this.timerTotal);
      const pct = left / total;

      // Barra: se reduce hacia el centro (width % centrado)
      barProgress.style.width = `${pct * 100}%`;

      // Últimos 5 segundos: números grandes como en el dibujo
      if (left <= 5 && left >= 1 && this.timerRunning) {
        timeEl.setText(String(left));
        timeEl.classList.add("ln-timer-countdown");
        ringWrap.classList.add("countdown");
      } else {
        timeEl.setText(format(this.timerLeft));
        timeEl.classList.remove("ln-timer-countdown");
        ringWrap.classList.remove("countdown");
      }

      if (this.timerRunning) {
        statusEl.setText("EN CURSO");
        statusEl.className = "ln-timer-status on";
        ringWrap.classList.add("running");
      } else if (this.timerLeft === 0) {
        statusEl.setText("FINALIZADO");
        statusEl.className = "ln-timer-status done";
        ringWrap.classList.remove("running");
        ringWrap.classList.remove("countdown");
        timeEl.classList.remove("ln-timer-countdown");
      } else if (this.timerLeft < this.timerTotal) {
        statusEl.setText("PAUSADO");
        statusEl.className = "ln-timer-status paused";
        ringWrap.classList.remove("running");
      } else {
        statusEl.setText("LISTO PARA EMPEZAR");
        statusEl.className = "ln-timer-status";
        ringWrap.classList.remove("running");
      }
    };

    const clearTick = () => {
      if (this._timerInterval) {
        clearInterval(this._timerInterval);
        this._timerInterval = null;
      }
    };

    const tick = () => {
      if (!this.timerRunning) return;
      this.timerLeft -= 1;
      // Voz: aviso a 10s y cuenta 5→1
      if (this.timerLeft === 10 || (this.timerLeft >= 1 && this.timerLeft <= 5)) {
        try { lnSpeakCountdown(this.timerLeft); } catch (_) {}
      }
      if (this.timerLeft <= 0) {
        this.timerLeft = 0;
        this.timerRunning = false;
        clearTick();
        try {
          lnSpeakTimeFinish();
          if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 400]);
        } catch (_) {}
        new Notice("⏰ Tiempo finalizado");
      }
      // Solo actualizar si seguimos en la pestaña timer
      if (this.tab === "timer") updateUI();
    };

    const start = () => {
      // iOS requiere gesto del usuario para activar audio/voz
      try {
        lnGetAudio();
        if (window.speechSynthesis) {
          window.speechSynthesis.getVoices();
          // desbloquear síntesis con un utterance vacío cancelado
          const warm = new SpeechSynthesisUtterance("");
          warm.volume = 0;
          window.speechSynthesis.speak(warm);
          window.speechSynthesis.cancel();
        }
      } catch (_) {}
      if (this.timerLeft <= 0) this.timerLeft = this.timerTotal;
      this.timerRunning = true;
      clearTick();
      this._timerInterval = setInterval(tick, 1000);
      updateUI();
    };

    const pause = () => {
      this.timerRunning = false;
      clearTick();
      updateUI();
    };

    const reset = () => {
      this.timerRunning = false;
      clearTick();
      this.timerLeft = this.timerTotal;
      updateUI();
    };

    const setDuration = (sec) => {
      this.timerTotal = sec;
      this.timerLeft = sec;
      this.timerRunning = false;
      clearTick();
      updateUI();
      // refrescar chips activos
      box.querySelectorAll(".ln-timer-chip").forEach((ch) => {
        ch.classList.toggle("active", parseInt(ch.dataset.sec, 10) === sec);
      });
    };

    // Presets rápidos
    const presets = box.createDiv({ cls: "ln-timer-presets" });
    presets.createEl("div", { text: "RÁPIDOS", cls: "ln-timer-label" });
    const chips = presets.createDiv({ cls: "ln-timer-chips" });
    [30, 60, 90, 120, 180, 300].forEach((sec) => {
      const label = sec < 60 ? `${sec}s` : `${sec / 60}:00`;
      const chip = chips.createEl("button", {
        text: label,
        cls: "ln-timer-chip" + (this.timerTotal === sec ? " active" : ""),
      });
      chip.dataset.sec = String(sec);
      chip.onclick = () => setDuration(sec);
    });

    // Ajuste fino (±15 s) — si está corriendo, suma/resta y continúa sin pausar
    const fine = box.createDiv({ cls: "ln-timer-fine" });
    const minus = fine.createEl("button", { text: "−15 s", cls: "ln-btn ln-btn-ghost" });
    const plus = fine.createEl("button", { text: "+15 s", cls: "ln-btn ln-btn-ghost" });

    const adjustTime = (delta) => {
      if (this.timerRunning) {
        // Mientras corre: ajustar el tiempo restante y el total, sin detener
        const newLeft = Math.max(1, this.timerLeft + delta);
        const newTotal = Math.max(newLeft, this.timerTotal + delta);
        this.timerLeft = newLeft;
        this.timerTotal = Math.min(1800, Math.max(15, newTotal));
        updateUI();
        // Actualizar chips activos si coincide con algún preset
        box.querySelectorAll(".ln-timer-chip").forEach((ch) => {
          ch.classList.toggle("active", parseInt(ch.dataset.sec, 10) === this.timerTotal);
        });
      } else {
        // Detenido: comportamiento normal (cambiar duración total)
        const next = Math.max(15, Math.min(1800, this.timerTotal + delta));
        setDuration(next);
      }
    };

    minus.onclick = () => adjustTime(-15);
    plus.onclick = () => adjustTime(15);

    // Controles principales
    const controls = box.createDiv({ cls: "ln-timer-controls" });
    const btnMain = controls.createEl("button", {
      text: this.timerRunning ? "Pausar" : "Empezar",
      cls: "ln-btn ln-btn-primary ln-btn-lg ln-timer-main",
    });
    const btnReset = controls.createEl("button", { text: "Reiniciar", cls: "ln-btn ln-btn-ghost" });

    btnMain.onclick = () => {
      if (this.timerRunning) {
        pause();
        btnMain.setText("Empezar");
      } else {
        start();
        btnMain.setText("Pausar");
      }
    };
    btnReset.onclick = () => {
      reset();
      btnMain.setText("Empezar");
    };

    // Si ya estaba corriendo al volver a la pestaña, reanudar interval
    if (this.timerRunning && !this._timerInterval) {
      this._timerInterval = setInterval(tick, 1000);
      btnMain.setText("Pausar");
    }

    updateUI();
  }
}

// ── Modal para asignar nombre de rutina a un día ────────────────────────────
class AsignarRutinaModal extends Modal {
  constructor(app, plugin, fecha, valorActual, onSave) {
    super(app);
    this.plugin = plugin;
    this.fecha = fecha;
    this.valorActual = valorActual || "";
    this.onSave = onSave;
  }

  onOpen() {
    const { contentEl, modalEl } = this;
    modalEl.addClass("ln-form-modal");
    contentEl.empty();
    contentEl.addClass("ln-form");

    const guardarNombre = async (nombre) => {
      if (!this.plugin.settings.asignaciones) this.plugin.settings.asignaciones = {};
      if (nombre) {
        this.plugin.settings.asignaciones[this.fecha] = nombre;
        // Si es descanso o enfermo → crear entrada en el historial automáticamente
        const tipo = tipoDiaEspecial(nombre);
        if (tipo) {
          await this.plugin.guardarDiaEspecial(this.fecha, nombre, tipo);
        }
      } else {
        delete this.plugin.settings.asignaciones[this.fecha];
      }
      await this.plugin.saveSettings();
      new Notice(nombre ? `Asignado: ${nombre}` : "Eliminado");
      this.close();
      if (this.onSave) this.onSave();
    };

    // Botones ARRIBA (no los tapa el teclado del iPhone)
    const actions = contentEl.createDiv({ cls: "ln-form-actions ln-form-actions-top" });
    const cancel = actions.createEl("button", { text: "Cancelar", cls: "ln-btn ln-btn-ghost" });
    cancel.onclick = () => this.close();
    const save = actions.createEl("button", { text: "Guardar", cls: "ln-btn ln-btn-primary" });

    // Contenedor scrollable
    const body = contentEl.createDiv({ cls: "ln-form-body" });

    body.createEl("h2", { text: "Rutina del día" });
    body.createEl("p", { text: this.fecha, cls: "ln-muted" });

    // Sugerencias desde settings (editables)
    const headerRow = body.createDiv({ cls: "ln-opciones-header" });
    headerRow.createEl("p", { text: "Elige una opción:", cls: "ln-muted", attr: { style: "margin: 12px 0 8px; font-size: 0.85em;" } });
    const editBtn = headerRow.createEl("button", { text: "Editar opciones", cls: "ln-btn-link" });
    editBtn.onclick = () => {
      new EditarOpcionesModal(this.app, this.plugin, () => {
        // Reabrir este modal para refrescar chips
        const fecha = this.fecha;
        const valor = this.valorActual;
        const onSave = this.onSave;
        this.close();
        setTimeout(() => {
          new AsignarRutinaModal(this.app, this.plugin, fecha, valor, onSave).open();
        }, 100);
      }).open();
    };

    const sugerencias = body.createDiv({ cls: "ln-sugerencias" });
    const ejemplos = (this.plugin.settings.opcionesRapidas && this.plugin.settings.opcionesRapidas.length)
      ? this.plugin.settings.opcionesRapidas
      : ["Descanso"];

    ejemplos.forEach((ej) => {
      const chip = sugerencias.createEl("button", { text: ej, cls: "ln-chip" });
      chip.onclick = () => guardarNombre(ej);
    });

    // Input opcional (sin autofocus)
    body.createEl("p", { text: "O escribe uno personalizado:", cls: "ln-muted", attr: { style: "margin: 16px 0 4px; font-size: 0.85em;" } });
    const input = body.createEl("input", {
      type: "text",
      cls: "ln-input ln-input-lg",
      value: this.valorActual,
      attr: { placeholder: "Ej. Pecho y tríceps" },
    });
    input.addEventListener("focus", () => {
      setTimeout(() => {
        input.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 300);
    });

    save.onclick = () => guardarNombre(input.value.trim());

    // Borrar (si ya había algo)
    if (this.valorActual) {
      const del = body.createEl("button", { text: "Quitar asignación", cls: "ln-btn ln-btn-danger ln-btn-sm" });
      del.style.marginTop = "8px";
      del.onclick = () => guardarNombre("");
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}

// ── Modal para editar opciones rápidas del calendario ───────────────────────
class EditarOpcionesModal extends Modal {
  constructor(app, plugin, onDone) {
    super(app);
    this.plugin = plugin;
    this.onDone = onDone;
    this.lista = [...(plugin.settings.opcionesRapidas || [])];
  }

  onOpen() {
    const { contentEl, modalEl } = this;
    modalEl.addClass("ln-form-modal");
    contentEl.empty();
    contentEl.addClass("ln-form");

    const actions = contentEl.createDiv({ cls: "ln-form-actions ln-form-actions-top" });
    const cancel = actions.createEl("button", { text: "Cancelar", cls: "ln-btn ln-btn-ghost" });
    cancel.onclick = () => this.close();
    const save = actions.createEl("button", { text: "Guardar", cls: "ln-btn ln-btn-primary" });
    save.onclick = async () => {
      const limpia = this.lista.map((s) => s.trim()).filter(Boolean);
      this.plugin.settings.opcionesRapidas = limpia;
      await this.plugin.saveSettings();
      new Notice("Opciones actualizadas");
      this.close();
      if (this.onDone) this.onDone();
    };

    const body = contentEl.createDiv({ cls: "ln-form-body" });
    body.createEl("h2", { text: "Editar opciones" });
    body.createEl("p", { text: "Agrega, cambia o quita las opciones rápidas del calendario.", cls: "ln-muted" });

    const list = body.createDiv({ cls: "ln-opciones-lista" });

    const renderLista = () => {
      list.empty();
      this.lista.forEach((item, i) => {
        const row = list.createDiv({ cls: "ln-opcion-row" });
        const input = row.createEl("input", {
          type: "text",
          cls: "ln-input",
          value: item,
          attr: { placeholder: "Nombre de la opción" },
        });
        input.oninput = () => { this.lista[i] = input.value; };
        const del = row.createEl("button", { text: "✕", cls: "ln-icon-btn ln-icon-danger" });
        del.onclick = () => {
          this.lista.splice(i, 1);
          renderLista();
        };
      });
    };
    renderLista();

    const add = body.createEl("button", { text: "+ Agregar opción", cls: "ln-btn ln-btn-ghost" });
    add.style.marginTop = "12px";
    add.onclick = () => {
      this.lista.push("");
      renderLista();
      // focus último input
      const inputs = list.querySelectorAll("input");
      if (inputs.length) inputs[inputs.length - 1].focus();
    };
  }

  onClose() {
    this.contentEl.empty();
  }
}

// ── Modal premium para agregar historial de días pasados ───────────────────
class AgregarHistorialModal extends Modal {
  constructor(app, plugin, fecha, onSave) {
    super(app);
    this.plugin = plugin;
    this.fecha = fecha;
    this.onSave = onSave;
    this.unidad = lnNormUnidad(plugin.settings.unidadPeso || "kg");
    this.rutinaNombre = "";
    this.duracionMin = "";
    this.ejercicios = [
      { nombre: "", series: [{ peso: "", reps: "" }, { peso: "", reps: "" }, { peso: "", reps: "" }] }
    ];
    this.nombresEjercicios = []; // lista de historial + rutinas
    this._sugerenciasEl = null;
  }

  async onOpen() {
    const { contentEl, modalEl } = this;
    modalEl.addClass("ln-form-modal");
    modalEl.addClass("ln-agregar-hist-modal");
    contentEl.empty();
    contentEl.addClass("ln-form");

    // Cargar nombres de ejercicios del historial y rutinas
    await this.cargarNombresEjercicios();

    // Fecha legible
    const [y, m, d] = this.fecha.split("-");
    const meses = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
    const fechaTxt = `${parseInt(d, 10)} de ${meses[parseInt(m, 10) - 1]} ${y}`;

    // Acciones arriba (iPhone-friendly)
    const actions = contentEl.createDiv({ cls: "ln-form-actions ln-form-actions-top" });
    const cancel = actions.createEl("button", { text: "Cancelar", cls: "ln-btn ln-btn-ghost" });
    cancel.onclick = () => this.close();
    const save = actions.createEl("button", { text: "Guardar", cls: "ln-btn ln-btn-primary" });
    save.onclick = () => this.guardar();

    const body = contentEl.createDiv({ cls: "ln-form-body" });
    this.bodyEl = body;

    // Header premium
    const header = body.createDiv({ cls: "ln-agregar-header" });
    header.createEl("div", { text: "Agregar entrenamiento", cls: "ln-agregar-title" });
    header.createEl("div", { text: fechaTxt, cls: "ln-agregar-fecha" });
    header.createEl("p", {
      text: "Ideal para migrar entrenamientos que ya tenías. Rápido y sencillo.",
      cls: "ln-muted ln-agregar-sub"
    });

    // Nombre de rutina
    body.createEl("label", { text: "Nombre de la rutina", cls: "ln-label" });
    const inputRutina = body.createEl("input", {
      type: "text",
      cls: "ln-input ln-input-lg",
      attr: { placeholder: "Ej. Pecho + Tríceps, Espalda + Bíceps…", enterkeyhint: "done" },
      value: this.rutinaNombre,
    });
    inputRutina.oninput = () => { this.rutinaNombre = inputRutina.value; };
    this._bindEnterBlur(inputRutina);

    // Chips rápidos
    const chips = body.createDiv({ cls: "ln-sugerencias" });
    const opciones = (this.plugin.settings.opcionesRapidas || []).filter((o) => o && !/😴|💤|Enfermo/i.test(o));
    opciones.slice(0, 8).forEach((op) => {
      const chip = chips.createEl("button", { text: op, cls: "ln-chip" });
      chip.onclick = () => {
        this.rutinaNombre = op;
        inputRutina.value = op;
        inputRutina.blur();
      };
    });

    // Duración opcional
    const durRow = body.createDiv({ cls: "ln-agregar-dur" });
    durRow.createEl("label", { text: "Duración (min)", cls: "ln-label" });
    const inputDur = durRow.createEl("input", {
      type: "number",
      cls: "ln-input",
      attr: { placeholder: "Opcional", min: "1", inputmode: "numeric", enterkeyhint: "done" },
      value: this.duracionMin,
    });
    inputDur.oninput = () => { this.duracionMin = inputDur.value; };
    this._bindEnterBlur(inputDur);

    // Ejercicios
    body.createEl("label", { text: "Ejercicios", cls: "ln-label", attr: { style: "margin-top: 18px;" } });
    this.ejsContainer = body.createDiv({ cls: "ln-agregar-ejs" });
    this.renderEjercicios();

    const addEj = body.createEl("button", { text: "+ Agregar ejercicio", cls: "ln-btn ln-btn-ghost ln-btn-block" });
    addEj.style.marginTop = "10px";
    addEj.onclick = () => {
      this.ocultarSugerencias();
      this.ejercicios.push({
        nombre: "",
        series: [{ peso: "", reps: "" }, { peso: "", reps: "" }, { peso: "", reps: "" }]
      });
      this.renderEjercicios();
    };

    // Cerrar sugerencias al tocar fuera
    contentEl.addEventListener("click", (e) => {
      if (!e.target.closest(".ln-agregar-ej-top") && !e.target.closest(".ln-sugerencias-drop")) {
        this.ocultarSugerencias();
      }
    });
  }

  async cargarNombresEjercicios() {
    const set = new Set();
    try {
      const data = await this.plugin.indexarEjerciciosHistorial();
      (data.ejercicios || []).forEach((e) => {
        if (e.nombre) set.add(e.nombre.trim());
      });
    } catch (_) {}
    try {
      const rutinas = await this.plugin.listarRutinas();
      for (const r of rutinas) {
        (r.ejercicios || []).forEach((ej) => {
          if (ej.nombre) set.add(ej.nombre.trim());
        });
      }
    } catch (_) {}
    this.nombresEjercicios = Array.from(set).sort((a, b) => a.localeCompare(b, "es"));
  }

  _bindEnterBlur(input) {
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        input.blur();
        this.ocultarSugerencias();
      }
    });
  }

  ocultarSugerencias() {
    if (this._sugerenciasEl) {
      this._sugerenciasEl.remove();
      this._sugerenciasEl = null;
    }
  }

  mostrarSugerencias(input, ej, filtro) {
    this.ocultarSugerencias();
    const q = (filtro || "").trim().toLowerCase();
    let lista = this.nombresEjercicios;
    if (q) {
      lista = lista.filter((n) => n.toLowerCase().includes(q));
    }
    // Máximo 8
    lista = lista.slice(0, 8);

    const drop = document.createElement("div");
    drop.className = "ln-sugerencias-drop";

    if (lista.length === 0) {
      const empty = document.createElement("div");
      empty.className = "ln-sugerencias-empty";
      empty.textContent = q
        ? "No hay coincidencias · escribe uno nuevo"
        : "Aún no hay ejercicios en tu historial · escribe el nombre";
      drop.appendChild(empty);
    } else {
      lista.forEach((nombre) => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "ln-sugerencias-item";
        item.textContent = nombre;
        item.onclick = (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          ej.nombre = nombre;
          input.value = nombre;
          input.blur();
          this.ocultarSugerencias();
        };
        drop.appendChild(item);
      });
    }

    // Posicionar debajo del input
    const wrap = input.parentElement;
    wrap.style.position = "relative";
    wrap.appendChild(drop);
    this._sugerenciasEl = drop;

    // Scroll para que se vea
    setTimeout(() => {
      drop.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 50);
  }

  renderEjercicios() {
    this.ejsContainer.empty();
    this.ocultarSugerencias();
    const uTxt = this.unidad === "lbs" ? "lbs" : "kg";

    this.ejercicios.forEach((ej, ei) => {
      const card = this.ejsContainer.createDiv({ cls: "ln-agregar-ej-card" });

      // Nombre + eliminar
      const top = card.createDiv({ cls: "ln-agregar-ej-top" });
      const nameInput = top.createEl("input", {
        type: "text",
        cls: "ln-input",
        attr: {
          placeholder: `Ejercicio ${ei + 1} · toca para elegir`,
          enterkeyhint: "done",
          autocomplete: "off",
          autocorrect: "off",
        },
        value: ej.nombre,
      });
      nameInput.oninput = () => {
        ej.nombre = nameInput.value;
        this.mostrarSugerencias(nameInput, ej, nameInput.value);
      };
      nameInput.onfocus = () => {
        this.mostrarSugerencias(nameInput, ej, nameInput.value);
        setTimeout(() => {
          nameInput.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 300);
      };
      // Enter → cierra teclado y sugerencias
      nameInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          // Si hay sugerencias visibles, tomar la primera
          if (this._sugerenciasEl) {
            const first = this._sugerenciasEl.querySelector(".ln-sugerencias-item");
            if (first && !nameInput.value.trim()) {
              first.click();
              return;
            }
          }
          nameInput.blur();
          this.ocultarSugerencias();
        }
      });

      if (this.ejercicios.length > 1) {
        const del = top.createEl("button", { text: "✕", cls: "ln-icon-btn ln-agregar-del" });
        del.onclick = () => {
          this.ejercicios.splice(ei, 1);
          this.renderEjercicios();
        };
      }

      // Series
      const seriesBox = card.createDiv({ cls: "ln-agregar-series" });
      ej.series.forEach((s, si) => {
        const row = seriesBox.createDiv({ cls: "ln-agregar-serie-row" });
        row.createEl("span", { text: `${si + 1}`, cls: "ln-agregar-serie-num" });

        const pesoIn = row.createEl("input", {
          type: "number",
          cls: "ln-input",
          attr: { placeholder: uTxt, inputmode: "decimal", step: "any", enterkeyhint: "next" },
          value: s.peso,
        });
        pesoIn.oninput = () => { s.peso = pesoIn.value; };
        this._bindEnterBlur(pesoIn);

        row.createEl("span", { text: "×", cls: "ln-agregar-x" });

        const repsIn = row.createEl("input", {
          type: "number",
          cls: "ln-input",
          attr: { placeholder: "reps", inputmode: "numeric", enterkeyhint: "done" },
          value: s.reps,
        });
        repsIn.oninput = () => { s.reps = repsIn.value; };
        this._bindEnterBlur(repsIn);
      });

      // Agregar / quitar serie
      const seriesActions = card.createDiv({ cls: "ln-agregar-serie-actions" });
      const addSerie = seriesActions.createEl("button", { text: "+ Serie", cls: "ln-btn-link" });
      addSerie.onclick = () => {
        ej.series.push({ peso: "", reps: "" });
        this.renderEjercicios();
      };
      if (ej.series.length > 1) {
        const rmSerie = seriesActions.createEl("button", { text: "− Quitar serie", cls: "ln-btn-link" });
        rmSerie.onclick = () => {
          ej.series.pop();
          this.renderEjercicios();
        };
      }
    });
  }

  async guardar() {
    const nombre = (this.rutinaNombre || "").trim();
    if (!nombre) {
      new Notice("Ponle un nombre a la rutina");
      return;
    }

    // Filtrar ejercicios y series válidas
    const ejerciciosLimpios = [];
    for (const ej of this.ejercicios) {
      const n = (ej.nombre || "").trim();
      if (!n) continue;
      const seriesValidas = ej.series
        .filter((s) => s.peso !== "" || s.reps !== "")
        .map((s) => ({
          peso: s.peso || "0",
          reps: s.reps || "0",
          hecho: true,
          saltada: false,
        }));
      if (seriesValidas.length === 0) continue;
      ejerciciosLimpios.push({ nombre: n, sets: seriesValidas });
    }

    if (!ejerciciosLimpios.length) {
      new Notice("Agrega al menos un ejercicio con series");
      return;
    }

    const sesion = {
      rutina: nombre,
      fecha: this.fecha,
      inicio: "",
      fin: "",
      duracionMin: this.duracionMin ? parseInt(this.duracionMin, 10) || 0 : 0,
      unidad: this.unidad,
      ejercicios: ejerciciosLimpios,
      notas: "",
    };

    await this.plugin.guardarSesion(sesion);

    // Actualizar también la asignación del calendario
    if (!this.plugin.settings.asignaciones) this.plugin.settings.asignaciones = {};
    this.plugin.settings.asignaciones[this.fecha] = nombre;
    await this.plugin.saveSettings();

    new Notice(`Guardado · ${nombre}`);
    this.close();
    if (this.onSave) this.onSave();
  }

  onClose() {
    this.contentEl.empty();
  }
}

// ── Modal ver registro del día (historial) ─────────────────────────────────
class VerHistorialDiaModal extends Modal {
  constructor(app, plugin, fecha, sesiones, esPasado = false) {
    super(app);
    this.plugin = plugin;
    this.fecha = fecha;
    this.sesiones = sesiones || [];
    this.esPasado = esPasado;
  }

  onOpen() {
    const { contentEl, modalEl } = this;
    modalEl.addClass("ln-form-modal");
    contentEl.empty();
    contentEl.addClass("ln-form");

    const actions = contentEl.createDiv({ cls: "ln-form-actions ln-form-actions-top" });
    const closeBtn = actions.createEl("button", { text: "Cerrar", cls: "ln-btn ln-btn-ghost" });
    closeBtn.onclick = () => this.close();

    // Botón para editar el nombre planeado del día
    const editBtn = actions.createEl("button", { text: "Editar nombre", cls: "ln-btn ln-btn-ghost" });
    editBtn.onclick = () => {
      this.close();
      const asignado = (this.plugin.settings.asignaciones || {})[this.fecha] || "";
      new AsignarRutinaModal(this.app, this.plugin, this.fecha, asignado, () => {
        this.plugin.refreshView();
      }).open();
    };

    // Solo en días pasados: poder agregar otro entrenamiento
    if (this.esPasado) {
      const addBtn = actions.createEl("button", { text: "+ Agregar", cls: "ln-btn ln-btn-primary ln-btn-sm" });
      addBtn.onclick = () => {
        this.close();
        new AgregarHistorialModal(this.app, this.plugin, this.fecha, () => {
          this.plugin.refreshView();
        }).open();
      };
    }

    const body = contentEl.createDiv({ cls: "ln-form-body" });

    // Título con fecha legible
    const [y, m, d] = this.fecha.split("-");
    const meses = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
    const fechaTxt = `${parseInt(d, 10)} ${meses[parseInt(m, 10) - 1]} ${y}`;
    body.createEl("h2", { text: "Registro del día" });
    body.createEl("p", { text: fechaTxt, cls: "ln-muted" });

    if (!this.sesiones.length) {
      body.createEl("p", { text: "No hay entrenamientos registrados este día.", cls: "ln-muted" });
      return;
    }

    this.sesiones.forEach((ses, idx) => {
      const card = body.createDiv({ cls: "ln-hist-card" });
      card.createEl("div", { text: ses.nombre, cls: "ln-hist-title" });

      const meta = card.createDiv({ cls: "ln-hist-meta" });
      if (ses.inicio || ses.fin) {
        meta.createEl("span", { text: `${ses.inicio || "—"} → ${ses.fin || "—"}` });
      }
      if (ses.duracionMin) {
        meta.createEl("span", { text: ` · ${ses.duracionMin} min` });
      }
      if (ses.unidad) {
        meta.createEl("span", { text: ` · ${ses.unidad}` });
      }

      // Parsear ejercicios del body
      const ejercicios = this.parseBody(ses.body);
      if (ejercicios.length) {
        const list = card.createDiv({ cls: "ln-hist-ejs" });
        ejercicios.forEach((ej) => {
          const ejBox = list.createDiv({ cls: "ln-hist-ej" });
          ejBox.createEl("div", { text: ej.nombre, cls: "ln-hist-ej-name" });
          ej.series.forEach((s) => {
            ejBox.createEl("div", { text: s, cls: "ln-hist-serie" });
          });
        });
      } else if (ses.body) {
        // Fallback: mostrar el markdown crudo limpio
        const pre = card.createEl("pre", { cls: "ln-hist-raw" });
        pre.setText(ses.body);
      }
    });
  }

  parseBody(body) {
    if (!body) return [];
    const ejercicios = [];
    let actual = null;
    body.split("\n").forEach((line) => {
      const h = line.match(/^##\s+(.+)/);
      if (h) {
        actual = { nombre: h[1].trim(), series: [] };
        ejercicios.push(actual);
        return;
      }
      if (actual && line.trim().startsWith("-")) {
        actual.series.push(line.replace(/^-\s*/, "").trim());
      }
    });
    return ejercicios;
  }

  onClose() {
    this.contentEl.empty();
  }
}

// ── Modal buscador de ejercicios (progresión individual) ───────────────────
class BuscadorEjerciciosModal extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    this.ejercicios = [];
    this.unidad = "kg";
    this.query = "";
  }

  async onOpen() {
    const { contentEl, modalEl } = this;
    modalEl.addClass("ln-form-modal");
    modalEl.addClass("ln-search-modal");
    contentEl.empty();
    contentEl.addClass("ln-form");
    contentEl.addClass("ln-search-form");

    // Cabecera fija: Cerrar + título + buscador (siempre visible encima del teclado)
    const header = contentEl.createDiv({ cls: "ln-search-header" });
    const actions = header.createDiv({ cls: "ln-form-actions ln-form-actions-top" });
    const closeBtn = actions.createEl("button", { text: "Cerrar", cls: "ln-btn ln-btn-ghost" });
    closeBtn.onclick = () => {
      try { this.inputEl && this.inputEl.blur(); } catch (_) {}
      this.close();
    };

    header.createEl("h2", { text: "Buscar ejercicio", cls: "ln-search-title" });
    header.createEl("p", {
      text: "Escribe para filtrar · Enter para ocultar teclado",
      cls: "ln-muted ln-search-sub",
    });

    const searchWrap = header.createDiv({ cls: "ln-search-wrap" });
    const input = searchWrap.createEl("input", {
      cls: "ln-search-input",
      attr: {
        type: "search",
        placeholder: "Ej. press de banca, sentadilla…",
        autocomplete: "off",
        autocapitalize: "off",
        enterkeyhint: "search",
        inputmode: "search",
      },
    });
    this.inputEl = input;

    // Zona scrollable de resultados (debajo del header fijo)
    const body = contentEl.createDiv({ cls: "ln-form-body ln-search-body" });
    this.listEl = body.createDiv({ cls: "ln-search-results" });
    this.detailEl = body.createDiv({ cls: "ln-search-detail" });
    this.detailEl.style.display = "none";

    this.listEl.createEl("p", { text: "Cargando ejercicios…", cls: "ln-muted" });
    try {
      const data = await this.plugin.indexarEjerciciosHistorial();
      this.ejercicios = data.ejercicios;
      this.unidad = data.unidad === "lbs" ? "lbs" : "kg";
    } catch (_) {
      this.ejercicios = [];
    }

    input.oninput = () => {
      this.query = (input.value || "").trim().toLowerCase();
      this.renderList();
    };

    // Enter / Buscar en teclado iPhone → ocultar teclado y dejar ver resultados
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.keyCode === 13) {
        e.preventDefault();
        try { input.blur(); } catch (_) {}
      }
    });
    // Algunos teclados iOS disparan "search" en type=search
    input.addEventListener("search", () => {
      try { input.blur(); } catch (_) {}
    });

    this.renderList();

    setTimeout(() => {
      try { input.focus(); } catch (_) {}
    }, 150);
  }

  renderList() {
    this.listEl.empty();
    this.detailEl.style.display = "none";
    this.listEl.style.display = "";

    if (!this.ejercicios.length) {
      this.listEl.createEl("p", {
        text: "Aún no hay ejercicios registrados en el historial.",
        cls: "ln-muted",
      });
      return;
    }

    const q = this.query;
    const filtered = q
      ? this.ejercicios.filter((e) => e.nombre.toLowerCase().includes(q))
      : this.ejercicios;

    if (!filtered.length) {
      this.listEl.createEl("p", {
        text: `Ningún ejercicio coincide con “${this.query}”.`,
        cls: "ln-muted",
      });
      return;
    }

    // Mostrar máximo ~40 para no saturar
    filtered.slice(0, 40).forEach((ej) => {
      const item = this.listEl.createEl("button", { cls: "ln-selector-item" });
      const left = item.createDiv({ cls: "ln-selector-item-left" });
      left.createEl("div", { text: ej.nombre, cls: "ln-selector-item-title" });
      const maxTxt = ej.maxPeso
        ? `Máx ${this.fmtPeso(ej.maxPeso)} ${this.unidad}`
        : "Sin pesos";
      left.createEl("div", { text: maxTxt, cls: "ln-selector-item-meta" });
      const arrow = item.createDiv({ cls: "ln-selector-item-play" });
      arrow.setText("→");
      item.onclick = () => this.showDetail(ej);
    });

    if (filtered.length > 40) {
      this.listEl.createEl("p", {
        text: `Mostrando 40 de ${filtered.length}. Afina la búsqueda.`,
        cls: "ln-muted",
      });
    }
  }

  showDetail(ej) {
    try { this.inputEl && this.inputEl.blur(); } catch (_) {}
    this.listEl.style.display = "none";
    this.detailEl.style.display = "";
    this.detailEl.empty();

    // Scroll al inicio del área de resultados
    const body = this.contentEl.querySelector(".ln-search-body");
    if (body) body.scrollTop = 0;

    // Volver
    const back = this.detailEl.createEl("button", {
      text: "← Volver a resultados",
      cls: "ln-btn ln-btn-ghost",
    });
    back.style.marginBottom = "12px";
    back.onclick = () => this.renderList();

    this.detailEl.createEl("h3", { text: ej.nombre, cls: "ln-search-detail-title" });

    // Resumen máximo
    const summary = this.detailEl.createDiv({ cls: "ln-hist-card" });
    summary.createEl("div", { text: "Progresión", cls: "ln-hist-ej-name" });

    if (ej.maxPeso) {
      summary.createEl("div", {
        text: `Peso máximo: ${this.fmtPeso(ej.maxPeso)} ${this.unidad}`,
        cls: "ln-hist-serie",
      });
    }
    if (ej.mejorSerie) {
      const ms = ej.mejorSerie;
      const fechaTxt = ms.fecha ? ` (${ms.fecha})` : "";
      summary.createEl("div", {
        text: `Mejor serie: ${this.fmtPeso(ms.peso)} ${this.unidad} × ${ms.reps} reps${fechaTxt}`,
        cls: "ln-hist-serie",
      });
    }

    // Historial reciente
    if (ej.sesiones && ej.sesiones.length) {
      const histTitle = this.detailEl.createEl("p", {
        text: "Últimas sesiones",
        cls: "ln-muted",
      });
      histTitle.style.margin = "16px 0 8px";
      histTitle.style.fontWeight = "700";

      ej.sesiones.forEach((ses) => {
        const card = this.detailEl.createDiv({ cls: "ln-hist-card" });
        card.createEl("div", {
          text: ses.fecha || "Sin fecha",
          cls: "ln-hist-title",
        });
        const list = card.createDiv({ cls: "ln-hist-ejs" });
        ses.series.forEach((s, i) => {
          list.createEl("div", {
            text: `Serie ${i + 1}: ${this.fmtPeso(s.peso)} ${this.unidad} × ${s.reps} reps`,
            cls: "ln-hist-serie",
          });
        });
      });
    }
  }

  fmtPeso(n) {
    if (n == null || isNaN(n)) return "—";
    return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, "");
  }

  onClose() {
    this.contentEl.empty();
  }
}

// ── Modal selector de rutina (botón Empezar entrenamiento) ─────────────────
class SelectorRutinaModal extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
  }

  async onOpen() {
    const { contentEl, modalEl } = this;
    modalEl.addClass("ln-form-modal");
    contentEl.empty();
    contentEl.addClass("ln-form");

    // Botón cerrar arriba
    const actions = contentEl.createDiv({ cls: "ln-form-actions ln-form-actions-top" });
    const cancel = actions.createEl("button", { text: "Cerrar", cls: "ln-btn ln-btn-ghost" });
    cancel.onclick = () => this.close();

    const body = contentEl.createDiv({ cls: "ln-form-body" });
    body.createEl("h2", { text: "Empezar entrenamiento" });
    body.createEl("p", { text: "Elige la rutina que vas a hacer", cls: "ln-muted" });

    const list = body.createDiv({ cls: "ln-selector-list" });

    const rutinas = await this.plugin.listarRutinas();
    if (!rutinas.length) {
      const vacio = list.createDiv({ cls: "ln-vacio" });
      vacio.createEl("p", { text: "Aún no tienes rutinas." });
      const b = vacio.createEl("button", { text: "Crear la primera", cls: "ln-btn ln-btn-primary" });
      b.onclick = () => {
        this.close();
        this.plugin.crearRutina();
      };
      return;
    }

    rutinas.forEach((r) => {
      const item = list.createEl("button", { cls: "ln-selector-item" });
      const left = item.createDiv({ cls: "ln-selector-item-left" });
      left.createEl("div", { text: r.nombre, cls: "ln-selector-item-title" });
      left.createEl("div", { text: `${r.ejercicios.length} ejercicios`, cls: "ln-selector-item-meta" });
      const play = item.createDiv({ cls: "ln-selector-item-play" });
      play.setText("▶");
      item.onclick = () => {
        this.close();
        this.plugin.iniciarSesion(r);
      };
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}

// ── Modal sesión (estilo Hevy) ──────────────────────────────────────────────
class SesionModal extends Modal {
  constructor(app, plugin, rutina) {
    super(app);
    this.plugin = plugin;
    this.rutina = rutina;
    this.inicio = Date.now();
    this.inicioHora = horaAhora();
    this.ejIdx = 0;
    this.timerId = null;
    this.restLeft = 0;
    this.restTotal = 0;
    this.unidad = lnNormUnidad(plugin.settings.unidadPeso || "kg");
    this.sesion = {
      rutina: rutina.nombre,
      fecha: hoyISO(),
      inicio: this.inicioHora,
      unidad: this.unidad,
      ejercicios: rutina.ejercicios.map((ej) => ({
        nombre: ej.nombre,
        sets: Array.from({ length: ej.series || 3 }, () => ({
          peso: ej.peso || "",
          reps: "",
          hecho: false,
          saltada: false,
        })),
        descanso: ej.descanso || plugin.settings.descansoDefault || 90,
        notas: ej.notas || "",
      })),
    };
  }

  onOpen() {
    const { contentEl, modalEl } = this;
    modalEl.addClass("ln-sesion-modal");
    contentEl.empty();
    contentEl.addClass("ln-sesion");
    this.renderSesion();
  }

  onClose() {
    if (this.timerId) clearInterval(this.timerId);
    const { contentEl } = this;
    contentEl.empty();
  }

  renderSesion() {
    const el = this.contentEl;
    el.empty();

    // Top bar
    const top = el.createDiv({ cls: "ln-sesion-top" });
    const back = top.createEl("button", { text: "✕", cls: "ln-icon-btn" });
    back.onclick = () => {
      if (confirm("¿Salir del entrenamiento? Se perderá el progreso no guardado.")) this.close();
    };
    top.createEl("div", { text: this.rutina.nombre, cls: "ln-sesion-title" });
    const finish = top.createEl("button", { text: "Terminar", cls: "ln-btn ln-btn-primary ln-btn-sm" });
    finish.onclick = () => this.terminar();

    // ── Pantalla de DESCANSO (concepto Gym Vault: tiempo grande + siguiente + CTA) ──
    if (this.restLeft > 0) {
      const total = Math.max(1, this.restTotal || this.restLeft);
      const nextInfo = this.getNextSetInfo();

      const rest = el.createDiv({ cls: "ln-rest-screen" });

      rest.createEl("div", { text: "DESCANSO", cls: "ln-rest-kicker" });

      // Reloj grande + anillo sutil
      const clockWrap = rest.createDiv({ cls: "ln-rest-clock-wrap" });
      const size = 210;
      const stroke = 8;
      const r = (size - stroke) / 2;
      const c = 2 * Math.PI * r;
      const pct = this.restLeft / total;
      const offset = c * (1 - pct);
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
      svg.setAttribute("class", "ln-rest-ring");
      svg.innerHTML = `
        <circle class="ln-rest-track" cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke-width="${stroke}"/>
        <circle class="ln-rest-progress" cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke-width="${stroke}"
          stroke-linecap="round" transform="rotate(-90 ${size/2} ${size/2})"
          stroke-dasharray="${c}" stroke-dashoffset="${offset}"/>
      `;
      clockWrap.appendChild(svg);
      const timeEl = clockWrap.createDiv({ cls: "ln-rest-clock" });
      timeEl.setText(this.fmtTime(this.restLeft));

      // Qué viene después
      if (nextInfo) {
        const nextBox = rest.createDiv({ cls: "ln-rest-next" });
        nextBox.createEl("div", { text: "SIGUIENTE", cls: "ln-rest-next-label" });
        nextBox.createEl("div", { text: nextInfo.nombre, cls: "ln-rest-next-name" });
        nextBox.createEl("div", { text: `Serie ${nextInfo.serie}/${nextInfo.total}`, cls: "ln-rest-next-set" });
      } else {
        rest.createEl("div", { text: "Última serie del ejercicio", cls: "ln-rest-next-done" });
      }

      // Acciones secundarias
      const side = rest.createDiv({ cls: "ln-rest-side" });
      const btnPlus = side.createEl("button", { text: "+30 s", cls: "ln-btn ln-btn-ghost" });
      const btnSkip = side.createEl("button", { text: "Saltar", cls: "ln-btn ln-btn-ghost" });
      btnPlus.onclick = () => {
        this.restLeft += 30;
        this.restTotal = (this.restTotal || total) + 30;
        this.renderSesion();
      };
      btnSkip.onclick = () => this.terminarDescanso();

      // CTA principal
      const go = rest.createEl("button", { text: "Continuar", cls: "ln-btn-go" });
      go.onclick = () => this.terminarDescanso();

      rest.createEl("p", { text: "Descansa. No hace falta mirar el celular.", cls: "ln-rest-hint" });
      return;
    }

    // Progreso ejercicios
    const progress = el.createDiv({ cls: "ln-progress" });
    this.sesion.ejercicios.forEach((_, i) => {
      const dot = progress.createDiv({ cls: "ln-dot" + (i === this.ejIdx ? " on" : "") + (this.ejCompleto(i) ? " done" : "") });
      dot.onclick = () => {
        this.ejIdx = i;
        this.renderSesion();
      };
    });

    const ej = this.sesion.ejercicios[this.ejIdx];
    if (!ej) return;

    // Nombre ejercicio
    const ejHead = el.createDiv({ cls: "ln-ej-head" });
    ejHead.createEl("h2", { text: ej.nombre });
    const navEj = ejHead.createDiv({ cls: "ln-ej-nav" });
    const prevEj = navEj.createEl("button", { text: "‹", cls: "ln-icon-btn", attr: { disabled: this.ejIdx === 0 ? "true" : null } });
    prevEj.onclick = () => {
      if (this.ejIdx > 0) {
        this.ejIdx--;
        this.renderSesion();
      }
    };
    const nextEj = navEj.createEl("button", { text: "›", cls: "ln-icon-btn", attr: { disabled: this.ejIdx >= this.sesion.ejercicios.length - 1 ? "true" : null } });
    nextEj.onclick = () => {
      if (this.ejIdx < this.sesion.ejercicios.length - 1) {
        this.ejIdx++;
        this.renderSesion();
      }
    };

    // Interruptor de unidad (kg ↔ lbs)
    const unitBar = el.createDiv({ cls: "ln-unit-bar" });
    unitBar.createEl("span", { text: "Unidad", cls: "ln-unit-bar-label" });
    const unitToggle = unitBar.createDiv({ cls: "ln-unit-toggle" });
    const btnKg = unitToggle.createEl("button", {
      text: "KG",
      cls: "ln-unit-btn" + (this.unidad === "kg" ? " active" : ""),
    });
    const btnLb = unitToggle.createEl("button", {
      text: "LB",
      cls: "ln-unit-btn" + (this.unidad === "lbs" ? " active" : ""),
    });
    const cambiarUnidad = async (to) => {
      const dest = lnNormUnidad(to);
      if (dest === this.unidad) return;
      const from = this.unidad;
      // Convertir todos los pesos de la sesión actual
      this.sesion.ejercicios.forEach((ej) => {
        ej.sets.forEach((s) => {
          if (s.peso !== "" && s.peso != null) {
            s.peso = lnConvertPeso(s.peso, from, dest);
          }
        });
      });
      this.unidad = dest;
      this.sesion.unidad = dest;
      this.plugin.settings.unidadPeso = dest;
      try { await this.plugin.saveSettings(); } catch (_) {}
      this.renderSesion();
    };
    btnKg.onclick = () => cambiarUnidad("kg");
    btnLb.onclick = () => cambiarUnidad("lbs");

    // Series
    const setsBox = el.createDiv({ cls: "ln-sets" });
    const cols = setsBox.createDiv({ cls: "ln-sets-header" });
    cols.createEl("span", { text: "#" });
    cols.createEl("span", { text: lnUnidadLabel(this.unidad) });
    cols.createEl("span", { text: "REPS" });
    cols.createEl("span", { text: "" });

    ej.sets.forEach((set, i) => {
      const row = setsBox.createDiv({ cls: "ln-set-row" + (set.hecho ? " done" : "") + (set.saltada ? " skipped" : "") });
      row.createEl("span", { text: String(i + 1), cls: "ln-set-num" });

      const pesoIn = row.createEl("input", { type: "number", cls: "ln-input", value: set.peso, attr: { inputmode: "decimal", placeholder: "0" } });
      pesoIn.oninput = () => {
        set.peso = pesoIn.value;
      };

      const repsIn = row.createEl("input", { type: "number", cls: "ln-input", value: set.reps, attr: { inputmode: "numeric", placeholder: "0" } });
      repsIn.oninput = () => {
        set.reps = repsIn.value;
      };

      const check = row.createEl("button", { cls: "ln-check-btn" + (set.hecho ? " on" : ""), attr: { "aria-label": "Marcar serie" } });
      check.innerHTML = set.hecho ? "✓" : "○";
      check.onclick = () => {
        set.hecho = !set.hecho;
        set.saltada = false;
        if (set.hecho) this.iniciarDescanso(ej.descanso);
        this.renderSesion();
      };
    });

    // Añadir serie
    const addSet = el.createEl("button", { text: "+ Añadir serie", cls: "ln-btn ln-btn-ghost ln-btn-sm" });
    addSet.onclick = () => {
      const last = ej.sets[ej.sets.length - 1];
      ej.sets.push({ peso: last ? last.peso : "", reps: "", hecho: false, saltada: false });
      this.renderSesion();
    };
  }

  /** Info de la próxima serie pendiente (mismo o siguiente ejercicio) */
  getNextSetInfo() {
    const ejercicios = this.sesion.ejercicios;
    // Primero busca en el ejercicio actual una serie sin hacer
    for (let i = this.ejIdx; i < ejercicios.length; i++) {
      const ej = ejercicios[i];
      for (let s = 0; s < ej.sets.length; s++) {
        if (!ej.sets[s].hecho && !ej.sets[s].saltada) {
          return { nombre: ej.nombre, serie: s + 1, total: ej.sets.length, ejIdx: i };
        }
      }
    }
    return null;
  }

  terminarDescanso() {
    this.restLeft = 0;
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
    this.renderSesion();
  }

  ejCompleto(i) {
    const ej = this.sesion.ejercicios[i];
    return ej && ej.sets.every((s) => s.hecho || s.saltada);
  }

  iniciarDescanso(seg) {
    if (this.timerId) clearInterval(this.timerId);
    const total = seg || this.plugin.settings.descansoDefault || 90;
    this.restTotal = total;
    this.restLeft = total;
    this.renderSesion();

    // Desbloquear audio/voz en iOS con interacción del usuario (el check)
    try {
      lnGetAudio();
      if (window.speechSynthesis) {
        const warm = new SpeechSynthesisUtterance("");
        warm.volume = 0;
        window.speechSynthesis.speak(warm);
        window.speechSynthesis.cancel();
      }
    } catch (_) {}

    this.timerId = setInterval(() => {
      this.restLeft--;
      // Cuenta regresiva hablada
      if (this.restLeft === 10 || (this.restLeft >= 1 && this.restLeft <= 5)) {
        try { lnSpeakCountdown(this.restLeft); } catch (_) {}
      }
      if (this.restLeft <= 0) {
        clearInterval(this.timerId);
        this.timerId = null;
        this.restLeft = 0;
        try { lnSpeakFinish(); } catch (_) {}
        try { new Notice("⏰ Descanso terminado"); } catch (_) {}
      }
      this.renderSesion();
    }, 1000);
  }

  fmtTime(s) {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${String(sec).padStart(2, "0")}`;
  }

  async terminar() {
    if (this.timerId) clearInterval(this.timerId);
    const fin = Date.now();
    this.sesion.fin = horaAhora();
    this.sesion.duracionMin = Math.round((fin - this.inicio) / 60000);
    await this.plugin.guardarSesion(this.sesion);

    // Auto-asignar el nombre de la rutina al día de hoy si no tiene
    const fecha = this.sesion.fecha;
    if (!this.plugin.settings.asignaciones) this.plugin.settings.asignaciones = {};
    if (!this.plugin.settings.asignaciones[fecha]) {
      this.plugin.settings.asignaciones[fecha] = this.sesion.rutina;
      await this.plugin.saveSettings();
    }

    new Notice("Sesión guardada");
    this.close();
    await this.plugin.refreshView();
  }
}

// ── Modal crear / editar rutina ─────────────────────────────────────────────
class RutinaModal extends Modal {
  constructor(app, plugin, rutina, path) {
    super(app);
    this.plugin = plugin;
    this.path = path;
    this.rutina = rutina
      ? JSON.parse(JSON.stringify(rutina))
      : {
          nombre: "",
          tipo: "planificada",
          ejercicios: [{ nombre: "", series: 3, reps: "8-12", peso: "", descanso: 90, notas: "" }],
        };
  }

  onOpen() {
    const { contentEl, modalEl } = this;
    modalEl.addClass("ln-form-modal");
    contentEl.empty();
    contentEl.addClass("ln-form");

    // Botones ARRIBA (no los tapa el teclado del iPhone)
    const actions = contentEl.createDiv({ cls: "ln-form-actions ln-form-actions-top" });
    const cancel = actions.createEl("button", { text: "Cancelar", cls: "ln-btn ln-btn-ghost" });
    cancel.onclick = () => this.close();
    const save = actions.createEl("button", { text: "Guardar", cls: "ln-btn ln-btn-primary" });
    save.onclick = async () => {
      if (!this.rutina.nombre.trim()) {
        new Notice("Ponle un nombre a la rutina");
        return;
      }
      await this.plugin.guardarRutina(this.rutina, this.path);
      new Notice("Rutina guardada");
      this.close();
      await this.plugin.refreshView();
    };

    // Contenedor scrollable (fixa el problema de no poder deslizar en iPhone)
    const body = contentEl.createDiv({ cls: "ln-form-body" });

    body.createEl("h2", { text: this.path ? "Editar rutina" : "Nueva rutina" });

    new Setting(body).setName("Nombre").addText((t) => {
      t.setValue(this.rutina.nombre).onChange((v) => (this.rutina.nombre = v));
    });

    const ejsBox = body.createDiv({ cls: "ln-ejs-box" });
    const renderEjs = () => {
      ejsBox.empty();
      this.rutina.ejercicios.forEach((ej, i) => {
        const card = ejsBox.createDiv({ cls: "ln-ej-card" });
        new Setting(card).setName(`Ejercicio ${i + 1}`).addText((t) => {
          t.setValue(ej.nombre).onChange((v) => (ej.nombre = v));
        });
        new Setting(card).setName("Series").addText((t) => {
          t.setValue(String(ej.series || 3)).onChange((v) => (ej.series = parseInt(v, 10) || 3));
        });
        new Setting(card).setName("Reps").addText((t) => {
          t.setValue(ej.reps || "8-12").onChange((v) => (ej.reps = v));
        });
        new Setting(card).setName("Peso sugerido").addText((t) => {
          t.setValue(ej.peso || "").onChange((v) => (ej.peso = v));
        });
        new Setting(card).setName("Descanso (seg)").addText((t) => {
          t.setValue(String(ej.descanso || 90)).onChange((v) => (ej.descanso = parseInt(v, 10) || 90));
        });
        const del = card.createEl("button", { text: "Eliminar", cls: "ln-btn ln-btn-ghost ln-btn-sm" });
        del.onclick = () => {
          this.rutina.ejercicios.splice(i, 1);
          renderEjs();
        };
      });
    };
    renderEjs();

    const add = body.createEl("button", { text: "+ Añadir ejercicio", cls: "ln-btn ln-btn-ghost" });
    add.onclick = () => {
      this.rutina.ejercicios.push({ nombre: "", series: 3, reps: "8-12", peso: "", descanso: 90, notas: "" });
      renderEjs();
    };

    // Borrar rutina completa (solo si ya existe)
    if (this.path) {
      const delRutina = body.createEl("button", {
        text: "Borrar esta rutina",
        cls: "ln-btn ln-btn-danger ln-btn-sm",
      });
      delRutina.style.marginTop = "16px";
      delRutina.onclick = async () => {
        await this.plugin.borrarRutina({ nombre: this.rutina.nombre, path: this.path });
        this.close();
      };
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}

// ── Plugin principal ────────────────────────────────────────────────────────
module.exports = class LiftnotePlugin extends Plugin {
  async onload() {
    this.settings = Object.assign(
      {
        carpetaRutinas: "Entrenamiento/Rutinas",
        carpetaHistorial: "Entrenamiento/Historial",
        carpetaPlantillas: "Entrenamiento/Plantillas",
        unidadPeso: "kg",
        descansoDefault: 90,
        asignaciones: {}, // { "2026-10-23": "Pecho y tríceps", ... }
        seedHecho: false,
        opcionesRapidas: ["Pecho y tríceps", "Espalda y bíceps", "Piernas", "Hombros", "Full Body", "Push", "Pull", "Descanso"],
      },
      await this.loadData()
    );

    await this.ensureFolders();

    // Migrar asignaciones de descanso/enfermo que aún no tienen archivo en historial
    await this.migrarDiasEspeciales();

    this.registerView(VIEW_TYPE, (leaf) => new LiftnoteView(leaf, this));

    this.addRibbonIcon("dumbbell", "Liftnote", () => this.activarVista());

    this.addCommand({
      id: "abrir-liftnote",
      name: "Abrir Liftnote",
      callback: () => this.activarVista(),
    });

    this.addCommand({
      id: "nueva-rutina",
      name: "Nueva rutina",
      callback: () => this.crearRutina(),
    });

    // Plantillas de ejemplo la primera vez
    await this.seedPlantillas();
  }

  /** Crea archivos de historial para días de descanso/enfermo ya asignados */
  async migrarDiasEspeciales() {
    const asigs = this.settings.asignaciones || {};
    for (const [fecha, nombre] of Object.entries(asigs)) {
      const tipo = tipoDiaEspecial(nombre);
      if (tipo) {
        try {
          await this.guardarDiaEspecial(fecha, nombre, tipo);
        } catch (_) {}
      }
    }
  }

  async onunload() {}

  async ensureFolders() {
    for (const f of [this.settings.carpetaRutinas, this.settings.carpetaHistorial, this.settings.carpetaPlantillas]) {
      if (!(await this.app.vault.adapter.exists(f))) {
        await this.app.vault.createFolder(f);
      }
    }
  }

  async seedPlantillas() {
    // Solo sembrar una vez en la vida del plugin. Si el usuario borra todo, no volver a crear.
    if (this.settings.seedHecho) return;

    const folder = this.settings.carpetaRutinas;
    const files = this.app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(folder + "/") || f.path.startsWith(folder + "\\") || f.path === folder);
    if (files.length > 0) {
      this.settings.seedHecho = true;
      await this.saveSettings();
      return;
    }

    const ejemplos = [
      {
        nombre: "Full Body",
        tipo: "planificada",
        ejercicios: [
          { nombre: "Sentadilla", series: 4, reps: "6-8", peso: "", descanso: 120, notas: "" },
          { nombre: "Press banca", series: 4, reps: "8-10", peso: "", descanso: 90, notas: "" },
          { nombre: "Remo con barra", series: 3, reps: "8-10", peso: "", descanso: 90, notas: "" },
          { nombre: "Press militar", series: 3, reps: "8-12", peso: "", descanso: 90, notas: "" },
          { nombre: "Peso muerto rumano", series: 3, reps: "8-10", peso: "", descanso: 120, notas: "" },
        ],
      },
      {
        nombre: "Push",
        tipo: "planificada",
        ejercicios: [
          { nombre: "Press banca", series: 4, reps: "6-8", peso: "", descanso: 120, notas: "" },
          { nombre: "Press inclinado mancuernas", series: 3, reps: "8-12", peso: "", descanso: 90, notas: "" },
          { nombre: "Press militar", series: 3, reps: "8-10", peso: "", descanso: 90, notas: "" },
          { nombre: "Elevaciones laterales", series: 3, reps: "12-15", peso: "", descanso: 60, notas: "" },
          { nombre: "Fondos", series: 3, reps: "8-12", peso: "", descanso: 90, notas: "" },
          { nombre: "Extensiones de tríceps", series: 3, reps: "10-12", peso: "", descanso: 60, notas: "" },
        ],
      },
    ];

    for (const r of ejemplos) {
      await this.guardarRutina(r, null);
    }
    this.settings.seedHecho = true;
    await this.saveSettings();
  }

  async activarVista() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = workspace.getRightLeaf(false);
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    workspace.revealLeaf(leaf);
  }

  async refreshView() {
    this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach((l) => {
      if (l.view && l.view.render) l.view.render();
    });
  }

  async listarRutinas() {
    const folder = this.settings.carpetaRutinas;
    const files = this.app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(folder + "/") || f.path.startsWith(folder + "\\"));
    const out = [];
    for (const f of files) {
      try {
        const text = await this.app.vault.read(f);
        const r = parseRutinaMD(text);
        r.path = f.path;
        r.nombre = r.nombre || f.basename;
        out.push(r);
      } catch (_) {}
    }
    return out.sort((a, b) => a.nombre.localeCompare(b.nombre));
  }

  async listarHistorial(limit = 10) {
    const folder = this.settings.carpetaHistorial;
    const files = this.app.vault
      .getMarkdownFiles()
      .filter((f) => f.path.startsWith(folder + "/") || f.path.startsWith(folder + "\\"))
      .sort((a, b) => b.stat.mtime - a.stat.mtime)
      .slice(0, limit);
    const out = [];
    for (const f of files) {
      try {
        const text = await this.app.vault.read(f);
        const { data } = parseFrontmatter(text);
        out.push({
          nombre: data.rutina || f.basename,
          fecha: data.fecha || "",
          duracionMin: data.duracion_min || "",
          path: f.path,
        });
      } catch (_) {}
    }
    return out;
  }

  /** Devuelve todas las sesiones completadas de una fecha (YYYY-MM-DD) */
  async obtenerSesionesPorFecha(fecha) {
    const folder = this.settings.carpetaHistorial;
    const files = this.app.vault
      .getMarkdownFiles()
      .filter((f) => f.path.startsWith(folder + "/") || f.path.startsWith(folder + "\\"));
    const out = [];
    for (const f of files) {
      try {
        const text = await this.app.vault.read(f);
        const { data, body } = parseFrontmatter(text);
        if (data.fecha === fecha) {
          out.push({
            nombre: (data.rutina || f.basename).trim(),
            fecha: data.fecha || "",
            inicio: data.inicio || "",
            fin: data.fin || "",
            duracionMin: data.duracion_min || "",
            unidad: data.unidad || "kg",
            body: body || "",
            path: f.path,
          });
        }
      } catch (_) {}
    }
    // Más reciente primero
    return out.sort((a, b) => (b.inicio || "").localeCompare(a.inicio || ""));
  }

  // Calcula volumen total (peso × reps) por día a partir del historial
  // Convierte todo a la unidad actual de settings para que sea comparable
  async calcularVolumenPorDia() {
    const folder = this.settings.carpetaHistorial;
    const destU = lnNormUnidad(this.settings.unidadPeso || "kg");
    const files = this.app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(folder + "/") || f.path.startsWith(folder + "\\"));
    const vol = {};
    for (const f of files) {
      try {
        const text = await this.app.vault.read(f);
        const { data, body } = parseFrontmatter(text);
        const fecha = data.fecha;
        if (!fecha) continue;
        const fileU = lnNormUnidad(data.unidad || "kg");
        let total = 0;
        const re = /Serie\s+\d+:\s*([\d.]+)\s*(kg|lbs|lb)?\s*[×x]\s*(\d+)\s*reps/gi;
        let m;
        while ((m = re.exec(body)) !== null) {
          let peso = parseFloat(m[1]);
          const lineU = lnNormUnidad(m[2] || fileU);
          if (lineU !== destU) {
            peso = parseFloat(lnConvertPeso(peso, lineU, destU)) || 0;
          }
          total += peso * parseInt(m[3], 10);
        }
        vol[fecha] = (vol[fecha] || 0) + total;
      } catch (_) {}
    }
    return vol;
  }

  // Progresión por ejercicio y mes (min/max peso de series hechas)
  async calcularProgresionEjercicios() {
    const folder = this.settings.carpetaHistorial;
    const unidad = this.settings.unidadPeso || "kg";
    const files = this.app.vault
      .getMarkdownFiles()
      .filter((f) => f.path.startsWith(folder + "/") || f.path.startsWith(folder + "\\"));

    // ejMap[nombreNormalizado] = { nombre, porMes: { "2026-07": {min, max} } }
    const ejMap = {};
    const mesSet = new Set();

    const reSerie = /Serie\s+\d+:\s*([\d.]+)\s*(kg|lbs|lb)?\s*[×x]\s*(\d+)\s*reps/gi;
    const reHeading = /^##\s+(.+)$/gm;

    for (const f of files) {
      try {
        const text = await this.app.vault.read(f);
        const { data, body } = parseFrontmatter(text);
        const fecha = data.fecha;
        if (!fecha || fecha.length < 7) continue;
        const mesKey = fecha.slice(0, 7); // YYYY-MM
        mesSet.add(mesKey);

        // Split by ## exercise headings
        const parts = body.split(/^##\s+/m).filter(Boolean);
        for (const part of parts) {
          const nl = part.indexOf("\n");
          const nombreRaw = (nl >= 0 ? part.slice(0, nl) : part).trim();
          if (!nombreRaw || nombreRaw.toLowerCase().startsWith("notas")) continue;
          const bloque = nl >= 0 ? part.slice(nl) : "";
          const pesos = [];
          let m;
          reSerie.lastIndex = 0;
          const fileU = lnNormUnidad(data.unidad || "kg");
          while ((m = reSerie.exec(bloque)) !== null) {
            let p = parseFloat(m[1]);
            // m[0] may include unit; extract from full match if present
            const um = /([\d.]+)\s*(kg|lbs|lb)?/i.exec(m[0]);
            const lineU = lnNormUnidad((um && um[2]) || fileU);
            if (!isNaN(p) && p > 0) {
              if (lineU !== lnNormUnidad(unidad)) {
                p = parseFloat(lnConvertPeso(p, lineU, unidad)) || p;
              }
              pesos.push(p);
            }
          }
          if (!pesos.length) continue;

          const key = nombreRaw.toLowerCase().replace(/\s+/g, " ").trim();
          if (!ejMap[key]) {
            ejMap[key] = { nombre: nombreRaw, porMes: {} };
          }
          const min = Math.min(...pesos);
          const max = Math.max(...pesos);
          const prev = ejMap[key].porMes[mesKey];
          if (!prev) {
            ejMap[key].porMes[mesKey] = { min, max };
          } else {
            prev.min = Math.min(prev.min, min);
            prev.max = Math.max(prev.max, max);
          }
        }
      } catch (_) {}
    }

    const mesNames = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
    const meses = [...mesSet]
      .sort()
      .slice(-6) // últimos 6 meses
      .map((key) => {
        const [y, mo] = key.split("-");
        const label = `${mesNames[parseInt(mo, 10) - 1]} ${String(y).slice(2)}`;
        return { key, label };
      });

    const ejercicios = Object.values(ejMap).sort((a, b) =>
      a.nombre.localeCompare(b.nombre, "es")
    );

    return { ejercicios, meses, unidad };
  }

  abrirSelectorRutina() {
    new SelectorRutinaModal(this.app, this).open();
  }

  abrirBuscadorEjercicios() {
    new BuscadorEjerciciosModal(this.app, this).open();
  }

  /**
   * Indexa todos los ejercicios del historial con:
   * - nombre, maxPeso, mejorSerie (peso × reps), historial reciente
   */
  async indexarEjerciciosHistorial() {
    const folder = this.settings.carpetaHistorial;
    const destU = lnNormUnidad(this.settings.unidadPeso || "kg");
    const files = this.app.vault
      .getMarkdownFiles()
      .filter((f) => f.path.startsWith(folder + "/") || f.path.startsWith(folder + "\\"))
      .sort((a, b) => b.stat.mtime - a.stat.mtime);

    const reSerie = /Serie\s+\d+:\s*([\d.]+)\s*(kg|lbs|lb)?\s*[×x]\s*(\d+)\s*reps/gi;
    // key → { nombre, maxPeso, mejorSerie: {peso, reps, fecha}, sesiones: [{fecha, series:[{peso,reps}]}] }
    const map = {};

    for (const f of files) {
      try {
        const text = await this.app.vault.read(f);
        const { data, body } = parseFrontmatter(text);
        const fecha = data.fecha || "";
        const fileU = lnNormUnidad(data.unidad || "kg");
        const parts = body.split(/^##\s+/m).filter(Boolean);

        for (const part of parts) {
          const nl = part.indexOf("\n");
          const nombreRaw = (nl >= 0 ? part.slice(0, nl) : part).trim();
          if (!nombreRaw || nombreRaw.toLowerCase().startsWith("notas")) continue;
          const bloque = nl >= 0 ? part.slice(nl) : "";
          const series = [];
          let m;
          reSerie.lastIndex = 0;
          while ((m = reSerie.exec(bloque)) !== null) {
            let p = parseFloat(m[1]);
            const lineU = lnNormUnidad(m[2] || fileU);
            if (!isNaN(p) && p > 0) {
              if (lineU !== destU) p = parseFloat(lnConvertPeso(p, lineU, destU)) || p;
              series.push({ peso: p, reps: parseInt(m[3], 10) || 0 });
            }
          }
          if (!series.length) continue;

          const key = nombreRaw.toLowerCase().replace(/\s+/g, " ").trim();
          if (!map[key]) {
            map[key] = {
              nombre: nombreRaw,
              maxPeso: 0,
              mejorSerie: null,
              sesiones: [],
            };
          }
          const entry = map[key];
          const maxHoy = Math.max(...series.map((s) => s.peso));
          if (maxHoy > entry.maxPeso) entry.maxPeso = maxHoy;

          // Mejor serie = mayor peso; empate → más reps
          for (const s of series) {
            if (
              !entry.mejorSerie ||
              s.peso > entry.mejorSerie.peso ||
              (s.peso === entry.mejorSerie.peso && s.reps > entry.mejorSerie.reps)
            ) {
              entry.mejorSerie = { peso: s.peso, reps: s.reps, fecha };
            }
          }

          // Guardar sesión (máx 12 recientes)
          if (entry.sesiones.length < 12) {
            entry.sesiones.push({
              fecha,
              series: series.map((s) => ({ ...s })),
            });
          }
        }
      } catch (_) {}
    }

    return {
      ejercicios: Object.values(map).sort((a, b) => a.nombre.localeCompare(b.nombre, "es")),
      unidad: destU,
    };
  }

  iniciarSesion(rutina) {
    new SesionModal(this.app, this, rutina).open();
  }

  crearRutina() {
    new RutinaModal(this.app, this, null, null).open();
  }

  editarRutina(rutina) {
    new RutinaModal(this.app, this, rutina, rutina.path).open();
  }

  async borrarRutina(rutina) {
    if (!rutina || !rutina.path) {
      new Notice("No se puede borrar esta rutina");
      return;
    }
    const ok = confirm(`¿Borrar la rutina "${rutina.nombre}"?\n\nEsta acción no se puede deshacer.`);
    if (!ok) return;
    const file = this.app.vault.getAbstractFileByPath(rutina.path);
    if (file) {
      await this.app.vault.delete(file);
      new Notice(`Rutina borrada: ${rutina.nombre}`);
      await this.refreshView();
    } else {
      new Notice("No se encontró el archivo de la rutina");
    }
  }

  async guardarRutina(rutina, path) {
    const md = rutinaToMD(rutina);
    if (path) {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file) await this.app.vault.modify(file, md);
    } else {
      const safe = rutina.nombre.replace(/[\\/:*?"<>|]/g, "-").trim() || "Rutina";
      let p = `${this.settings.carpetaRutinas}/${safe}.md`;
      let n = 1;
      while (await this.app.vault.adapter.exists(p)) {
        p = `${this.settings.carpetaRutinas}/${safe}-${n}.md`;
        n++;
      }
      await this.app.vault.create(p, md);
    }
  }

  async guardarSesion(sesion) {
    const safe = sesion.rutina.replace(/[\\/:*?"<>|]/g, "-").trim() || "Sesion";
    const name = `${sesion.fecha}-${safe}-${horaAhora().replace(":", "")}.md`;
    // Agrupar por mes: Entrenamiento/Historial/Octubre/archivo.md
    const mes = nombreMesES(sesion.fecha);
    const mesFolder = `${this.settings.carpetaHistorial}/${mes}`;
    if (!(await this.app.vault.adapter.exists(mesFolder))) {
      await this.app.vault.createFolder(mesFolder);
    }
    const path = `${mesFolder}/${name}`;
    await this.app.vault.create(path, sesionToMD(sesion));
  }

  /**
   * Guarda un día de descanso o enfermo en el historial (sin series).
   * Evita duplicados: si ya existe un archivo para esa fecha + tipo, no crea otro.
   */
  async guardarDiaEspecial(fecha, nombre, tipo) {
    const folder = this.settings.carpetaHistorial;
    const mes = nombreMesES(fecha);
    const mesFolder = `${folder}/${mes}`;
    if (!(await this.app.vault.adapter.exists(mesFolder))) {
      await this.app.vault.createFolder(mesFolder);
    }

    // ¿Ya hay un archivo especial para este día?
    const existentes = this.app.vault
      .getMarkdownFiles()
      .filter((f) => f.path.startsWith(mesFolder + "/") || f.path.startsWith(folder + "/"));
    for (const f of existentes) {
      try {
        const text = await this.app.vault.read(f);
        const { data } = parseFrontmatter(text);
        if (data.fecha === fecha && (data.tipo === tipo || tipoDiaEspecial(data.rutina) === tipo)) {
          // Actualizar nombre si cambió
          if (data.rutina !== nombre) {
            const nuevo = text.replace(/^rutina:\s*.+$/m, `rutina: "${nombre}"`);
            await this.app.vault.modify(f, nuevo);
          }
          return;
        }
      } catch (_) {}
    }

    const etiqueta = tipo === "enfermo" ? "Enfermo" : "Descanso";
    const emoji = tipo === "enfermo" ? "🤒" : "😴";
    const safe = String(nombre).replace(/[\\/:*?"<>|]/g, "-").trim() || etiqueta;
    const name = `${fecha}-${safe}.md`;
    const path = `${mesFolder}/${name}`;

    const md = `---
rutina: "${nombre}"
fecha: ${fecha}
tipo: ${tipo}
unidad: ${lnNormUnidad(this.settings.unidadPeso || "kg") === "lbs" ? "lbs" : "kg"}
---

${emoji} **${etiqueta}**

Sin entrenamiento este día.
`;
    await this.app.vault.create(path, md);
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
};
