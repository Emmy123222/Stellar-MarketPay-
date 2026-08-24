import { useEffect } from "react";
import { useToast } from "./Toast";

export default function RateLimitWatcher() {
  const toast = useToast();

  useEffect(() => {
    let lastShown = 0;
    const handleWarning = () => {
      const now = Date.now();
      if (now - lastShown > 5000) {
        toast.info("Slowing down... API rate limit approaching.");
        lastShown = now;
      }
    };

    window.addEventListener("ratelimit-warning", handleWarning);
    return () => {
      window.removeEventListener("ratelimit-warning", handleWarning);
    };
  }, [toast]);

  return null;
}
