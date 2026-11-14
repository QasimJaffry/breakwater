/** The collector's export format, consumed by the CLI and dashboard. Contains no user data. */
export interface Snapshot {
  schema: 1;
  generatedAt: string;
  windowDays: number;
  /** Active installs per app version seen in the window. */
  versions: { platform: string; version: string; installs: number }[];
  /** route -> path -> list of "platform@version" that read it in the window. */
  usage: Record<string, Record<string, string[]>>;
}
export const vkey = (platform: string, version: string) => `${platform}@${version}`;
