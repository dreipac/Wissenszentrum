import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AppThemeProvider, applyAppTheme, readAppTheme } from "./lib/appTheme";
import "./styles/tokens.css";
import "./styles/global.css";
import "./styles/buttons.css";

// Das gewählte Farbschema gilt schon vor dem ersten Bild, damit beim Start nichts aufblitzt
applyAppTheme(readAppTheme());

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AppThemeProvider>
      <App />
    </AppThemeProvider>
  </React.StrictMode>,
);
