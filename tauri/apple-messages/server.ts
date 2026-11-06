/*
 * What an app's server needs to check an upload of texts from Apple Messages: the limits the plugin cuts each text to
 * (./names.ts, their one owner) and the shape of a text. The server imports this entry alone, never the page's.
 * Checking the upload, storing the texts and keeping which Mac may upload are the app's.
 */
export {
  BATCH_SIZE,
  MAX_FIELD_UNITS,
  MAX_GUID_UNITS,
  MAX_PARTICIPANTS,
  MAX_SERVICE_UNITS,
  MAX_TEXT_UNITS,
} from './names';
export type { MacPerson, MacText, MessagesUpload } from './index';
