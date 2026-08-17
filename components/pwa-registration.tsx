"use client";

import { useEffect } from "react";

export function PwaRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      return;
    }

    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((registration) => registration.update())
      .catch((error: unknown) => {
        if (process.env.NODE_ENV === "development") {
          console.error("Service Workerの登録に失敗しました", error);
        }
      });
  }, []);

  return null;
}
