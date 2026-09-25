/* rAAAA!king — calificando películas caga'o de miedo */
(() => {
  "use strict";

  const CONFIG = Object.assign({ tmdbKey: "", language: "es-MX" }, window.RAAAAKING_CONFIG || {});

  /* ------------------------------------------------------------------
   * Escala de miedo (de izquierda a derecha).
   * Para usar tus propios emojis en imagen, agrega `img` a cada nivel:
   *   { emoji: "😟", img: "emojis/nivel-1.png", name: "Un poco asustado" }
   * Si hay `img`, se muestra la imagen; si no, el emoji.
   * ------------------------------------------------------------------ */
  const FEAR_LEVELS = [
    { emoji: "😟", name: "Un poco asustado" },
    { emoji: "😨", name: "Asustado" },
    { emoji: "😰", name: "Sudando frío" },
    { emoji: "😱", name: "Gritando" },
    { emoji: "🥶", name: "Casi congelado" }
  ];

  const HORROR_GENRE_ID = 27;
  const API = "https://api.themoviedb.org/3";
  const IMG = "https://image.tmdb.org/t/p/";
  const KEYS = {
    ratings: "raaaaking.ratings.v1",
    draft: "raaaaking.draft.v1",
    tmdbKey: "raaaaking.tmdbKey",
    sort: "raaaaking.sort"
  };

  /* ---------- almacenamiento local (tolerante a errores) ---------- */
  const store = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); return true; }
      catch { return false; }
    },
    remove(key) { try { localStorage.removeItem(key); } catch { /* nada */ } }
  };

  /* ---------- utilidades ---------- */
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const levelInfo = (n) => FEAR_LEVELS[n - 1];

  function faceMarkup(level) {
    const info = levelInfo(level);
    if (!info) return "";
    return info.img
      ? `<img src="${esc(info.img)}" alt="">`
      : `<span aria-hidden="true">${info.emoji}</span>`;
  }

  function posterMarkup(path, title, { eager = false, big = false } = {}) {
    if (!path) return `<span class="no-poster">${esc(title)}</span>`;
    const small = big ? "w342" : "w185";
    const large = big ? "w500" : "w342";
    const sizes = big ? "(min-width: 800px) 320px, 112px" : "(max-width: 600px) 45vw, 190px";
    return `<img src="${IMG}${large}${path}"
      srcset="${IMG}${small}${path} ${small.slice(1)}w, ${IMG}${large}${path} ${large.slice(1)}w"
      sizes="${sizes}" alt="Afiche de ${esc(title)}"
      ${eager ? "" : 'loading="lazy"'} decoding="async">`;
  }

  function vibrate(ms) {
    try { if (navigator.vibrate) navigator.vibrate(ms); } catch { /* nada */ }
  }

  function restartAnimation(node, cls) {
    node.classList.remove(cls);
    void node.offsetWidth;
    node.classList.add(cls);
  }

  /* ---------- elementos ---------- */
  const el = {
    home: $("home"), rate: $("rate"),
    draftBanner: $("draftBanner"), draftTitle: $("draftTitle"), draftDetail: $("draftDetail"),
    draftResume: $("draftResume"), draftDiscard: $("draftDiscard"),
    keyPanel: $("keyPanel"), keyForm: $("keyForm"), keyInput: $("keyInput"), keyMsg: $("keyMsg"),
    searchForm: $("searchForm"), searchInput: $("searchInput"), searchStatus: $("searchStatus"),
    results: $("results"),
    ranking: $("ranking"), rankingEmpty: $("rankingEmpty"), rankingCount: $("rankingCount"),
    sortSelect: $("sortSelect"),
    backBtn: $("backBtn"), ratePoster: $("ratePoster"), rateTitle: $("rateTitle"),
    rateMeta: $("rateMeta"), rateGenres: $("rateGenres"),
    fearSet: $("fearSet"), fearFaces: $("fearFaces"), fearRange: $("fearRange"), fearValue: $("fearValue"),
    jumpBtn: $("jumpBtn"), jumpCount: $("jumpCount"), jumpUnit: $("jumpUnit"), jumpUndo: $("jumpUndo"),
    doneBtn: $("doneBtn"), doneHint: $("doneHint"), deleteBtn: $("deleteBtn"),
    keyToggle: $("keyToggle"), exportBtn: $("exportBtn"), importInput: $("importInput"), footerMsg: $("footerMsg")
  };

  /* ---------- estado ---------- */
  let ratings = store.get(KEYS.ratings, []);
  if (!Array.isArray(ratings)) ratings = [];
  let draft = store.get(KEYS.draft, null);
  if (!draft || !draft.movie) draft = null;
  let lastResults = [];
  let searchSeq = 0;
  let searchTimer = 0;
  let pendingHighlight = null;
  let deleteArmed = 0;

  const saveRatings = () => store.set(KEYS.ratings, ratings);
  const saveDraft = () => (draft ? store.set(KEYS.draft, draft) : store.remove(KEYS.draft));
  const findRating = (id) => ratings.find((r) => r.id === id);

  /* ================================================================
   * TMDB
   * ================================================================ */
  const getKey = () => (CONFIG.tmdbKey || store.get(KEYS.tmdbKey, "") || "").trim();

  class TmdbError extends Error {
    constructor(kind, status) { super(kind); this.kind = kind; this.status = status; }
  }

  async function tmdb(path, params = {}, key = getKey()) {
    if (!key) throw new TmdbError("nokey");
    const url = new URL(API + path);
    url.searchParams.set("language", CONFIG.language);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    const headers = { accept: "application/json" };
    // Los tokens v4 son JWT (empiezan con "eyJ"); las keys v3 van como parámetro.
    if (key.startsWith("eyJ")) headers.Authorization = `Bearer ${key}`;
    else url.searchParams.set("api_key", key);

    let res;
    try { res = await fetch(url, { headers }); }
    catch { throw new TmdbError("network"); }
    if (res.status === 401) throw new TmdbError("badkey", 401);
    if (!res.ok) throw new TmdbError("http", res.status);
    return res.json();
  }

  function errorText(err) {
    switch (err && err.kind) {
      case "nokey": return "Falta la key de TMDB. Pégala en el panel de arriba.";
      case "badkey": return "TMDB rechazó la key. Revísala en «Configurar TMDB», abajo.";
      case "network": return "No pude conectar con TMDB. Revisa tu internet y vuelve a intentar.";
      default: return `TMDB respondió con un error (${err && err.status}). Intenta de nuevo en un rato.`;
    }
  }

  function normalizeMovie(m) {
    return {
      id: m.id,
      title: m.title || m.original_title || "Sin título",
      originalTitle: m.original_title || "",
      year: (m.release_date || "").slice(0, 4),
      poster: m.poster_path || "",
      genreIds: Array.isArray(m.genre_ids) ? m.genre_ids : (m.genres || []).map((g) => g.id),
      genres: [],
      keywords: [],
      director: "",
      runtime: null
    };
  }

  const isHorror = (m) => (m.genreIds || []).includes(HORROR_GENRE_ID);

  /* ================================================================
   * Búsqueda
   * ================================================================ */
  function setStatus(text, isError = false) {
    el.searchStatus.textContent = text;
    el.searchStatus.classList.toggle("is-error", isError);
  }

  async function runSearch(query) {
    const q = query.trim();
    const seq = ++searchSeq;
    if (q.length < 2) {
      lastResults = [];
      renderResults();
      setStatus("");
      return;
    }
    if (!getKey()) {
      showKeyPanel(true);
      setStatus(errorText({ kind: "nokey" }), true);
      return;
    }
    setStatus(`Buscando «${q}»…`);
    try {
      const data = await tmdb("/search/movie", { query: q, include_adult: "false", page: "1" });
      if (seq !== searchSeq) return; // llegó una búsqueda más nueva
      const movies = (data.results || []).map(normalizeMovie);
      // Las de terror primero, manteniendo el orden de relevancia de TMDB.
      lastResults = movies.sort((a, b) => Number(isHorror(b)) - Number(isHorror(a)));
      renderResults();
      if (!lastResults.length) setStatus(`No encontré nada con «${q}». Prueba con el título original.`);
      else setStatus(`${plural(lastResults.length, "resultado", "resultados")}. Las de terror aparecen primero.`);
    } catch (err) {
      if (seq !== searchSeq) return;
      if (err.kind === "badkey" || err.kind === "nokey") showKeyPanel(true);
      setStatus(errorText(err), true);
    }
  }

  function renderResults() {
    el.results.hidden = lastResults.length === 0;
    el.results.innerHTML = lastResults.map((m) => {
      const rated = findRating(m.id);
      const badge = rated ? `<span class="badge" title="${esc(levelInfo(rated.level).name)}">${faceMarkup(rated.level)}</span>` : "";
      const tag = isHorror(m) ? `<span class="tag-horror">Terror</span>` : "";
      return `<li>
        <button class="card-hit" type="button" data-id="${m.id}" data-source="result">
          <span class="poster">${badge}<span class="poster-frame">${posterMarkup(m.poster, m.title)}${tag}</span></span>
          <span class="card-text">
            <span class="card-title">${esc(m.title)}</span>
            <span class="card-meta">${esc(m.year || "Sin año")}</span>
            <span class="card-cta${rated ? " is-rated" : ""}">${rated ? "Ya calificada · editar" : "Calificar"}</span>
          </span>
        </button>
      </li>`;
    }).join("");
  }

  /* ================================================================
   * Ranking
   * ================================================================ */
  function sortedRatings(mode) {
    const list = ratings.slice();
    if (mode === "recent") return list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    // Más miedo: nivel, luego saltos, luego la más reciente.
    return list.sort((a, b) =>
      (b.level - a.level) || (b.jumps - a.jumps) || ((b.updatedAt || 0) - (a.updatedAt || 0)));
  }

  function renderRanking() {
    const mode = el.sortSelect.value;
    const list = sortedRatings(mode);
    el.rankingEmpty.hidden = list.length > 0;
    el.rankingCount.textContent = list.length ? plural(list.length, "película", "películas") : "";
    el.ranking.innerHTML = list.map((r, i) => {
      const info = levelInfo(r.level);
      const rankNo = mode === "fear" ? `<span class="rank-no" aria-label="Puesto ${i + 1}">${i + 1}</span>` : "";
      return `<li class="rank-card" data-id="${r.id}">
        <button class="card-hit" type="button" data-id="${r.id}" data-source="rating">
          <span class="poster">
            <span class="badge" title="Nivel ${r.level} de 5: ${esc(info.name)}">${faceMarkup(r.level)}</span>
            <span class="poster-frame">${posterMarkup(r.poster, r.title)}${rankNo}</span>
          </span>
          <span class="card-text">
            <span class="card-title">${esc(r.title)}</span>
            <span class="card-meta">${esc(r.year || "Sin año")} · ${plural(r.jumps, "salto", "saltos")}</span>
            <span class="visually-hidden">Nivel de miedo ${r.level} de 5, ${esc(info.name)}</span>
          </span>
        </button>
      </li>`;
    }).join("");

    if (pendingHighlight != null) {
      const card = el.ranking.querySelector(`.rank-card[data-id="${pendingHighlight}"]`);
      pendingHighlight = null;
      if (card) {
        card.classList.add("just-saved");
        card.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  }

  function renderDraftBanner() {
    const hasProgress = draft && (draft.level || draft.jumps);
    el.draftBanner.hidden = !hasProgress;
    if (!hasProgress) return;
    el.draftTitle.textContent = draft.movie.title;
    const bits = [];
    if (draft.level) bits.push(`nivel ${draft.level}`);
    bits.push(plural(draft.jumps, "salto", "saltos"));
    el.draftDetail.textContent = `(${bits.join(", ")}).`;
  }

  /* ================================================================
   * Vistas
   * ================================================================ */
  function showHome() {
    el.rate.hidden = true;
    el.home.hidden = false;
    renderDraftBanner();
    renderResults();
    renderRanking();
    if (pendingHighlight == null) window.scrollTo(0, 0);
  }

  function showRate() {
    el.home.hidden = true;
    el.rate.hidden = false;
    renderRateView();
    window.scrollTo(0, 0);
  }

  function goHome() {
    if (history.state && history.state.view === "rate") history.back(); // popstate llama a showHome
    else showHome();
  }

  function openRate(movie, existing) {
    draft = {
      movie: { ...movie },
      level: existing ? existing.level : null,
      jumps: existing ? existing.jumps : 0,
      editing: Boolean(existing),
      ratedAt: existing ? existing.ratedAt : null
    };
    saveDraft();
    if (!(history.state && history.state.view === "rate")) {
      history.pushState({ view: "rate" }, "", "#calificar");
    }
    showRate();
    loadDetails(movie.id);
  }

  async function loadDetails(id) {
    if (!getKey()) return;
    try {
      const d = await tmdb(`/movie/${id}`, { append_to_response: "keywords,credits" });
      if (!draft || draft.movie.id !== id) return;
      const m = draft.movie;
      m.genres = (d.genres || []).map((g) => ({ id: g.id, name: g.name }));
      m.genreIds = m.genres.map((g) => g.id);
      m.keywords = ((d.keywords && d.keywords.keywords) || []).map((k) => ({ id: k.id, name: k.name }));
      m.director = ((d.credits && d.credits.crew) || [])
        .filter((p) => p.job === "Director").map((p) => p.name).join(", ");
      m.runtime = d.runtime || null;
      if (!m.poster && d.poster_path) m.poster = d.poster_path;
      saveDraft();
      if (!el.rate.hidden) renderRateInfo();
    } catch { /* sin detalles igual se puede calificar */ }
  }

  function renderRateView() {
    renderRateInfo();
    renderFear();
    renderJumps(false);
    el.deleteBtn.hidden = !draft.editing;
    disarmDelete();
  }

  function renderRateInfo() {
    const m = draft.movie;
    el.ratePoster.innerHTML = posterMarkup(m.poster, m.title, { eager: true, big: true });
    el.rateTitle.textContent = m.title;
    const meta = [];
    if (m.year) meta.push(m.year);
    if (m.director) meta.push(`Dirigida por ${m.director}`);
    if (m.runtime) meta.push(`${m.runtime} min`);
    if (m.originalTitle && m.originalTitle !== m.title) meta.push(`Título original: ${m.originalTitle}`);
    el.rateMeta.textContent = meta.join(" · ");
    el.rateGenres.innerHTML = (m.genres || []).map((g) =>
      `<li class="${g.id === HORROR_GENRE_ID ? "is-horror" : ""}">${esc(g.name)}</li>`).join("");
  }

  /* ---------- barra de miedo ---------- */
  function buildFaces() {
    el.fearFaces.innerHTML = FEAR_LEVELS.map((lvl, i) =>
      `<button type="button" class="face" data-level="${i + 1}" aria-pressed="false"
        aria-label="Nivel ${i + 1} de 5: ${esc(lvl.name)}" title="${esc(lvl.name)}">${faceMarkup(i + 1)}</button>`
    ).join("");
  }

  function renderFear() {
    const level = draft.level;
    el.fearSet.classList.toggle("unset", !level);
    if (level) el.fearRange.value = String(level);
    el.fearRange.setAttribute("aria-valuetext", level ? `${level} de 5, ${levelInfo(level).name}` : "Sin calificar");
    el.fearFaces.querySelectorAll(".face").forEach((b) =>
      b.setAttribute("aria-pressed", String(Number(b.dataset.level) === level)));
    el.fearValue.innerHTML = level
      ? `<strong>${level} de 5</strong> · ${esc(levelInfo(level).name)}`
      : "Toca una cara o mueve la barra.";
    el.doneBtn.disabled = !level;
    el.doneHint.textContent = level ? "" : "Elige cuánto te asustó para guardar.";
  }

  function setLevel(n) {
    if (!draft) return;
    const level = Math.min(5, Math.max(1, Number(n) || 1));
    draft.level = level;
    saveDraft();
    renderFear();
  }

  /* ---------- saltos ---------- */
  function renderJumps(animate) {
    el.jumpCount.textContent = String(draft.jumps);
    el.jumpUnit.textContent = draft.jumps === 1 ? "salto" : "saltos";
    el.jumpUndo.disabled = draft.jumps === 0;
    if (animate) restartAnimation(el.jumpCount, "bump");
  }

  function addJump(delta) {
    if (!draft) return;
    draft.jumps = Math.max(0, draft.jumps + delta);
    saveDraft();
    renderJumps(delta > 0);
    if (delta > 0) vibrate(40);
  }

  /* ---------- guardar / borrar ---------- */
  function finishRating() {
    if (!draft || !draft.level) return;
    const now = Date.now();
    const m = draft.movie;
    const record = {
      id: m.id,
      title: m.title,
      originalTitle: m.originalTitle,
      year: m.year,
      poster: m.poster,
      genreIds: m.genreIds || [],
      genres: m.genres || [],
      keywords: m.keywords || [],   // se guardan para el futuro filtro por subgénero
      director: m.director || "",
      runtime: m.runtime || null,
      level: draft.level,
      jumps: draft.jumps,
      ratedAt: draft.ratedAt || now,
      updatedAt: now
    };
    ratings = ratings.filter((r) => r.id !== record.id).concat(record);
    saveRatings();
    draft = null;
    saveDraft();
    // Al volver, se limpia la búsqueda para que se vea el ranking.
    el.searchInput.value = "";
    lastResults = [];
    setStatus("");
    pendingHighlight = record.id;
    goHome();
  }

  function disarmDelete() {
    clearTimeout(deleteArmed);
    deleteArmed = 0;
    el.deleteBtn.textContent = "Borrar esta calificación";
  }

  function deleteRating() {
    if (!draft) return;
    if (!deleteArmed) {
      el.deleteBtn.textContent = "¿Seguro? Toca otra vez para borrarla";
      deleteArmed = setTimeout(disarmDelete, 4000);
      return;
    }
    disarmDelete();
    ratings = ratings.filter((r) => r.id !== draft.movie.id);
    saveRatings();
    draft = null;
    saveDraft();
    goHome();
  }

  function movieFromRating(r) {
    return {
      id: r.id, title: r.title, originalTitle: r.originalTitle || "", year: r.year || "",
      poster: r.poster || "", genreIds: r.genreIds || [], genres: r.genres || [],
      keywords: r.keywords || [], director: r.director || "", runtime: r.runtime || null
    };
  }

  /* ================================================================
   * API key
   * ================================================================ */
  function showKeyPanel(show) {
    el.keyPanel.hidden = !show;
    if (show) {
      el.keyInput.placeholder = getKey()
        ? (CONFIG.tmdbKey ? "Hay una key en config.js" : "Ya hay una key guardada; pega otra para cambiarla")
        : "Pega tu key de TMDB";
    }
  }

  function setKeyMsg(text, kind) {
    el.keyMsg.textContent = text;
    el.keyMsg.classList.toggle("is-error", kind === "error");
    el.keyMsg.classList.toggle("is-ok", kind === "ok");
  }

  async function saveKey(value) {
    const key = value.trim();
    if (!key) { setKeyMsg("Pega la key antes de guardar.", "error"); return; }
    setKeyMsg("Probando la key con TMDB…");
    try {
      await tmdb("/genre/movie/list", {}, key);
      store.set(KEYS.tmdbKey, key);
      el.keyInput.value = "";
      setKeyMsg("Key guardada. Ya puedes buscar.", "ok");
      setTimeout(() => { showKeyPanel(false); setKeyMsg(""); }, 1400);
      el.searchInput.focus();
      if (el.searchInput.value.trim()) runSearch(el.searchInput.value);
    } catch (err) {
      if (err.kind === "network") {
        store.set(KEYS.tmdbKey, key);
        setKeyMsg("La guardé, pero no pude comprobarla porque no hay conexión con TMDB.", "error");
      } else {
        setKeyMsg("TMDB no aceptó esa key. Copia la «API Key» o el «API Read Access Token» completo.", "error");
      }
    }
  }

  /* ================================================================
   * Exportar / importar
   * ================================================================ */
  function setFooterMsg(text, kind) {
    el.footerMsg.textContent = text;
    el.footerMsg.classList.toggle("is-error", kind === "error");
    el.footerMsg.classList.toggle("is-ok", kind === "ok");
  }

  function exportRatings() {
    if (!ratings.length) { setFooterMsg("Todavía no hay calificaciones para exportar.", "error"); return; }
    const payload = { app: "rAAAA!king", version: 1, exportedAt: new Date().toISOString(), ratings };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `raaaaking-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    setFooterMsg(`Exporté ${plural(ratings.length, "calificación", "calificaciones")}.`, "ok");
  }

  async function importRatings(file) {
    try {
      const data = JSON.parse(await file.text());
      const incoming = (Array.isArray(data) ? data : data.ratings || []).filter((r) =>
        r && Number.isFinite(r.id) && r.level >= 1 && r.level <= 5 && typeof r.title === "string");
      if (!incoming.length) throw new Error("vacío");
      let added = 0;
      incoming.forEach((r) => {
        const rec = { ...r, jumps: Math.max(0, Number(r.jumps) || 0) };
        const current = findRating(rec.id);
        if (!current || (rec.updatedAt || 0) > (current.updatedAt || 0)) {
          ratings = ratings.filter((x) => x.id !== rec.id).concat(rec);
          added++;
        }
      });
      saveRatings();
      renderRanking();
      setFooterMsg(`Importé ${plural(added, "calificación", "calificaciones")}.`, "ok");
    } catch {
      setFooterMsg("Ese archivo no parece un respaldo de rAAAA!king.", "error");
    }
  }

  /* ================================================================
   * Eventos
   * ================================================================ */
  el.searchForm.addEventListener("submit", (e) => {
    e.preventDefault();
    clearTimeout(searchTimer);
    runSearch(el.searchInput.value);
    el.searchInput.blur(); // cierra el teclado en el celular
  });
  el.searchInput.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => runSearch(el.searchInput.value), 450);
  });

  el.results.addEventListener("click", (e) => {
    const btn = e.target.closest(".card-hit");
    if (!btn) return;
    const movie = lastResults.find((m) => m.id === Number(btn.dataset.id));
    if (movie) openRate(movie, findRating(movie.id));
  });
  el.ranking.addEventListener("click", (e) => {
    const btn = e.target.closest(".card-hit");
    if (!btn) return;
    const r = findRating(Number(btn.dataset.id));
    if (r) openRate(movieFromRating(r), r);
  });

  el.sortSelect.addEventListener("change", () => {
    store.set(KEYS.sort, el.sortSelect.value);
    renderRanking();
  });

  el.draftResume.addEventListener("click", () => {
    if (!draft) return;
    history.pushState({ view: "rate" }, "", "#calificar");
    showRate();
    if (!draft.movie.director) loadDetails(draft.movie.id);
  });
  el.draftDiscard.addEventListener("click", () => {
    draft = null;
    saveDraft();
    renderDraftBanner();
  });

  el.backBtn.addEventListener("click", goHome);

  el.fearFaces.addEventListener("click", (e) => {
    const face = e.target.closest(".face");
    if (face) setLevel(face.dataset.level);
  });
  el.fearRange.addEventListener("input", () => setLevel(el.fearRange.value));
  // Un clic justo en la posición actual no dispara "input"; esto lo cubre.
  el.fearRange.addEventListener("click", () => setLevel(el.fearRange.value));

  el.jumpBtn.addEventListener("click", () => addJump(1));
  el.jumpUndo.addEventListener("click", () => addJump(-1));
  el.doneBtn.addEventListener("click", finishRating);
  el.deleteBtn.addEventListener("click", deleteRating);

  el.keyToggle.addEventListener("click", () => {
    const show = el.keyPanel.hidden;
    if (!el.home.hidden || !show) showKeyPanel(show);
    else { goHome(); showKeyPanel(true); }
    if (show) { el.keyPanel.scrollIntoView({ behavior: "smooth", block: "start" }); el.keyInput.focus(); }
  });
  el.keyForm.addEventListener("submit", (e) => { e.preventDefault(); saveKey(el.keyInput.value); });

  el.exportBtn.addEventListener("click", exportRatings);
  el.importInput.addEventListener("change", () => {
    const file = el.importInput.files && el.importInput.files[0];
    if (file) importRatings(file);
    el.importInput.value = "";
  });

  window.addEventListener("popstate", () => {
    if (location.hash === "#calificar" && draft) showRate();
    else showHome();
  });

  // Si otra pestaña cambia las calificaciones, se refleja aquí.
  window.addEventListener("storage", (e) => {
    if (e.key === KEYS.ratings) {
      ratings = store.get(KEYS.ratings, []);
      if (!el.home.hidden) renderRanking();
    }
  });

  /* ================================================================
   * Arranque
   * ================================================================ */
  buildFaces();
  const savedSort = store.get(KEYS.sort, "fear");
  el.sortSelect.value = savedSort === "recent" ? "recent" : "fear";
  showKeyPanel(!getKey());

  if (draft && location.hash === "#calificar") {
    // Se recargó la página a mitad de película: se retoma donde iba.
    // Se deja el inicio debajo en el historial para que "volver" no se salga de la app.
    history.replaceState(null, "", location.pathname + location.search);
    history.pushState({ view: "rate" }, "", "#calificar");
    showRate();
  } else {
    if (location.hash === "#calificar") history.replaceState(null, "", location.pathname + location.search);
    showHome();
  }
})();
