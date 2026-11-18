import { mkdir, readFile, writeFile } from "node:fs/promises";
import { TelegramClient } from "teleproto";
import { StringSession } from "teleproto/sessions";
import { wantApplyBotSource } from "./sources.js";
import type { Vacancy } from "./types.js";

const sessionPath = "data/telegram.session";
let localEnvironmentLoaded = false;

interface TelegramCredentials {
  apiId: number;
  apiHash: string;
}

async function loadLocalEnvironment(): Promise<void> {
  if (localEnvironmentLoaded) return;
  localEnvironmentLoaded = true;
  try {
    const contents = await readFile(".env", "utf8");
    for (const line of contents.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!match || process.env[match[1]] !== undefined) continue;
      process.env[match[1]] = match[2].replace(/^(["'])(.*)\1$/, "$2");
    }
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function credentialsFromEnvironment(): Promise<TelegramCredentials | undefined> {
  await loadLocalEnvironment();
  const apiId = Number(process.env.TELEGRAM_API_ID);
  const apiHash = process.env.TELEGRAM_API_HASH?.trim();
  return Number.isInteger(apiId) && apiId > 0 && apiHash ? { apiId, apiHash } : undefined;
}

async function readSession(): Promise<string | undefined> {
  try {
    return (await readFile(sessionPath, "utf8")).trim() || undefined;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function telegramSetupIsConfigured(): Promise<boolean> {
  return (await credentialsFromEnvironment()) !== undefined;
}

export async function wantApplyBotIsReady(): Promise<boolean> {
  return (await telegramSetupIsConfigured()) && (await readSession()) !== undefined;
}

function messageTitle(text: string): string {
  return text.split(/\r?\n/).find((line) => line.trim())?.replace(/^#+\s*/, "").trim().slice(0, 160) || "Вакансия из WantApply";
}

/** Reads messages already visible to the user's own Telegram account. */
export async function scrapeWantApplyBot(): Promise<Vacancy[]> {
  const credentials = await credentialsFromEnvironment();
  const savedSession = await readSession();
  if (!credentials || !savedSession) return [];

  const client = new TelegramClient(new StringSession(savedSession), credentials.apiId, credentials.apiHash, { connectionRetries: 3 });
  try {
    await client.connect();
    const vacancies: Vacancy[] = [];
    for await (const message of client.iterMessages("wantapply_bot", { limit: 100 })) {
      const text = message.message?.trim();
      if (!text) continue;
      const url = message.buttons?.flat().map((button) => button.url).find((candidate): candidate is string => Boolean(candidate)) ?? wantApplyBotSource.url;
      vacancies.push({
        source: wantApplyBotSource.id,
        sourceName: wantApplyBotSource.name,
        title: messageTitle(text),
        url,
        snippet: text.slice(0, 1_500),
        remoteByDefault: false,
        fetchedAt: new Date().toISOString(),
      });
    }
    return vacancies;
  } finally {
    await client.disconnect();
  }
}

export async function loginTelegram(): Promise<void> {
  const credentials = await credentialsFromEnvironment();
  if (!credentials) throw new Error("Укажите TELEGRAM_API_ID и TELEGRAM_API_HASH перед входом.");
  const readline = await import("node:readline/promises");
  const terminal = readline.createInterface({ input: process.stdin, output: process.stdout });
  const session = new StringSession("");
  const client = new TelegramClient(session, credentials.apiId, credentials.apiHash, { connectionRetries: 3 });
  try {
    await client.start({
      phoneNumber: () => terminal.question("Номер телефона в международном формате: "),
      password: () => terminal.question("Пароль двухэтапной проверки (если есть): "),
      phoneCode: () => terminal.question("Код из Telegram: "),
      onError: (error) => { console.error(error.message); },
    });
    await mkdir("data", { recursive: true });
    await writeFile(sessionPath, client.session.save(), { mode: 0o600 });
    console.log("Telegram-сессия сохранена локально в data/telegram.session.");
  } finally {
    terminal.close();
    await client.disconnect();
  }
}
