"use client";

import { useEffect } from "react";
import { errorFields, reportClientError } from "@/lib/log.mjs";

/** Sends uncaught browser errors and unhandled promise rejections to the server logs. */
export default function ErrorReporter() {
  useEffect(() => {
    const onError = (e: ErrorEvent) =>
      reportClientError("uncaught", {
        ...errorFields(e.error ?? e.message),
        route: location.pathname,
        line: e.lineno,
        col: e.colno,
      });
    const onRejection = (e: PromiseRejectionEvent) =>
      reportClientError("unhandled_rejection", { ...errorFields(e.reason), route: location.pathname });
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}
