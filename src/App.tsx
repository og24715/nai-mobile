import MainPage from "@/components/MainPage";
import SetupPage from "@/components/SetupPage";

// Tiny path-based routing: the setup page lives at "setup" relative to
// wherever the app is mounted ("/" on :8196, "/nai/" via the gateway).
export default function App() {
  const p = window.location.pathname;
  const isSetup = p.endsWith("/setup") || p.endsWith("/setup/");
  return isSetup ? <SetupPage /> : <MainPage />;
}
