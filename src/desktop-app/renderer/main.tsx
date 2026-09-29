import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App.js";
import { DataTipLayer } from "./DataTipLayer.js";
import {
  isWorkspacesWindow,
  WorkspacesWindow,
} from "./WorkspacesWindow.js";

const Root = isWorkspacesWindow() ? WorkspacesWindow : App;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
    <DataTipLayer />
  </React.StrictMode>,
);
