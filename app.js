const state = {
  data: null,
  config: null,
  runtimeAdapters: {},
  expandedDay: null,
  selectedItineraryDay: null,
  countdownTimer: null,
  purchasedTickets: new Set(),
  todos: [],
  wishlistPlaces: [],
  wishlistDraftArea: "函館",
  wishlistDraftCategory: "餐飲",
  wishlistListArea: "函館"
};

const MODULE_NAMES = Object.freeze(["flights", "overview", "itinerary", "todo", "driving", "ledger"]);
const SHARED_COLLECTIONS = Object.freeze(["todos", "tickets", "ledger"]);
const WISHLIST_AREAS = Object.freeze(["函館", "洞爺湖", "室蘭", "登別", "小樽", "札幌"]);
const WISHLIST_CATEGORIES = Object.freeze(["餐飲", "購物", "景點", "體驗", "拍照", "其他"]);
const WISHLIST_LONG_PRESS_MS = 550;
const WISHLIST_LONG_PRESS_MOVE_TOLERANCE = 10;

function normalizeTripConfig(raw = {}) {
  if (!raw || typeof raw !== "object" || raw.schemaVersion !== "1.0.0") throw new Error("trip-data.json config.schemaVersion must be 1.0.0");
  if (!raw.modules || typeof raw.modules !== "object") throw new Error("trip-data.json config must contain confirmed module switches");
  const modules = Object.fromEntries(MODULE_NAMES.map((name) => {
    if (typeof raw.modules[name] !== "boolean") throw new Error(`trip-data.json config.modules.${name} must be boolean`);
    return [name, raw.modules[name]];
  }));
  const mode = raw?.persistence?.mode;
  if (mode !== "local" && mode !== "d1") throw new Error("trip-data.json config.persistence.mode must be local or d1");
  const sharedCollections = mode === "d1" ? [...new Set(raw.persistence.sharedCollections || [])] : [];
  if (mode === "d1" && (!sharedCollections.length || sharedCollections.some((name) => !SHARED_COLLECTIONS.includes(name)))) {
    throw new Error("D1 mode requires an explicit sharedCollections allowlist");
  }
  const apiBase = raw.persistence.apiBase || "/api/trip";
  if (mode === "d1" && (!/^\/(?!\/)/.test(apiBase) || apiBase.includes("\\") || /[?#]/.test(apiBase))) {
    throw new Error("D1 apiBase must be a same-origin path");
  }
  return {
    ...raw,
    modules,
    persistence: {
      ...(raw.persistence || {}),
      mode,
      ...(mode === "d1" ? { apiBase, sharedCollections } : {})
    }
  };
}

function moduleEnabled(name) {
  return Boolean(state.config && state.config.modules?.[name] === true);
}

function applyModuleConfig() {
  document.querySelectorAll("[data-module]").forEach((element) => {
    element.hidden = !moduleEnabled(element.dataset.module);
  });
  const visibleTravelLinks = [...document.querySelectorAll(".travel-navigation-menu [data-module]")].filter((link) => !link.hidden);
  const travelNavigation = $("#travel-navigation");
  if (travelNavigation) travelNavigation.hidden = visibleTravelLinks.length === 0;
  document.documentElement.dataset.persistence = state.config.persistence.mode;

  const hashModules = {
    "#flights": "flights", "#route": "overview", "#itinerary": "itinerary",
    "#drive": "driving", "#prep": "todo", "#ledger": "ledger", "#ledger-stats": "ledger"
  };
  const requestedModule = hashModules[location.hash];
  if (requestedModule && !moduleEnabled(requestedModule)) {
    const firstVisible = visibleTravelLinks[0]?.getAttribute("href") || "#top";
    history.replaceState({ view: "travel" }, "", firstVisible);
  }
  window.dispatchEvent(new CustomEvent("travel-config:ready", { detail: { config: state.config } }));
}

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, (character) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "'": "&#39;",
  '"': "&quot;"
})[character]);

const airportCity = (airport) => airport.city || airport.airportCode;

function localDateTime(date, time, _airportCode, utcOffset = "") {
  return new Date(`${date}T${time}:00${utcOffset || "+00:00"}`);
}

function countdownParts(target, now = new Date()) {
  const difference = target.getTime() - now.getTime();
  if (difference <= 0) return { difference, days: 0, hours: 0, minutes: 0 };
  const totalMinutes = Math.floor(difference / 60000);
  return {
    difference,
    days: Math.floor(totalMinutes / 1440),
    hours: Math.floor((totalMinutes % 1440) / 60),
    minutes: totalMinutes % 60
  };
}

function countdownText(target, completionText = "已出發") {
  const value = countdownParts(target);
  if (value.difference <= 0) return completionText;
  if (value.days > 0) return `${value.days}天 ${String(value.hours).padStart(2, "0")}小時`;
  if (value.hours > 0) return `${value.hours}小時 ${String(value.minutes).padStart(2, "0")}分`;
  return `${Math.max(1, value.minutes)}分鐘`;
}

function preciseCountdownText(target, completionText = "已出發") {
  const difference = target.getTime() - Date.now();
  if (difference <= 0) return completionText;
  const totalSeconds = Math.floor(difference / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const clock = [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
  return days > 0 ? `${days}天 ${clock}` : clock;
}

function formatDate(dateString, includeYear = false) {
  const date = new Date(`${dateString}T12:00:00`);
  const options = includeYear
    ? { year: "numeric", month: "long", day: "numeric" }
    : { month: "long", day: "numeric" };
  return new Intl.DateTimeFormat("zh-TW", options).format(date);
}

function formatRentalDateTime(dateString, timeString) {
  const [hour, minute] = timeString.split(":").map(Number);
  const twelveHour = hour % 12 || 12;
  const meridiem = hour < 12 ? "AM" : "PM";
  return `${dateString.replaceAll("-", "/")} ${String(twelveHour).padStart(2, "0")}:${String(minute).padStart(2, "0")} ${meridiem}`;
}

function formatCompactDate(dateString) {
  const [, month, day] = dateString.split("-");
  return `${Number(month)}月${Number(day)}日`;
}

function formatDayHeaderDate(dateString) {
  const [, month, day] = dateString.split("-");
  return `${Number(month)}月${day}日`;
}

function itineraryWeekday(dateString) {
  const date = new Date(`${dateString}T12:00:00`);
  return new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(date).toUpperCase();
}

function itineraryDateNumber(dateString) {
  return Number(dateString.split("-")[2]);
}

function renderDaySummary(value) {
  const parts = String(value ?? "").split(" → ");
  return parts.map((part, index) => {
    const text = escapeHtml(preserveVisibleSpaces(part));
    const arrow = index < parts.length - 1 ? '<span class="day-summary-arrow">&nbsp;→</span>' : '';
    return `<span class="day-summary-step">${text}${arrow}</span>${index < parts.length - 1 ? ' ' : ''}`;
  }).join("");
}

function todayForTrip() {
  const timeZone = state.data?.metadata?.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(new Date());
  } catch {
    return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  }
}


function preserveVisibleSpaces(value) {
  return String(value ?? "").replace(/ /g, "\u00A0");
}

function renderHighlightedText(value, highlights = []) {
  const source = String(value ?? "");
  if (!Array.isArray(highlights) || !highlights.length) return escapeHtml(preserveVisibleSpaces(source));
  const matches = highlights
    .map((highlight) => ({ ...highlight, index: source.indexOf(String(highlight.text || "")) }))
    .filter((highlight) => highlight.text && highlight.index >= 0)
    .sort((a, b) => a.index - b.index);
  if (!matches.length) return escapeHtml(preserveVisibleSpaces(source));
  let cursor = 0;
  let html = "";
  for (const match of matches) {
    if (match.index < cursor) continue;
    html += escapeHtml(preserveVisibleSpaces(source.slice(cursor, match.index)));
    const toneClass = match.tone === "blue" ? " is-blue" : match.tone === "red" ? " is-red" : match.tone === "green" ? " is-green" : match.tone === "pink" ? " is-pink" : "";
    html += `<span class="schedule-text__highlight${toneClass}">${escapeHtml(preserveVisibleSpaces(match.text))}</span>`;
    cursor = match.index + match.text.length;
  }
  html += escapeHtml(preserveVisibleSpaces(source.slice(cursor)));
  return html;
}

function mapsSearch(query) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function heroDestinationFor(trip) {
  const destinations = (trip.countries || []).filter((country) => (trip.primaryDestinationCountries || []).includes(country.code));
  const isDomestic = destinations.length > 0 && destinations.every((country) => country.code === "CN");
  const customTitle = String(trip.heroTitle || "").trim();
  if (customTitle) {
    return { title: customTitle, eyebrow: String(trip.heroEyebrow || "").trim(), destinations, isDomestic };
  }
  if (isDomestic) {
    const destination = String(trip.primaryDestinationName || trip.primaryDestinationCity || trip.citiesAndAreas?.[0] || "目的地待補充").trim();
    return {
      title: destination,
      eyebrow: String(trip.primaryDestinationNameEn || trip.primaryDestinationCityEn || "DOMESTIC JOURNEY").trim(),
      destinations,
      isDomestic
    };
  }
  return {
    title: destinations.map((country) => country.nameZh || country.name).join(" × ") || "目的地待補充",
    eyebrow: destinations.map((country) => country.nameEn || country.name).filter(Boolean).join(" × "),
    destinations,
    isDomestic
  };
}

function renderHero() {
  const { trip } = state.data;
  if (trip.status === "uninitialized") {
    document.title = state.data.metadata.title;

    $("#route-day-count").textContent = "0 DAYS";
    return;
  }
  const hero = heroDestinationFor(trip);
  const { destinations } = hero;
  const shortMark = destinations.map((country) => country.code).join(" / ");
  const year = trip.startDate.slice(0, 4);
  document.title = state.data.metadata.title;

  $("#route-day-count").textContent = `${trip.dayCount} DAYS`;
}

function journeyFlights(journeyId) {
  return state.data.flights
    .filter((flight) => flight.journeyId === journeyId)
    .sort((first, second) => first.sequence - second.sequence);
}

function journeyStatusAndTarget(flights) {
  const now = new Date();
  for (const flight of flights) {
    const departure = localDateTime(flight.departure.date, flight.departure.time, flight.departure.airportCode, flight.departure.utcOffset);
    const arrival = localDateTime(flight.arrival.date, flight.arrival.time, flight.arrival.airportCode, flight.arrival.utcOffset);
    if (now < departure) return { target: departure, label: flight === flights[0] ? "距離起飛還剩" : "距離下一程起飛還剩", complete: false };
    if (now < arrival) return { target: arrival, label: "飛行中 · 距抵達", complete: false };
  }
  return { target: null, label: "已抵達", complete: true };
}

function relativeFlightDate(date, journeyStartDate) {
  if (date === journeyStartDate) return formatCompactDate(date);
  const difference = Math.round((new Date(`${date}T12:00:00`) - new Date(`${journeyStartDate}T12:00:00`)) / 86400000);
  return difference === 1 ? "次日" : formatCompactDate(date);
}

function flightStopMarkup(stop, position, journeyStartDate) {
  let timing;
  if (position === 0) {
    timing = `<b class="flight-stop__time">${escapeHtml(stop.departure.time)}</b><span>${escapeHtml(relativeFlightDate(stop.departure.date, journeyStartDate))} 出發</span>`;
  } else if (position === stop.totalStops - 1) {
    timing = `<b class="flight-stop__time">${escapeHtml(stop.arrival.time)}</b><span>${escapeHtml(relativeFlightDate(stop.arrival.date, journeyStartDate))} 抵達</span>`;
  } else {
    const nextFlight = stop.nextFlight;
    const connection = nextFlight.connectionFromPrevious || {};
    const duration = connection.calculatedFromSchedule || connection.durationUsingTicketTimes || connection.plannedDurationText || "轉機";
    timing = `
      <span>${escapeHtml(stop.arrival.time)} 抵達</span>
      <em>${escapeHtml(duration)}</em>
      <b>${escapeHtml(relativeFlightDate(nextFlight.departure.date, journeyStartDate))} ${escapeHtml(nextFlight.departure.time)}</b>
      <span>起飛</span>
    `;
  }
  return `
    <div class="flight-stop${position > 0 && position < stop.totalStops - 1 ? " is-transfer" : ""}">
      <span class="flight-stop__code">${escapeHtml(stop.airport.airportCode)}</span>
      <span class="flight-stop__city">${escapeHtml(airportCity(stop.airport))}</span>
      <span class="flight-stop__dot" aria-hidden="true"></span>
      <div class="flight-stop__timing">${timing}</div>
    </div>
  `;
}

function flightDurationText(flight) {
  if (flight.plannedDurationText) return String(flight.plannedDurationText).replace(/(\d+)小時(?:(\d+)分鐘)?/, (_, h, m) => `${h}h ${m || 0}m`);
  const departure = localDateTime(flight.departure.date, flight.departure.time, flight.departure.airportCode, flight.departure.utcOffset);
  const arrival = localDateTime(flight.arrival.date, flight.arrival.time, flight.arrival.airportCode, flight.arrival.utcOffset);
  const totalMinutes = Math.max(0, Math.round((arrival - departure) / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m`;
}

function flightMissingFieldLabel(field) {
  return ({
    carrierId: "航空公司",
    flightNumber: "航班號",
    departure: "起飛資訊",
    arrival: "抵達資訊",
    departurePlace: "出發機場",
    arrivalPlace: "抵達機場",
    departureTime: "起飛時間",
    arrivalTime: "抵達時間",
    timeZone: "當地時區"
  })[field] || String(field || "待補充資訊");
}

function flightPlaceholderCard(journey, index) {
  const missingFields = [...new Set(journey.missingFields || [])].map(flightMissingFieldLabel);
  return `
    <article class="flight-card flight-card--placeholder" data-journey="${escapeHtml(journey.id)}">
      <div class="flight-card__top">
        <span>FLIGHT ${String(index + 1).padStart(2, "0")} / ${String(state.data.flightJourneys.length).padStart(2, "0")}</span>
      </div>
      <div class="flight-placeholder">
        <span class="flight-placeholder__eyebrow">資料待補充</span>
        <h3>${escapeHtml(journey.title || "航班資訊待補充")}</h3>
        <p>已按第二輪確認繼續生成標準預覽；系統沒有猜測或偽造缺失的航班資訊。</p>
        ${missingFields.length ? `<ul>${missingFields.map((field) => `<li>${escapeHtml(field)}</li>`).join("")}</ul>` : ""}
      </div>
      <div class="flight-card__countdown-row">
        <div class="flight-countdown" data-countdown-journey="${escapeHtml(journey.id)}" data-placeholder="true">
          <span>目前狀態</span>
          <strong>待補充</strong>
        </div>
      </div>
    </article>
  `;
}

function flightCard(journey, index) {
  const flights = journeyFlights(journey.id);
  if (journey.placeholder || journey.status === "missing" || journey.status === "pending" || !flights.length || flights.some((flight) => flight.placeholder)) {
    return flightPlaceholderCard(journey, index);
  }

  const first = flights[0];
  const last = flights[flights.length - 1];
  const airlineNames = [...new Set(flights.map((flight) => flight.airline.nameZh || flight.airline.name))].join(" · ");
  const totalDuration = flights.length === 1 ? flightDurationText(first) : flightDurationText({
    departure: first.departure,
    arrival: last.arrival,
    plannedDurationText: ""
  });
  const baggage = String(first.baggage || "").replace(/\s+/g, "");

  return `
    <article class="flight-card" data-journey="${escapeHtml(journey.id)}">
      <div class="flight-card__top">
        <span>FLIGHT ${String(index + 1).padStart(2, "0")} / ${String(state.data.flightJourneys.length).padStart(2, "0")}</span>
      </div>
      <div class="flight-card__airlines">${escapeHtml(airlineNames)}</div>
      <div class="flight-route-line">
        <strong class="flight-route-line__code">${escapeHtml(first.departure.airportCode)}</strong>
        <strong class="flight-route-line__code">${escapeHtml(last.arrival.airportCode)}</strong>
      </div>
      <div class="flight-city-row">
        <span>${escapeHtml(airportCity(first.departure))}</span>
        <span>${escapeHtml(airportCity(last.arrival))}</span>
      </div>
      <div class="flight-time-row">
        <strong class="flight-time-row__time flight-time-row__time--departure">${escapeHtml(first.departure.time)}</strong>
        <div class="flight-time-row__middle">
          <span class="flight-time-row__segment" aria-hidden="true"></span>
          <span class="flight-route-line__duration">${escapeHtml(totalDuration)}</span>
          <span class="flight-time-row__segment" aria-hidden="true"></span>
        </div>
        <strong class="flight-time-row__time flight-time-row__time--arrival">${escapeHtml(last.arrival.time)}</strong>
      </div>
      <div class="flight-baggage">${escapeHtml(baggage)}</div>
    </article>
  `;
}

function boardingPassSection(journey, index) {
  const flights = journeyFlights(journey.id);
  if (journey.placeholder || journey.status === "missing" || journey.status === "pending" || !flights.length || flights.some((flight) => flight.placeholder)) {
    return `<section class="boarding-pass__half">${flightPlaceholderCard(journey, index)}</section>`;
  }
  const first = flights[0];
  const last = flights[flights.length - 1];
  const airlineNames = [...new Set(flights.map((flight) => flight.airline.nameZh || flight.airline.name))].join(" · ");
  const totalDuration = flights.length === 1 ? flightDurationText(first) : flightDurationText({ departure:first.departure, arrival:last.arrival, plannedDurationText:"" });
  const baggage = String(first.baggage || "").replace(/\s+/g, "");
  return `
    <section class="boarding-pass__half" aria-label="${index === 0 ? "去程" : "回程"}航班">
      <div class="flight-card__airlines">${escapeHtml(airlineNames)}</div>
      <div class="flight-route-line">
        <strong class="flight-route-line__code">${escapeHtml(first.departure.airportCode)}</strong>
        <strong class="flight-route-line__code">${escapeHtml(last.arrival.airportCode)}</strong>
      </div>
      <div class="flight-city-row"><span>${escapeHtml(airportCity(first.departure))}</span><span>${escapeHtml(airportCity(last.arrival))}</span></div>
      <div class="flight-time-row">
        <strong class="flight-time-row__time flight-time-row__time--departure">${escapeHtml(first.departure.time)}</strong>
        <div class="flight-time-row__middle"><span class="flight-time-row__segment" aria-hidden="true"></span><span class="flight-route-line__duration">${escapeHtml(totalDuration)}</span><span class="flight-time-row__segment" aria-hidden="true"></span></div>
        <strong class="flight-time-row__time flight-time-row__time--arrival">${escapeHtml(last.arrival.time)}</strong>
      </div>
      <div class="flight-baggage">${escapeHtml(baggage)}</div>
    </section>`;
}

function renderFlights() {
  const journeys = state.data.flightJourneys;
  const halves = journeys.slice(0, 2).map(boardingPassSection);
  $("#flight-carousel").innerHTML = halves.map((half, index) => `
    <article class="flight-card flight-card--boarding flight-card--single" aria-label="${index === 0 ? "去程" : "回程"}航班資訊">
      <div class="boarding-pass">${half}</div>
    </article>`).join("");
  $("#flight-dots").innerHTML = "";
  $("#flight-index").textContent = "去程 / 回程";
}

function updateFlightCountdowns() {
  state.data.flightJourneys.forEach((journey) => {
    const target = $(`[data-countdown-journey="${journey.id}"]`);
    if (!target || target.dataset.placeholder === "true" || journey.placeholder) return;
    const status = journeyStatusAndTarget(journeyFlights(journey.id));
    $("strong", target).textContent = status.complete ? "已完成" : preciseCountdownText(status.target, "即將出發");
    $("span", target).textContent = status.label;
  });
}

function costText(cost) {
  if (cost.amount !== undefined) return `${cost.item} · ${cost.currency} ${cost.amount}`;
  if (cost.standard !== undefined && cost.standard !== null) return `${cost.item} · ${cost.currency} ${cost.standard}`;
  if (cost.discounted !== undefined && cost.discounted !== null) return `${cost.item} · ${cost.currency} ${cost.discounted}`;
  if (cost.amountOptions) return `${cost.item} · ${cost.currency} ${cost.amountOptions.join(" / ")}`;
  return cost.item;
}

function ticketsForDay(day) {
  if (!moduleEnabled("itinerary")) return [];
  return (state.data.ticketPlanning?.items || []).filter((ticket) =>
    ticket.dayId ? ticket.dayId === day.id : ticket.day === day.day
  );
}

function ticketsForSchedule(day, item) {
  if (!moduleEnabled("itinerary")) return [];
  const tickets = ticketsForDay(day);
  if (Array.isArray(item.ticketIds)) return tickets.filter((ticket) => item.ticketIds.includes(ticket.id));
  if (item.id) {
    const explicit = tickets.filter((ticket) => (ticket.scheduleItemIds || ticket.itemIds || []).includes(item.id));
    if (explicit.length) return explicit;
  }
  const lowerText = String(item.text || item.title || "").toLocaleLowerCase();
  return tickets.filter((ticket) => (ticket.scheduleMatchTerms || []).some((term) => lowerText.includes(term.toLocaleLowerCase())));
}

function isTicketPurchased(ticket) {
  return ticket.purchaseStatus === "purchased" || state.purchasedTickets.has(ticket.id);
}

function ticketRequirement(ticket) {
  return ({
    "advance-required": "需提前購票",
    "advance-recommended": "建議預約",
    "needs-confirmation": "購票方式待確認"
  })[ticket.requirement] || "門票資訊";
}

function ticketTitle(ticket) {
  return ticket.name || ticket.attraction?.nameZh || ticket.attraction?.name || "門票詳情";
}

function ticketGuidance(ticket) {
  const guidance = ticket.guidance || ticket.notes || [];
  return Array.isArray(guidance) ? guidance.join("·") : String(guidance || "");
}

function ticketDocument(ticket) {
  const document = ticket.document || ticket.booking?.document;
  if (document && typeof document === "object") {
    return { url: document.url || document.path || "", type: document.type || "", label: document.label || "查看票據" };
  }
  const url = ticket.documentUrl || ticket.booking?.documentUrl || "";
  return url ? { url, type: "", label: ticket.documentLabel || "查看票據" } : null;
}

function inlineTicketMarkup(ticket) {
  const purchased = isTicketPurchased(ticket);
  const title = ticketTitle(ticket);
  return `
    <div class="schedule-ticket ${purchased ? "is-purchased" : `is-${escapeHtml(ticket.requirement)}`}" data-inline-ticket="${escapeHtml(ticket.id)}">
      <label class="schedule-ticket__toggle">
        <input type="checkbox" value="${escapeHtml(ticket.id)}" ${purchased ? "checked" : ""} aria-label="${purchased ? "取消已購票" : "標記為已購票"}：${escapeHtml(title)}">
        <span class="schedule-ticket__check" aria-hidden="true">✓</span>
        <span class="schedule-ticket__content">
          <span class="schedule-ticket__status">${purchased ? "已購票" : escapeHtml(ticketRequirement(ticket))}</span>
          <strong>${escapeHtml(title)}</strong>
          <small>${escapeHtml(ticketGuidance(ticket))}</small>
        </span>
      </label>
      <button type="button" class="schedule-ticket__open" data-ticket-open="${escapeHtml(ticket.id)}" aria-haspopup="dialog" aria-controls="ticket-dialog">查看</button>
    </div>`;
}

function dayCard(day) {
  const today = todayForTrip();
  const isToday = day.date === today;
  const expanded = state.expandedDay === day.day;
  const schedule = day.schedule.map((item) => {
    const destinations = navigationDestinations(item);
    const mapLinks = destinations.map((destination) => `
      <button type="button" class="schedule-map-link schedule-map-link--itinerary" data-map-query="${escapeHtml(destination.query || "")}" data-map-url="${escapeHtml(destination.url || "")}" data-map-label="${escapeHtml(destination.label)}" aria-haspopup="dialog" aria-controls="place-map" aria-label="在 Google Map 查看 ${escapeHtml(destination.label)}">
        <span class="schedule-map-link__pin" aria-hidden="true"></span>
      </button>
    `).join("");
    const scheduleTickets = ticketsForSchedule(day, item).map(inlineTicketMarkup).join("");
    const detailLines = (item.detailLines || []).map((line) => {
      const toneClass = line.tone === "pink" ? " is-pink" : line.tone === "green" ? " is-green" : line.tone === "blue" ? " is-blue" : line.tone === "red" ? " is-red" : "";
      return `<span class="schedule-text__line${toneClass}">${escapeHtml(preserveVisibleSpaces(line.text))}</span>`;
    }).join("");
    return `
      <li class="schedule-item">
        <div class="schedule-main">
          <span class="schedule-time">${escapeHtml(item.time)}</span>
          <div class="schedule-text">
            <div class="schedule-text__first-row">
              <span class="schedule-text__line schedule-text__primary">${renderHighlightedText(item.text, item.highlights)}</span>
              ${mapLinks ? `<span class="schedule-map-links schedule-map-links--inline">${mapLinks}</span>` : ""}
            </div>
            ${detailLines}
          </div>
        </div>
        <div class="schedule-content">
          ${scheduleTickets}
        </div>
      </li>
    `;
  }).join("");
  const notes = [...(day.notes || []), ...(day.sourceDateLabelConflict ? [day.sourceDateLabelConflict] : [])];
  const costs = (day.costReferences || []).map((cost) => `<span class="cost-tag">${escapeHtml(costText(cost))}</span>`).join("");
  return `
    <article class="day-card${isToday ? " is-today" : ""}" data-day="${day.day}">
      <div class="day-detail" id="day-detail-${day.day}">
        <ol class="schedule">${schedule}</ol>
        ${costs ? `<div class="costs">${costs}</div>` : ""}
        ${notes.map((note) => `<p class="detail-note">${escapeHtml(note)}</p>`).join("")}
      </div>
    </article>
  `;
}

function navigationDestinations(item) {
  const policy = state.data.mapLinks?.navigationPolicy || { noNavigationTypes: [], selfNavigationTypes: [] };
  if (policy.noNavigationTypes.includes(item.type) && !item.forceMap) return [];
  const referencedPlaceIds = [...new Set([
    ...(Array.isArray(item.placeIds) ? item.placeIds : []),
    ...(item.placeId ? [item.placeId] : [])
  ])];
  if (referencedPlaceIds.length) {
    return referencedPlaceIds.map((placeId) => state.data.places.find((place) => place.id === placeId)).filter(Boolean).map((place) => ({
      id: place.id,
      label: place.nameZh || place.name,
      query: place.navigation?.query || place.googleMapsQuery || place.address || `${place.nameZh || place.name}${place.cityOrArea ? `, ${place.cityOrArea}` : ""}`,
      directUrl: Boolean(place.navigation?.url || place.googleMapsUrl),
      url: place.navigation?.url || place.googleMapsUrl || ""
    }));
  }
  const text = [item.text || item.title || "", ...(item.detailLines || []).map((line) => line.text || "")].join(" ");
  const lowerText = text.toLocaleLowerCase();
  const explicit = (state.data.mapLinks?.navigationPlaces || [])
    .filter((place) => place.matchTerms.some((term) => lowerText.includes(term.toLocaleLowerCase())))
    .map((place) => ({
      id: place.id,
      label: place.label,
      query: place.query || "",
      directUrl: Boolean(place.canonicalUrl || place.url),
      url: place.canonicalUrl || place.url || "",
      priority: place.priority || 1,
      matchIndex: Math.max(...place.matchTerms.map((term) => lowerText.lastIndexOf(term.toLocaleLowerCase())))
    }));
  const highestExplicitPriority = explicit.reduce((highest, place) => Math.max(highest, place.priority), 0);
  const selectedExplicit = highestExplicitPriority > 1
    ? explicit.filter((place) => place.priority === highestExplicitPriority)
    : explicit;

  const catalogPlaces = state.data.places
    .filter((place) => [place.name, place.nameZh].filter(Boolean).some((name) => lowerText.includes(name.toLocaleLowerCase())))
    .map((place) => ({
      id: place.id,
      label: place.nameZh || place.name,
      query: place.navigation?.query || place.googleMapsQuery || place.address || [place.nameZh || place.name, place.cityOrArea].filter(Boolean).join(", "),
      directUrl: Boolean(place.navigation?.url || place.googleMapsUrl),
      matchIndex: Math.max(...[place.name, place.nameZh].filter(Boolean).map((name) => lowerText.lastIndexOf(name.toLocaleLowerCase())))
    }));

  const restaurants = state.data.restaurants
    .filter((restaurant) => lowerText.includes(restaurant.name.toLocaleLowerCase()))
    .map((restaurant) => ({
      id: `restaurant-${restaurant.name}`,
      label: restaurant.name,
      query: restaurant.googleMapsQuery || `${restaurant.nameZh || restaurant.name}, ${restaurant.city}`,
      directUrl: Boolean(restaurant.googleMapsUrl),
      url: restaurant.googleMapsUrl || "",
      matchIndex: lowerText.lastIndexOf(restaurant.name.toLocaleLowerCase())
    }));

  const specificExplicit = selectedExplicit.filter((place) => place.priority > 1);
  let destinations = specificExplicit.length
    ? [...specificExplicit]
    : catalogPlaces.length
      ? [...catalogPlaces, ...restaurants]
      : [...selectedExplicit, ...restaurants];
  destinations = destinations.filter((place, index, all) => all.findIndex((candidate) => candidate.id === place.id) === index);

  if (policy.selfNavigationTypes.includes(item.type) && destinations.length > 1 && !specificExplicit.length) {
    destinations.sort((first, second) => second.matchIndex - first.matchIndex);
    return [destinations[0]];
  }
  return destinations;
}

function currentTripDay() {
  const today = todayForTrip();
  return state.data.days.find((day) => day.date === today)?.day || null;
}

function renderItineraryDateStrip() {
  const strip = $("#itinerary-date-strip");
  if (!strip) return;
  const days = state.data.days;
  const existing = Array.from(strip.querySelectorAll("[data-itinerary-day]"));
  const sameDays = existing.length === days.length && existing.every((node, index) => Number(node.dataset.itineraryDay) === days[index].day);
  if (!sameDays) {
    strip.innerHTML = days.map((day) => `
      <button type="button" class="itinerary-date-option" data-itinerary-day="${day.day}" aria-pressed="false" aria-label="DAY ${day.day}，${escapeHtml(formatDayHeaderDate(day.date))}">
        <span class="itinerary-date-weekday">${escapeHtml(itineraryWeekday(day.date))}</span>
        <span class="itinerary-date-number">${itineraryDateNumber(day.date)}</span>
      </button>
    `).join("");
  }
  strip.querySelectorAll("[data-itinerary-day]").forEach((node) => {
    const selected = Number(node.dataset.itineraryDay) === state.selectedItineraryDay;
    node.classList.toggle("is-selected", selected);
    node.setAttribute("aria-pressed", String(selected));
  });
  strip.onclick = (event) => {
    const option = event.target.closest("[data-itinerary-day]");
    if (!option) return;
    const dayNumber = Number(option.dataset.itineraryDay);
    const index = days.findIndex((day) => day.day === dayNumber);
    if (index < 0) return;
    // v253: Preserve photo progress without reserving the previous day's
    // timeline height. The old min-height reservation caused a large blank
    // area below the last event on shorter days.
    const section = document.querySelector(".itinerary-section");
    const photo = document.querySelector("#itinerary-day-photo-placeholder");
    const timeline = $("#timeline");
    const beforeY = window.scrollY;
    const collapseProgress = photo ? Math.max(0, Math.min(1,
      Number(photo.style.getPropertyValue("--photo-collapse")) || 0)) : 0;
    itineraryPhotoCollapseLocked = true;
    if (timeline) timeline.style.removeProperty("min-height");
    state.selectedItineraryDay = dayNumber;
    state.expandedDay = dayNumber;
    renderTimeline();
    if (photo && section) setItineraryPhotoProgress(section, photo, collapseProgress);
    // Let the browser clamp to the new day's natural height, without
    // manufacturing blank scrollable space at the bottom.
    const maxY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    window.scrollTo({ top: Math.min(beforeY, maxY), behavior: "instant" });
    requestAnimationFrame(() => {
      if (photo && section) {
        setItineraryPhotoProgress(section, photo, collapseProgress);
        const sectionTop = section.getBoundingClientRect().top + window.scrollY;
        itineraryPhotoScrollOffset = collapseProgress * 155 - (window.scrollY - sectionTop);
      }
      itineraryPhotoCollapseLocked = false;
      itineraryLastScrollY = window.scrollY;
    });
    // v246: Every date selection has its own smoothly animated target.
    // Divide the available horizontal travel evenly across all seven dates,
    // so early dates move too; the final date ends at the 2px inset.
    const selectedOption = strip.querySelector(`[data-itinerary-day="${dayNumber}"]`);
    const lastOption = strip.querySelector(`[data-itinerary-day="${days[days.length - 1].day}"]`);
    if (selectedOption && lastOption) {
      const stripRect = strip.getBoundingClientRect();
      const lastRect = lastOption.getBoundingClientRect();
      const maxScroll = Math.max(0, strip.scrollWidth - strip.clientWidth);
      // Use the last capsule's actual right edge, not an obsolete proportional
      // offset or a competing scrollIntoView target.
      const lastTarget = Math.max(0, Math.min(maxScroll,
        strip.scrollLeft + lastRect.right - stripRect.right + 2));
      const target = lastTarget * (index / Math.max(1, days.length - 1));
      strip.scrollTo({ left: target, behavior: "smooth" });
    }
  };
}

// v239: Collapse only the photo's actual height. The two surrounding margins
// and the heading remain constant; no clipping of dates or timeline text.
let itineraryPhotoRaf = 0;
let itineraryPhotoCollapseLocked = false;
let itineraryPhotoScrollOffset = 0;
// v254: Distinguish a real upward gesture from browser scroll clamping.
// A collapsing photo shortens the document; at the bottom this can lower
// scrollY without any upward gesture, causing the old code to re-expand it.
let itineraryGestureDirection = 0; // +1 down the page, -1 up the page
let itineraryTouchY = null;
let itineraryLastScrollY = window.scrollY;
window.addEventListener("touchstart", (event) => {
  if (event.touches.length) itineraryTouchY = event.touches[0].clientY;
}, { passive: true });
window.addEventListener("touchmove", (event) => {
  if (!event.touches.length || itineraryTouchY === null) return;
  const nextY = event.touches[0].clientY;
  if (Math.abs(nextY - itineraryTouchY) > 1) itineraryGestureDirection = nextY < itineraryTouchY ? 1 : -1;
  itineraryTouchY = nextY;
}, { passive: true });
window.addEventListener("touchend", () => { itineraryTouchY = null; }, { passive: true });
window.addEventListener("wheel", (event) => {
  if (Math.abs(event.deltaY) > 0) itineraryGestureDirection = event.deltaY > 0 ? 1 : -1;
}, { passive: true });
function setItineraryPhotoProgress(section, photo, progress) {
  const value = String(Math.max(0, Math.min(1, progress)));
  photo.style.setProperty("--photo-collapse", value);
  // Compensate the photo's removed height at the bottom of the same section.
  // This keeps document scrollHeight stable throughout a finger swipe.
  section.style.setProperty("--photo-collapse", value);
  section.classList.toggle("is-photo-collapsed", progress >= 0.999);
}
function updateItineraryPhotoCollapse() {
  if (itineraryPhotoCollapseLocked) return;
  if (itineraryPhotoRaf) return;
  itineraryPhotoRaf = requestAnimationFrame(() => {
    itineraryPhotoRaf = 0;
    if (itineraryPhotoCollapseLocked) return;
    const section = document.querySelector(".itinerary-section");
    const photo = document.querySelector("#itinerary-day-photo-placeholder");
    if (!section || !photo || section.hidden || document.body.dataset.activeView !== "travel") return;
    // v250: Measure against the section's document position, which stays
    // independent of the collapsing photo and the mobile visual viewport.
    // Ignore overscroll values outside the actual document scroll range.
    const sectionTop = section.getBoundingClientRect().top + window.scrollY;
    const maxY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    const stableY = Math.max(0, Math.min(window.scrollY, maxY));
    const calculated = Math.max(0, Math.min(1, (stableY - sectionTop + itineraryPhotoScrollOffset) / 155));
    const previous = Math.max(0, Math.min(1, Number(photo.style.getPropertyValue("--photo-collapse")) || 0));
    // While the user is scrolling down, a lower scrollY can be a *layout
    // clamp*, not an intentional upward scroll. Never expand in that case.
    // A genuine upward touch/wheel gesture explicitly unlocks expansion.
    const progress = itineraryGestureDirection > 0 ? Math.max(previous, calculated) : calculated;
    setItineraryPhotoProgress(section, photo, progress);
    itineraryLastScrollY = stableY;
  });
}

window.addEventListener("scroll", updateItineraryPhotoCollapse, { passive: true });
// A mobile browser's URL bar changes viewport height during momentum scrolling.
// Recalculating the photo on that resize can trigger an unwanted second layout shift.
// Scroll events already update the photo; avoid a competing resize callback.


function renderTimeline() {
  if (!state.data.days.length) return;
  if (!state.data.days.some((day) => day.day === state.selectedItineraryDay)) {
    state.selectedItineraryDay = state.data.days[0].day;
  }
  state.expandedDay = state.selectedItineraryDay;
  // v248: Map each itinerary day to the user-approved crop. Keep the existing
  // collapse container and scroll logic unchanged.
  const itineraryPhotoNames = {
    1: "01_11-05_Hakodate_night.jpg",
    2: "02_11-06_Goryokaku_observatory.jpg",
    3: "03_11-07_Lake_Toya.jpg",
    4: "04_11-08_Noboribetsu.jpg",
    5: "05_11-09_Otaru_canal.jpg",
    6: "06_11-10_Tanukikoji.jpg",
    7: "07_11-11_New_Chitose_airport.jpg"
  };
  const itineraryPhoto = document.querySelector("#itinerary-day-photo-placeholder");
  const itineraryPhotoName = itineraryPhotoNames[state.selectedItineraryDay];
  if (itineraryPhoto && itineraryPhotoName) {
    itineraryPhoto.style.backgroundImage = `url("assets/itinerary/${itineraryPhotoName}?v=255")`;
    itineraryPhoto.setAttribute("aria-label", `DAY ${state.selectedItineraryDay} 行程照片`);
  }
  renderItineraryDateStrip();
  updateItineraryPhotoCollapse();

  const selectedDay = state.data.days.find((day) => day.day === state.selectedItineraryDay) || state.data.days[0];
  $("#timeline").innerHTML = dayCard(selectedDay);
  $("#timeline").onclick = (event) => {
    const ticketButton = event.target.closest("[data-ticket-open]");
    if (ticketButton) openTicketDialog(ticketButton.dataset.ticketOpen, ticketButton);
  };
  $("#timeline").onchange = (event) => {
    const checkbox = event.target.closest(".schedule-ticket input[type='checkbox']");
    if (!checkbox) return;
    if (checkbox.checked) state.purchasedTickets.add(checkbox.value);
    else state.purchasedTickets.delete(checkbox.value);
    saveTicketState(checkbox.value, checkbox.checked);
    updateInlineTicketState(checkbox.value, checkbox.checked);
  };
}

function updateInlineTicketState(ticketId, purchased) {
  const ticketData = state.data.ticketPlanning.items.find((item) => item.id === ticketId);
  if (!ticketData) return;
  $$(`[data-inline-ticket="${ticketId}"]`).forEach((ticket) => {
    ticket.classList.toggle("is-purchased", purchased);
    ticket.querySelector("input").checked = purchased;
    ticket.querySelector("input").setAttribute("aria-label", `${purchased ? "取消已購票" : "標記為已購票"}：${ticketTitle(ticketData)}`);
    ticket.querySelector(".schedule-ticket__status").textContent = purchased ? "已購票" : ticketRequirement(ticketData);
  });
  const day = state.data.days.find((item) => ticketData.dayId ? item.id === ticketData.dayId : item.day === ticketData.day);
  const dayCardElement = day ? $(`[data-day="${day.day}"]`) : null;
  const badge = dayCardElement ? $(".day-ticket-summary", dayCardElement) : null;
  const dayTickets = day ? ticketsForDay(day) : [];
  const pending = dayTickets.filter((ticket) => !isTicketPurchased(ticket)).length;
  if (!badge) return;
  badge.textContent = pending ? `${pending} 項待購票` : "門票已準備";
  badge.classList.toggle("has-pending", pending > 0);
  badge.classList.toggle("is-complete", pending === 0);
}

async function loadTicketState() {
  state.purchasedTickets = new Set();
}

function saveTicketState(ticketId, completed) {
  return saveSharedChange("tickets", { id: ticketId, completed }, completed ? "upsert" : "delete").catch(console.error);
}

function rentalStatus(rental) {
  const pickup = new Date(`${rental.pickup.date}T${rental.pickup.time}:00${rental.pickup.utcOffset || "+00:00"}`);
  const dropoff = new Date(`${rental.dropoff.date}T${rental.dropoff.time}:00${rental.dropoff.utcOffset || "+00:00"}`);
  const now = new Date();
  if (now < pickup) return { label: "距取車", target: pickup, complete: false };
  if (now < dropoff) return { label: "距還車", target: dropoff, complete: false };
  return { label: "已超過預約還車時間", target: dropoff, complete: true };
}

function renderRental() {
  const transport = state.data.groundTransport;
  const rental = transport.rentalCar;
  const vehicle = rental.vehicle || {};
  $("#rental-card").innerHTML = `
    <article class="rental-panel rental-panel--editorial">
      <div class="rental-vehicle-hero">
        <img class="rental-vehicle-image" src="assets/toyota-noah-reference.jpg" alt="Toyota Noah 白色休旅車，前側視角" loading="lazy">
        <h3 class="rental-car">Noah/Voxy同級車</h3>
      </div>
      <div class="rental-spec-grid" aria-label="車輛規格">
        <div class="rental-spec"><img class="rental-spec__icon" src="assets/icons/rental-seat.png?v=241" alt="" aria-hidden="true"><span>7–8人座</span></div>
        <div class="rental-spec"><img class="rental-spec__icon" src="assets/icons/rental-no-smoking.png?v=241" alt="" aria-hidden="true"><span>禁菸車</span></div>
        <div class="rental-spec"><img class="rental-spec__icon" src="assets/icons/rental-oil.png?v=241" alt="" aria-hidden="true"><span>95<br>無鉛汽油</span></div>
        <div class="rental-spec"><img class="rental-spec__icon" src="assets/icons/rental-insurance.png?v=241" alt="" aria-hidden="true"><span>全險＋<br>道路救援</span></div>
      </div>
      <div class="rental-stops">
        <div class="rental-stop"><span class="rental-stop__label">PICK UP</span><div class="rental-stop__detail"><span class="rental-stop__line">${escapeHtml(formatRentalDateTime(rental.pickup.date, rental.pickup.time))}</span><span class="rental-stop__line">${escapeHtml(rental.pickup.location)}</span></div></div>
        <div class="rental-stop"><span class="rental-stop__label">RETURN</span><div class="rental-stop__detail"><span class="rental-stop__line">${escapeHtml(formatRentalDateTime(rental.dropoff.date, rental.dropoff.time))}</span><span class="rental-stop__line">${escapeHtml(rental.dropoff.vehicleReturnPoint)}</span></div></div>
      </div>
      <div class="rental-map-actions">
        <button type="button" class="schedule-map-link rental-map-button" data-map-query="ENEOS 北8条SS／中和石油㈱" data-map-url="https://www.google.com/maps/place/ENEOS+%E5%8C%978%E6%9D%A1SS%EF%BC%8F%E4%B8%AD%E5%92%8C%E7%9F%B3%E6%B2%B9%E3%88%B1/@43.0698224,141.354926,16z/data=!4m6!3m5!1s0x5f0b290cd9fff0c7:0x3811b1ed48dac1eb!8m2!3d43.071128!4d141.355151!16s%2Fg%2F1td6s0dr?authuser=0&amp;entry=ttu&amp;g_ep=EgoyMDI2MDkxMy4wIKXMDSoASAFQAw%3D%3D" data-map-label="還車前指定加油站" aria-haspopup="dialog" aria-controls="place-map">還車前指定加油站</button>
        <button type="button" class="schedule-map-link rental-map-button" data-map-query="World Net Rent-A-Car Sapporo Sales Office" data-map-url="https://www.google.com/maps/place/World+Net+Rent-A-Car+Sapporo+Sales+Office/@43.0627597,141.3416769,14.75z/data=!4m6!3m5!1s0x5f0b2912f42e193b:0x93aa32e9ca06aab5!8m2!3d43.0742374!4d141.35853!16s%2Fg%2F11c1t53px5?authuser=0&amp;entry=ttu&amp;g_ep=EgoyMDI2MDkxMy4wIKXMDSoASAFQAw%3D%3D" data-map-label="還車地點" aria-haspopup="dialog" aria-controls="place-map">還車地點</button>
      </div>
    </article>
  `;
  const panels = {
    driving: `<ul>
      <li>需攜帶台灣駕照+護照+日文譯本(正本)</li>
      <li>台灣駕照與日文譯本登載內容須完全一致</li>
      <li>還車時需至指定加油站加滿 95 無鉛汽油，並<span class="rental-note-emphasis">保留收據</span>備查</li>
    </ul>`,
    highway: `<ul>
      <li>因日本高速公路過路費較高，僅行程<span class="rental-note-emphasis">標示「付費高速公路」的路段</span>會行駛，其餘皆走一般道路</li>
      <li>租車方案不包含ETC</li>
      <li>高速公路<span class="rental-note-emphasis">入口收費站需抽票</span>，並於出口處繳回，僅<span class="rental-note-emphasis">支援VISA信用卡及現金</span>付款</li>
    </ul>`,
    accident: `<ol>
      <li>開啟國際漫遊並撥打110報警，請勿私下和解保險不予受理</li>
      <li>聯繫租車公司說明事故情況(LINE提供中文客服)</li>
      <li>與對方互留聯絡資料</li>
      <li>還車時與租車公司確認「事故處理報告書」內容，並拍照存證</li>
    </ol>`
  };
  const notes = $("#drive-notes");
  notes.innerHTML = `
    <div class="drive-note-tabs" role="group" aria-label="自駕注意事項">
      <button type="button" aria-expanded="true" aria-controls="drive-note-content" data-drive-note="driving">駕駛提醒</button>
      <button type="button" aria-expanded="false" aria-controls="drive-note-content" data-drive-note="highway">高速公路</button>
      <button type="button" aria-expanded="false" aria-controls="drive-note-content" data-drive-note="accident">車禍處理</button>
    </div>
    <div class="drive-note-panel" id="drive-note-content">${panels.driving}</div>`;
  notes.onclick = (event) => {
    const button = event.target.closest("button[data-drive-note]");
    if (!button) return;
    const collapse = button.getAttribute("aria-expanded") === "true";
    $$("button[data-drive-note]", notes).forEach((item) => item.setAttribute("aria-expanded", String(item === button && !collapse)));
    const panel = $(".drive-note-panel", notes);
    panel.hidden = collapse;
    if (!collapse) panel.innerHTML = panels[button.dataset.driveNote];
  };
}

function updateRentalCountdown() {
  const dropoff = state.data.groundTransport.rentalCar.dropoff;
  const deadline = new Date(`${dropoff.date}T${dropoff.time}:00${dropoff.utcOffset}`);
  const remaining = deadline.getTime() - Date.now();
  $("#return-deadline-timer").textContent = remaining > 0
    ? `距還車截止 ${preciseCountdownText(deadline)}`
    : "预约还车时间已过 · 如尚未还车，請立即聯絡租车公司";
  $(".return-deadline").classList.toggle("is-urgent", remaining <= 86400000);
  const panel = $("#rental-countdown");
  if (!panel) return;
  const status = rentalStatus(state.data.groundTransport.rentalCar);
  $("span", panel).textContent = status.label;
  $("strong", panel).textContent = status.complete ? `請立即聯絡 ${state.data.groundTransport.rentalCar.company}` : countdownText(status.target);
}

function loadTodoState() { state.todos = []; }

function createRuntimeAdapters() {
  const storage = window.TravelRuntimeStorage;
  if (!storage?.createAdapter) throw new Error("runtime-storage.js is required");
  const persistence = state.config.persistence || { mode: "local" };
  const sharedCollections = new Set(Array.isArray(persistence.sharedCollections)
    ? persistence.sharedCollections
    : ["todos", "tickets", "ledger"]);
  const tripId = state.data.metadata.tripId;
  const enabledCollections = [
    ...(moduleEnabled("todo") ? ["todos"] : []),
    ...(moduleEnabled("itinerary") ? ["tickets"] : [])
  ];
  const localCollections = enabledCollections.filter((collection) => persistence.mode !== "d1" || !sharedCollections.has(collection));
  const d1Collections = enabledCollections.filter((collection) => persistence.mode === "d1" && sharedCollections.has(collection));
  const localAdapter = localCollections.length ? storage.createAdapter({ mode: "local", tripId, collections: localCollections }) : null;
  const d1Adapter = d1Collections.length ? storage.createAdapter({
    mode: "d1",
    tripId,
    apiBase: persistence.apiBase || "/api/trip",
    collections: d1Collections
  }) : null;
  state.runtimeAdapters = {};
  localCollections.forEach((collection) => { state.runtimeAdapters[collection] = localAdapter; });
  d1Collections.forEach((collection) => { state.runtimeAdapters[collection] = d1Adapter; });
}

async function loadSharedState() {
  const adapters = [...new Set(Object.values(state.runtimeAdapters).filter(Boolean))];
  const todoAdapter = state.runtimeAdapters.todos;
  const snapshots = await Promise.all(adapters.map(async (adapter) => [adapter, await adapter.load()]));
  const snapshotFor = (collection) => snapshots.find(([adapter]) => adapter === state.runtimeAdapters[collection])?.[1] || {};
  const todoSnapshot = snapshotFor("todos");
  const ticketSnapshot = snapshotFor("tickets");
  state.todos = Array.isArray(todoSnapshot.todos) ? todoSnapshot.todos : [];
  state.purchasedTickets = new Set((Array.isArray(ticketSnapshot.tickets) ? ticketSnapshot.tickets : []).filter((item) => item.completed).map((item) => item.id));
  // v251: No seeded memo entries. Existing user-created items remain in storage.

}

async function saveSharedChange(collection, value, op = "upsert") {
  const adapter = state.runtimeAdapters[collection];
  if (!adapter) return null;
  return adapter.applyChange(collection, value, op);
}

function saveTodoState() { return Promise.all(state.todos.map((todo) => saveSharedChange("todos", todo))); }

function renderTodoList() {
  const completed = state.todos.filter((todo) => todo.completed).length;
  // Unfinished items keep their original order; completed items follow check order.
  // completedAt is persisted with each todo so the order survives reloads.
  const displayTodos = state.todos.map((todo, originalIndex) => ({ todo, originalIndex }))
    .sort((a, b) => {
      if (Boolean(a.todo.completed) !== Boolean(b.todo.completed)) return a.todo.completed ? 1 : -1;
      if (!a.todo.completed) return a.originalIndex - b.originalIndex;
      const aTime = Number(a.todo.completedAt) || 0;
      const bTime = Number(b.todo.completedAt) || 0;
      return aTime - bTime || a.originalIndex - b.originalIndex;
    }).map(({ todo }) => todo);
  $("#todo-list").innerHTML = displayTodos.length ? displayTodos.map((todo) => `
    <div class="todo-item${todo.completed ? " is-complete" : ""}" data-todo-id="${escapeHtml(todo.id)}">
      <label>
        <input type="checkbox" ${todo.completed ? "checked" : ""} aria-label="完成：${escapeHtml(todo.text)}">
        <span class="todo-check" aria-hidden="true"><img src="assets/icons/todo-check-white.png?v=241" alt=""></span>
        <span class="todo-text">${escapeHtml(todo.text)}</span>
      </label>

    </div>`).join("") : `<p class="todo-empty">開始建立準備清單！</p>`;
  document.querySelectorAll("#todo-list .todo-item[data-todo-id]").forEach((row) => {
    const todoId = row.dataset.todoId;
    let pressState = null;
    let suppressClick = false;
    const clearPress = () => {
      if (pressState?.timer) window.clearTimeout(pressState.timer);
      pressState = null;
    };
    row.addEventListener("pointerdown", (event) => {
      if (event.button != null && event.button !== 0) return;
      clearPress();
      pressState = { pointerId: event.pointerId, x: event.clientX, y: event.clientY,
        timer: window.setTimeout(() => {
          suppressClick = true;
          try { navigator.vibrate?.(18); } catch (_) {}
          clearPress();
          const todo = state.todos.find((entry) => entry.id === todoId);
          if (!todo) return;
          openSharedDeleteConfirm({
            message: `刪除「${todo.text}」？`,
            onConfirm: () => {
              state.todos = state.todos.filter((entry) => entry.id !== todoId);
              saveSharedChange("todos", { id: todoId }, "delete").catch(console.error);
              renderTodoList();
            }
          });
        }, WISHLIST_LONG_PRESS_MS)
      };
    });
    row.addEventListener("pointermove", (event) => {
      if (!pressState || pressState.pointerId !== event.pointerId) return;
      if (Math.hypot(event.clientX - pressState.x, event.clientY - pressState.y) > WISHLIST_LONG_PRESS_MOVE_TOLERANCE) clearPress();
    });
    row.addEventListener("pointerup", clearPress);
    row.addEventListener("pointercancel", () => { clearPress(); suppressClick = false; });
    row.addEventListener("pointerleave", (event) => { if (event.pointerType === "mouse") clearPress(); });
    row.addEventListener("click", (event) => {
      if (suppressClick) { event.preventDefault(); event.stopPropagation(); suppressClick = false; }
    }, true);
    row.addEventListener("contextmenu", (event) => event.preventDefault());
  });
}

function renderTravelPrep() {
  renderTodoList();
  renderWishlist();
  $("#todo-input").oninput = (event) => {
    const count = document.getElementById("todo-character-count");
    if (count) count.textContent = `${Array.from(event.target.value).length}/100`;
  };
  $("#todo-form").onsubmit = (event) => {
    event.preventDefault();
    const input = $("#todo-input");
    const text = input.value.trim();
    if (!text) return;
    state.todos.push({ id: `todo-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, text, completed: false });
    input.value = "";
    const count = document.getElementById("todo-character-count");
    if (count) count.textContent = "0/100";
    saveSharedChange("todos", state.todos.at(-1)).catch(console.error);
    renderTodoList();
    document.getElementById("todo-dialog")?.close();
  };
  $("#todo-list").onchange = (event) => {
    const item = event.target.closest("[data-todo-id]");
    if (!item || !event.target.matches("input[type='checkbox']")) return;
    const todo = state.todos.find((entry) => entry.id === item.dataset.todoId);
    todo.completed = event.target.checked;
    // Monotonic completion order, including rapid consecutive taps.
    if (todo.completed) {
      const lastOrder = Math.max(Date.now(), ...state.todos.map((entry) => Number(entry.completedAt) || 0));
      todo.completedAt = lastOrder + 1;
    } else {
      delete todo.completedAt;
    }
    saveSharedChange("todos", todo).catch(console.error);
    renderTodoList();
  };

}


function wishlistStorageKey() {
  const tripId = String(state.data?.metadata?.tripId || "default-trip").trim() || "default-trip";
  return `travel-plan:wishlist:v1:${encodeURIComponent(tripId)}`;
}

function normalizeWishlistPlace(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = String(raw.id || "").trim();
  const area = WISHLIST_AREAS.includes(raw.area) ? raw.area : "";
  const category = WISHLIST_CATEGORIES.includes(raw.category) ? raw.category : "其他";
  const name = String(raw.name || "").trim().slice(0, 80);
  const mapUrl = safeGoogleMapsUrl(raw.mapUrl);
  const note = String(raw.note || "").trim().slice(0, 300);
  if (!id || !area || !name) return null;
  return { id, area, category, name, mapUrl, note, createdAt: String(raw.createdAt || "") };
}

function loadWishlistState() {
  state.wishlistPlaces = [];
  try {
    const parsed = JSON.parse(localStorage.getItem(wishlistStorageKey()) || "[]");
    if (!Array.isArray(parsed)) return;
    state.wishlistPlaces = parsed.map(normalizeWishlistPlace).filter(Boolean);
  } catch (error) {
    console.warn("Wishlist data could not be loaded; starting with an empty list.", error);
  }
}

function saveWishlistState() {
  try {
    localStorage.setItem(wishlistStorageKey(), JSON.stringify(state.wishlistPlaces));
  } catch (error) {
    console.warn("Wishlist data could not be saved in localStorage.", error);
  }
}

function safeGoogleMapsUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    const host = url.hostname.toLowerCase();
    const isGoogleHost = host === "google.com" || host.endsWith(".google.com") || host === "maps.app.goo.gl" || host === "goo.gl";
    if (!isGoogleHost) return "";
    if (host === "goo.gl" && !url.pathname.startsWith("/maps")) return "";
    return url.href;
  } catch {
    return "";
  }
}

function renderWishlistChoiceButtons(container, choices, selected, onSelect) {
  if (!container) return;
  container.replaceChildren(...choices.map((choice) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "wishlist-choice";
    button.textContent = choice;
    button.setAttribute("aria-pressed", String(choice === selected));
    button.onclick = () => onSelect(choice);
    return button;
  }));
}

function wishlistExternalIcon() {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 5h5v5"></path><path d="m19 5-8 8"></path><path d="M17 13v4a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h4"></path></svg>';
}


function closeSharedDeleteConfirm() {
  document.querySelector(".shared-delete-backdrop")?.remove();
  document.querySelector(".shared-delete-dialog")?.remove();
}

function openSharedDeleteConfirm({ message, onConfirm, onCancel }) {
  closeSharedDeleteConfirm();

  const backdrop = document.createElement("div");
  backdrop.className = "shared-delete-backdrop";
  backdrop.setAttribute("aria-hidden", "true");

  const dialog = document.createElement("div");
  dialog.className = "shared-delete-dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "shared-delete-message");
  dialog.innerHTML = `
    <p class="shared-delete-message" id="shared-delete-message">${escapeHtml(message)}</p>
    <div class="shared-delete-actions">
      <button class="shared-delete-cancel" type="button">取消</button>
      <button class="shared-delete-danger" type="button">刪除</button>
    </div>`;

  let closed = false;
  let confirmed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener("keydown", onKeyDown);
    closeSharedDeleteConfirm();
    if (!confirmed) onCancel?.();
  };
  const onKeyDown = (event) => {
    if (event.key === "Escape") close();
  };

  backdrop.addEventListener("click", close, { once: true });
  dialog.querySelector(".shared-delete-cancel")?.addEventListener("click", close);
  dialog.querySelector(".shared-delete-danger")?.addEventListener("click", async () => {
    const action = dialog.querySelector(".shared-delete-danger");
    if (action) action.disabled = true;
    try {
      confirmed = true;
      await Promise.resolve(onConfirm?.());
    } finally {
      close();
    }
  });
  document.addEventListener("keydown", onKeyDown);

  document.body.append(backdrop, dialog);
  requestAnimationFrame(() => dialog.classList.add("is-visible"));
  dialog.querySelector(".shared-delete-cancel")?.focus();
  return { close };
}

window.TravelDeleteConfirm = {
  open: openSharedDeleteConfirm,
  close: closeSharedDeleteConfirm
};

function deleteWishlistPlace(place) {
  if (!place) return;
  state.wishlistPlaces = state.wishlistPlaces.filter((item) => item.id !== place.id);
  saveWishlistState();
  renderWishlistList();
}

function openWishlistDeleteConfirm(place) {
  if (!place) return;
  openSharedDeleteConfirm({
    message: `刪除「${place.name}」？`,
    onConfirm: () => deleteWishlistPlace(place)
  });
}

function setupWishlistLongPress(card, place) {
  let pressState = null;
  let suppressNextClick = false;
  const clearPress = () => {
    if (pressState?.timer) window.clearTimeout(pressState.timer);
    pressState = null;
  };
  card.addEventListener("pointerdown", (event) => {
    if (event.button != null && event.button !== 0) return;
    clearPress();
    pressState = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      timer: window.setTimeout(() => {
        suppressNextClick = true;
        try { navigator.vibrate?.(18); } catch (_) {}
        clearPress();
        openWishlistDeleteConfirm(place);
      }, WISHLIST_LONG_PRESS_MS)
    };
  });
  card.addEventListener("pointermove", (event) => {
    if (!pressState || pressState.pointerId !== event.pointerId) return;
    if (Math.hypot(event.clientX - pressState.x, event.clientY - pressState.y) > WISHLIST_LONG_PRESS_MOVE_TOLERANCE) clearPress();
  });
  card.addEventListener("pointerup", clearPress);
  card.addEventListener("pointercancel", () => { clearPress(); suppressNextClick = false; });
  card.addEventListener("pointerleave", (event) => { if (event.pointerType === "mouse") clearPress(); });
  card.addEventListener("click", (event) => {
    if (suppressNextClick) { event.preventDefault(); event.stopPropagation(); suppressNextClick = false; }
  }, true);
  card.addEventListener("contextmenu", (event) => event.preventDefault());
}

function renderWishlistList() {
  const list = $("#wishlist-list");
  if (!list) return;
  const places = state.wishlistPlaces.filter((place) => place.area === state.wishlistListArea);
  if (!places.length) {
    list.innerHTML = `<p class="wishlist-empty">目前沒有${escapeHtml(state.wishlistListArea)}想去的地點筆記</p>`;
    return;
  }

  list.innerHTML = places.map((place) => `
    <article class="wishlist-place-card" data-wishlist-id="${escapeHtml(place.id)}" aria-label="${escapeHtml(place.name)}，點擊開啟 Google Maps，長按可刪除">
      ${place.mapUrl ? `<a class="wishlist-place-row-link" href="${escapeHtml(place.mapUrl)}" target="_blank" rel="noopener noreferrer" aria-label="在 Google Maps 開啟 ${escapeHtml(place.name)}">` : `<div class="wishlist-place-row-link">`}
        <div class="wishlist-place-copy">
          <p>${escapeHtml(place.name)}</p>
          ${place.note ? `<h4>${escapeHtml(place.note)}</h4>` : ""}
        </div>
      ${place.mapUrl ? "</a>" : "</div>"}
    </article>`).join("");

  list.querySelectorAll(".wishlist-place-card[data-wishlist-id]").forEach((card) => {
    const place = state.wishlistPlaces.find((item) => item.id === card.dataset.wishlistId);
    if (place) setupWishlistLongPress(card, place);
  });
}

function renderWishlistRegionTabs() {
  const tabs = $("#wishlist-region-tabs");
  renderWishlistChoiceButtons(tabs, WISHLIST_AREAS, state.wishlistListArea, (area) => {
    state.wishlistListArea = area;
    renderWishlistRegionTabs();
    renderWishlistList();
  });
}

function renderWishlistDraftControls() {
  const areaGrid = $("#wishlist-area-choices");
  if (areaGrid) {
    const regionIcons = {"函館":"hakodate", "洞爺湖":"toya", "室蘭":"muroran", "登別":"noboribetsu", "小樽":"otaru", "札幌":"sapporo"};
    areaGrid.replaceChildren(...WISHLIST_AREAS.map((area) => {
      const label = document.createElement("label");
      label.className = "ledger-category-choice ledger-sheet-category-choice";
      const input = document.createElement("input");
      input.className = "ledger-category-input";
      input.type = "radio";
      input.name = "wishlist-area";
      input.value = area;
      input.checked = area === state.wishlistDraftArea;
      input.onchange = () => { state.wishlistDraftArea = area; renderWishlistDraftControls(); };
      const tile = document.createElement("span");
      tile.className = "ledger-category-icon-tile";
      const icon = document.createElement("span");
      icon.className = "ledger-category-icon wishlist-region-icon";
      icon.style.setProperty("--region-mask", `url("assets/icons/wishlist-regions/${regionIcons[area]}.png")`);
      icon.setAttribute("aria-hidden", "true");
      if (area === "洞爺湖") icon.classList.add("wishlist-region-icon--toya");
      if (area === "小樽") icon.classList.add("wishlist-region-icon--otaru");
      if (area === "登別") icon.classList.add("wishlist-region-icon--noboribetsu");
      tile.append(icon);
      const name = document.createElement("span");
      name.className = "ledger-category-name";
      name.textContent = area;
      label.append(input, tile, name);
      return label;
    }));
  }
}

function renderWishlist() {
  const form = $("#wishlist-form");
  if (!form) return;
  renderWishlistDraftControls();
  renderWishlistRegionTabs();
  renderWishlistList();

  const mapInput = $("#wishlist-map-url");
  const mapError = $("#wishlist-map-error");
  if (mapInput && mapError) {
    mapInput.oninput = () => {
      if (!mapError.textContent) return;
      if (!mapInput.value.trim() || safeGoogleMapsUrl(mapInput.value)) mapError.textContent = "";
    };
  }

  // Keep the inspiration note compact until its text wraps.
  const wishlistNote = $("#wishlist-note");
  const resizeWishlistNote = () => {
    if (!wishlistNote) return;
    wishlistNote.style.height = "44px";
    wishlistNote.style.height = `${Math.max(44, Math.min(128, wishlistNote.scrollHeight))}px`;
    wishlistNote.style.overflowY = wishlistNote.scrollHeight > 128 ? "auto" : "hidden";
  };
  if (wishlistNote) {
    wishlistNote.addEventListener("input", resizeWishlistNote);
    resizeWishlistNote();
  }

  form.onsubmit = (event) => {
    event.preventDefault();
    const nameInput = $("#wishlist-name");
    const mapInput = $("#wishlist-map-url");
    const noteInput = $("#wishlist-note");
    const message = $("#wishlist-form-message");
    const mapError = $("#wishlist-map-error");
    const name = nameInput.value.trim();
    const mapUrl = safeGoogleMapsUrl(mapInput.value);
    const note = noteInput.value.trim();

    message.textContent = "";
    message.classList.remove("is-success");
    if (mapError) mapError.textContent = "";
    if (!name) {
      message.textContent = "請輸入地點名稱";
      nameInput.focus();
      return;
    }
    if (mapInput.value.trim() && !mapUrl) {
      if (mapError) mapError.textContent = "請貼上有效的 Google Maps 連結";
      mapInput.focus();
      return;
    }

    const place = {
      id: `wishlist-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      area: state.wishlistDraftArea,
      name,
      mapUrl,
      note,
      createdAt: new Date().toISOString()
    };
    state.wishlistPlaces.push(place);
    state.wishlistListArea = place.area;
    saveWishlistState();
    nameInput.value = "";
    mapInput.value = "";
    noteInput.value = "";
    resizeWishlistNote();
    renderWishlistRegionTabs();
    renderWishlistList();
    document.getElementById("wishlist-dialog")?.close();
  };
}

function safeExternalUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw, location.href);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function localAssetUrl(value) {
  const raw = String(value || "").trim();
  if (!raw || raw.startsWith("//") || /^[a-z][a-z0-9+.-]*:/i.test(raw)) return "";
  try {
    const url = new URL(raw, location.href);
    return url.origin === location.origin ? url.href : "";
  } catch {
    return "";
  }
}

let ticketDialogOpener = null;

function openTicketDialog(ticketId, opener) {
  const ticket = state.data.ticketPlanning?.items?.find((item) => item.id === ticketId);
  const dialog = $("#ticket-dialog");
  if (!ticket || !dialog) return;
  ticketDialogOpener = opener || null;
  $("#ticket-dialog-title").textContent = ticketTitle(ticket);
  const document = ticketDocument(ticket);
  const localDocument = localAssetUrl(document?.url);
  const externalDocument = !localDocument ? safeExternalUrl(document?.url) : "";
  const officialUrl = safeExternalUrl(ticket.officialUrl || ticket.booking?.officialUrl || ticket.booking?.purchaseUrl);
  const extension = localDocument.split(/[?#]/)[0].split(".").at(-1)?.toLocaleLowerCase();
  let preview = "";
  if (localDocument && ["png", "jpg", "jpeg", "webp", "gif", "svg"].includes(extension)) {
    preview = `<img class="ticket-dialog__preview" src="${escapeHtml(localDocument)}" alt="${escapeHtml(ticketTitle(ticket))}">`;
  } else if (localDocument) {
    preview = `<iframe class="ticket-dialog__preview" src="${escapeHtml(localDocument)}" title="${escapeHtml(ticketTitle(ticket))}" sandbox="allow-same-origin" referrerpolicy="no-referrer"></iframe>`;
  }
  const links = [
    localDocument ? `<a href="${escapeHtml(localDocument)}" target="_blank" rel="noopener noreferrer">在新視窗開啟票據 ↗</a>` : "",
    externalDocument ? `<a href="${escapeHtml(externalDocument)}" target="_blank" rel="noopener noreferrer">${escapeHtml(document?.label || "查看票據")} ↗</a>` : "",
    officialUrl ? `<a href="${escapeHtml(officialUrl)}" target="_blank" rel="noopener noreferrer">開啟官方頁面 ↗</a>` : ""
  ].filter(Boolean).join("");
  $("#ticket-dialog-body").innerHTML = `
    <p class="ticket-dialog__status">${escapeHtml(isTicketPurchased(ticket) ? "已標記購票" : ticketRequirement(ticket))}</p>
    ${ticketGuidance(ticket) ? `<p class="ticket-dialog__guidance">${escapeHtml(ticketGuidance(ticket))}</p>` : ""}
    ${preview || (!links ? `<p class="ticket-dialog__empty">目前沒有可預覽的票據檔案或官方連結。</p>` : "")}
    ${links ? `<div class="ticket-dialog__links">${links}</div>` : ""}`;
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
  $("#ticket-dialog-close").focus();
}

function setupTicketDialog() {
  const dialog = $("#ticket-dialog");
  if (!dialog) return;
  const close = () => {
    if (typeof dialog.close === "function" && dialog.open) dialog.close();
    else dialog.removeAttribute("open");
  };
  $("#ticket-dialog-close").onclick = close;
  dialog.addEventListener("click", (event) => { if (event.target === dialog) close(); });
  dialog.addEventListener("close", () => {
    const body = $("#ticket-dialog-body");
    if (!body.querySelector(".ticket-dialog__preview--pdf")) body.replaceChildren();
    ticketDialogOpener?.focus({ preventScroll: true });
    ticketDialogOpener = null;
  });
}

function setupPlaceMap() {
  const panel = $("#place-map");
  const frame = $("#place-map-frame");
  let opener;
  let previousOverflow = "";
  const close = () => {
    panel.hidden = true;
    frame.src = "about:blank";
    document.body.style.overflow = previousOverflow;
    opener?.focus();
  };
  document.addEventListener("click", (event) => {
    const link = event.target.closest("button[data-map-query]");
    if (!link) return;
    event.preventDefault();
    const directUrl = safeExternalUrl(link.dataset.mapUrl);
    opener = link;
    $("#place-map-title").textContent = link.dataset.mapLabel;
    $("#place-map-external").href = directUrl || mapsSearch(link.dataset.mapQuery);
    frame.title = `${link.dataset.mapLabel} Google Maps`;
    // v37: the full Google Maps place URL is the single canonical destination datum.
    // The preview pin is extracted from that same URL's exact !3d(lat)!4d(lng) place coordinates,
    // so the preview and “用 Google Maps 開啟” cannot silently point at different places.
    const coordinateMatch = (directUrl || "").match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
    const previewQuery = coordinateMatch ? `${coordinateMatch[1]},${coordinateMatch[2]}` : link.dataset.mapQuery;
    frame.src = `https://maps.google.com/maps?q=${encodeURIComponent(previewQuery)}&output=embed`;
    previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.hidden = false;
    $("#place-map-close").focus();
  });
  $("#place-map-close").onclick = close;
  panel.addEventListener("click", (event) => { if (event.target === panel) close(); });
  panel.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close();
    if (event.key === "Tab") {
      const first = $("#place-map-close");
      const last = $("#place-map-external");
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
}

function startCountdowns() {
  if (moduleEnabled("flights")) updateFlightCountdowns();
  if (moduleEnabled("driving")) updateRentalCountdown();
  if (!moduleEnabled("flights") && !moduleEnabled("driving")) return;
  state.countdownTimer = window.setInterval(() => {
    if (moduleEnabled("flights")) updateFlightCountdowns();
    if (moduleEnabled("driving")) updateRentalCountdown();
  }, 1000);
}

function preloadDefaultRouteMap() {
  const routeMap = state.data?.routeMap;
  const source = travelMapSource(routeMap, routeMap?.defaultRegionId);
  if (!source?.baseImage) return;
  const image = new Image();
  image.decoding = "async";
  image.fetchPriority = "high";
  image.src = source.baseImage;
  state.routeMapPreload = image;
}

async function init() {
  try {
    const response = await fetch("trip-data.json?v=255", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.data = await response.json();
    state.config = normalizeTripConfig(state.data.config);
    window.TRAVEL_PLAN_CONFIG = state.config;
    window.TRAVEL_PLAN_DATA = state.data;
    document.dispatchEvent(new CustomEvent("travel-data-ready", { detail: state.data }));
    applyModuleConfig();
    if (moduleEnabled("overview")) preloadDefaultRouteMap();
    renderHero();
    if (moduleEnabled("flights")) renderFlights();
    if (moduleEnabled("overview")) setupRouteExplorer();
    if (moduleEnabled("itinerary")) {
      setupPlaceMap();
      setupTicketDialog();
    }
    if (moduleEnabled("todo") || moduleEnabled("itinerary")) {
      createRuntimeAdapters();
      try {
        await loadSharedState();
      } catch (error) {
        console.error(`${state.config.persistence.mode === "d1" ? "Shared" : "Local"} runtime data could not be loaded`, error);
        state.todos = [];
        state.purchasedTickets = new Set();
      }
    }
    if (moduleEnabled("itinerary")) renderTimeline();
    if (moduleEnabled("driving")) renderRental();
    if (moduleEnabled("todo")) {
      loadWishlistState();
      renderTravelPrep();
    }
    if (moduleEnabled("ledger")) {
      await window.TravelLedger?.init?.({ tripId: state.data.metadata.tripId, config: state.config });
    }
  } catch (error) {
    console.error("Travel data could not be loaded", error);
    $("#loading-error").hidden = false;
  }
}

document.addEventListener("DOMContentLoaded", init);
