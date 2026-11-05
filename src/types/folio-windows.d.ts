interface FolioWindowsAPI {
  sendNotification(title: string, body: string, actions?: string[]): void;
  minimize(): void;
  maximize(): void;
  close(): void;
  setBadgeCount(count: number): void;
  setLaunchOnStartup(enabled: boolean): void;
  getLaunchOnStartup(): Promise<boolean>;
  onQuickAddTriggered(callback: () => void): () => void;
}

declare global {
  interface Window {
    folioWindowsAPI?: FolioWindowsAPI;
  }
}

export {};
