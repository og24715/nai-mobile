import MainPage from "@/components/MainPage";
import SetupPage from "@/components/SetupPage";
import { Toaster } from "@/components/ui/sonner";

// Tiny path-based routing: the setup page lives at "setup" relative to
// wherever the app is mounted ("/" on :8196, "/nai/" via the gateway).
// The Toaster (improvement #25) sits at the root; MainPage fires an
// error toast for every error it puts in the status line. Top-center
// keeps it clear of the bottom-right FABs and the form Drawer, and
// the longer duration leaves time to read upstream error messages.
export default function App() {
  const p = window.location.pathname;
  const isSetup = p.endsWith("/setup") || p.endsWith("/setup/");
  return (
    <>
      {isSetup ? <SetupPage /> : <MainPage />}
      <Toaster position="top-center" duration={6000} />
    </>
  );
}
