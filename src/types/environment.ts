/** Environment variables as read by configuration helpers; `process.env` satisfies it and tests pass plain objects. */
export type Environment = Readonly<Record<string, string | undefined>>;
