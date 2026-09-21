/**
 * Helpers for parallel workspace group-chat bot turns.
 */

/** Serialize HITL approval so parallel bots don't share one waiter unsafely. */
export function createApprovalMutex(): <T>(fn: () => Promise<T>) => Promise<T> {
  let chain: Promise<unknown> = Promise.resolve();
  return function withApprovalLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = chain.then(() => fn(), () => fn());
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
}

/** First caller wins — used so only one bot writes the user transcript. */
export function createClaimGate(): () => boolean {
  let claimed = false;
  return () => {
    if (claimed) return false;
    claimed = true;
    return true;
  };
}

export function workspaceBotRunThreadId(
  groupThreadId: string,
  botId: string,
): string {
  return `${groupThreadId}__${botId}`;
}
