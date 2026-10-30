/** Runs one server-confirmed dashboard action; resolves `true` once the server and a fresh snapshot confirm it. */
export type RunAction = (key: string, work: () => Promise<unknown>, success: string) => Promise<boolean>;
