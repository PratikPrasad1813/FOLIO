const { app, BrowserWindow, shell, session } = require("electron");
const path = require("path");

const APP_ID = "com.folio.workspace";
const PROTOCOL = "folio";

app.setAppUserModelId(APP_ID);

// 1. Register the custom protocol (folio://) in Windows
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient(PROTOCOL);
}

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: "Folio",
    icon: path.join(__dirname, "icon.ico"),
    autoHideMenuBar: true,
    backgroundColor: "#0d0d11",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Open the app directly to overview
  mainWindow.loadURL("https://folio-management-studio.netlify.app/overview");

  // If unauthenticated or navigating to login/signup, open Chrome
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url.includes("/login") || url.includes("/signup")) {
      event.preventDefault();
      shell.openExternal("https://folio-management-studio.netlify.app/desktop-auth");
    }
  });

  // Intercept button popups/links
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.includes("/login") || url.includes("/signup") || url.includes("/auth")) {
      shell.openExternal("https://folio-management-studio.netlify.app/desktop-auth");
      return { action: "deny" };
    }
    return { action: "allow" };
  });
}

// 2. Handle the return from Chrome (folio://auth?token=...)
function handleAuthUrl(rawUrl) {
  if (!rawUrl || !rawUrl.startsWith("folio://")) return;

  try {
    const url = new URL(rawUrl);
    const token = url.searchParams.get("token");

    if (token) {
      // Set the session cookie directly inside the Electron app
      session.defaultSession.cookies
        .set({
          url: "https://folio-management-studio.netlify.app",
          name: "folio_session", // Matches your Next.js session cookie name
          value: decodeURIComponent(token),
          domain: "folio-management-studio.netlify.app",
          path: "/",
          secure: true,
          httpOnly: true,
          sameSite: "lax",
        })
        .then(() => {
          if (mainWindow) {
            mainWindow.loadURL("https://folio-management-studio.netlify.app/overview");
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
          }
        });
    }
  } catch (err) {
    console.error("Failed to parse auth URL:", err);
  }
}

// 3. Ensure single app instance lock & capture Windows protocol calls
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  // When Chrome calls folio:// while the app is already running
  app.on("second-instance", (event, commandLine) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
    const deepLink = commandLine.find((arg) => arg.startsWith("folio://"));
    if (deepLink) handleAuthUrl(deepLink);
  });

  app.whenReady().then(() => {
    createWindow();

    // In case the app was launched directly from Chrome via folio://
    const deepLink = process.argv.find((arg) => arg.startsWith("folio://"));
    if (deepLink) handleAuthUrl(deepLink);

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});