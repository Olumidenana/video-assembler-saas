"use client";

import { useEffect } from "react";

/** Fades `.reveal` elements in as they scroll into view. Mounted once in the layout. */
export function RevealObserver() {
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.setAttribute("data-shown", "");
            observer.unobserve(entry.target);
          }
        }
      },
      { rootMargin: "0px 0px -10% 0px" },
    );
    const observe = () => document.querySelectorAll(".reveal:not([data-shown])").forEach((el) => observer.observe(el));
    observe();
    // Pick up elements added later (client-rendered sections).
    const mutations = new MutationObserver(observe);
    mutations.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      mutations.disconnect();
    };
  }, []);
  return null;
}
