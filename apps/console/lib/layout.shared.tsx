import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <span className="fd-brand">
          <span className="fd-brand-mark" aria-hidden="true" />
          finity
        </span>
      ),
      url: "/",
    },
    links: [
      {
        text: "home",
        url: "/",
      },
    ],
    themeSwitch: {
      enabled: false,
    },
  };
}
