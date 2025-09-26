import logger from "../logger";
import { sessionStore } from "../session";
import { ApiError, createApiClient, isNetworkError } from "../services/apiClient";
import { RegistrationPayload, SessionData, UserProfile } from "../types";
import { config } from "../config";

interface RegistrationTask {
  chatId: number;
  payload: RegistrationPayload;
}

interface ProfilePatchTask {
  chatId: number;
  payload: Partial<UserProfile>;
}

const registrationQueue: RegistrationTask[] = [];
const profileQueue: ProfilePatchTask[] = [];
let flushInterval: NodeJS.Timeout | null = null;

export function enqueueRegistration(chatId: number, payload: RegistrationPayload): void {
  const existing = registrationQueue.find((item) => item.chatId === chatId);
  if (existing) {
    existing.payload = { ...payload };
  } else {
    registrationQueue.push({ chatId, payload: { ...payload } });
  }
}

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

async function tryFlushRegistrationQueue(): Promise<void> {
  if (!registrationQueue.length) {
    return;
  }
  if (!config.apiBaseUrl?.trim()) {
    return;
  }

  for (let index = 0; index < registrationQueue.length; ) {
    const task = registrationQueue[index];
    const client = createApiClient();
    try {
      const result = await client.register(task.payload);
      registrationQueue.splice(index, 1);
      logger.info("registration flush succeeded", { chatId: task.chatId });
      const session = sessionStore.get(task.chatId);
      if (session) {
        const patch: Partial<SessionData> = {
          jwt: result.token,
          profile: result.user,
          language: result.user.language,
          pendingRegistration: undefined,
        };
        if (session.mode === "registration") {
          patch.mode = "idle";
        }
        sessionStore.update(task.chatId, patch);
      }
    } catch (error) {
      if (isNetworkError(error)) {
        logger.warn("registration flush deferred chatId=%d", task.chatId);
        index += 1;
        continue;
      }
      if (error instanceof ApiError && error.status === 409) {
        registrationQueue.splice(index, 1);
        logger.warn("registration flush conflict chatId=%d", task.chatId);
        const session = sessionStore.get(task.chatId);
        if (session) {
          sessionStore.update(task.chatId, {
            pendingRegistration: undefined,
            registration: undefined,
            mode: "login",
            login: { stepIndex: 0 },
          });
        }
        continue;
      }
      logger.error("registration flush failed chatId=%d %o", task.chatId, error);
      registrationQueue.splice(index, 1);
    }
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
  const run = async () => {
    await tryFlushRegistrationQueue();
    await tryFlushProfileQueue();
  };
  flushInterval = setInterval(() => {
    run().catch((error) => {
      logger.error("profile sync loop error %o", error);
    });
  }, intervalMs);
  run().catch((error) => {
    logger.error("profile sync loop error %o", error);
  });
  if (typeof flushInterval.unref === "function") {
    flushInterval.unref();
  }
}
