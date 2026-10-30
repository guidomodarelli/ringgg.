/** Runs one server-confirmed dashboard action; resolves `true` once the server and a fresh snapshot confirm it. `success` may derive the message from the server result. */
export type RunAction = (key: string, work: () => Promise<unknown>, success: string | ((result: unknown) => string)) => Promise<boolean>;
