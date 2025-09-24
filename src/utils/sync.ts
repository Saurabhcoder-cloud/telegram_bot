import logger from "../logger";
import { sessionStore } from "../session";
import { createApiClient, isNetworkError } from "../services/apiClient";
import { UserProfile } from "../types";
import { config } from "../config";

interface ProfilePatchTask {
  chatId: number;
  payload: Partial<UserProfile>;
}

const profileQueue: ProfilePatchTask[] = [];
let flushInterval: NodeJS.Timeout | null = null;

export function enqueueProfilePatch(chatId: number, payload: Partial<UserProfile>): void {
  const fields = Object.keys(payload);
  if (fields.length === 0) {
    return;
  }
  const existing = profileQueue.find((item) => item.chatId === chatId);
  if (existing) {
    existing.payload = { ...existing.payload, ...payload };
  } else {
    profileQueue.push({ chatId, payload: { ...payload } });
  }
}

export async function tryFlushProfileQueue(): Promise<void> {
  if (!profileQueue.length) {
    return;
  }
  if (!config.apiBaseUrl?.trim()) {
    return;
  }

  for (let index = 0; index < profileQueue.length; ) {
    const task = profileQueue[index];
    const session = sessionStore.get(task.chatId);
    if (!session || !session.jwt) {
      index += 1;
      continue;
    }
    const client = createApiClient(session.jwt);
    try {
      const profile = await client.updateProfile(task.payload);
      if (profile) {
        sessionStore.update(task.chatId, { profile });
      }
      profileQueue.splice(index, 1);
      logger.info(
        "profile patch flushed",
        { chatId: task.chatId, fields: Object.keys(task.payload) },
      );
    } catch (error) {
      if (isNetworkError(error)) {
        logger.warn("profile patch flush deferred chatId=%d", task.chatId);
      } else {
        logger.error("profile patch flush failed chatId=%d %o", task.chatId, error);
      }
      index += 1;
    }
  }
}

export function startProfileSync(intervalMs = 30_000): void {
  if (flushInterval) {
    return;
  }
  flushInterval = setInterval(() => {
    tryFlushProfileQueue().catch((error) => {
      logger.error("profile sync loop error %o", error);
    });
  }, intervalMs);
  if (typeof flushInterval.unref === "function") {
    flushInterval.unref();
  }
}
