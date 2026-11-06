/*
 * The page half of reading Apple Messages, for a Tauri app's Mac build with the plugin in plugin/ (README.md's "Reading
 * Apple Messages" says how a shell takes it in). macOS opens the Messages database only to an app the person has added
 * to Full Disk Access; the plugin reads it, and this asks it whether it can (`status`), for new texts (`since`), to open
 * System Settings there and to reopen the app once access is granted. `catchUp` reads from where the last upload
 * stopped to the end, batch by batch, and hands each batch to the app's upload. Where texts go, which Mac reads them,
 * and how often a round runs are the app's.
 */
import { COMMANDS, PLUGIN, SERVICE_CONNECT_HOST, SERVICE_SCHEME } from './names';

export {
  BATCH_SIZE,
  COMMANDS,
  CONNECT_CODE_MS,
  FULL_DISK_ACCESS_PANE,
  HOLD_READS,
  LOG_PREFIX,
  MAX_FIELD_UNITS,
  MAX_GUID_UNITS,
  MAX_PARTICIPANTS,
  MAX_SERVICE_UNITS,
  MAX_TEXT_UNITS,
  MESSAGES_SERVICE_ROUTES,
  PLUGIN,
  SERVICE_APP_NAME,
  SERVICE_BUNDLE_ID,
  SERVICE_LATEST_JSON,
  SERVICE_OPEN_PATHS,
  SERVICE_SCHEME,
} from './names';

/** A person in a chat: their phone number or email as Messages has it, and their name from Contacts if they are on a card. */
export type MacPerson = { handle: string; name: string | null };

/**
 * One text, as the plugin reads it (plugin/src/reader.rs Text). `senderKind` is `me` for a text sent from this Mac's
 * account, `contact` for a sender on a Contacts card (named or not), `short_code` for a 5- or 6-digit sender not on
 * one, and `unknown` for anyone else. When Contacts could not be read, nobody is `unknown`: everyone else is `contact`.
 * A text that is only an attachment reads "[photo]" or "[attachment]".
 */
export type MacText = {
  /** Messages' own id for the text: the key that keeps an upload from storing it twice. */
  guid: string;
  /** Its row in this Mac's Messages database, which only this Mac's read marks mean anything against. */
  rowid: number;
  chatGuid: string;
  chatName: string | null;
  participants: MacPerson[];
  /** The sender's handle, or "me". */
  senderHandle: string;
  senderName: string | null;
  senderKind: 'me' | 'contact' | 'short_code' | 'unknown';
  /** "iMessage", "SMS" or "RCS". */
  service: string;
  sentAtMs: number;
  text: string;
};

/** One read (plugin/src/reader.rs Batch). */
export type MacBatch = {
  texts: MacText[];
  /** The highest row examined, skipped rows included: the next read starts after it. */
  scannedTo: number;
  /** The database's highest row. Below the last mark means Messages rebuilt its database. */
  maxRowid: number;
  /** False when Contacts could not be read, and so nobody is `unknown`. */
  contactsRead: boolean;
};

/** `denied`: the app is not in Full Disk Access, or macOS applies the grant only once the app is reopened. */
export type MessagesAccess = 'granted' | 'denied' | 'no_database';
export type MessagesStatus = { access: MessagesAccess; contactsRead: boolean };

export type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

const tauriInvoke: Invoke = async (command, args) => (await import('@tauri-apps/api/core')).invoke(command, args);
const plugin = (command: string) => `plugin:${PLUGIN}|${command}`;

/**
 * The plugin's commands. `since` rejects with its reason as a string ("denied", "read failed: …"); `reopen` rejects
 * while Messages can already be read, since it is only for a grant macOS applies at launch.
 */
export function macMessages(invoke: Invoke = tauriInvoke) {
  return {
    status: () => invoke(plugin(COMMANDS.access)) as Promise<MessagesStatus>,
    since: (afterRowid: number | null, sinceMs: number) =>
      invoke(plugin(COMMANDS.since), { afterRowid, sinceMs }) as Promise<MacBatch>,
    openFullDiskAccess: () => invoke(plugin(COMMANDS.openFullDiskAccess)) as Promise<void>,
    reopen: () => invoke(plugin(COMMANDS.reopen)) as Promise<void>,
  };
}

/** A first read goes back this far, and a database Messages rebuilt is read again from this far back. */
export const FIRST_READ_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Batches per catch-up: 40 × 500 texts is plenty for 14 days, and the rest waits for the next round. */
export const MAX_BATCHES = 40;

/** Where an upload stands: the app's stored mark (null before the first upload), and the first day it reads. */
export type CatchUpMark = { readMark: number | null; readFrom: number };

/** One batch for the app's server: the texts, the new mark, and whether the mark moved back for a rebuilt database. */
export type MessagesUpload = { texts: MacText[]; scannedTo: number; reset: boolean };

/**
 * One destination's catch-up: read after the mark and upload, batch by batch, until the reader has scanned to the end
 * or MAX_BATCHES. The first read (no mark yet) starts at the first text sent since `readFrom`. Every read leaves out
 * texts sent before `readFrom`, including old ones Messages syncs in later with higher rows. A read whose database ends
 * below the mark (Messages rebuilt it) starts again FIRST_READ_DAYS back, or at `readFrom` if that is later, and its
 * upload says `reset`; the app keys texts by guid, so nothing is stored twice. A failed read or upload rejects, and the
 * app's mark stays where its server holds it. `toEnd` is false while a row Messages is still writing holds the read
 * below the end.
 */
export async function catchUp(deps: {
  mark: CatchUpMark;
  now: number;
  read: (afterRowid: number | null, sinceMs: number) => Promise<MacBatch>;
  upload: (upload: MessagesUpload) => Promise<unknown>;
}): Promise<{ uploaded: number; batches: number; toEnd: boolean }> {
  let after = deps.mark.readMark;
  const sinceMs = deps.mark.readFrom;
  let uploaded = 0;
  for (let batches = 0; batches < MAX_BATCHES; batches++) {
    let batch = await deps.read(after, sinceMs);
    let reset = false;
    if (after !== null && batch.maxRowid < after) {
      console.log(`[apple-messages] the Messages database ends at ${batch.maxRowid}, below ${after}: reading ${FIRST_READ_DAYS} days again`);
      batch = await deps.read(null, Math.max(sinceMs, deps.now - FIRST_READ_DAYS * DAY_MS));
      reset = true;
    }
    const moved = after === null || batch.scannedTo > after || reset;
    // Nothing new: at the end, unless the reader stopped below a text Messages is still writing.
    if (!moved) return { uploaded, batches, toEnd: batch.scannedTo >= batch.maxRowid };
    await deps.upload({ texts: batch.texts, scannedTo: batch.scannedTo, reset });
    uploaded += batch.texts.length;
    after = batch.scannedTo;
    if (batch.scannedTo >= batch.maxRowid) return { uploaded, batches: batches + 1, toEnd: true };
  }
  return { uploaded, batches: MAX_BATCHES, toEnd: false };
}

/*
 * Messages Service, the Mac app that holds the one Full Disk Access grant and pushes texts to the server of each app
 * the person connects (server.ts says how). An app's page connects the person's texts to its server with a code from
 * its server and the link below, which the service opens in its own window to ask the person; nothing flows until they
 * say yes there, with the app's host and the account the code was made for in front of them. In a Tauri Mac app the
 * plugin installs the service when it is missing and opens the link, since the window opens no other app's links; in a browser the page opens the link itself, and offers the download when no app
 * answers it.
 */

/** The link that asks the service to connect: `address` is the app's routes, as `${origin}${MESSAGES_SERVICE_ROUTES}`. */
export function connectLink({ address, code }: { address: string; code: string }): string {
  const query = new URLSearchParams({ address, code });
  return `${SERVICE_SCHEME}://${SERVICE_CONNECT_HOST}?${query}`;
}

/** What `installService` did: opened the copy already in Applications, or downloaded, checked and installed one. */
export type ServiceInstall = { done: 'opened' | 'installed'; path: string };

/**
 * The plugin's service commands. `installService(teamId)` opens the installed service, or downloads its latest
 * release, installs it only if it is signed by the team `teamId` (the 10 characters of the person's Apple Developer
 * team) and notarized by Apple, and opens it; it rejects with its reason, and nothing is put in Applications.
 * `openConnectLink(teamId, link)` hands a connectLink to the installed copy, checked the same way, by its path, so no
 * other app that claims the link's scheme gets the code.
 */
export function messagesService(invoke: Invoke = tauriInvoke) {
  return {
    installService: (teamId: string) => invoke(plugin(COMMANDS.installService), { teamId }) as Promise<ServiceInstall>,
    openConnectLink: (teamId: string, link: string) =>
      invoke(plugin(COMMANDS.openConnectLink), { teamId, link }) as Promise<void>,
  };
}
