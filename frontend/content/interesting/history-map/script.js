(function () {
  "use strict";

  const stages = window.historyStages || [];
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const ANIM_MS = reducedMotion ? 0 : 750;

  if (!stages.length) {
    console.error("historyStages is empty. Check data/stages.js");
    return;
  }

  if (!window.d3 || !window.WORLD_GEO) {
    console.error("D3 / WORLD_GEO failed to load");
    return;
  }

  const d3 = window.d3;

  const els = {
    track: document.getElementById("stages-track"),
    dots: document.getElementById("progress-dots"),
    panel: document.getElementById("panel"),
    panelColumn: document.getElementById("panel-column"),
    label: document.getElementById("stage-label"),
    year: document.getElementById("stage-year"),
    image: document.getElementById("stage-image"),
    title: document.getElementById("stage-title"),
    subtitle: document.getElementById("stage-subtitle"),
    location: document.getElementById("stage-location"),
    description: document.getElementById("stage-description"),
    fact: document.getElementById("stage-fact"),
    btnPrev: document.getElementById("btn-prev"),
    btnNext: document.getElementById("btn-next"),
    btnDetails: document.getElementById("btn-details"),
    btnMenu: document.getElementById("btn-menu"),
    btnInfo: document.getElementById("btn-info"),
    btnSound: document.getElementById("btn-sound"),
    bgMusic: document.getElementById("bg-music"),
    btnZoomIn: document.getElementById("btn-zoom-in"),
    btnZoomOut: document.getElementById("btn-zoom-out"),
    btnZoomReset: document.getElementById("btn-zoom-reset"),
    mapSvg: document.getElementById("map"),
    century: document.querySelectorAll(".century-rail span"),
    modals: {
      details: document.getElementById("modal-details"),
      menu: document.getElementById("modal-menu"),
      howto: document.getElementById("modal-howto"),
      info: document.getElementById("modal-info"),
      sources: document.getElementById("modal-sources"),
      detailsImage: document.getElementById("modal-details-image"),
      galleryCaption: document.getElementById("modal-gallery-caption"),
      galleryDots: document.getElementById("modal-gallery-dots"),
      galleryPrev: document.getElementById("modal-gallery-prev"),
      galleryNext: document.getElementById("modal-gallery-next"),
      detailsMeta: document.getElementById("modal-details-meta"),
      detailsTitle: document.getElementById("modal-details-title"),
      detailsSubtitle: document.getElementById("modal-details-subtitle"),
      detailsPlace: document.getElementById("modal-details-place"),
      detailsBody: document.getElementById("modal-details-body"),
      detailsFactWrap: document.getElementById("modal-details-fact-wrap"),
      detailsFact: document.getElementById("modal-details-fact"),
      menuStages: document.getElementById("menu-stages"),
    },
  };

  const MODAL_KEYS = ["details", "menu", "howto", "info", "sources"];

  let currentIndex = 0;
  let map = null;
  let gallerySlides = [];
  let galleryIndex = 0;

  /* ── Map ── */

  function createMap() {
    const svg = d3.select(els.mapSvg);
    const width = () => els.mapSvg.clientWidth || 800;
    const height = () => els.mapSvg.clientHeight || 500;

    const projection = d3.geoNaturalEarth1();
    const path = d3.geoPath(projection);

    const gRoot = svg.append("g").attr("class", "map-root");
    const gGrid = gRoot.append("g").attr("class", "map-grid-layer");
    const gLand = gRoot.append("g").attr("class", "land-layer");
    const gCities = gRoot.append("g").attr("class", "cities-layer");
    const gMarker = gRoot.append("g").attr("class", "marker-layer");

    const countries = window.WORLD_GEO;

    function fitBase() {
      const w = width();
      const h = height();
      svg.attr("viewBox", `0 0 ${w} ${h}`);
      projection.fitExtent(
        [
          [20, 20],
          [w - 20, h - 20],
        ],
        countries
      );
    }

    fitBase();

    // Graticule
    const graticule = d3.geoGraticule().step([20, 20]);
    gGrid
      .append("path")
      .datum(graticule)
      .attr("class", "map-grid")
      .attr("d", path);

    // Countries
    gLand
      .selectAll("path.country")
      .data(countries.features)
      .join("path")
      .attr("class", "country")
      .attr("d", path);

    // Decorative city lights (fixed demo points)
    const lights = [
      [-0.1, 51.5],
      [2.35, 48.85],
      [-74.0, 40.7],
      [139.7, 35.7],
      [37.6, 55.75],
      [151.2, -33.87],
      [12.5, 41.9],
      [-122.4, 37.8],
      [77.2, 28.6],
      [103.8, 1.35],
    ];
    gCities
      .selectAll("circle")
      .data(lights)
      .join("circle")
      .attr("class", "city-dot")
      .attr("r", 1.4)
      .attr("transform", (d) => {
        const p = projection(d);
        return p ? `translate(${p[0]},${p[1]})` : "translate(-9999,-9999)";
      });

    const zoom = d3
      .zoom()
      .scaleExtent([1, 12])
      .filter((event) => {
        if (event.type === "wheel") return true;
        const t = event.target;
        if (t && (t.classList?.contains("marker-hit") || t.closest?.(".marker-hit"))) {
          return false;
        }
        return !event.button;
      })
      .on("zoom", (event) => {
        gRoot.attr("transform", event.transform);
        const k = event.transform.k;
        gLand.selectAll(".country").attr("stroke-width", 0.6 / k);
        gGrid.select(".map-grid").attr("stroke-width", 0.4 / k);
      });

    svg.call(zoom).on("dblclick.zoom", null);

    svg
      .on("pointerdown", () => svg.classed("is-panning", true))
      .on("pointerup pointerleave", () => svg.classed("is-panning", false));

    function focusLocation(coords, stageLabel, placeName, countryName) {
      const w = width();
      const h = height();
      const [lon, lat] = coords;
      const target = projection([lon, lat]);
      if (!target) return;

      // Highlight nearby countries roughly by centroid distance
      gLand.selectAll(".country").classed("is-near", (f) => {
        const c = path.centroid(f);
        if (!c || Number.isNaN(c[0])) return false;
        const dx = c[0] - target[0];
        const dy = c[1] - target[1];
        return dx * dx + dy * dy < 40 * 40;
      });

      // Marker
      gMarker.selectAll("*").remove();
      const marker = gMarker
        .append("g")
        .attr("class", "marker-group")
        .attr("transform", `translate(${target[0]},${target[1]})`)
        .attr("opacity", 0);

      marker
        .append("circle")
        .attr("class", "marker-hit")
        .attr("r", 32)
        .attr("role", "button")
        .attr("tabindex", "0")
        .attr("aria-label", `Открыть подробности: ${placeName}`)
        .on("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          openStageModal(stages[currentIndex]);
        })
        .on("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openStageModal(stages[currentIndex]);
          }
        });

      [18, 30, 44].forEach((r, i) => {
        marker
          .append("circle")
          .attr("class", "marker-pulse")
          .attr("r", r)
          .attr("stroke-width", 1)
          .attr("opacity", 0)
          .transition()
          .delay(reducedMotion ? 0 : 120 + i * 90)
          .duration(ANIM_MS)
          .attr("opacity", 0.55 - i * 0.12);
      });

      marker.append("circle").attr("class", "marker-core").attr("r", 4.5);

      // Подпись справа от точки, вертикально по центру относительно маркера
      const absLat = Math.abs(lat).toFixed(4);
      const absLon = Math.abs(lon).toFixed(4);
      const labelLines = [
        { text: stageLabel, className: "" },
        { text: placeName, className: "muted" },
        { text: countryName, className: "muted" },
        { text: `${absLat}° ${lat >= 0 ? "N" : "S"}`, className: "coords" },
        { text: `${absLon}° ${lon >= 0 ? "E" : "W"}`, className: "coords" },
      ];
      const lineStep = 14;
      const blockHeight = (labelLines.length - 1) * lineStep;
      const labelTop = -blockHeight / 2;
      const placeRight = target[0] < w * 0.55;
      const side = placeRight ? 1 : -1;
      const stemStart = 10 * side;
      const stemEnd = 20 * side;
      const labelX = 24 * side;

      marker
        .append("line")
        .attr("class", "marker-stem")
        .attr("x1", stemStart)
        .attr("y1", 0)
        .attr("x2", stemEnd)
        .attr("y2", 0);

      const label = marker
        .append("g")
        .attr("class", "marker-label")
        .attr("transform", `translate(${labelX}, ${labelTop})`);

      labelLines.forEach((line, i) => {
        const text = label
          .append("text")
          .attr("x", 0)
          .attr("y", i * lineStep)
          .attr("text-anchor", placeRight ? "start" : "end")
          .attr("dominant-baseline", "central")
          .text(line.text);
        if (line.className) text.attr("class", line.className);
      });

      marker.transition().duration(ANIM_MS * 0.6).attr("opacity", 1);

      // Zoom toward point
      const scale = Math.min(5.5, Math.max(2.8, w / 280));
      const transform = d3.zoomIdentity
        .translate(w / 2, h / 2)
        .scale(scale)
        .translate(-target[0], -target[1]);

      svg
        .transition()
        .duration(ANIM_MS)
        .ease(d3.easeCubicInOut)
        .call(zoom.transform, transform);
    }

    function resetView() {
      const w = width();
      const h = height();
      fitBase();
      gLand.selectAll(".country").attr("d", path).classed("is-near", false);
      gGrid.select(".map-grid").attr("d", path);
      gCities.selectAll("circle").attr("transform", (d) => {
        const p = projection(d);
        return p ? `translate(${p[0]},${p[1]})` : "translate(-9999,-9999)";
      });
      svg.transition().duration(ANIM_MS).call(zoom.transform, d3.zoomIdentity);
      // re-focus current after reset fit
      const stage = stages[currentIndex];
      if (stage) {
        window.setTimeout(() => {
          focusLocation(
            stage.location.coordinates,
            stage.stageLabel,
            stage.location.name,
            stage.location.country
          );
        }, ANIM_MS * 0.15);
      }
      void w;
      void h;
    }

    function resize() {
      const stage = stages[currentIndex];
      fitBase();
      gLand.selectAll(".country").attr("d", path);
      gGrid.select(".map-grid").attr("d", path);
      gCities.selectAll("circle").attr("transform", (d) => {
        const p = projection(d);
        return p ? `translate(${p[0]},${p[1]})` : "translate(-9999,-9999)";
      });
      if (stage) {
        focusLocation(
          stage.location.coordinates,
          stage.stageLabel,
          stage.location.name,
          stage.location.country
        );
      }
    }

    return {
      focusLocation,
      resetView,
      resize,
      zoomIn: () => svg.transition().duration(280).call(zoom.scaleBy, 1.3),
      zoomOut: () => svg.transition().duration(280).call(zoom.scaleBy, 1 / 1.3),
    };
  }

  /* ── UI builders ── */

  function buildStageStrip() {
    els.track.innerHTML = "";
    stages.forEach((stage, index) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "stage-item";
      btn.dataset.index = String(index);
      btn.setAttribute("aria-label", `${stage.stageLabel}: ${stage.navigationTitle}`);
      btn.innerHTML = `
        <span class="stage-item__meta">${escapeHtml(stage.period || stage.stageLabel)}</span>
        <span class="stage-item__title">${escapeHtml(stage.navigationTitle)}</span>
        <span class="stage-item__node" aria-hidden="true"></span>
      `;
      btn.addEventListener("click", () => goTo(index));
      els.track.appendChild(btn);
    });
  }

  function buildDots() {
    els.dots.innerHTML = "";
    stages.forEach((stage, index) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute("role", "tab");
      btn.setAttribute("aria-label", `Перейти к ${stage.stageLabel}`);
      btn.addEventListener("click", () => goTo(index));
      els.dots.appendChild(btn);
    });
  }

  function updateStripAndDots() {
    els.track.querySelectorAll(".stage-item").forEach((node, index) => {
      node.classList.toggle("is-active", index === currentIndex);
      node.classList.toggle("is-past", index < currentIndex);
      node.setAttribute("aria-current", index === currentIndex ? "step" : "false");
    });
    els.dots.querySelectorAll("button").forEach((node, index) => {
      node.classList.toggle("is-active", index === currentIndex);
      node.setAttribute("aria-selected", String(index === currentIndex));
    });

    const active = els.track.querySelector(".stage-item.is-active");
    if (active && active.scrollIntoView) {
      active.scrollIntoView({ inline: "center", block: "nearest", behavior: reducedMotion ? "auto" : "smooth" });
    }
  }

  function updateCenturyRail(index) {
    // Decorative only — map stages 1-2 → XIX, 3-4 → XX, 5-6 → XXI
    let key = "xx";
    if (index <= 1) key = "xix";
    else if (index >= 4) key = "xxi";
    els.century.forEach((node) => {
      node.classList.toggle("is-active", node.getAttribute("data-century") === key);
    });
  }

  function renderPanel(stage) {
    els.panel.classList.add("is-switching");

    const apply = () => {
      els.label.textContent = stage.stageLabel;
      els.year.textContent = stage.year;
      els.title.textContent = stage.title;
      els.subtitle.textContent = stage.subtitle;
      els.description.textContent = stage.description;
      els.fact.textContent = stage.fact;
      els.location.innerHTML = `<strong>${escapeHtml(stage.location.name)}</strong> · ${escapeHtml(
        stage.location.country
      )}`;
      els.image.alt = `${stage.title} — иллюстрация этапа`;
      els.image.src = stage.image;
      els.panel.classList.remove("is-switching");
    };

    if (ANIM_MS === 0) apply();
    else window.setTimeout(apply, 220);
  }

  function goTo(index, force) {
    if (index < 0 || index >= stages.length) return;
    if (!force && index === currentIndex) return;

    currentIndex = index;
    const stage = stages[currentIndex];

    renderPanel(stage);
    if (els.panelColumn) els.panelColumn.scrollTop = 0;
    updateStripAndDots();
    updateCenturyRail(currentIndex);

    els.btnPrev.disabled = currentIndex === 0;
    els.btnNext.disabled = currentIndex === stages.length - 1;

    if (map) {
      map.focusLocation(
        stage.location.coordinates,
        stage.stageLabel,
        stage.location.name,
        stage.location.country
      );
    }
  }

  /* ── Modals ── */

  function buildGallerySlides(stage) {
    const modal = stage.modal || {};
    const slides = [];
    const citySrc = modal.image || modal.cityImage;
    const extraSrc = modal.extraImage || stage.image;

    if (citySrc) {
      slides.push({
        src: citySrc,
        caption: modal.imageCaption || modal.cityCaption || `${stage.location.name} · ${stage.location.country}`,
        alt: modal.imageCaption || stage.location.name || stage.title,
      });
    }
    if (extraSrc && extraSrc !== citySrc) {
      slides.push({
        src: extraSrc,
        caption: modal.extraImageCaption || stage.title,
        alt: modal.extraImageCaption || stage.title,
      });
    }
    if (!slides.length && stage.image) {
      slides.push({
        src: stage.image,
        caption: stage.title,
        alt: stage.title,
      });
    }
    return slides;
  }

  function showGallerySlide(index) {
    if (!gallerySlides.length) return;
    galleryIndex = ((index % gallerySlides.length) + gallerySlides.length) % gallerySlides.length;
    const slide = gallerySlides[galleryIndex];
    const m = els.modals;
    const img = m.detailsImage;
    if (!img) return;

    const apply = () => {
      img.src = slide.src;
      img.alt = slide.alt || "";
      if (m.galleryCaption) m.galleryCaption.textContent = slide.caption || "";
      if (m.galleryDots) {
        m.galleryDots.querySelectorAll("button").forEach((btn, i) => {
          btn.classList.toggle("is-active", i === galleryIndex);
          btn.setAttribute("aria-selected", String(i === galleryIndex));
        });
      }
      img.classList.remove("is-fading");
    };

    if (reducedMotion) {
      apply();
      return;
    }
    img.classList.add("is-fading");
    window.setTimeout(apply, 180);
  }

  function renderGallery(stage) {
    const m = els.modals;
    gallerySlides = buildGallerySlides(stage);
    galleryIndex = 0;

    if (m.galleryDots) {
      m.galleryDots.innerHTML = "";
      gallerySlides.forEach((slide, i) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.setAttribute("role", "tab");
        btn.setAttribute("aria-label", `Изображение ${i + 1}: ${slide.caption || ""}`);
        btn.addEventListener("click", () => showGallerySlide(i));
        m.galleryDots.appendChild(btn);
      });
    }

    const multi = gallerySlides.length > 1;
    if (m.galleryPrev) m.galleryPrev.hidden = !multi;
    if (m.galleryNext) m.galleryNext.hidden = !multi;
    if (m.galleryDots) m.galleryDots.hidden = !multi;

    showGallerySlide(0);
  }

  function fillStageModal(stage) {
    if (!stage) return;
    const modal = stage.modal || {};
    const m = els.modals;
    const modalTitle = modal.title || stage.title;
    const modalText =
      modal.text ||
      "Добавьте отдельный текст модального окна в поле modal.text в data/stages.js.";
    const modalFact = modal.fact;

    renderGallery(stage);

    if (m.detailsMeta) m.detailsMeta.textContent = `${stage.stageLabel} · ${stage.year}`;
    if (m.detailsTitle) m.detailsTitle.textContent = modalTitle;
    if (m.detailsSubtitle) m.detailsSubtitle.textContent = stage.subtitle || "";
    if (m.detailsPlace) {
      m.detailsPlace.textContent = `${stage.location.name} · ${stage.location.country}`;
    }
    if (m.detailsBody) {
      m.detailsBody.innerHTML = "";
      modalText
        .split(/\n\s*\n/)
        .map((part) => part.trim())
        .filter(Boolean)
        .forEach((part) => {
          const p = document.createElement("p");
          p.textContent = part;
          m.detailsBody.appendChild(p);
        });
    }
    if (m.detailsFactWrap && m.detailsFact) {
      if (modalFact) {
        m.detailsFact.textContent = modalFact;
        m.detailsFactWrap.hidden = false;
      } else {
        m.detailsFactWrap.hidden = true;
      }
    }
  }

  function openStageModal(stage) {
    fillStageModal(stage || stages[currentIndex]);
    openModal(els.modals.details);
  }

  function openModal(modal) {
    modal.hidden = false;
    // force reflow
    void modal.offsetWidth;
    modal.classList.add("is-open");
    const closeBtn = modal.querySelector("[data-close]");
    closeBtn && closeBtn.focus();
  }

  function closeModal(modal) {
    modal.classList.remove("is-open");
    window.setTimeout(() => {
      modal.hidden = true;
    }, reducedMotion ? 0 : 320);
  }

  function closeAllModals() {
    MODAL_KEYS.forEach((key) => {
      const node = els.modals[key];
      if (node) closeModal(node);
    });
  }

  function openNamedModal(name) {
    const modal = els.modals[name];
    if (!modal) return;
    MODAL_KEYS.forEach((key) => {
      if (key !== name && els.modals[key]) closeModal(els.modals[key]);
    });
    if (name === "menu") renderMenuStages();
    openModal(modal);
  }

  function startJourney() {
    closeAllModals();
    goTo(0, true);
  }

  function renderMenuStages() {
    const root = els.modals.menuStages;
    if (!root) return;
    root.innerHTML = "";
    stages.forEach((stage, index) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `menu-stage${index === currentIndex ? " is-current" : ""}`;
      btn.innerHTML = `
        <span class="menu-stage__num">${escapeHtml(stage.stageLabel)}</span>
        <span>${escapeHtml(stage.navigationTitle)}</span>
      `;
      btn.addEventListener("click", () => {
        closeAllModals();
        goTo(index, true);
      });
      root.appendChild(btn);
    });
  }

  function bindModals() {
    els.btnDetails.addEventListener("click", () => openStageModal(stages[currentIndex]));
    els.btnMenu.addEventListener("click", () => openNamedModal("menu"));
    els.btnInfo.addEventListener("click", () => openNamedModal("info"));
    els.modals.galleryPrev?.addEventListener("click", () => showGallerySlide(galleryIndex - 1));
    els.modals.galleryNext?.addEventListener("click", () => showGallerySlide(galleryIndex + 1));

    document.getElementById("menu-restart")?.addEventListener("click", startJourney);
    document.getElementById("menu-continue")?.addEventListener("click", () => closeAllModals());
    document.getElementById("info-start")?.addEventListener("click", startJourney);
    document.getElementById("info-first-stage")?.addEventListener("click", startJourney);
    document.getElementById("info-continue")?.addEventListener("click", () => closeAllModals());

    document.querySelectorAll("[data-open-modal]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const name = btn.getAttribute("data-open-modal");
        openNamedModal(name);
      });
    });

    document.querySelectorAll(".modal").forEach((modal) => {
      modal.addEventListener("click", (e) => {
        if (e.target === modal) closeModal(modal);
      });
      modal.querySelectorAll("[data-close]").forEach((btn) => {
        btn.addEventListener("click", () => closeModal(modal));
      });
    });
  }

  /* ── Ambient music ── */

  const SOUND_STORAGE_KEY = "history-map-sound-muted";
  const MUSIC_VOLUME = 0.38;

  function readSoundMuted() {
    try {
      return localStorage.getItem(SOUND_STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  }

  function writeSoundMuted(muted) {
    try {
      localStorage.setItem(SOUND_STORAGE_KEY, muted ? "1" : "0");
    } catch {
      /* ignore */
    }
  }

  function syncSoundButton(muted) {
    const btn = els.btnSound;
    if (!btn) return;
    btn.classList.toggle("is-muted", muted);
    btn.setAttribute("aria-pressed", muted ? "true" : "false");
    btn.setAttribute("aria-label", muted ? "Включить звук" : "Выключить звук");
    btn.title = muted ? "Звук выключен" : "Звук включён";
    const onIcon = btn.querySelector(".icon-sound-on");
    const offIcon = btn.querySelector(".icon-sound-off");
    if (onIcon) onIcon.hidden = muted;
    if (offIcon) offIcon.hidden = !muted;
  }

  function playBgMusic() {
    const audio = els.bgMusic;
    if (!audio || audio.muted) return Promise.resolve();
    const playPromise = audio.play();
    if (playPromise && typeof playPromise.catch === "function") {
      return playPromise.catch(() => {});
    }
    return Promise.resolve();
  }

  function setupAmbientMusic() {
    const audio = els.bgMusic;
    const btn = els.btnSound;
    if (!audio || !btn) return;

    const muted = readSoundMuted();
    audio.loop = true;
    audio.volume = MUSIC_VOLUME;
    audio.muted = muted;
    syncSoundButton(muted);

    if (!muted) {
      playBgMusic();
    }

    const unlock = () => {
      if (!audio.muted) playBgMusic();
    };
    document.addEventListener("pointerdown", unlock, { once: true, passive: true });
    document.addEventListener("keydown", unlock, { once: true });

    btn.addEventListener("click", () => {
      const nextMuted = !audio.muted;
      audio.muted = nextMuted;
      writeSoundMuted(nextMuted);
      syncSoundButton(nextMuted);
      if (nextMuted) {
        audio.pause();
      } else {
        playBgMusic();
      }
    });
  }

  /* ── Controls ── */

  function bindControls() {
    els.btnPrev.addEventListener("click", () => goTo(currentIndex - 1));
    els.btnNext.addEventListener("click", () => goTo(currentIndex + 1));
    els.btnZoomIn.addEventListener("click", () => map && map.zoomIn());
    els.btnZoomOut.addEventListener("click", () => map && map.zoomOut());
    els.btnZoomReset.addEventListener("click", () => map && map.resetView());

    window.addEventListener("keydown", (e) => {
      const tag = document.activeElement && document.activeElement.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      if (e.key === "Escape") {
        closeAllModals();
        return;
      }
      const detailsOpen = els.modals.details?.classList.contains("is-open");
      if (detailsOpen && gallerySlides.length > 1) {
        if (e.key === "ArrowRight") {
          e.preventDefault();
          showGallerySlide(galleryIndex + 1);
          return;
        }
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          showGallerySlide(galleryIndex - 1);
          return;
        }
      }
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        goTo(currentIndex + 1);
      }
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        goTo(currentIndex - 1);
      }
    });

    // Swipe on map / panel
    let touchX = null;
    const swipeTarget = document.querySelector(".main");
    swipeTarget.addEventListener(
      "touchstart",
      (e) => {
        touchX = e.changedTouches[0].clientX;
      },
      { passive: true }
    );
    swipeTarget.addEventListener(
      "touchend",
      (e) => {
        if (touchX == null) return;
        const dx = e.changedTouches[0].clientX - touchX;
        touchX = null;
        if (Math.abs(dx) < 56) return;
        if (dx < 0) goTo(currentIndex + 1);
        else goTo(currentIndex - 1);
      },
      { passive: true }
    );

    let resizeTimer = 0;
    window.addEventListener("resize", () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => map && map.resize(), 120);
    });
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /* ── Init ── */

  function init() {
    buildStageStrip();
    buildDots();
    bindModals();
    bindControls();
    setupAmbientMusic();
    map = createMap();
    goTo(0, true);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
