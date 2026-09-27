import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Image Genie",
  description: "A local review and organization layer for Immich",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
