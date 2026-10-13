import type { MetadataRoute } from "next";
import { SITE } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  return SITE.routes.map((r) => ({ url: `${SITE.url}${r.path}`, lastModified: new Date(), changeFrequency: "weekly", priority: r.priority }));
}
