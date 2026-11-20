<script setup lang="ts">
/*
 * Sources view: what each source's last collection yielded, why the rest was
 * dropped, and how the user's decisions on it went. Sources that need
 * attention come first; switched-off ones sit at the end. A source can be
 * switched off here.
 */
import { computed, onMounted, ref, watch } from "vue";
import type { SourceDropReason, SourceReport, SourceSummary } from "../../src/api";
import { formatWhen, percent, plural } from "./format";

type DropGroup = NonNullable<SourceReport["dropped"][SourceDropReason]>;
type Notice = { text: string; tone?: "info" | "error"; retry?: () => void };

/** Changes when a collection finishes, so the view reloads its reports. */
const props = defineProps<{ collectedVersion: number }>();
const emit = defineEmits<{ notice: [notice: Notice] }>();

const rows = ref<SourceSummary[]>([]);
const loading = ref(true);
const pendingDisable = ref<string>();
/** The one drop reason whose examples are open, if any. */
const openReason = ref<{ sourceId: string; reason: SourceDropReason }>();

const dropLabels: Record<SourceDropReason, string> = {
  notTargetRole: "не целевая роль",
  notRemote: "не удалёнка",
  russia: "РФ",
  excludedRole: "исключённая роль",
  blocker: "блокер",
  stale: "старый пост",
  lowScore: "низкая оценка",
};
/** Below this pass rate a source is mostly noise. */
const lowPassRate = 0.02;

function passRate(row: SourceSummary): number | undefined {
  return row.report && !row.report.error && row.report.found ? row.report.matched / row.report.found : undefined;
}
function isLowRate(row: SourceSummary): boolean {
  const rate = passRate(row);
  return row.enabled && rate !== undefined && rate < lowPassRate;
}
function needsAttention(row: SourceSummary): boolean {
  return row.enabled && (Boolean(row.report?.error) || isLowRate(row));
}
const byRate = (a: SourceSummary, b: SourceSummary) => (passRate(b) ?? -1) - (passRate(a) ?? -1) || a.name.localeCompare(b.name);
const groups = computed(() => [
  { id: "attention", title: "Стоит проверить", rows: rows.value.filter(needsAttention).sort(byRate) },
  { id: "working", title: "Работают", rows: rows.value.filter((row) => row.enabled && !needsAttention(row)).sort(byRate) },
  { id: "off", title: "Выключены", rows: rows.value.filter((row) => !row.enabled).sort((a, b) => a.name.localeCompare(b.name)) },
].filter((group) => group.rows.length));
const enabledCount = computed(() => rows.value.filter((row) => row.enabled).length);

function status(row: SourceSummary): string {
  if (!row.enabled) return "Выключен";
  if (!row.report) return "Ещё не собирался";
  const when = formatWhen(row.report.collectedAt);
  if (row.report.error) return `Ошибка ${when}: ${row.report.error}`;
  if (isLowRate(row)) return `Собран ${when} · почти всё отсеивается`;
  return `Собран ${when}`;
}
function decided(row: SourceSummary): number {
  return row.liked + row.rejected;
}
function added(row: SourceSummary): number {
  return row.report && !row.report.error ? row.report.added : 0;
}
/** Spoken form of the heart figure, for screen readers. */
function likesLabel(row: SourceSummary): string {
  return `${row.liked} ${plural(row.liked, "лайк", "лайка", "лайков")} из ${decided(row)} ${plural(decided(row), "решения", "решений", "решений")}`;
}
function droppedGroups(report: SourceReport): Array<{ reason: SourceDropReason; group: DropGroup }> {
  return Object.entries(report.dropped)
    .map(([reason, group]) => ({ reason: reason as SourceDropReason, group: group! }))
    .sort((a, b) => b.group.count - a.group.count);
}
/** Width of one part of the yield bar; a sliver stays visible. */
function share(count: number, report: SourceReport): string {
  return `max(3px, ${(count / report.found) * 100}%)`;
}

function isOpen(row: SourceSummary, reason: SourceDropReason): boolean {
  return openReason.value?.sourceId === row.id && openReason.value.reason === reason;
}
function toggleReason(row: SourceSummary, reason: SourceDropReason): void {
  openReason.value = isOpen(row, reason) ? undefined : { sourceId: row.id, reason };
}
function openGroup(row: SourceSummary): { reason: SourceDropReason; group: DropGroup } | undefined {
  if (openReason.value?.sourceId !== row.id || !row.report) return undefined;
  const group = row.report.dropped[openReason.value.reason];
  return group ? { reason: openReason.value.reason, group } : undefined;
}

async function load(): Promise<void> {
  try {
    const response = await fetch("/api/sources");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    rows.value = await response.json() as SourceSummary[];
  } catch {
    emit("notice", { text: "Не удалось загрузить источники: локальный API не отвечает.", tone: "error", retry: () => void load() });
  } finally { loading.value = false; }
}

async function toggle(row: SourceSummary): Promise<void> {
  const enabled = !row.enabled;
  row.enabled = enabled;
  try {
    const response = await fetch(`/api/sources/${encodeURIComponent(row.id)}/enabled`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled }) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    emit("notice", { text: enabled ? `${row.name} снова собирается со следующего сбора.` : `${row.name} выключен: его карточки убраны из очереди.` });
    if (!enabled) void load();
  } catch {
    row.enabled = !enabled;
    emit("notice", { text: `Не удалось ${enabled ? "включить" : "выключить"} ${row.name}: локальный API не ответил.`, tone: "error", retry: () => void toggle(row) });
  }
}

/** Disabling also removes queued cards, so ask in the row before committing it. */
function requestToggle(row: SourceSummary): void {
  if (!row.enabled) return void toggle(row);
  pendingDisable.value = row.id;
}
function cancelDisable(): void { pendingDisable.value = undefined; }
function confirmDisable(row: SourceSummary): void {
  pendingDisable.value = undefined;
  void toggle(row);
}

onMounted(load);
watch(() => props.collectedVersion, () => void load());
</script>

<template>
  <section class="sources" aria-label="Источники">
    <div v-if="loading" class="state">Загружаем источники…</div>
    <section v-else class="source-sheet">
      <header class="source-summary">
        <h1>Источники</h1>
        <p>{{ rows.length }} {{ plural(rows.length, "источник", "источника", "источников") }} · включено {{ enabledCount }}</p>
      </header>

      <section v-for="group in groups" :key="group.id" class="source-group" :data-group="group.id" :aria-labelledby="`source-group-${group.id}`">
        <h2 :id="`source-group-${group.id}`">{{ group.title }} <span>{{ group.rows.length }}</span></h2>
        <ol class="source-list">
          <li v-for="row in group.rows" :key="row.id" class="source-row">
            <div class="source-main">
              <h3><a :href="row.url" target="_blank" rel="noreferrer">{{ row.name }}</a></h3>
              <p class="source-status" :data-tone="row.report?.error && row.enabled ? 'error' : undefined">{{ status(row) }}</p>
              <p v-if="row.enabled && row.report" class="source-facts">
                <span>в очереди {{ row.queued }}</span>
                <span v-if="decided(row)" class="fact-likes" :aria-label="likesLabel(row)" :title="likesLabel(row)">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.9-8.6a5.5 5.5 0 0 0-.1-7.8Z" /></svg>{{ row.liked }} из {{ decided(row) }}
                </span>
                <span v-if="added(row)">+{{ added(row) }} {{ plural(added(row), "новая", "новые", "новых") }}</span>
              </p>
            </div>

            <div v-if="row.enabled && row.report && !row.report.error && row.report.found" class="source-yield">
              <p class="yield-figure"><strong>{{ percent(passRate(row)!) }}</strong> прошло · {{ row.report.matched }} из {{ row.report.found }}</p>
              <div class="yield-bar" aria-hidden="true">
                <span v-if="row.report.matched" class="yield-pass" :style="{ flexBasis: share(row.report.matched, row.report) }"></span>
                <span v-for="({ reason, group }, index) in droppedGroups(row.report)" :key="reason" class="yield-drop" :data-shade="Math.min(index, 3)" :style="{ flexBasis: share(group.count, row.report) }"></span>
              </div>
              <ul class="yield-legend" aria-label="Почему отсеяно">
                <li v-for="({ reason, group }, index) in droppedGroups(row.report)" :key="reason">
                  <button type="button" :aria-expanded="isOpen(row, reason)" :aria-controls="`drops-${row.id}`" @click="toggleReason(row, reason)">
                    <span class="swatch" :data-shade="Math.min(index, 3)" aria-hidden="true"></span><span class="legend-label">{{ dropLabels[reason] }}</span><span class="legend-count">{{ group.count }}</span>
                  </button>
                </li>
              </ul>
            </div>

            <div class="source-action">
              <!-- A power switch: filled while the source is collected, pale when it is off. -->
              <button
                type="button"
                role="switch"
                class="source-switch"
                :aria-checked="row.enabled"
                :aria-label="`${row.name}: ${row.enabled ? 'собирается' : 'выключен'}`"
                :title="row.enabled ? 'Выключить источник' : 'Включить источник'"
                @click="requestToggle(row)"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v8M6.3 6.8a8 8 0 1 0 11.4 0" /></svg>
              </button>
            </div>

            <!-- Its own line under the row, so the columns above do not move. -->
            <div v-if="pendingDisable === row.id" class="source-confirm" role="group" :aria-label="`Подтверждение выключения ${row.name}`">
              <span>Выключить {{ row.name }} и убрать его карточки из очереди?</span>
              <button type="button" class="secondary" @click="confirmDisable(row)">Выключить</button>
              <button type="button" class="text-action" @click="cancelDisable">Отмена</button>
            </div>

            <div v-if="openGroup(row)" :id="`drops-${row.id}`" class="drop-panel">
              <header>
                <h4>{{ dropLabels[openGroup(row)!.reason] }} <span>{{ openGroup(row)!.group.count }} из {{ row.report!.found }}</span></h4>
                <button type="button" class="text-action" @click="openReason = undefined">Свернуть</button>
              </header>
              <ul>
                <li v-for="(example, index) in openGroup(row)!.group.examples" :key="index">
                  <a :href="example.url" target="_blank" rel="noreferrer">{{ example.title }}</a>
                  <span v-if="example.detail" class="drop-detail">«{{ example.detail }}»</span>
                </li>
              </ul>
              <p v-if="openGroup(row)!.group.count > openGroup(row)!.group.examples.length" class="drop-more">
                и ещё {{ openGroup(row)!.group.count - openGroup(row)!.group.examples.length }} — показаны первые {{ openGroup(row)!.group.examples.length }}
              </p>
            </div>
          </li>
        </ol>
      </section>
    </section>
  </section>
</template>
