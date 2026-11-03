import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MauiProvider } from "maui";
import { snapshot } from "virtual:diffmap-export";
import { HostFilesContext } from "../host/files.ts";
import {
  ChangesLoaderContext,
  type ChangesLoader,
} from "../viewer/changesSource.ts";
import { ViewerApp } from "../viewer/ViewerApp.tsx";
import "../viewer/styles.css";
import { WORKING } from "../changes.ts";

const loadChanges: ChangesLoader = (rev) =>
  Promise.resolve(
    snapshot.changes[rev] ??
      (rev === WORKING
        ? { rev, title: "Captured sources", files: [] }
        : new Error(`This export has no snapshot of ${rev}.`)),
  );
const root = document.getElementById("root");
if (root === null) throw new Error("diffmap root element is missing");
createRoot(root).render(
  <StrictMode>
    <MauiProvider>
      <HostFilesContext.Provider value={snapshot.files}>
        <ChangesLoaderContext.Provider value={loadChanges}>
          <ViewerApp
            document={snapshot.document}
            title={snapshot.title}
            mode="export"
          />
        </ChangesLoaderContext.Provider>
      </HostFilesContext.Provider>
    </MauiProvider>
  </StrictMode>,
);
