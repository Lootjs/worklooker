<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import type { CollectionError, CollectionEvent, SavedVacancy as Vacancy, VacancyStatus as Status } from "../../src/api";
import { ageLabel, formatDateTime, likedLabel } from "./format";
import SourcesView from "./SourcesView.vue";

type View = "new" | "liked" | "sources";

const view = ref<View>("new");
const vacancies = ref<Vacancy[]>([]);
const loading = ref(true);
const collecting = ref(false);
type Progress = { done: number; total: number; added: number };
const progress = ref<Progress>();
/**
 * One status message at a time, shown in-flow under the top bar, always with a
 * close button. Information fades quickly, warnings a little later; errors stay
 * until dismissed or retried.
 */
type Notice = { text: string; tone: "info" | "warning" | "error"; action?: { label: string; run: () => void } };
const notice = ref<Notice>();
const noticeLifetimeMs: Record<Notice["tone"], number | undefined> = { info: 6_000, warning: 12_000, error: undefined };
let noticeTimer = 0;
function say(text: string, tone: Notice["tone"] = "info", action?: Notice["action"]): void {
  window.clearTimeout(noticeTimer);
  notice.value = { text, tone, action };
  const lifetime = noticeLifetimeMs[tone];
  if (lifetime) noticeTimer = window.setTimeout(() => { notice.value = undefined; }, lifetime);
}
function dismissNotice(): void {
  window.clearTimeout(noticeTimer);
  notice.value = undefined;
}
function runNoticeAction(): void {
  const action = notice.value?.action;
  dismissNotice();
  action?.run();
}
const touchStart = ref<number>();
const expanded = ref(false);

const visible = computed(() => vacancies.value.filter((vacancy) => vacancy.status === view.value));
const current = computed(() => visible.value[0]);
const queueCount = computed(() => vacancies.value.filter((vacancy) => vacancy.status === "new").length);
const likedCount = computed(() => vacancies.value.filter((vacancy) => vacancy.status === "liked").length);

type FitTone = "strong" | "good" | "review";
function fitTone(score: number): FitTone {
  if (score >= 12) return "strong";
  if (score >= 9) return "good";
  return "review";
}
function fitLabel(score: number): string {
  return { strong: "сильное соответствие", good: "хорошее соответствие", review: "на просмотр" }[fitTone(score)];
}

// Liked jobs read as a scrolling feed, freshest like first: the card nearest
// the middle is in focus, the others are blurred and drift away from it.
// Titles, authors and descriptions arrive ready from the collector.
const likedCards = computed(() => vacancies.value
  .filter((vacancy) => vacancy.status === "liked")
  .sort((a, b) => (b.decidedAt ?? "").localeCompare(a.decidedAt ?? "")));
const feedEl = ref<HTMLElement>();
const focusIndex = ref(0);
const focusedLiked = computed(() => likedCards.value[focusIndex.value]);
/** The liked card showing its full text; only the focused one may expand. */
const likedExpandedId = ref<string>();
/** The liked card whose "remove" menu is open. */
const removeMenuId = ref<string>();
watch(focusIndex, () => {
  // A taller card shifts the feed, so it folds back as soon as focus moves on.
  likedExpandedId.value = undefined;
  removeMenuId.value = undefined;
});

async function toggleLikedDetails(vacancy: Vacancy): Promise<void> {
  const expanding = likedExpandedId.value !== vacancy.id;
  likedExpandedId.value = expanding ? vacancy.id : undefined;
  if (!expanding) return;
  // Keep the card's top in view: it now grows downward, past the screen.
  await nextTick();
  const feed = feedEl.value;
  const card = feedCards()[likedCards.value.findIndex((item) => item.id === vacancy.id)];
  if (feed && card) feed.scrollTo({ top: card.offsetTop - 24, behavior: reducedMotion.matches ? "auto" : "smooth" });
}

function toggleRemoveMenu(vacancy: Vacancy): void {
  removeMenuId.value = removeMenuId.value === vacancy.id ? undefined : vacancy.id;
}
function closeRemoveMenu(event: MouseEvent): void {
  if (removeMenuId.value && !(event.target as Element | null)?.closest(".remove-split")) removeMenuId.value = undefined;
}
/** Out of the liked list: back to the queue at once, or rejected with the usual undo window. */
function removeLiked(vacancy: Vacancy, to: "new" | "rejected"): void {
  removeMenuId.value = undefined;
  if (to === "rejected") reject(vacancy);
  else void setStatus("new", false, vacancy);
}
const showFeed = computed(() => view.value === "liked" && !loading.value && likedCards.value.length > 0);
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

// Geometry comes from layout offsets, never getBoundingClientRect: the blur and
// drift transforms live on an inner element, so a card's box stays where the
// scroll snap expects it and the focused card does not settle back after centring.
function feedCards(): HTMLElement[] {
  return Array.from(feedEl.value?.querySelectorAll<HTMLElement>(".liked-card") ?? []);
}

let feedFrame = 0;
function onFeedScroll(): void {
  if (feedFrame) return;
  feedFrame = requestAnimationFrame(() => {
    feedFrame = 0;
    const feed = feedEl.value;
    if (!feed) return;
    const middle = feed.scrollTop + feed.clientHeight / 2;
    const cards = feedCards();
    // An expanded card is taller than the screen: while it spans the middle it
    // keeps focus, even though a neighbour's centre may be nearer.
    const spanning = cards.findIndex((element) => element.offsetTop <= middle && middle <= element.offsetTop + element.offsetHeight);
    let nearest = 0;
    let nearestDistance = Infinity;
    cards.forEach((element, index) => {
      const distance = Math.abs(element.offsetTop + element.offsetHeight / 2 - middle);
      if (distance < nearestDistance) { nearest = index; nearestDistance = distance; }
    });
    focusIndex.value = spanning >= 0 ? spanning : nearest;
  });
}

function focusLiked(index: number): void {
  const feed = feedEl.value;
  const count = likedCards.value.length;
  if (!feed || !count) return;
  const next = Math.min(Math.max(index, 0), count - 1);
  const target = feedCards()[next];
  focusIndex.value = next;
  if (!target) return;
  const top = target.offsetTop - (feed.clientHeight - target.offsetHeight) / 2;
  feed.scrollTo({ top, behavior: reducedMotion.matches ? "auto" : "smooth" });
}

/** A blurred card is not actionable: the first click only brings it into focus. */
function onLikedCardClick(event: MouseEvent, index: number): void {
  if (index === focusIndex.value) return;
  event.preventDefault();
  event.stopPropagation();
  focusLiked(index);
}

watch(view, async (next) => {
  expanded.value = false;
  if (next === "sources") return;
  if (next !== "liked") return;
  focusIndex.value = 0;
  await nextTick();
  feedEl.value?.scrollTo({ top: 0 });
});
watch(() => likedCards.value.length, (count) => {
  if (focusIndex.value > count - 1) focusIndex.value = Math.max(count - 1, 0);
});

// Bumped on every decision: a list fetched while a decision was in flight may
// still contain the old status, so it is discarded and fetched again.
let decisionVersion = 0;
async function refresh(): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const version = decisionVersion;
    const fresh = await fetch("/api/vacancies").then((response) => response.json()) as Vacancy[];
    if (version === decisionVersion) return void (vacancies.value = withPendingReject(fresh));
  }
}

/*
 * Rejection is permanent, so it is held locally for a few seconds first: the
 * card leaves the queue at once, and the request is sent only when the undo
 * window closes (or the page is closed).
 */
const undoWindowMs = 5_000;
/** `previous` is where an undo puts the card back: the queue or the liked list. */
type PendingReject = { vacancy: Vacancy; title: string; previous: Status; timer: number };
const pendingReject = ref<PendingReject>();

function withLocalStatus(list: Vacancy[], id: string, status: Status): Vacancy[] {
  return list.map((vacancy) => vacancy.id === id ? { ...vacancy, status } : vacancy);
}
/** A refresh during the undo window must not bring the card back. */
function withPendingReject(list: Vacancy[]): Vacancy[] {
  return pendingReject.value ? withLocalStatus(list, pendingReject.value.vacancy.id, "rejected") : list;
}

function reject(target: Vacancy | undefined = current.value): void {
  if (!target) return;
  flushPendingReject();
  pendingReject.value = { vacancy: target, title: target.title, previous: target.status, timer: window.setTimeout(() => flushPendingReject(), undoWindowMs) };
  vacancies.value = withLocalStatus(vacancies.value, target.id, "rejected");
  expanded.value = false;
}

function undoReject(): void {
  const pending = pendingReject.value;
  if (!pending) return;
  window.clearTimeout(pending.timer);
  pendingReject.value = undefined;
  vacancies.value = withLocalStatus(vacancies.value, pending.vacancy.id, pending.previous);
}

function flushPendingReject(keepalive = false): void {
  const pending = pendingReject.value;
  if (!pending) return;
  window.clearTimeout(pending.timer);
  pendingReject.value = undefined;
  void setStatus("rejected", false, pending.vacancy, keepalive);
}

function describeFailures(errors: CollectionError[]): string {
  const blocked: string[] = [];
  const silent: string[] = [];
  for (const { sourceName, message } of errors) {
    // 4xx (except rate limits), closed previews, login walls and empty pages
    // will not fix themselves on retry.
    const isBlocked = /HTTP 4(?!29)\d\d|закрыл|captcha|капч|авториз|вход/i.test(message);
    (isBlocked ? blocked : silent).push(sourceName);
  }
  return [
    blocked.length ? `Закрыты для сбора: ${blocked.join(", ")}.` : "",
    silent.length ? `Не ответили: ${silent.join(", ")}.` : "",
  ].filter(Boolean).join(" ");
}

// Sources finish close together; coalesce their refreshes into one at a time.
let refreshing: Promise<void> | undefined;
let refreshAgain = false;
function scheduleRefresh(): void {
  if (refreshing) return void (refreshAgain = true);
  refreshing = refresh().catch(() => undefined).finally(() => {
    refreshing = undefined;
    if (refreshAgain) { refreshAgain = false; scheduleRefresh(); }
  });
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    const response = await fetch("/api/vacancies");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    vacancies.value = withPendingReject(await response.json() as Vacancy[]);
    if (notice.value?.action?.run === load) dismissNotice();
  } catch {
    say("Не удалось загрузить вакансии: локальный API не отвечает. Проверьте, что запущен pnpm dev.", "error", { label: "Повторить", run: load });
  } finally { loading.value = false; }
}

const statusVerb: Record<Status, string> = { new: "вернуть в очередь", liked: "сохранить", rejected: "отклонить" };

async function setStatus(status: Status, open = false, target: Vacancy | undefined = current.value, keepalive = false): Promise<void> {
  if (!target) return;
  if (open) openInBackground(target.url);
  decisionVersion += 1;
  try {
    const response = await fetch(`/api/vacancies/${target.id}/status`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }), keepalive });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const changed = await response.json() as Vacancy;
    decisionVersion += 1;
    vacancies.value = vacancies.value.map((vacancy) => vacancy.id === changed.id ? changed : vacancy);
    expanded.value = false;
  } catch {
    // Show the card in its saved state again, and offer to retry the exact decision.
    const title = target.title;
    vacancies.value = withLocalStatus(vacancies.value, target.id, target.status);
    say(`Не удалось ${statusVerb[status]} «${title}»: локальный API не ответил.`, "error", { label: "Повторить", run: () => void setStatus(status, false, target) });
  }
}

function openInBackground(url: string): void {
  const opened = window.open(url, "_blank");
  if (!opened) return;
  opened.opener = null;
  opened.blur();
  window.focus();
}

/** Bumped after each collection, so the sources view reloads its reports. */
const collectedVersion = ref(0);
function onSourcesNotice({ text, tone = "info", retry }: { text: string; tone?: "info" | "error"; retry?: () => void }): void {
  say(text, tone, retry ? { label: "Повторить", run: retry } : undefined);
}

function onCollectionEvent(event: CollectionEvent): void {
  if (event.type === "start") progress.value = { done: 0, total: event.total, added: 0 };
  if (event.type === "source") {
    progress.value = { done: event.done, total: event.total, added: (progress.value?.added ?? 0) + event.added };
    if (event.added) scheduleRefresh();
  }
  if (event.type === "done") {
    scheduleRefresh();
    collectedVersion.value += 1;
    const summary = event.added ? `Добавлено новых вакансий: ${event.added}.` : "Новых вакансий нет.";
    const failures = describeFailures(event.errors);
    if (failures) say(`${summary} ${failures}`, "warning");
    else say(summary);
  }
  if (event.type === "error") say(`Сбор прервался: ${event.message}. Найденные до этого вакансии сохранены.`, "error", { label: "Собрать заново", run: () => void collect() });
}

/** Reads the NDJSON progress stream: one JSON event per line. */
async function collect(): Promise<void> {
  if (collecting.value) return;
  collecting.value = true;
  dismissNotice();
  try {
    const response = await fetch("/api/collect", { method: "POST" });
    if (response.status === 409) return void say("Сбор уже идёт в другой вкладке. Новые вакансии появятся здесь после обновления страницы.");
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) if (line.trim()) onCollectionEvent(JSON.parse(line) as CollectionEvent);
    }
  } catch {
    say("Связь со сбором прервалась. Сервер продолжает сбор и сохраняет вакансии, они появятся после обновления.", "error", { label: "Обновить очередь", run: () => void refresh() });
  } finally {
    collecting.value = false;
    progress.value = undefined;
  }
}

function onKey(event: KeyboardEvent): void {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
  // Browser shortcuts (Alt+← is Back, Ctrl+L is the address bar) must never decide a vacancy.
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  // The sources view has no card to decide on.
  if (view.value === "sources") return;
  const key = event.key.toLowerCase();
  if (view.value === "liked") {
    if (key === "escape") { removeMenuId.value = undefined; return; }
    if (key === "arrowdown" || key === "j") { event.preventDefault(); focusLiked(focusIndex.value + 1); return; }
    if (key === "arrowup" || key === "k") { event.preventDefault(); focusLiked(focusIndex.value - 1); return; }
    if (event.repeat || !focusedLiked.value) return;
    // U and X here take the focused card out of the list; undo is the toast's button.
    if (key === "u") removeLiked(focusedLiked.value, "new");
    if (key === "x") removeLiked(focusedLiked.value, "rejected");
    if (key === "arrowright" || key === "o") openInBackground(focusedLiked.value.url);
    return;
  }
  // A held key would otherwise decide a whole run of cards.
  if (event.repeat) return;
  if (key === "u") return undoReject();
  if (key === "arrowright" || key === "l") void setStatus("liked", true);
  if (key === "arrowleft" || key === "x") reject();
}
function onTouchStart(event: TouchEvent): void { touchStart.value = event.changedTouches[0]?.clientX; }
function onTouchEnd(event: TouchEvent): void {
  if (touchStart.value === undefined || view.value !== "new") return;
  const delta = event.changedTouches[0]?.clientX - touchStart.value;
  if (delta > 90) void setStatus("liked", true);
  if (delta < -90) reject();
  touchStart.value = undefined;
}
// Closing the tab inside the undo window still records the rejection.
function onPageHide(): void { flushPendingReject(true); }
onMounted(() => {
  void load();
  window.addEventListener("keydown", onKey);
  window.addEventListener("pagehide", onPageHide);
  document.addEventListener("click", closeRemoveMenu);
});
onUnmounted(() => {
  window.removeEventListener("keydown", onKey);
  window.removeEventListener("pagehide", onPageHide);
  document.removeEventListener("click", closeRemoveMenu);
});
</script>

<template>
  <main class="app-shell" :class="{ 'feed-mode': showFeed }">
    <header class="topbar">
      <a class="wordmark" href="/" aria-label="Worklooker">worklooker</a>
      <nav aria-label="Разделы">
        <button :class="{ active: view === 'new' }" :aria-pressed="view === 'new'" @click="view = 'new'">Очередь <span>{{ queueCount }}</span></button>
        <button :class="{ active: view === 'liked' }" :aria-pressed="view === 'liked'" @click="view = 'liked'">Лайкнутые <span>{{ likedCount }}</span></button>
        <button :class="{ active: view === 'sources' }" :aria-pressed="view === 'sources'" @click="view = 'sources'">Источники</button>
      </nav>
      <button class="collect" :disabled="collecting" @click="collect">{{ !collecting ? 'Обновить' : progress?.total ? `Сбор ${progress.done}/${progress.total}` : 'Сбор…' }}</button>
    </header>
    <div v-if="collecting" class="collect-progress" role="progressbar" aria-label="Сбор вакансий" :aria-valuenow="progress?.done ?? 0" :aria-valuemax="progress?.total || undefined">
      <span :style="{ width: progress?.total ? `${(progress.done / progress.total) * 100}%` : '0%' }"></span>
    </div>

    <!-- Always mounted, so screen readers announce messages inserted into it. -->
    <div class="status-strip" role="status" aria-live="polite">
      <div v-if="notice" class="status-message" :data-tone="notice.tone">
        <p>{{ notice.text }}</p>
        <button v-if="notice.action" type="button" class="status-action" @click="runNoticeAction">{{ notice.action.label }}</button>
        <button type="button" class="status-close" aria-label="Закрыть сообщение" @click="dismissNotice"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg></button>
      </div>
    </div>

    <section v-if="showFeed" ref="feedEl" class="liked-feed" aria-label="Лайкнутые вакансии" @scroll.passive="onFeedScroll">
      <article
        v-for="(vacancy, index) in likedCards"
        :key="vacancy.id"
        class="liked-card"
        :class="{ focused: index === focusIndex, before: index < focusIndex, after: index > focusIndex, expanded: likedExpandedId === vacancy.id }"
        :aria-current="index === focusIndex ? 'true' : undefined"
        @click.capture="onLikedCardClick($event, index)"
      >
        <!-- The visual card: blur and drift happen here, never on the snapped box. -->
        <div class="liked-card-body">
          <header class="vacancy-meta">
            <span class="meta-line"><span class="source">{{ vacancy.sourceName }}</span><span v-if="likedLabel(vacancy)" class="age">{{ likedLabel(vacancy) }}</span></span>
            <span class="fit" :data-tone="fitTone(vacancy.score)">{{ fitLabel(vacancy.score) }}</span>
          </header>
          <p v-if="vacancy.author" class="author">Разместил: {{ vacancy.author }}</p>
          <h2>{{ vacancy.title }}</h2>
          <p v-if="vacancy.company" class="company">{{ vacancy.company }}</p>
          <ul class="reasons" aria-label="Почему вакансия подошла"><li v-for="reason in vacancy.reasons" :key="reason">{{ reason }}</li></ul>
          <p class="snippet">{{ vacancy.snippet || 'Описание есть на странице вакансии.' }}</p>
          <dl v-if="likedExpandedId === vacancy.id" class="details">
            <div><dt>Источник</dt><dd>{{ vacancy.sourceName }}</dd></div>
            <div v-if="vacancy.publishedAt"><dt>{{ vacancy.publishedAtSource === 'source' ? 'Опубликована' : 'Найдена' }}</dt><dd>{{ formatDateTime(vacancy.publishedAt) }}</dd></div>
            <div><dt>Последний сбор</dt><dd>{{ formatDateTime(vacancy.fetchedAt) }}</dd></div>
            <div><dt>Ссылка</dt><dd><a class="detail-link" :href="vacancy.url" target="_blank" rel="noreferrer" :tabindex="index === focusIndex ? 0 : -1">{{ vacancy.url }}</a></dd></div>
          </dl>
          <!-- Same row as the queue card: details on the left, actions on the right. -->
          <footer class="vacancy-actions">
            <button type="button" class="details-toggle" :aria-expanded="likedExpandedId === vacancy.id" :tabindex="index === focusIndex ? 0 : -1" @click="toggleLikedDetails(vacancy)">{{ likedExpandedId === vacancy.id ? 'Свернуть' : 'Подробнее' }}</button>
            <div class="decision-dock">
              <!-- One way out of the list: back to the queue now, or rejected from the menu. -->
              <div class="remove-split">
                <button type="button" class="secondary" :tabindex="index === focusIndex ? 0 : -1" @click="removeLiked(vacancy, 'new')"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></svg><span>В очередь</span><kbd aria-hidden="true">U</kbd></button>
                <button type="button" class="secondary remove-caret" aria-label="Другие действия" aria-haspopup="menu" :aria-expanded="removeMenuId === vacancy.id" :tabindex="index === focusIndex ? 0 : -1" @click="toggleRemoveMenu(vacancy)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg></button>
                <div v-if="removeMenuId === vacancy.id" class="remove-menu" role="menu">
                  <button type="button" role="menuitem" @click="removeLiked(vacancy, 'rejected')"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg><span>Отклонить</span><kbd aria-hidden="true">X</kbd></button>
                </div>
              </div>
              <a class="like" :href="vacancy.url" target="_blank" rel="noreferrer" :tabindex="index === focusIndex ? 0 : -1"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6" /><path d="M20 4 11 13" /><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" /></svg><span>Открыть<span class="wide-only"> вакансию</span></span><kbd aria-hidden="true">→</kbd></a>
            </div>
          </footer>
        </div>
      </article>
      <div v-if="!likedExpandedId" class="feed-help">
        <span class="feed-position" aria-live="polite">{{ focusIndex + 1 }} из {{ likedCards.length }}</span>
      </div>
    </section>

    <SourcesView v-else-if="view === 'sources'" :collected-version="collectedVersion" @notice="onSourcesNotice" />

    <section v-else class="feed" @touchstart.passive="onTouchStart" @touchend.passive="onTouchEnd">
      <div v-if="loading" class="state">Загружаем вашу очередь…</div>
      <div v-else-if="view === 'liked' || !current" class="state empty">
        <template v-if="view === 'new' && collecting">
          <span class="loader-ring" aria-hidden="true"></span>
          <h1>Ищем вакансии</h1>
          <p>Первые появятся здесь, как только ответит один из источников.</p>
        </template>
        <template v-else>
          <h1>{{ view === 'liked' ? 'Лайкнутых пока нет' : 'Очередь чиста' }}</h1>
          <p>{{ view === 'liked' ? 'Сохранённые вакансии появятся здесь.' : 'Запустите сбор, чтобы увидеть подходящие вакансии.' }}</p>
          <button v-if="view === 'new'" class="primary" @click="collect">Собрать вакансии</button>
        </template>
      </div>
      <div v-else class="card-stack" :key="current.id">
        <article class="vacancy" :class="{ expanded }">
          <header class="vacancy-meta">
            <span class="meta-line"><span class="source">{{ current.sourceName }}</span><span v-if="ageLabel(current)" class="age">{{ ageLabel(current) }}</span></span>
            <span class="fit" :data-tone="fitTone(current.score)">{{ fitLabel(current.score) }}</span>
          </header>
          <div class="copy">
            <p v-if="current.author" class="author">Разместил: {{ current.author }}</p>
            <h1>{{ current.title }}</h1>
            <p v-if="current.company" class="company">{{ current.company }}</p>
            <ul class="reasons" aria-label="Почему вакансия в очереди"><li v-for="reason in current.reasons" :key="reason">{{ reason }}</li></ul>
            <p class="snippet">{{ current.snippet || 'Описание есть на странице вакансии.' }}</p>
            <dl v-if="expanded" class="details">
              <div><dt>Источник</dt><dd>{{ current.sourceName }}</dd></div>
              <div v-if="current.publishedAt"><dt>{{ current.publishedAtSource === 'source' ? 'Опубликована' : 'Найдена' }}</dt><dd>{{ formatDateTime(current.publishedAt) }}</dd></div>
              <div><dt>Последний сбор</dt><dd>{{ formatDateTime(current.fetchedAt) }}</dd></div>
              <div><dt>Ссылка</dt><dd><a class="detail-link" :href="current.url" target="_blank" rel="noreferrer">{{ current.url }}</a></dd></div>
            </dl>
          </div>
          <!-- Actions live inside the card, like the liked feed: details on the left, the decision on the right. -->
          <footer class="vacancy-actions">
            <button type="button" class="details-toggle" :aria-expanded="expanded" @click="expanded = !expanded">{{ expanded ? 'Свернуть' : 'Подробнее' }}</button>
            <div class="decision-dock">
              <button class="reject" aria-label="Отклонить вакансию" @click="reject()"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg><span>Отклонить</span><kbd aria-hidden="true">←</kbd></button>
              <button class="like" aria-label="Сохранить и открыть вакансию" @click="setStatus('liked', true)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.9-8.6a5.5 5.5 0 0 0-.1-7.8Z" /></svg><span>Сохранить</span><kbd aria-hidden="true">→</kbd></button>
            </div>
          </footer>
        </article>
      </div>
    </section>

    <div v-if="pendingReject" :key="pendingReject.vacancy.id" class="undo-toast" role="status">
      <p>Отклонено: <strong>{{ pendingReject.title }}</strong></p>
      <!-- In the liked list U sends a card to the queue, so undo is the button alone there. -->
      <button type="button" @click="undoReject">Вернуть <kbd v-if="view !== 'liked'">U</kbd></button>
      <span class="undo-timer" aria-hidden="true" :style="{ animationDuration: `${undoWindowMs}ms` }"></span>
    </div>
  </main>
</template>
