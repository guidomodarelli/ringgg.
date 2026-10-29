/** The first-entry prompt remains visible until this browser has a push subscription. */
export function needsNotificationSetup(supported: boolean, permission: NotificationPermission | 'unsupported', hasSubscription: boolean, registeredForResident: boolean): boolean {
  return !supported || permission !== 'granted' || !hasSubscription || !registeredForResident;
}
