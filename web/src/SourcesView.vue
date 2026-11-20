<script setup lang="ts">
/*
 * Sources view: what each source's last collection found, how much of it
 * passed the profile, why the rest was dropped, and how the user's decisions
 * on it went. A source can be switched off here.
 */
import { computed, onMounted, ref, watch } from "vue";
import type { SourceDropReason, SourceReport, SourceSummary } from "../../src/api";
import { formatDateTime, percent, plural } from "./format";

type DropGroup = NonNullable<SourceReport["dropped"][SourceDropReason]>;
type Notice = { text: string; tone?: "info" | "error"; retry?: () => void };

/** Changes when a collection finishes, so the view reloads its reports. */
const props = defineProps<{ collectedVersion: number }>();
const emit = defineEmits<{ notice: [notice: Notice] }>();

const rows = ref<SourceSummary[]>([]);
const loading = ref(true);

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
const sorted = computed(() => [...rows.value].sort((a, b) =>
  (passRate(b) ?? -1) - (passRate(a) ?? -1) || a.name.localeCompare(b.name)));
function isLowRate(row: SourceSummary): boolean {
  const rate = passRate(row);
  return row.enabled && rate !== undefined && rate < lowPassRate;
}
function status(row: SourceSummary): string {
  if (!row.enabled) return "Выключен";
  if (!row.report) return "Ещё не собирался";
  const when = formatDateTime(row.report.collectedAt);
  return row.report.error ? `Ошибка ${when}: ${row.report.error}` : `Собран ${when}`;
}
function decisions(row: SourceSummary): string {
  const decided = row.liked + row.rejected;
  return decided ? `${row.liked} ${plural(row.liked, "лайк", "лайка", "лайков")} из ${decided}` : "пока нет";
}
function droppedGroups(report: SourceReport): Array<{ reason: SourceDropReason; group: DropGroup }> {
  return Object.entries(report.dropped)
    .map(([reason, group]) => ({ reason: reason as SourceDropReason, group: group! }))
    .sort((a, b) => b.group.count - a.group.count);
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

onMounted(load);
watch(() => props.collectedVersion, () => void load());
</script>

<template>
  <section class="sources" aria-label="Источники">
    <div v-if="loading" class="state">Загружаем источники…</div>
    <ol v-else class="source-sheet">
      <li v-for="row in sorted" :key="row.id" class="source-row">
        <header class="source-head">
          <div class="source-title">
            <h2><a :href="row.url" target="_blank" rel="noreferrer">{{ row.name }}</a></h2>
            <p class="source-status" :data-tone="!row.enabled ? 'off' : row.report?.error ? 'error' : undefined">{{ status(row) }}</p>
          </div>
          <span v-if="isLowRate(row)" class="low-rate">кандидат на выключение</span>
          <button type="button" class="secondary" @click="toggle(row)">{{ row.enabled ? 'Выключить' : 'Включить' }}</button>
        </header>
        <template v-if="row.report && !row.report.error">
          <dl class="source-stats">
            <div><dt>Доля прохода</dt><dd>{{ passRate(row) === undefined ? '—' : percent(passRate(row)!) }} <span>{{ row.report.matched }} из {{ row.report.found }}</span></dd></div>
            <div><dt>Новых за сбор</dt><dd>{{ row.report.added }}</dd></div>
            <div><dt>В очереди</dt><dd>{{ row.queued }}</dd></div>
            <div><dt>Ваши решения</dt><dd>{{ decisions(row) }}</dd></div>
          </dl>
          <details v-for="{ reason, group } in droppedGroups(row.report)" :key="reason" class="drop-reason">
            <summary>{{ dropLabels[reason] }} — {{ group.count }} <span>({{ percent(group.count / row.report.found) }})</span></summary>
            <ul>
              <li v-for="(example, index) in group.examples" :key="index">
                <a :href="example.url" target="_blank" rel="noreferrer">{{ example.title }}</a>
                <span v-if="example.detail" class="drop-detail">«{{ example.detail }}»</span>
              </li>
            </ul>
            <p v-if="group.count > group.examples.length" class="drop-more">и ещё {{ group.count - group.examples.length }}</p>
          </details>
        </template>
      </li>
    </ol>
  </section>
</template>
