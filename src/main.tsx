import React from "react";
import ReactDOM from "react-dom/client";
import DesktopApp from "./desktop/DesktopApp";
import { isDesktop } from "./desktop/api";
// Fonts are self-hosted (no Google Fonts request; required by the desktop CSP).
import "@fontsource/space-grotesk/400.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/600.css";
import "@fontsource/space-grotesk/700.css";
import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/500.css";
import "@fontsource/dm-sans/600.css";
import "@fontsource/dm-sans/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "./i18n"; // initialize translations before the first render
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {isDesktop() ? <DesktopApp /> : <p style={{ padding: 24, fontFamily: "sans-serif" }}>This is the DS5 Dongle OLED Edition desktop app&apos;s interface. Open the app to use it.</p>}
  </React.StrictMode>,
);
