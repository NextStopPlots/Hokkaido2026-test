(() => {
  const TRAVEL_HASHES = new Set(["", "#top", "#flights", "#route", "#itinerary", "#drive"]);
  const isLedgerHash = (hash) => hash === "#ledger" || hash.startsWith("#ledger-");
  const ledgerEnabled = () => !document.querySelector("#ledger-navigation-link")?.hidden;
  const prepEnabled = () => !document.querySelector("#prep-navigation-link")?.hidden;
  const viewForHash = (hash) => hash === "#accommodation" ? "accommodation" : hash === "#prep" && prepEnabled() ? "prep" : isLedgerHash(hash) && ledgerEnabled() ? "ledger" : "travel";

  let activeView = "travel";
  const scrollPositions = { travel: 0, accommodation: 0, prep: 0, ledger: 0 };
  let scrollFrame = 0;
  let browserRouteFrame = 0;
  let pendingBrowserRestore = false;

  function elements() {
    return {
      travelView: document.querySelector('[data-site-view="travel"]'),
      prepView: document.querySelector('[data-site-view="prep"]'),
      ledgerView: document.querySelector('[data-site-view="ledger"]'),
      accommodationView: document.querySelector('[data-site-view="accommodation"]'),
      travelMenu: document.querySelector("#travel-navigation"),
      travelTrigger: document.querySelector("#travel-navigation-trigger"),
      prepLink: document.querySelector("#prep-navigation-link"),
      ledgerLink: document.querySelector("#ledger-navigation-link"),
      skipLink: document.querySelector("#skip-link")
    };
  }

  function setVisibleView(nextView, options = {}) {
    const { travelView, prepView, ledgerView, accommodationView, travelTrigger, prepLink, ledgerLink, skipLink } = elements();
    if (!travelView || !prepView || !ledgerView || !accommodationView) return;

    const viewChanged = activeView !== nextView;
    if (viewChanged) scrollPositions[activeView] = window.scrollY;
    activeView = nextView;
    const ledgerActive = nextView === "ledger";
    const prepActive = nextView === "prep";
    const travelActive = nextView === "travel";
    const accommodationActive = nextView === "accommodation";

    travelView.hidden = !travelActive;
    prepView.hidden = !prepActive;
    ledgerView.hidden = !ledgerActive;
    accommodationView.hidden = !accommodationActive;
    travelView.toggleAttribute("inert", !travelActive);
    prepView.toggleAttribute("inert", !prepActive);
    ledgerView.toggleAttribute("inert", !ledgerActive);
    accommodationView.toggleAttribute("inert", !accommodationActive);
    document.body.dataset.activeView = nextView;
    if (travelTrigger) {
      if (travelActive) travelTrigger.setAttribute("aria-current", "page");
      else travelTrigger.removeAttribute("aria-current");
    }
    if (prepLink) {
      if (prepActive) prepLink.setAttribute("aria-current", "page");
      else prepLink.removeAttribute("aria-current");
    }
    if (ledgerLink) {
      if (ledgerActive) ledgerLink.setAttribute("aria-current", "page");
      else ledgerLink.removeAttribute("aria-current");
    }
    if (skipLink) skipLink.href = ledgerActive ? "#ledger-root" : prepActive ? "#prep" : accommodationActive ? "#accommodation" : "#main";
    document.querySelectorAll("[data-bottom-view]").forEach((item) => {
      if (item.dataset.bottomView === nextView) item.setAttribute("aria-current", "page");
      else item.removeAttribute("aria-current");
    });

    if (ledgerActive) {
      const tab = location.hash === "#ledger-stats" ? "stats" : location.hash === "#ledger" ? "entry" : "";
      if (tab) window.TravelLedger?.setActiveTab?.(tab, { updateHash: false });
    }

    cancelAnimationFrame(scrollFrame);
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = 0;
      if (!ledgerActive && viewChanged) window.dispatchEvent(new Event("travel-view:shown"));
      if (options.targetId && options.targetId !== "top" && nextView === "travel") {
        document.getElementById(options.targetId)?.scrollIntoView({ block: "start", behavior: "instant" });
      } else if ((viewChanged || options.forceScroll) && options.restore) {
        window.scrollTo({ top: scrollPositions[nextView] || 0, behavior: "instant" });
      } else if (viewChanged || options.forceScroll) {
        window.scrollTo({ top: 0, behavior: "instant" });
      }
    });
  }

  function routeFromLocation(options = {}) {
    const hash = location.hash;
    const nextView = viewForHash(hash);
    const targetId = nextView === "travel" && TRAVEL_HASHES.has(hash) ? hash.slice(1) : "";
    setVisibleView(nextView, { ...options, targetId });
  }

  function navigate(hash) {
    const nextView = viewForHash(hash);
    scrollPositions[activeView] = window.scrollY;
    if (location.hash === hash) {
      setVisibleView(nextView, { targetId: nextView === "travel" ? hash.slice(1) : "" });
      return;
    }
    history.pushState({ view: nextView }, "", hash);
    setVisibleView(nextView, { targetId: nextView === "travel" ? hash.slice(1) : "" });
  }

  function scheduleBrowserRoute({ restore = false } = {}) {
    pendingBrowserRestore ||= restore;
    if (browserRouteFrame) return;
    browserRouteFrame = requestAnimationFrame(() => {
      browserRouteFrame = 0;
      const shouldRestore = pendingBrowserRestore;
      pendingBrowserRestore = false;
      routeFromLocation({ restore: shouldRestore });
    });
  }

  function setupAccommodationTabs() {
    const tabs = [...document.querySelectorAll('.accommodation-tab')];
    const panels = [document.getElementById('stay-panel'), document.getElementById('flight-panel'), document.getElementById('rental-panel')];
    if (tabs.length !== 3 || panels.some((panel) => !panel)) return;
    function activate(index, focus = false) {
      tabs.forEach((tab, i) => {
        const selected = i === index;
        tab.setAttribute('aria-selected', String(selected));
        tab.tabIndex = selected ? 0 : -1;
        panels[i].hidden = !selected;
      });
      const tabBar = tabs[0].closest('.accommodation-tabs');
      if (tabBar) {
        tabBar.classList.toggle('left-active', index === 0);
        tabBar.classList.toggle('middle-active', index === 1);
        tabBar.classList.toggle('right-active', index === 2);
      }
      const heading = document.getElementById('accommodation-title');
      const kicker = document.getElementById('accommodation-kicker');
      if (heading) heading.textContent = '預訂資訊';
      if (kicker) kicker.textContent = 'OUR BOOKINGS';
      if (focus) tabs[index].focus({ preventScroll: true });
    }
    tabs.forEach((tab, index) => {
      tab.addEventListener('click', () => activate(index));
      tab.addEventListener('keydown', (event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
        activate(next, true);
      });
    });
  }

  function setup() {
    const { travelMenu } = elements();
    history.scrollRestoration = "manual";
    setupAccommodationTabs();
    activeView = viewForHash(location.hash);
    routeFromLocation({ restore: false, forceScroll: true });

    document.addEventListener("click", (event) => {
      const bottomLink = event.target.closest(".bottom-navigation__item");
      if (bottomLink) {
        event.preventDefault();
        navigate(bottomLink.getAttribute("href") || "#top");
        return;
      }

      const prepLink = event.target.closest("#prep-navigation-link");
      if (prepLink) {
        event.preventDefault();
        travelMenu?.removeAttribute("open");
        navigate("#prep");
        return;
      }

      const ledgerLink = event.target.closest("#ledger-navigation-link");
      if (ledgerLink) {
        event.preventDefault();
        travelMenu?.removeAttribute("open");
        navigate("#ledger");
        return;
      }

      const travelLink = event.target.closest(".travel-navigation-menu a, #wordmark");
      if (travelLink) {
        event.preventDefault();
        travelMenu?.removeAttribute("open");
        navigate(travelLink.getAttribute("href") || "#top");
        return;
      }

      if (travelMenu?.open && !event.target.closest("#travel-navigation")) travelMenu.removeAttribute("open");
    });

    window.addEventListener("popstate", () => scheduleBrowserRoute({ restore: true }));
    window.addEventListener("hashchange", () => scheduleBrowserRoute());
    window.addEventListener("travel-config:ready", () => {
      activeView = viewForHash(location.hash);
      routeFromLocation({ forceScroll: false });
    });
    window.addEventListener("travel-ledger:navigate", (event) => {
      const hash = event.detail?.tab === "stats" ? "#ledger-stats" : "#ledger";
      if (location.hash !== hash) history.pushState({ view: "ledger" }, "", hash);
    });
  }

  function renderAccommodations(data) {
    const list = document.querySelector("#accommodation-list");
    if (!list) return;
    const stays = Array.isArray(data?.accommodations) ? data.accommodations : [];
    list.replaceChildren(...stays.map((stay) => {
      const card = document.createElement("article");
      card.className = "accommodation-card";
      const accommodationImages = {
        "stay-omo5-hakodate": [1, 3, 2, 4].map((index) => `assets/accommodation/omo5-hakodate-${index}.webp`),
        "stay-dormy-muroran": [1, 2, 3].map((index) => `assets/accommodation/dormy-muroran-${index}.webp`),
        "stay-sapporo": [1, 2, 3, 4].map((index) => `assets/accommodation/tokyu-stay-sapporo-${index}.webp`)
      };
      const imageSources = accommodationImages[stay.id] || [];
      if (imageSources.length) {
        const gallery = document.createElement("div");
        gallery.className = "accommodation-gallery";
        const track = document.createElement("div");
        track.className = "accommodation-gallery__track";
        const loopSources = imageSources.length > 1
          ? [imageSources[imageSources.length - 1], ...imageSources, imageSources[0]]
          : imageSources;
        loopSources.forEach((src, index) => {
          const slide = document.createElement("div");
          slide.className = "accommodation-gallery__slide";
          const img = document.createElement("img");
          img.src = src;
          img.alt = `${stay.name || "住宿"} 照片 ${imageSources.length > 1 ? ((index + imageSources.length - 1) % imageSources.length) + 1 : 1}`;
          img.decoding = "async";
          if (index > 1) img.loading = "lazy";
          slide.append(img);
          track.append(slide);
        });
        const dots = document.createElement("div");
        dots.className = "accommodation-gallery__dots";
        dots.setAttribute("aria-hidden", "true");
        imageSources.forEach((_, index) => {
          const dot = document.createElement("span");
          dot.className = `accommodation-gallery__dot${index === 0 ? " is-active" : ""}`;
          dots.append(dot);
        });
        let raf = 0;
        let settling = false;
        const updateDots = () => {
          const width = track.clientWidth || 1;
          const raw = Math.round(track.scrollLeft / width);
          const active = imageSources.length > 1
            ? (raw - 1 + imageSources.length) % imageSources.length
            : 0;
          [...dots.children].forEach((dot, index) => dot.classList.toggle("is-active", index === active));
        };
        if (imageSources.length > 1) {
          track.classList.add('is-looping');
          // Start on the real first image, between the cloned endpoints.
          requestAnimationFrame(() => { track.scrollLeft = track.clientWidth; updateDots(); });
          const settle = () => {
            if (settling || !track.clientWidth) return;
            const width = track.clientWidth;
            const index = Math.round(track.scrollLeft / width);
            if (index !== 0 && index !== imageSources.length + 1) return;
            settling = true;
            track.style.scrollBehavior = 'auto';
            track.style.scrollSnapType = 'none';
            track.scrollLeft = (index === 0 ? imageSources.length : 1) * width;
            requestAnimationFrame(() => {
              track.style.scrollSnapType = '';
              track.style.scrollBehavior = '';
              settling = false;
              updateDots();
            });
          };
          track.addEventListener('scrollend', settle);
          // Fallback for browsers without scrollend support.
          let settleTimer;
          track.addEventListener('scroll', () => {
            clearTimeout(settleTimer);
            settleTimer = setTimeout(settle, 160);
          }, {passive:true});
          if (typeof ResizeObserver !== 'undefined') {
            let previousWidth = 0;
            new ResizeObserver(() => {
              const width = track.clientWidth;
              if (!width || width === previousWidth) return;
              const index = previousWidth ? Math.round(track.scrollLeft / previousWidth) : 1;
              previousWidth = width;
              track.style.scrollBehavior = 'auto';
              track.scrollLeft = Math.max(1, index) * width;
              requestAnimationFrame(() => { track.style.scrollBehavior = ''; updateDots(); });
            }).observe(track);
          }
        }
        track.addEventListener("scroll", () => {
          cancelAnimationFrame(raf);
          raf = requestAnimationFrame(updateDots);
        }, { passive: true });
        gallery.append(track, dots);
        card.append(gallery);
      }
      const content = document.createElement("div");
      content.className = "accommodation-card__content";
      const meta = document.createElement("p");
      meta.className = "accommodation-card__meta";
      meta.textContent = `${stay.city || ""} · ${stay.nights || 0} 晚`;
      const title = document.createElement("h3");
      title.textContent = stay.name || "住宿";
      const dates = document.createElement("p");
      dates.className = "accommodation-card__dates";
      const displayStayDate = (value) => String(value || "").replaceAll("-", "/");
      dates.textContent = `${displayStayDate(stay.checkIn)} - ${displayStayDate(stay.checkOut)}`;
      content.append(meta, title, dates);

      const stayNotes = Array.isArray(stay.notes) ? stay.notes : [];
      const addressNote = stayNotes.find((note) => /飯店住址|地址|住址/.test(String(note || ""))) || "";
      if (addressNote) {
        const raw = String(addressNote || "");
        const address = raw.replace(/^(?:飯店住址|地址|住址)[：:]\s*/, "");
        const addressRow = document.createElement("div");
        addressRow.className = "accommodation-card__address-row accommodation-card__address-meta";
        // Reuse the itinerary/rental place-map overlay; external navigation is
        // available only from its explicit "用 Google Maps 開啟" action.
        const mapLink = document.createElement("button");
        mapLink.type = "button";
        mapLink.className = "accommodation-card__map-link";
        mapLink.dataset.mapQuery = `${stay.name || "住宿"} ${address}`;
        mapLink.dataset.mapUrl = stay.googleMapsUrl || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
        mapLink.dataset.mapLabel = stay.name || "住宿地點";
        mapLink.setAttribute("aria-haspopup", "dialog");
        mapLink.setAttribute("aria-controls", "place-map");
        mapLink.setAttribute("aria-label", `${address}，預覽地圖`);
        mapLink.title = "預覽地圖";
        const addressText = document.createElement("span");
        addressText.className = "accommodation-card__address-text";
        addressText.textContent = address.replace(/^\s*〒?\s*\d{3}[-－]\d{4}\s*/, "");
        const mapIcon = document.createElement("span");
        mapIcon.className = "accommodation-card__map-icon";
        mapIcon.setAttribute("aria-hidden", "true");
        mapLink.append(addressText, document.createTextNode(" "), mapIcon);
        addressRow.append(mapLink);
        content.append(addressRow);
      }

      const detailNotes = stayNotes.filter((note) => !/飯店住址|地址|住址/.test(String(note || "")));
      if (detailNotes.length) {
        const ul = document.createElement("ul");
        ul.className = "accommodation-card__details";

        const iconSvg = (type) => {
          const paths = {
            suitcase: '<rect x="4" y="7" width="16" height="12" rx="2"></rect><path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M8 11v4M16 11v4"></path>',
            car: '<rect x="4.5" y="3.5" width="15" height="17" rx="2.5"></rect><path d="M9 17V7h3.6a3.2 3.2 0 0 1 0 6.4H9"></path>',
            sun: '<circle cx="12" cy="12" r="3.5"></circle><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4"></path>',
            moon: '<path d="M18.5 15.5A7.5 7.5 0 0 1 8.5 5.5 7.5 7.5 0 1 0 18.5 15.5z"></path>',
            hotel: '<path d="M4.5 10.5 12 5l7.5 5.5v9H4.5z"></path><path d="M9.5 19.5v-5h5v5"></path>',
            alert: '<circle cx="12" cy="12" r="9"></circle><path d="M12 7.5v6M12 17h.01"></path>'
          };
          return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[type] || ""}</svg>`;
        };

        const detailType = (note) => {
          const text = String(note || "");
          if (/飯店住址|地址|住址/.test(text)) return "hotel";
          if (/入住\s*\/\s*退房|入住.?退房/.test(text)) return "suitcase";
          if (/停車/.test(text)) return "car";
          if (/早餐/.test(text)) return "sun";
          if (/夜鳴|宵夜|消夜/.test(text)) return "moon";
          if (/近地鐵大通站|攜行李可至狸小路/.test(text)) return "alert";
          return "";
        };

        detailNotes.forEach((note) => {
          const li = document.createElement("li");
          const type = detailType(note);
          if (type) {
            li.className = "accommodation-card__detail accommodation-card__detail--icon";
            const icon = document.createElement("span");
            icon.className = "accommodation-card__detail-icon";
            icon.innerHTML = iconSvg(type);
            const text = document.createElement("span");
            text.className = "accommodation-card__detail-text";
            text.textContent = note;
            li.append(icon, text);
          } else {
            li.className = "accommodation-card__detail accommodation-card__detail--bullet";
            li.textContent = note;
          }
          ul.append(li);
        });
        content.append(ul);
      }
      card.append(content);
      return card;
    }));
  }

  document.addEventListener("travel-data-ready", (event) => renderAccommodations(event.detail));

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", setup);
  else setup();
})();
