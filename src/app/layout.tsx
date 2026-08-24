import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Checklists · Version2",
  description: "Organization-aware checklist template authoring",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
