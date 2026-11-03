declare module "virtual:diffmap" {
  import type { ViewerDocument } from "../parseViewer.js";
  export const viewerDocument: ViewerDocument | null;
  export const parseError: string | null;
}

declare module "virtual:diffmap-export" {
  import type { ExportSnapshot } from "../export.js";
  export const snapshot: ExportSnapshot;
}
