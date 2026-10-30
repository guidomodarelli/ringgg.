/**
 * How the open app moves onto a new deployment. Once the last request that changes data ends, the
 * reload waits this long, so what follows its answer (a confirmation, or opening a just-created
 * home) runs first. If another change starts in the meantime, it waits for that one too.
 */
export const APP_UPDATES = { settleBeforeReloadMs: 1_500 };
