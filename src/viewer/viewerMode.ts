import { createContext, useContext } from "react";

export type ViewerMode = "local" | "gist" | "github" | "host" | "export";

export const ViewerModeContext = createContext<ViewerMode>("local");

export function useViewerMode() {
  return useContext(ViewerModeContext);
}
