import type { ReactNode } from "react";
import { RootProvider } from "fumadocs-ui/provider/next";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { source } from "@/lib/source";
import { baseOptions } from "@/lib/layout.shared";
import "./docs.css";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="finity-docs dark">
      <RootProvider theme={{ defaultTheme: "dark", forcedTheme: "dark" }}>
        <DocsLayout tree={source.getPageTree()} {...baseOptions()}>
          {children}
        </DocsLayout>
      </RootProvider>
    </div>
  );
}
