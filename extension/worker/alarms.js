// Background work on a clock, on chrome.alarms.
//
// Chrome stops an idle service worker after about thirty seconds, and its
// setInterval and setTimeout timers with it. An alarm survives: Chrome starts
// the worker again to deliver it. What the work needs across a restart belongs
// in chrome.storage, since the worker's variables do not survive either.

/**
 * Runs `run` every `minutes` minutes, from now on, in every worker that starts.
 * Call it at the top level of the worker, so the listener is in place when
 * Chrome starts the worker to deliver the alarm. The alarm is created only
 * when missing, so a revival does not push the next run back.
 * @param {string} name
 * @param {number} minutes Chrome's least is half a minute
 * @param {() => unknown} run
 */
export function every(name, minutes, run) {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === name) run();
  });
  chrome.alarms.get(name).then((existing) => {
    if (!existing || existing.periodInMinutes !== minutes) chrome.alarms.create(name, { periodInMinutes: minutes });
  });
}
