import { createRoot } from "react-dom/client";
import { TRPCProvider } from "./lib/trpc";
import App from "./App.tsx";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <TRPCProvider>
    <App />
  </TRPCProvider>
);