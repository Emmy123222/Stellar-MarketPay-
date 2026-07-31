import { useEffect } from "react";
import { useToast } from "./Toast";

export default function RateLimitWatcher() {
  const toast = useToast();

  useEffect(() => {
    const handleWarning = () => {
      toast.info("Slowing down... API rate limit approaching.");
    };

    window.addEventListener("ratelimit-warning", handleWarning);
    return () => {
      window.removeEventListener("ratelimit-warning", handleWarning);
    };
  }, [toast]);

  return null;
}
