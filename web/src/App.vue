<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";

type Status = "new" | "liked" | "rejected";
type Vacancy = { id: string; title: string; author?: string; company?: string; sourceName: string; url: string; snippet: string; fetchedAt: string; score: number; reasons: string[]; status: Status };
type View = "new" | "liked";

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

// A capitalised first and last name, followed by a role. The name check must be
// case-sensitive and the role check case-insensitive, so they are separate.
const authorName = /^([А-ЯЁ][а-яё-]+\s+[А-ЯЁ][а-яё-]+)\s+/u;
const roleStart = /^(?:head\s+of|frontend|front-end|tech(?:nical)?\s+lead|cto|senior|staff|principal|lead|middle|разработчик[а-яё]*|фронтенд[а-яё]*|техлид[а-яё]*|руководител[а-яё]*)(?![\p{L}\p{N}_])/iu;
function authorOf(text: string): string | undefined {
  const match = text.match(authorName);
  return match && roleStart.test(text.slice(match[0].length)) ? match[1] : undefined;
}
const titleBoundary = /[📍💎🚀]|(?<![\p{L}\p{N}_])(?:remote|удал[её]н|опыт|experience|требован|команда|услови)/iu;
function presentation(vacancy: Vacancy | undefined): { title: string; author?: string; snippet: string } | undefined {
  if (!vacancy) return undefined;
  const raw = vacancy.title.replace(/\s+/g, " ").replace(/^(?:#[\p{L}\d_]+\s*)+/u, "").replace(/^(?:→\s*)?(?:откликнуться\s+)?тут\s+/i, "").trim();
    const author = vacancy.author ?? authorOf(raw);
  const titleStart = author ? raw.slice(author.length).trim() : raw;
  const boundary = titleStart.search(titleBoundary);
  const title = titleStart.slice(0, boundary > 20 ? boundary : 120).trim() || raw;
  const intro = [author, title].filter(Boolean).join(" ");
  const withoutIntro = intro ? vacancy.snippet.replace(phrasePattern(intro), "") : vacancy.snippet;
  const snippet = tidyLines(author ? withoutIntro.replace(phrasePattern(author), "") : withoutIntro);
  return { title, ...(author ? { author } : {}), snippet };
}

/** Matches a phrase whatever whitespace, including line breaks, separates its words. */
function phrasePattern(phrase: string): RegExp {
  return new RegExp(phrase.trim().split(/\s+/).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(String.raw`\s+`), "g");
}

/** Keeps the description's line breaks, at most one blank line in a row. */
function tidyLines(text: string): string {
  return text.split("\n").map((line) => line.replace(/[^\S\n]+/g, " ").trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
const card = computed(() => presentation(current.value));

// Liked jobs read as a scrolling feed: the card nearest the middle is in focus,
// the others are blurred and drift away from it.
const likedCards = computed(() => vacancies.value
  .filter((vacancy) => vacancy.status === "liked")
  .map((vacancy) => ({ vacancy, text: presentation(vacancy)! })));
const feedEl = ref<HTMLElement>();
const focusIndex = ref(0);
const focusedLiked = computed(() => likedCards.value[focusIndex.value]?.vacancy);
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
    let nearest = 0;
    let nearestDistance = Infinity;
    feedCards().forEach((element, index) => {
      const distance = Math.abs(element.offsetTop + element.offsetHeight / 2 - middle);
      if (distance < nearestDistance) { nearest = index; nearestDistance = distance; }
    });
    focusIndex.value = nearest;
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
type PendingReject = { vacancy: Vacancy; title: string; timer: number };
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
  pendingReject.value = { vacancy: target, title: presentation(target)?.title ?? target.title, timer: window.setTimeout(() => flushPendingReject(), undoWindowMs) };
  vacancies.value = withLocalStatus(vacancies.value, target.id, "rejected");
  expanded.value = false;
}

function undoReject(): void {
  const pending = pendingReject.value;
  if (!pending) return;
  window.clearTimeout(pending.timer);
  pendingReject.value = undefined;
  vacancies.value = withLocalStatus(vacancies.value, pending.vacancy.id, "new");
}

function flushPendingReject(keepalive = false): void {
  const pending = pendingReject.value;
  if (!pending) return;
  window.clearTimeout(pending.timer);
  pendingReject.value = undefined;
  void setStatus("rejected", false, pending.vacancy, keepalive);
}

function describeFailures(errors: string[]): string {
  const blocked: string[] = [];
  const silent: string[] = [];
  for (const error of errors) {
    const separator = error.indexOf(": ");
    const name = separator > 0 ? error.slice(0, separator) : error;
    const reason = separator > 0 ? error.slice(separator + 2) : "";
    // 4xx, closed previews and login walls will not fix themselves on retry.
    (/HTTP 4\d\d|закрыл|captcha|авториз/i.test(reason) ? blocked : silent).push(name);
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
    const title = presentation(target)?.title ?? target.title;
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

function formatFetchedAt(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

type CollectionEvent =
  | { type: "start"; total: number }
  | { type: "source"; sourceName: string; done: number; total: number; added: number; error?: string }
  | { type: "done"; added: number; errors: string[] }
  | { type: "error"; message: string };

function onCollectionEvent(event: CollectionEvent): void {
  if (event.type === "start") progress.value = { done: 0, total: event.total, added: 0 };
  if (event.type === "source") {
    progress.value = { done: event.done, total: event.total, added: (progress.value?.added ?? 0) + event.added };
    if (event.added) scheduleRefresh();
  }
  if (event.type === "done") {
    scheduleRefresh();
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
  const key = event.key.toLowerCase();
  if (view.value === "liked") {
    if (key === "arrowdown" || key === "j") { event.preventDefault(); focusLiked(focusIndex.value + 1); return; }
    if (key === "arrowup" || key === "k") { event.preventDefault(); focusLiked(focusIndex.value - 1); return; }
    if (event.repeat || !focusedLiked.value) return;
    if (key === "u" || key === "arrowleft") void setStatus("new", false, focusedLiked.value);
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
});
onUnmounted(() => {
  window.removeEventListener("keydown", onKey);
  window.removeEventListener("pagehide", onPageHide);
});
</script>

<template>
  <main class="app-shell" :class="{ 'feed-mode': showFeed }">
    <header class="topbar">
      <a class="wordmark" href="/" aria-label="Worklooker">worklooker</a>
      <nav aria-label="Разделы">
        <button :class="{ active: view === 'new' }" :aria-pressed="view === 'new'" @click="view = 'new'">Очередь <span>{{ queueCount }}</span></button>
        <button :class="{ active: view === 'liked' }" :aria-pressed="view === 'liked'" @click="view = 'liked'">Лайкнутые <span>{{ likedCount }}</span></button>
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
        v-for="({ vacancy, text }, index) in likedCards"
        :key="vacancy.id"
        class="liked-card"
        :class="{ focused: index === focusIndex, before: index < focusIndex, after: index > focusIndex }"
        :aria-current="index === focusIndex ? 'true' : undefined"
        @click.capture="onLikedCardClick($event, index)"
      >
        <!-- The visual card: blur and drift happen here, never on the snapped box. -->
        <div class="liked-card-body">
          <header class="vacancy-meta">
            <span class="source">{{ vacancy.sourceName }}</span>
            <span class="fit" :data-tone="fitTone(vacancy.score)">{{ fitLabel(vacancy.score) }}</span>
          </header>
          <p v-if="text.author" class="author">Разместил: {{ text.author }}</p>
          <h2>{{ text.title }}</h2>
          <p v-if="vacancy.company" class="company">{{ vacancy.company }}</p>
          <ul class="reasons" aria-label="Почему вакансия подошла"><li v-for="reason in vacancy.reasons" :key="reason">{{ reason }}</li></ul>
          <p class="snippet">{{ text.snippet || 'Описание есть на странице вакансии.' }}</p>
          <footer class="liked-actions">
            <button type="button" class="secondary" :tabindex="index === focusIndex ? 0 : -1" @click="setStatus('new', false, vacancy)">Вернуть в очередь</button>
            <a class="like link-action" :href="vacancy.url" target="_blank" rel="noreferrer" :tabindex="index === focusIndex ? 0 : -1">Открыть вакансию</a>
          </footer>
        </div>
      </article>
      <div class="feed-help">
        <span class="feed-position" aria-live="polite">{{ focusIndex + 1 }} из {{ likedCards.length }}</span>
        <span><kbd>↑</kbd><kbd>↓</kbd> листать · <kbd>U</kbd> вернуть · <kbd>→</kbd> открыть</span>
      </div>
    </section>

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
        <article class="vacancy" :class="{ expanded }" @click="expanded = !expanded">
          <header class="vacancy-meta">
            <span class="source">{{ current.sourceName }}</span>
            <span class="fit" :data-tone="fitTone(current.score)">{{ fitLabel(current.score) }}</span>
          </header>
          <div class="copy">
            <p v-if="card?.author" class="author">Разместил: {{ card.author }}</p>
            <h1>{{ card?.title }}</h1>
            <p v-if="current.company" class="company">{{ current.company }}</p>
            <ul class="reasons" aria-label="Почему вакансия в очереди"><li v-for="reason in current.reasons" :key="reason">{{ reason }}</li></ul>
            <p class="snippet">{{ card?.snippet || 'Описание есть на странице вакансии.' }}</p>
            <dl v-if="expanded" class="details">
              <div><dt>Источник</dt><dd>{{ current.sourceName }}</dd></div>
              <div><dt>Добавлено</dt><dd>{{ formatFetchedAt(current.fetchedAt) }}</dd></div>
              <div><dt>Ссылка</dt><dd><a class="detail-link" :href="current.url" target="_blank" rel="noreferrer" @click.stop>{{ current.url }}</a></dd></div>
            </dl>
          </div>
          <button type="button" class="details-toggle" :aria-expanded="expanded" @click.stop="expanded = !expanded">{{ expanded ? 'Свернуть' : 'Подробнее' }}</button>
        </article>
        <div class="decision-dock" @click.stop>
          <button class="reject" aria-label="Отклонить вакансию" @click="reject()"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg><span>Отклонить</span></button>
          <button class="like" aria-label="Сохранить и открыть вакансию" @click="setStatus('liked', true)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.9-8.6a5.5 5.5 0 0 0-.1-7.8Z" /></svg><span>Сохранить</span></button>
        </div>
      </div>
    </section>

    <div v-if="pendingReject" :key="pendingReject.vacancy.id" class="undo-toast" role="status">
      <p>Отклонено: <strong>{{ pendingReject.title }}</strong></p>
      <button type="button" @click="undoReject">Вернуть <kbd>U</kbd></button>
      <span class="undo-timer" aria-hidden="true" :style="{ animationDuration: `${undoWindowMs}ms` }"></span>
    </div>
  </main>
</template>
