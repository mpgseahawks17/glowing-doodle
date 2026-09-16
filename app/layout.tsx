import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NFL Survivor",
  description: "Weekly survivor pick model",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
